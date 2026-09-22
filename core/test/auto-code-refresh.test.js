const test = require('node:test');
const assert = require('node:assert/strict');

const { createAutoCodeRefreshService } = require('../src/runtime/auto-code-refresh');

function createService(account, logs) {
  return createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: () => ({ enabled: false, intervalMinutes: 60 }),
    },
    getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: () => {},
    resolveWorkerControls: () => ({}),
    log: (...args) => logs.push(args),
    addAccountLog: () => {},
  });
}

test('QQ accounts do not emit a missing wxid warning during Code refresh scheduling', () => {
  const logs = [];
  const service = createService({ id: 'qq-1', name: 'QQ account', platform: 'qq' }, logs);

  service.scheduleAccount('qq-1');

  assert.deepEqual(logs, []);
});

test('WeChat accounts still report a missing wxid during Code refresh scheduling', () => {
  const logs = [];
  const service = createService({ id: 'wx-1', name: 'WeChat account', platform: 'wx' }, logs);

  service.scheduleAccount('wx-1');

  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], '自动刷新 Code 未启动: 账号缺少 wxid');
});

function createNapcatService(account, options = {}) {
  const updated = { calls: 0, account: null };
  const restarts = { calls: 0, account: null };
  const logs = [];
  const service = createAutoCodeRefreshService({
    store: {
      getAutoCodeRefresh: () => ({
        enabled: options.enabled !== undefined ? options.enabled : true,
        intervalMinutes: options.intervalMinutes || 60,
      }),
    },
    getAccounts: () => ({ accounts: [account] }),
    addOrUpdateAccount: (acc) => {
      updated.calls += 1;
      updated.account = acc;
    },
    resolveWorkerControls: () => ({
      restartWorker: (acc) => {
        restarts.calls += 1;
        restarts.account = acc;
      },
    }),
    log: (...args) => logs.push(args),
    addAccountLog: () => {},
  });
  return { service, updated, restarts, logs };
}

function napcatAccount() {
  return {
    id: 'qq-nap-1',
    name: 'QQ NapCat account',
    platform: 'qq',
    code: 'old-code',
    napcatApi: 'http://127.0.0.1:6099/plugin/napcat-plugin-qq-farm-code/api',
    napcatKey: 'k',
  };
}

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  }
  finally {
    globalThis.fetch = original;
  }
}

test('NapCat QQ accounts enable scheduled Code refresh', () => {
  const { service, logs } = createNapcatService(napcatAccount(), { enabled: true });

  service.scheduleAccount('qq-nap-1');
  service.stopAccount('qq-nap-1');

  assert.equal(logs.some((entry) => entry[1] === '自动刷新 Code 已启用: QQ NapCat account，间隔 60 分钟'), true);
});

test('NapCat refresh success persists the new code and restarts the worker', async () => {
  const { service, updated, restarts } = createNapcatService(napcatAccount());
  const ok = await withFetch(
    () => new Response(JSON.stringify({ ok: true, uin: 1, code: 'napcat-code-1' }), { status: 200 }),
    () => service.refreshAccountCode('qq-nap-1', 'ws_400'),
  );

  assert.equal(ok, true);
  assert.equal(updated.calls, 1);
  assert.equal(updated.account.code, 'napcat-code-1');
  assert.equal(restarts.calls, 1);
  assert.equal(restarts.account.code, 'napcat-code-1');
});

test('NapCat refresh failure returns false and does not restart the worker', async () => {
  const { service, updated, restarts } = createNapcatService(napcatAccount());
  const ok = await withFetch(async () => {
    throw new Error('ECONNREFUSED');
  }, () => service.refreshAccountCode('qq-nap-1', 'ws_400'));

  assert.equal(ok, false);
  assert.equal(updated.calls, 0);
  assert.equal(restarts.calls, 0);
});

test('QQ accounts without any auto-refresh source cannot recover their code', async () => {
  const account = { id: 'qq-manual-1', name: 'QQ manual', platform: 'qq', code: 'manual-code' };
  const { service, updated, restarts } = createNapcatService(account, { enabled: false });

  const ok = await withFetch(async () => ({ json: async () => ({ ok: true, code: 'x' }) }), () => service.refreshAccountCode('qq-manual-1', 'ws_400'));

  assert.equal(ok, false);
  assert.equal(updated.calls, 0);
  assert.equal(restarts.calls, 0);
});

