/**
 * QQ经典农场 code 获取插件（协议自动化版，无抓包、无证书、无管理员权限）
 *
 * 背景：code 传统上只能通过「在 QQ 客户端里打开【经典农场】小程序」产生，
 * 但 GitHub 扫码/API 方式（q.qq.com/ide/login）已被腾讯封禁。本插件用【协议自动化】解决：
 *   QQNT 内核 misc.loginWithAppId('1112386029') 直接签发小程序登录 code，
 *   再用 protobuf 直连农场网关 wss://gate-obt.nqf.qq.com/prod/ws，
 *   发 gamepb.userpb.UserService.Login（空 body 即可）完成登录，返回农场身份。
 *   全程无需打开 QQ 界面、无需抓包、无需管理员权限。
 *
 * HTTP 接口（WebUI 端口，前缀 /plugin/napcat-plugin-qq-farm-code/api/）：
 *   GET  /proto/code   -> 取农场登录 code（loginWithAppId）
 *   GET  /proto/login  -> 取 code 并直连网关完成农场登录（返回 GID/昵称/open_id）
 *   （可选 ?appid= 换小程序；?ver= 覆盖版本号，用于探测新版本）
 *
 * 安全：若 data/config.json 配置了 key，则以上接口需带 ?key=xxx 或
 *       header x-napcat-farm-key 才能访问；key 留空则不鉴权（单机/本地用）。
 *
 * 配置（data/config.json，缺省用内置默认值；改完重启生效）：
 *   { "appid": "...", "serverUrl": "...", "ver": "1.13.3.14_20260826", "key": "" }
 *
 * 登录编排（出码/扫码/状态/被踢重登）不在本插件：登录请走 QQ 客户端或 WebUI
 * 扫码完成（插件在登录成功后加载），本插件只管取 code / 农场登录。
 *
 * 跨平台：主功能为纯 Node + QQ 内核会话，Windows/Linux 均可用（Linux 需 Node>=22.4）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(PLUGIN_DIR, 'data');
const CONFIG_FILE = path.join(DATA, 'config.json');
const CODES_FILE = path.join(DATA, 'codes.json');
const MAX_CODES = 100; // 历史 code 最多保留条数

// ---------------- 配置（外置，可覆盖） ----------------
const DEFAULT_CONFIG = {
  appid: '1112386029',
  serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
  platform: 'qq',
  os: 'iOS',
  // 版本号不能低于网关最小值，否则网关踢下线 reason=10「客户端版本过低」。
  // 当前用真实客户端版本（用户抓包确认 1.13.3.14_20260826）；低于 20260801 会被踢。
  // 农场升级后可带 ?ver= 先试新版本，或用 farm-test/probe-version.mjs 探测新下限。
  ver: '1.13.3.14_20260826',
  wsHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
    'Origin': 'https://gate-obt.nqf.qq.com',
  },
  key: '', // 留空=不鉴权；设置后 /proto/code、/proto/login 需带 ?key= 或 x-napcat-farm-key
};

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
    return {
      ...DEFAULT_CONFIG,
      ...c,
      wsHeaders: { ...DEFAULT_CONFIG.wsHeaders, ...(c.wsHeaders || {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG, wsHeaders: { ...DEFAULT_CONFIG.wsHeaders } };
  }
}
function saveConfig() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2));
  } catch {}
}
let CONFIG = loadConfig();

// ---------------- 已获取的 code 历史（持久化，只留最近 MAX_CODES 条） ----------------
let CODES = [];
function loadCodes() {
  try {
    const arr = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveCodes() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(CODES_FILE, JSON.stringify(CODES.slice(-MAX_CODES), null, 2));
  } catch {}
}
function pushCode(code, uin) {
  CODES.push({ code, uin, time: new Date().toISOString(), source: 'proto' });
  CODES = CODES.slice(-MAX_CODES);
  saveCodes();
}

// ---------------- 小工具 ----------------
function log(logger, msg) {
  try { logger.log('[QQ农场] ' + msg); } catch {}
}

// ---------------- 极简 protobuf 编解码（农场网关协议） ----------------
// 手写实现 gatepb.Message{meta,body} 与 userpb.LoginReply 的线格式，避免引入 protobufjs。

function pbVarint(n) {
  n = Number(n) || 0;
  const out = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
function pbTag(field, wireType) {
  return pbVarint((field << 3) | wireType);
}
function pbInt(field, n) {
  n = Number(n);
  if (!n) return Buffer.alloc(0);
  return Buffer.concat([Buffer.from(pbTag(field, 0)), Buffer.from(pbVarint(n))]);
}
function pbStr(field, s) {
  if (s === undefined || s === null || s === '') return Buffer.alloc(0);
  const b = Buffer.from(String(s), 'utf8');
  return Buffer.concat([Buffer.from(pbTag(field, 2)), Buffer.from(pbVarint(b.length)), b]);
}
function pbBytes(field, buf) {
  if (!buf || buf.length === 0) return Buffer.alloc(0);
  return Buffer.concat([Buffer.from(pbTag(field, 2)), Buffer.from(pbVarint(buf.length)), buf]);
}
const pbMsg = pbBytes;

// 解码：返回 { fieldNum: [values...] }，wireType=2 的值为 Buffer。
// 带长度/迭代/移位防护，畸形数据不会死循环。
function pbDecode(buf) {
  const map = {};
  let pos = 0;
  const maxLen = buf.length;
  let guard = 0;
  const readVarint = () => {
    let v = 0, shift = 0, b;
    do {
      if (pos >= maxLen || shift > 63) return v; // 越界/移位溢出即停
      b = buf[pos++];
      v += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b & 0x80);
    return v;
  };
  const readBytes = () => {
    let len = readVarint();
    if (pos + len > maxLen) len = maxLen - pos; // 越界截断
    const out = buf.slice(pos, pos + len);
    pos += len;
    return out;
  };
  const readTag = () => (pos >= maxLen ? null : readVarint());
  let tag;
  while ((tag = readTag()) !== null && guard++ < 2048) {
    const field = tag >>> 3;
    const wt = tag & 7;
    let value;
    if (wt === 0) value = readVarint();
    else if (wt === 1) { if (pos + 8 <= maxLen) { value = buf.readDoubleLE(pos); pos += 8; } else break; }
    else if (wt === 2) value = readBytes();
    else if (wt === 5) { if (pos + 4 <= maxLen) { value = buf.readFloatLE(pos); pos += 4; } else break; }
    else break;
    if (!map[field]) map[field] = [];
    map[field].push(value);
  }
  return map;
}

// 注意：qq-farm-bot 逆向出的 LoginRequest 字段（device_info=5/scene_id=7/report_data=8）
// 与农场服务器真实 schema 不符 —— 按它编码会被 grpc 以 "cannot parse invalid wire-format data" 拒绝。
// 实测【空 LoginRequest】即返回 err=0 并建立真实账户会话（返回 GID/昵称/open_id/等级）。
function encodeLoginRequest() {
  return Buffer.alloc(0);
}

function encodeGateMessage(service, method, bodyBytes, clientSeq) {
  return Buffer.concat([
    pbMsg(1, Buffer.concat([
      pbStr(1, service),
      pbStr(2, method),
      pbInt(3, 1),          // message_type = Request
      pbInt(4, clientSeq),  // client_seq
    ])),
    pbBytes(2, bodyBytes),
  ]);
}
function decodeLoginReply(buf) {
  const m = pbDecode(buf);
  const b = m[1]?.[0] ? pbDecode(Buffer.from(m[1][0])) : null;
  const num = (x) => (x ? x[0] : undefined);
  return {
    gid: num(b?.[1]),
    name: b?.[2]?.[0] ? Buffer.from(b[2][0]).toString('utf8') : undefined,
    level: num(b?.[3]),
    exp: num(b?.[4]),
    gold: num(b?.[5]),
    open_id: b?.[6]?.[0] ? Buffer.from(b[6][0]).toString('utf8') : undefined,
    time_now_millis: num(m[3]),
    is_first_login: num(m[4]),
  };
}

// 直连农场网关：ws 握手 -> 发 Login -> 收 LoginReply -> 短暂停留收推送 -> 关闭
// ver 可用参数覆盖 CONFIG.ver（探测新版本号用）
function connectFarmLogin(code, { timeout = 15000, ver } = {}) {
  return new Promise((resolve) => {
    const useVer = ver || CONFIG.ver;
    const WS = globalThis.WebSocket;
    if (!WS) return resolve({ ok: false, stage: 'no-ws', error: '当前 Node 无全局 WebSocket（需 >=22.4）' });
    const url = `${CONFIG.serverUrl}?platform=${CONFIG.platform}&os=${CONFIG.os}&ver=${useVer}&code=${code}&openID=`;
    let ws;
    try {
      ws = new WS(url, { headers: CONFIG.wsHeaders });
    } catch (e) {
      return resolve({ ok: false, stage: 'ws-create', error: String(e?.message || e) });
    }
    ws.binaryType = 'arraybuffer';

    const out = { ok: false, code, url, ver: useVer };
    let finished = false;
    const finish = (patch) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      Object.assign(out, patch);
      resolve(out);
    };
    const timer = setTimeout(() => finish({ stage: 'timeout', error: '整体超时 ' + timeout + 'ms' }), timeout);

    ws.onopen = () => {
      out.gate = 'open';
      try {
        ws.send(encodeGateMessage('gamepb.userpb.UserService', 'Login', encodeLoginRequest(), 1));
        out.sent = 'Login';
      } catch (e) {
        finish({ stage: 'send-login', error: String(e?.message || e) });
      }
    };
    ws.onmessage = (ev) => {
      let meta, body;
      try {
        const data = ev.data;
        const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data);
        const gm = pbDecode(buf);
        meta = gm[1]?.[0] ? pbDecode(Buffer.from(gm[1][0])) : {};
        body = gm[2]?.[0] ? Buffer.from(gm[2][0]) : Buffer.alloc(0);
      } catch {
        return; // 帧解析失败，忽略该帧（不打断连接）
      }
      const method = meta[2]?.[0] ? Buffer.from(meta[2][0]).toString('utf8') : '';
      const errCode = meta[6]?.[0] || 0;
      if (meta[3]?.[0] !== 2) return; // 只处理 Response
      if (method !== 'Login') return;
      if (errCode !== 0) {
        return finish({ stage: 'login', error: `农场拒绝 code: code=${errCode} ${meta[7]?.[0] ? Buffer.from(meta[7][0]).toString('utf8') : ''}` });
      }
      try {
        out.login = decodeLoginReply(body);
      } catch (e) {
        return finish({ stage: 'decode-reply', error: 'LoginReply 解码失败: ' + String(e?.message || e) });
      }
      out.openID = out.login.open_id || '';
      out.recvCount = (out.recvCount || 0) + 1;
      // 短暂停留接收几条服务器推送，然后正常关闭（会话已验证真实）
      setTimeout(() => finish({ ok: true, stage: 'done', note: '登录成功' }), 1000);
    };
    ws.onerror = () => { if (!out.login) finish({ stage: 'ws-error', error: 'WebSocket error' }); };
    ws.onclose = (ev) => {
      if (out.login) finish({ ok: true, stage: 'closed-after-login', note: '网关在登录完成后关闭连接 code=' + ev?.code });
      else finish({ stage: 'ws-close', error: '网关关闭连接 code=' + ev?.code + (ev?.reason ? ' reason=' + ev.reason : '') });
    };
  });
}

// ---------------- 鉴权 ----------------
// key 留空 = 不鉴权；配置了 key 则需 ?key= 或 header x-napcat-farm-key 一致
function checkAuth(req) {
  const k = CONFIG.key;
  if (!k) return true;
  const got = (req.query && req.query.key) || (req.headers && req.headers['x-napcat-farm-key']) || '';
  return String(got) === String(k);
}

// ---------------- 插件入口 ----------------
export async function plugin_init(context) {
  const { core, router, logger } = context;

  CONFIG = loadConfig();
  CODES = loadCodes();
  saveConfig(); // 确保 data/config.json 存在，方便编辑 key 等配置

  const authOk = (req, res) => {
    if (checkAuth(req)) return true;
    res.status(401).json({ ok: false, error: 'unauthorized: 需要 ?key= 或 header x-napcat-farm-key' });
    return false;
  };

  // 协议自动化：获取农场小程序登录 code（loginWithAppId）
  router.getNoAuth('/proto/code', async (req, res) => {
    try {
      if (!authOk(req, res)) return;
      const session = core?.context?.session;
      if (!session) return res.json({ error: 'no session' });
      const misc = session.getNodeMiscService();
      const uin = core?.selfInfo?.uin;
      const appid = req.query?.appid || CONFIG.appid;
      try {
        const r = await misc.loginWithAppId(appid);
        const code = r?.result || null;
        if (code) {
          log(logger, 'loginWithAppId 成功 code=' + code);
          res.json({ ok: true, uin, appid, code, raw: r });
        } else {
          res.json({ ok: false, uin, appid, raw: r });
        }
      } catch (e) {
        res.json({ error: String(e?.message || e) });
      }
    } catch (e) {
      res.json({ error: String(e?.message || e) });
    }
  });

  // 协议自动化：取 code 并端到端登录农场（返回农场 GID/昵称/open_id）
  router.getNoAuth('/proto/login', async (req, res) => {
    try {
      if (!authOk(req, res)) return;
      const session = core?.context?.session;
      if (!session) return res.json({ error: 'no session' });
      const misc = session.getNodeMiscService();
      const uin = core?.selfInfo?.uin;
      const appid = req.query?.appid || CONFIG.appid;
      const ver = req.query?.ver || CONFIG.ver; // ?ver= 覆盖：探测新版本号时用，不必改代码
      const codeRes = await misc.loginWithAppId(appid);
      const code = codeRes?.result || null;
      if (!code) return res.json({ ok: false, stage: 'loginWithAppId', uin, appid, raw: codeRes });

      log(logger, 'loginWithAppId code=' + code + (ver !== CONFIG.ver ? ` (ver=${ver})` : ''));
      const farm = await connectFarmLogin(code, { timeout: 15000, ver });
      if (farm.ok && farm.login) pushCode(code, uin);
      res.json({ uin, appid, code, ...farm, raw: codeRes });
    } catch (e) {
      res.json({ error: String(e?.message || e) });
    }
  });

  // 加载时输出说明
  try {
    log(logger, '插件已加载（协议自动化版）。鉴权: ' + (CONFIG.key ? '已启用(?key=xxx)' : '未启用(本地无鉴权，建议设 key 或绑本机)'));
    log(logger, '取 code:  GET /plugin/napcat-plugin-qq-farm-code/api/proto/code' + (CONFIG.key ? '?key=xxx' : ''));
    log(logger, '登录验证: GET /plugin/napcat-plugin-qq-farm-code/api/proto/login' + (CONFIG.key ? '?key=xxx' : ''));
    log(logger, '历史 code: ' + CODES.length + ' 条（最多保留 ' + MAX_CODES + ' 条）');
  } catch {}
}

// 仅测试导出（NapCat 只调用 plugin_init，这些不影响运行）
export { pbDecode, pushCode };
