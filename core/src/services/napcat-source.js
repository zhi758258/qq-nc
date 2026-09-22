// QQ 农场号经 NapCat + napcat-plugin-qq-farm-code 签发农场登录 code。
// 插件 HTTP 端点(前缀为 NapCat WebUI 端口):
//   GET <base>/proto/code   —— 用 QQNT 会话直接签发小程序登录 code
//   GET <base>/proto/login  —— 取 code 并直连农场网关完成登录，返回农场身份
// 账号配置:
//   napcatApi  —— 插件 HTTP 前缀, 形如 http://127.0.0.1:6099/plugin/napcat-plugin-qq-farm-code/api
//   napcatKey  —— 插件 data/config.json 中的 key, 留空表示不鉴权
// 详细见仓库 AGENTS.md 与 qq-code 插件 README。

const NAPCAT_KEY_HEADER = 'x-napcat-farm-key';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ERROR_TEXT = 200;

function normalizeBaseApi(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('NapCat 取码地址为空');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('NapCat 取码地址不是合法 URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('NapCat 取码地址必须是 http(s):// 前缀');
  }
  return raw;
}

function buildUrl(baseApi, path, query) {
  const url = `${normalizeBaseApi(baseApi)}${path}`;
  const search = query || {};
  const keys = Object.keys(search).filter(
    (k) => search[k] !== undefined && search[k] !== null && String(search[k]).trim() !== '',
  );
  if (keys.length === 0) return url;
  const params = new URLSearchParams();
  for (const key of keys) params.set(key, String(search[key]));
  return `${url}?${params.toString()}`;
}

function authHeaders(key) {
  const trimmed = String(key || '').trim();
  if (!trimmed) return {};
  return { [NAPCAT_KEY_HEADER]: trimmed };
}

function errorTextSnippet(text) {
  const value = String(text || '').trim().replace(/\s+/g, ' ').slice(0, MAX_ERROR_TEXT);
  return value || 'HTTP 请求失败';
}

async function httpGetJson(url, { key, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...authHeaders(key),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? `请求超时(>${Math.max(500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)}ms)` : String((err && err.message) || err);
    throw new Error(`NapCat 取码接口不可达: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  let text = '';
  try {
    text = await response.text();
  } catch {
    // 响应体读取失败时按空文本处理
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON 响应，交由上层统一报错
  }

  if (!response.ok) {
    throw new Error(`NapCat 接口返回 HTTP ${response.status}: ${errorTextSnippet(text)}`);
  }
  if (!json || typeof json !== 'object') {
    throw new Error(`NapCat 接口返回非 JSON 内容: ${errorTextSnippet(text)}`);
  }
  if (json.error) {
    throw new Error(`NapCat 接口报错: ${errorTextSnippet(String(json.error))}`);
  }
  return json;
}

function readCodePayload(json) {
  const code = json && typeof json.code === 'string' ? json.code.trim() : '';
  if (!code) {
    const raw = json && json.raw && typeof json.raw === 'object' ? JSON.stringify(json.raw) : '';
    throw new Error(`NapCat 取码失败(插件 ok=${json && json.ok !== undefined ? json.ok : '?'}${raw ? '，详情见 raw' : ''})`);
  }
  return {
    code,
    uin: json.uin !== undefined ? String(json.uin) : '',
  };
}

function readLoginPayload(json) {
  const code = json && typeof json.code === 'string' ? json.code.trim() : '';
  if (!code) {
    const stage = json && json.stage ? String(json.stage) : '';
    const errMsg = json && json.error ? String(json.error) : (stage ? '' : JSON.stringify(json).slice(0, MAX_ERROR_TEXT));
    throw new Error(`NapCat 农场登录失败(${stage || 'loginWithAppId'})${errMsg ? `: ${errMsg}` : ''}`);
  }
  if (json.ok !== true) {
    const errMsg = json && json.error ? String(json.error) : '';
    const stage = json && json.stage ? String(json.stage) : '';
    throw new Error(`NapCat 农场登录失败(${stage || 'login'})${errMsg ? `: ${errMsg}` : ''}`);
  }
  const login = json.login && typeof json.login === 'object' ? json.login : null;
  if (!login) throw new Error('NapCat 农场登录成功但缺少农场身份(login)');
  return {
    code,
    uin: json.uin ? String(json.uin) : '',
    appid: json.appid ? String(json.appid) : '',
    farm: {
      gid: login.gid !== undefined ? String(login.gid) : '',
      name: login.name !== undefined ? String(login.name) : '',
      level: login.level !== undefined ? String(login.level) : '',
      open_id: login.open_id !== undefined ? String(login.open_id) : '',
    },
  };
}

function requestCode(source) {
  const options = source && typeof source === 'object' ? source : {};
  const url = buildUrl(options.napcatApi, '/proto/code');
  return httpGetJson(url, { key: options.napcatKey, timeoutMs: options.timeoutMs }).then(readCodePayload);
}

function requestLogin(source) {
  const options = source && typeof source === 'object' ? source : {};
  const query = {};
  if (options.ver) query.ver = String(options.ver).trim();
  const url = buildUrl(options.napcatApi, '/proto/login', query);
  return httpGetJson(url, { key: options.napcatKey, timeoutMs: options.timeoutMs }).then(readLoginPayload);
}

module.exports = {
  NAPCAT_KEY_HEADER,
  DEFAULT_TIMEOUT_MS,
  normalizeBaseApi,
  buildUrl,
  httpGetJson,
  requestCode,
  requestLogin,
};
