const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
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
function visitorRequest(pathname, host) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { host } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
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

test('routes wildcard subdomains without path rewriting', async () => {
  const tunnelId = 'subdomain';
  const registration = (await api('/api/register', { id: tunnelId, port: 4321, timeout: 10 })).data;
  assert.equal(registration.publicUrl, `https://${tunnelId}.webtnx.nxlabtw.com/`);
  const key = decode(registration.encryptionKey);
  const visitor = visitorRequest('/dashboard?view=activity', `${tunnelId}.webtnx.nxlabtw.com`);
  await new Promise(resolve => setTimeout(resolve, 80));
  const poll = await api('/api/reqs', { id: tunnelId }, registration.token);
  assert.equal(poll.data.requests.length, 1);
  assert.equal(poll.data.requests[0].path, '/dashboard');
  assert.equal(poll.data.requests[0].query.view, 'activity');
  await api('/api/res', {
    requestId: poll.data.requests[0].id,
    status: 302,
    headers: {
      location: 'http://localhost:4321/login',
      'set-cookie': 'session=abc; Domain=localhost; Path=/; HttpOnly',
      'content-type': 'text/html'
    },
    payload: encrypt(Buffer.from('<script src="/assets/app.js"></script>'), key)
  }, registration.token);
  const response = await visitor;
  assert.equal(response.headers.location, `https://${tunnelId}.webtnx.nxlabtw.com/login`);
  assert.match(response.headers['set-cookie'][0], /Path=\//);
  assert.doesNotMatch(response.headers['set-cookie'][0], /Domain=localhost/i);
  assert.equal(response.body.toString(), '<script src="/assets/app.js"></script>');
});

test('automatically prefixes statically identifiable asset paths with the tunnel ID', async () => {
  const tunnelId = 'assetpaths';
  const registration = (await api('/api/register', { id: tunnelId, port: 4321, timeout: 10 })).data;
  const key = decode(registration.encryptionKey);

  async function relay(pathname, contentType, body) {
    const visitor = fetch(`${base}/${tunnelId}${pathname}`);
    await new Promise(resolve => setTimeout(resolve, 80));
    const poll = await api('/api/reqs', { id: tunnelId }, registration.token);
    assert.equal(poll.data.requests.length, 1);
    await api('/api/res', {
      requestId: poll.data.requests[0].id,
      status: 200,
      headers: { 'content-type': contentType },
      payload: encrypt(Buffer.from(body), key)
    }, registration.token);
    return (await visitor).text();
  }

  const html = await relay('/', 'text/html; charset=utf-8', [
    '<link href="/styles/app.css">',
    '<script src="/scripts/app.js"></script>',
    '<img src="/images/logo.png" srcset="/images/one.png 1x, /images/two.png 2x">',
    '<video poster="/images/poster.jpg"></video>',
    '<form action="/submit"></form>',
    '<base href="/app/">',
    '<link href="/assetpaths/already.css">',
    '<img src="https://cdn.example/logo.png">'
  ].join(''));
  assert.match(html, /href="\/assetpaths\/styles\/app\.css"/);
  assert.match(html, /src="\/assetpaths\/scripts\/app\.js"/);
  assert.match(html, /srcset="\/assetpaths\/images\/one\.png 1x, \/assetpaths\/images\/two\.png 2x"/);
  assert.match(html, /poster="\/assetpaths\/images\/poster\.jpg"/);
  assert.match(html, /action="\/assetpaths\/submit"/);
  assert.match(html, /href="\/assetpaths\/app\/"/);
  assert.equal((html.match(/\/assetpaths\/already\.css/g) || []).length, 1);
  assert.match(html, /https:\/\/cdn\.example\/logo\.png/);

  const css = await relay('/styles/app.css', 'text/css', '@import "/theme.css";body{background:url(/images/hero.png)}');
  assert.match(css, /@import "\/assetpaths\/theme\.css"/);
  assert.match(css, /url\(\/assetpaths\/images\/hero\.png\)/);

  const javascript = await relay('/scripts/app.js', 'application/javascript', [
    'import module from "/modules/app.js";',
    "fetch('/api/items');",
    'const image=`/images/icon.svg`;',
    'const existing="/assetpaths/ready";',
    'const external="https://cdn.example/app.js";'
  ].join(''));
  assert.match(javascript, /"\/assetpaths\/modules\/app\.js"/);
  assert.match(javascript, /fetch\('\/assetpaths\/api\/items'\)/);
  assert.match(javascript, /`\/assetpaths\/images\/icon\.svg`/);
  assert.equal((javascript.match(/\/assetpaths\/ready/g) || []).length, 1);
  assert.match(javascript, /https:\/\/cdn\.example\/app\.js/);

  const redirectVisitor = fetch(`${base}/${tunnelId}/account`, { redirect: 'manual' });
  await new Promise(resolve => setTimeout(resolve, 80));
  const redirectPoll = await api('/api/reqs', { id: tunnelId }, registration.token);
  assert.equal(redirectPoll.data.requests.length, 1);
  await api('/api/res', {
    requestId: redirectPoll.data.requests[0].id,
    status: 302,
    headers: {
      location: 'http://localhost:4321/login?next=%2Faccount',
      'set-cookie': 'session=abc; Domain=localhost; Path=/; HttpOnly',
      link: '</assets/app.css>; rel=preload; as=style'
    },
    payload: encrypt(Buffer.alloc(0), key)
  }, registration.token);
  const redirectResponse = await redirectVisitor;
  assert.equal(redirectResponse.headers.get('location'), '/assetpaths/login?next=%2Faccount');
  assert.match(redirectResponse.headers.get('set-cookie'), /Path=\/assetpaths\//);
  assert.doesNotMatch(redirectResponse.headers.get('set-cookie'), /Domain=localhost/i);
  assert.match(redirectResponse.headers.get('link'), /<\/assetpaths\/assets\/app\.css>/);
});
