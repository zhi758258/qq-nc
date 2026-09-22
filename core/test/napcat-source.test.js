const test = require('node:test');
const assert = require('node:assert/strict');

const napcatSource = require('../src/services/napcat-source');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
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

test('normalizeBaseApi strips trailing slashes and rejects non-http URLs', () => {
  assert.equal(
    napcatSource.normalizeBaseApi('http://127.0.0.1:6099/plugin/napcat-plugin-qq-farm-code/api/'),
    'http://127.0.0.1:6099/plugin/napcat-plugin-qq-farm-code/api',
  );
  assert.throws(() => napcatSource.normalizeBaseApi('ftp://x/api'), /http\(s\)/);
  assert.throws(() => napcatSource.normalizeBaseApi('not-a-url'), /合法 URL|http\(s\)/);
});

test('buildUrl points to /proto/code and appends ver query', () => {
  const url = napcatSource.buildUrl('http://h:1/api/', '/proto/code');
  assert.equal(url, 'http://h:1/api/proto/code');

  const withVer = napcatSource.buildUrl('http://h:1/api', '/proto/login', { ver: '1.13.3.14_20260826' });
  assert.equal(withVer, 'http://h:1/api/proto/login?ver=1.13.3.14_20260826');
});

test('requestCode parses ok response and sends the key header', async () => {
  let calledUrl = '';
  let calledHeaders;
  await withFetch(async (url, init) => {
    calledUrl = String(url);
    calledHeaders = init.headers;
    return jsonResponse({ ok: true, uin: 123456, appid: '1112386029', code: 'abc123' });
  }, () => napcatSource.requestCode({
    napcatApi: 'http://napcat.local/plugin/napcat-plugin-qq-farm-code/api',
    napcatKey: 'secret-key',
  }));

  assert.equal(calledUrl, 'http://napcat.local/plugin/napcat-plugin-qq-farm-code/api/proto/code');
  assert.equal(calledHeaders['x-napcat-farm-key'], 'secret-key');
});

test('requestCode returns code and uin from plugin payload', async () => {
  const result = await withFetch(() => jsonResponse({ ok: true, uin: 998877, code: 'farm-code-1' }), () => napcatSource.requestCode({ napcatApi: 'http://h/api' }));
  assert.equal(result.code, 'farm-code-1');
  assert.equal(result.uin, '998877');
});

test('requestCode normalizes non-json / http error / plugin error responses', async () => {
  await assert.rejects(
    () => withFetch(() => textResponse('<html>gateway</html>'), () => napcatSource.requestCode({ napcatApi: 'http://h/api' })),
    /非 JSON/,
  );
  await assert.rejects(
    () => withFetch(() => jsonResponse({ error: 'unauthorized' }, 401), () => napcatSource.requestCode({ napcatApi: 'http://h/api' })),
    /HTTP 401/,
  );
  await assert.rejects(
    () => withFetch(() => jsonResponse({ ok: false, uin: 1, raw: {} }), () => napcatSource.requestCode({ napcatApi: 'http://h/api' })),
    /取码失败/,
  );
});

test('requestCode reports unreachable endpoint errors', async () => {
  await assert.rejects(
    () => withFetch(async () => {
      throw new Error('ECONNREFUSED');
    }, () => napcatSource.requestCode({ napcatApi: 'http://h/api', timeoutMs: 500 })),
    /接口不可达/,
  );
});

test('requestLogin parses farm identity from a successful login', async () => {
  const result = await withFetch(() => jsonResponse({
    uin: 5566,
    appid: '1112386029',
    code: 'login-code',
    ok: true,
    stage: 'done',
    ver: '1.13.3.14_20260826',
    login: { gid: 77001, name: '农场主', level: 3, open_id: 'open-xyz' },
  }), () => napcatSource.requestLogin({ napcatApi: 'http://h/api', ver: '1.13.3.14_20260826' }));

  assert.equal(result.code, 'login-code');
  assert.equal(result.uin, '5566');
  assert.equal(result.farm.gid, '77001');
  assert.equal(result.farm.name, '农场主');
  assert.equal(result.farm.open_id, 'open-xyz');
});

test('requestLogin rejects rejected-code and failed-gateway-login payloads', async () => {
  await assert.rejects(
    () => withFetch(() => jsonResponse({ ok: false, stage: 'loginWithAppId', uin: 1, raw: {} }), () => napcatSource.requestLogin({ napcatApi: 'http://h/api' })),
    /农场登录失败/,
  );
  await assert.rejects(
    () => withFetch(() => jsonResponse({ uin: 1, code: 'c', ok: false, stage: 'login', error: 'reason=10' }), () => napcatSource.requestLogin({ napcatApi: 'http://h/api' })),
    /reason=10/,
  );
});
