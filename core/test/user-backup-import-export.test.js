const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'user-backup-test-'));

const userStore = require('../src/models/user-store');
const routes = require('../src/controllers/admin-user-manage-routes');

const DEFAULT_ADMIN_USERNAME = userStore.defaultAdmin.username;

function seedUser({ username, password = 'Secret123', role = 'user', qq = '', note = '', accountLimit = 2 }) {
  const { salt, hash } = userStore.hashPassword(password);
  return {
    username,
    qq,
    passwordSalt: salt,
    passwordHash: hash,
    role,
    accountLimit,
    cardCode: '',
    note,
    mustChangePassword: false,
    createdAt: new Date().toISOString(),
  };
}

function seedCard({ code, type = 'time', days = 30 }) {
  return {
    code,
    type,
    days,
    description: '备份测试卡密',
    status: 'unused',
    enabled: true,
    createdAt: new Date().toISOString(),
    usedBy: '',
    usedAt: '',
  };
}

/* ============================ 导出 ============================ */

test('导出备份包含用户与卡密，并保留密码凭据', () => {
  const backup = userStore.exportUserBackup();
  assert.equal(backup.format, 'qq-farm-bot-user-backup');
  assert.equal(backup.version, 1);
  assert.ok(Array.isArray(backup.users));
  assert.ok(Array.isArray(backup.cards));
  assert.equal(typeof backup.exportedAt, 'string');
  assert.equal(backup.counts.users, backup.users.length);
  assert.equal(backup.counts.cards, backup.cards.length);

  const admin = backup.users.find(user => user.username === DEFAULT_ADMIN_USERNAME);
  assert.ok(admin, '备份应包含默认管理员');
  assert.ok(admin.passwordSalt, '备份应包含密码盐');
  assert.ok(admin.passwordHash, '备份应包含密码哈希');
});

/* ============================ 导入：新增 ============================ */

test('skip 模式新增缺失用户与卡密，并跳过同名记录', () => {
  const backup = {
    format: 'qq-farm-bot-user-backup',
    version: 1,
    users: [
      seedUser({ username: 'backup_skip_a', qq: '', note: 'a' }),
      seedUser({ username: DEFAULT_ADMIN_USERNAME, role: 'admin' }),
    ],
    cards: [seedCard({ code: 'BK_SKIP_1' }), seedCard({ code: 'BK_SKIP_2' })],
  };

  const result = userStore.importUserBackup({ backup, mode: 'skip' });
  assert.equal(result.ok, true);
  assert.equal(result.data.added, 1);
  assert.equal(result.data.overwritten, 0);
  assert.equal(result.data.skipped, 1);
  assert.equal(result.data.cardsAdded, 2);
  assert.equal(result.data.cardsSkipped, 0);

  assert.ok(userStore.findUser('backup_skip_a'));
  assert.equal(userStore.getOneCardByCode('BK_SKIP_1')?.code, 'BK_SKIP_1');
  assert.equal(userStore.findUser(DEFAULT_ADMIN_USERNAME).role, 'super_admin', 'skip 模式不得改写已有管理员');
});

test('导入的用户可以使用备份中的原密码登录', () => {
  const password = 'BackupPass456';
  const backup = {
    users: [seedUser({ username: 'backup_login_user', password })],
    cards: [],
  };
  const result = userStore.importUserBackup({ backup, mode: 'skip' });
  assert.equal(result.ok, true);

  const restored = userStore.findUser('backup_login_user');
  assert.ok(restored);
  assert.equal(userStore.verifyPassword(password, restored.passwordSalt, restored.passwordHash), true);
  assert.equal(userStore.verifyPassword('wrong-password', restored.passwordSalt, restored.passwordHash), false);
});

/* ============================ 导入：覆盖 ============================ */

test('overwrite 模式以备份覆盖同名用户与卡密', () => {
  userStore.addUser({ username: 'backup_overwrite', password: 'Original1', role: 'user', accountLimit: 1, note: '旧备注' });
  const before = userStore.findUser('backup_overwrite');
  assert.equal(before.accountLimit, 1);

  const backup = {
    users: [seedUser({ username: 'backup_overwrite', password: 'Replaced1', accountLimit: 9, note: '新备注' })],
    cards: [seedCard({ code: 'BK_OVERWRITE' })],
  };
  const first = userStore.importUserBackup({ backup, mode: 'skip' });
  assert.equal(first.data.added, 0);
  assert.equal(first.data.skipped, 1);

  const result = userStore.importUserBackup({ backup, mode: 'overwrite' });
  assert.equal(result.ok, true);
  assert.equal(result.data.added, 0);
  assert.equal(result.data.overwritten, 1);
  assert.equal(result.data.cardsAdded, 0, '卡密已在 skip 阶段新增');
  assert.equal(result.data.cardsOverwritten, 1);

  const after = userStore.findUser('backup_overwrite');
  assert.equal(after.accountLimit, 9, 'overwrite 应以备份额度覆盖');
  assert.equal(after.note, '新备注');
  assert.equal(userStore.verifyPassword('Replaced1', after.passwordSalt, after.passwordHash), true);

  const overwriteAgain = userStore.importUserBackup({
    backup: { users: [], cards: [seedCard({ code: 'BK_OVERWRITE' })] },
    mode: 'overwrite',
  });
  assert.equal(overwriteAgain.data.cardsOverwritten, 1);
  assert.equal(overwriteAgain.data.cardsAdded, 0);
});

/* ============================ 导入：安全校验 ============================ */

test('导入拒绝格式非法或空内容的备份', () => {
  assert.equal(userStore.importUserBackup({ backup: null }).ok, false);
  assert.match(userStore.importUserBackup({ backup: 'not-an-object' }).error, /格式不正确/);
  assert.match(
    userStore.importUserBackup({ backup: { format: 'other-format', users: [] } }).error,
    /类型不匹配/,
  );
  assert.match(userStore.importUserBackup({ backup: { cards: [] } }).error, /缺少用户列表/);
  assert.match(
    userStore.importUserBackup({ backup: { users: [], cards: [] } }).error,
    /没有可导入的记录/,
  );
  assert.match(
    userStore.importUserBackup({ backup: { users: [seedUser({ username: 'x' })] }, mode: 'replace' }).error,
    /导入模式不正确/,
  );
});

test('导入跳过非法用户与非法卡密并报告原因', () => {
  const noHash = seedUser({ username: 'backup_no_hash' });
  delete noHash.passwordHash;

  const result = userStore.importUserBackup({
    backup: {
      users: [
        seedUser({ username: 'backup_valid_entry' }),
        { username: 'bad name!', passwordSalt: 'aa', passwordHash: 'bb' },
        noHash,
        { username: 'admin', passwordSalt: 'aa', passwordHash: 'bb' },
      ],
      cards: [seedCard({ code: 'BK_VALID' }), { code: '', days: 1 }],
    },
    mode: 'skip',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.added, 1);
  assert.equal(result.data.invalidUsers.length, 3);
  assert.equal(result.data.invalidCards.length, 1);
  assert.equal(result.data.cardsAdded, 1);
  assert.ok(result.data.invalidUsers.some(item => /密码凭据/.test(item.reason)));
  assert.ok(result.data.invalidUsers.some(item => /保留用户名/.test(item.reason)));
  assert.ok(!userStore.findUser('bad name!'));
});

test('导入结果若不含超级管理员则整体取消', () => {
  const backup = {
    users: [seedUser({ username: DEFAULT_ADMIN_USERNAME, role: 'user' })],
    cards: [],
  };
  const result = userStore.importUserBackup({ backup, mode: 'overwrite' });
  assert.equal(result.ok, false);
  assert.match(result.error, /超级管理员/);
  assert.equal(userStore.findUser(DEFAULT_ADMIN_USERNAME).role, 'super_admin', '取消导入不应修改数据');
});

test('overwrite 模式保护当前登录账号不被覆盖', () => {
  const before = userStore.findUser('backup_overwrite');
  const backup = {
    users: [seedUser({ username: 'backup_overwrite', password: 'Hacked1', accountLimit: 0 })],
    cards: [],
  };
  const result = userStore.importUserBackup({
    backup,
    mode: 'overwrite',
    protectedUsernames: ['backup_overwrite'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.overwritten, 0);
  assert.equal(result.data.skipped, 1);
  assert.equal(result.data.protectedSkipped.length, 1);

  const after = userStore.findUser('backup_overwrite');
  assert.equal(after.accountLimit, before.accountLimit, '受保护账号不应被改动');
});

/* ============================ 路由 ============================ */

function createMockApp() {
  const handlers = { get: [], post: [], put: [], delete: [] };
  const app = {
    get: (route, ...args) => handlers.get.push({ route, handlers: args }),
    post: (route, ...args) => handlers.post.push({ route, handlers: args }),
    put: (route, ...args) => handlers.put.push({ route, handlers: args }),
    delete: (route, ...args) => handlers.delete.push({ route, handlers: args }),
  };
  return { app, handlers };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

async function invoke(handlersList, route, req, res) {
  const entry = handlersList.find((item) => item.route === route);
  assert.ok(entry, `未找到路由 ${route}`);
  let advanced = true;
  let index = 0;
  while (advanced && index < entry.handlers.length) {
    advanced = false;
    const handler = entry.handlers[index];
    index += 1;
    await handler(req, res, () => {
      advanced = true;
    });
  }
}

function registerRoutes({ role = 'super_admin', confirmed = true } = {}) {
  const { app, handlers } = createMockApp();
  routes.registerAdminUserManageRoutes({
    app,
    logger: { warn() {}, info() {}, error() {} },
    userStore,
    requireAdminToken: (req, res, next) => {
      req.currentUser = { username: DEFAULT_ADMIN_USERNAME, role };
      next();
    },
    requireAdminRole: (req, res, next) => next(),
    requireSuperAdminRole: (req, res, next) => {
      if (!req.currentUser || req.currentUser.role !== 'super_admin') {
        res.status(403).json({ ok: false, error: '需要超级管理员权限' });
        return;
      }
      next();
    },
    requireDangerConfirmation: (req, res) => {
      if (confirmed !== true) {
        res.status(400).json({ ok: false, error: '危险操作未确认' });
        return false;
      }
      return true;
    },
    getAdminUserMutationError: () => null,
  });
  return handlers;
}

test('GET /api/admin/users/backup/export 返回可下载的备份数据', async () => {
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.get, '/api/admin/users/backup/export', {}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.format, 'qq-farm-bot-user-backup');
  assert.ok(Array.isArray(res.payload.data.users));
});

test('导出接口拒绝普通管理员', async () => {
  const handlers = registerRoutes({ role: 'admin' });
  const res = createRes();
  await invoke(handlers.get, '/api/admin/users/backup/export', {}, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.ok, false);
});

test('导入接口需要危险操作确认', async () => {
  const handlers = registerRoutes({ confirmed: false });
  const res = createRes();
  await invoke(handlers.post, '/api/admin/users/backup/import', {
    body: { backup: { users: [seedUser({ username: 'route_confirm_user' })], cards: [] }, mode: 'skip' },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.equal(userStore.findUser('route_confirm_user'), null, '未确认时不应写入数据');
});

test('导入接口在确认后写入数据并保护当前登录账号', async () => {
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/users/backup/import', {
    body: {
      backup: {
        users: [
          seedUser({ username: 'route_import_user' }),
          seedUser({ username: DEFAULT_ADMIN_USERNAME, role: 'user' }),
        ],
        cards: [seedCard({ code: 'BK_ROUTE' })],
      },
      mode: 'overwrite',
    },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.added, 1);
  assert.equal(res.payload.data.skipped, 1);
  assert.ok(userStore.findUser('route_import_user'));
  assert.equal(userStore.findUser(DEFAULT_ADMIN_USERNAME).role, 'super_admin', '当前登录账号应受保护');
});

test('导入接口对非法备份返回 400', async () => {
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/users/backup/import', {
    body: { backup: { format: 'other', users: [] }, mode: 'skip' },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
});
