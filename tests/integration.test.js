const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = 32191;
const base = `http://127.0.0.1:${port}`;
let server;

function decode(value) { return Buffer.from(value, 'base64url'); }
function encode(value) { return Buffer.from(value).toString('base64url'); }
function encrypt(body, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
  return { algorithm: 'AES-256-GCM', iv: encode(iv), data: encode(data) };
}
function decrypt(payload, key) {
  const combined = decode(payload.data);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, decode(payload.iv));
  decipher.setAuthTag(combined.subarray(-16));
  return Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]);
}
async function api(pathname, data, token) {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data)
  });
  return { response, data: await response.json() };
}

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: 'ignore'
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
});

test.after(() => server?.kill());

test('forwards and authenticates a complete HTTP request', async () => {
  const registration = (await api('/api/register', { id: 'integration', port: 4321, timeout: 10 })).data;
  assert.equal(registration.success, true);
  const key = decode(registration.encryptionKey);
  const originalBody = Buffer.from(JSON.stringify({ hello: 'frosted world' }));
  const visitor = fetch(`${base}/integration/webhook?mode=test`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic example', 'x-custom': 'kept' }, body: originalBody
  });
  await new Promise(resolve => setTimeout(resolve, 80));
  const poll = await api('/api/reqs', { id: 'integration' }, registration.token);
  assert.equal(poll.response.status, 200);
  assert.equal(poll.data.requests.length, 1);
  const request = poll.data.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/webhook');
  assert.equal(request.query.mode, 'test');
  assert.equal(request.headers['x-custom'], 'kept');
  assert.equal(request.headers.authorization, 'Basic example');
  assert.deepEqual(decrypt(request.payload, key), originalBody);
  assert.ok(request.source.ip);

  const responseBody = Buffer.from('relay-complete');
  const agentResponse = await api('/api/res', {
    requestId: request.id, status: 202, headers: { 'content-type': 'text/plain', 'x-upstream': 'yes' }, payload: encrypt(responseBody, key)
  }, registration.token);
  assert.equal(agentResponse.response.status, 200);
  const publicResponse = await visitor;
  assert.equal(publicResponse.status, 202);
  assert.equal(publicResponse.headers.get('x-upstream'), 'yes');
  assert.equal(await publicResponse.text(), 'relay-complete');
});

test('rejects an unauthenticated agent poll', async () => {
  const result = await api('/api/reqs', { id: 'integration' });
  assert.equal(result.response.status, 401);
});
