const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ACTIVE_WINDOW_MS = 20_000;
const MAX_TIMEOUT_SECONDS = 120;
const MAX_QUEUE_PER_TUNNEL = 10;
const MAX_PENDING_REQUESTS = 64;
const MAX_QUEUED_BODY_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CONTROL_BODY_BYTES = 3 * 1024 * 1024;
const pagesDir = path.join(__dirname, 'pages');
const tunnels = new Map();
const pendingRequests = new Map();
let queuedBodyBytes = 0;

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/create', ['create.html', 'text/html; charset=utf-8']],
  ['/tunnel', ['tunnel.html', 'text/html; charset=utf-8']],
  ['/download', ['download.html', 'text/html; charset=utf-8']],
  ['/docs', ['docs.html', 'text/html; charset=utf-8']],
  ['/timeout.html', ['timeout.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/site.js', ['site.js', 'application/javascript; charset=utf-8']]
]);
const staticCache = new Map();
for (const [urlPath, [file, type]] of staticFiles) {
  staticCache.set(urlPath, { body: fs.readFileSync(path.join(pagesDir, file)), type });
}
const timeoutPage = staticCache.get('/timeout.html').body;

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function send(res, status, body = '', headers = {}) {
  if (res.writableEnded) return;
  setSecurityHeaders(res);
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.statusCode = status;
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > limit) {
        const error = new Error('Payload too large');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks, length)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req, MAX_CONTROL_BODY_BYTES);
  try { return body.length ? JSON.parse(body.toString('utf8')) : {}; }
  catch (_) { const error = new Error('Invalid JSON'); error.status = 400; throw error; }
}

function isValidTunnelId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-_]{3,64}$/.test(id)) return false;
  return !new Set(['api','create','tunnel','timeout','license','index','requests','ids','data','favicon','static','download','docs','styles','site']).has(id.toLowerCase());
}

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function fromBase64url(value) { return Buffer.from(value, 'base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest(); }

function safeEqualToken(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const actual = hashToken(token);
  return actual.length === expectedHash.length && crypto.timingSafeEqual(actual, expectedHash);
}

function bearerToken(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function encryptPayload(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return { algorithm: 'AES-256-GCM', iv: base64url(iv), data: base64url(Buffer.concat([ciphertext, cipher.getAuthTag()])) };
}

function decryptPayload(payload, key) {
  if (!payload || payload.algorithm !== 'AES-256-GCM') throw new Error('Unsupported encrypted payload');
  const iv = fromBase64url(payload.iv);
  const combined = fromBase64url(payload.data);
  if (iv.length !== 12 || combined.length < 16) throw new Error('Malformed encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(combined.subarray(-16));
  return Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]);
}

function authenticateAgent(req, res, id) {
  const tunnel = tunnels.get(id);
  if (!tunnel || !safeEqualToken(bearerToken(req), tunnel.tokenHash)) {
    sendJson(res, 401, { error: 'Invalid tunnel credentials' });
    return null;
  }
  tunnel.lastActive = Date.now();
  return tunnel;
}

function sanitizeForwardHeaders(headers) {
  const excluded = new Set(['connection','proxy-connection','keep-alive','transfer-encoding','upgrade','te','trailer','host','content-length','proxy-authenticate','proxy-authorization']);
  return Object.fromEntries(Object.entries(headers || {}).filter(([key]) => !excluded.has(key.toLowerCase())));
}

function queryObject(searchParams) {
  const output = {};
  for (const [key, value] of searchParams) {
    if (key in output) output[key] = Array.isArray(output[key]) ? [...output[key], value] : [output[key], value];
    else output[key] = value;
  }
  return output;
}

function sourceDetails(req) {
  const forwarded = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return {
    ip: forwarded || req.socket.remoteAddress || 'unknown',
    forwardedFor: process.env.TRUST_PROXY === '1' ? (req.headers['x-forwarded-for'] || null) : null,
    protocol: process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-proto'] || 'http').split(',')[0] : (req.socket.encrypted ? 'https' : 'http'),
    host: req.headers.host || '',
    userAgent: req.headers['user-agent'] || 'unknown',
    referer: req.headers.referer || null,
    receivedAt: new Date().toISOString()
  };
}

function tunnelPath(pathname, tunnelId) {
  if (pathname === `/${tunnelId}` || pathname.startsWith(`/${tunnelId}/`)) return pathname;
  return `/${tunnelId}${pathname}`;
}

function rewriteCssUrls(content, tunnelId) {
  let rewritten = content.replace(/url\(\s*(["']?)\/(?!\/)([^"')]+)\1\s*\)/gi, (match, quote, subPath) => {
    return `url(${quote}${tunnelPath(`/${subPath}`, tunnelId)}${quote})`;
  });
  return rewritten.replace(/(@import\s+)(["'])\/(?!\/)([^"']+)\2/gi, (match, prefix, quote, subPath) => {
    return `${prefix}${quote}${tunnelPath(`/${subPath}`, tunnelId)}${quote}`;
  });
}

function rewriteUrls(content, tunnelId, contentType) {
  let rewritten = content;
  if (contentType.includes('text/html')) {
    rewritten = rewritten.replace(/(href|src|action|poster|base)(\s*=\s*)(["'])\/(?!\/)([^"']*)\3/gi, (match, prop, separator, quote, subPath) => {
      return `${prop}${separator}${quote}${tunnelPath(`/${subPath}`, tunnelId)}${quote}`;
    });
    rewritten = rewritten.replace(/(srcset)(\s*=\s*)(["'])([^"']*)\3/gi, (match, prop, separator, quote, value) => {
      const paths = value.split(',').map(candidate => candidate.trim().replace(/^\/(?!\/)(\S+)(.*)$/, (item, pathname, descriptor) => {
        return `${tunnelPath(`/${pathname}`, tunnelId)}${descriptor}`;
      }));
      return `${prop}${separator}${quote}${paths.join(', ')}${quote}`;
    });
    rewritten = rewriteCssUrls(rewritten, tunnelId);
  } else if (contentType.includes('text/css')) {
    rewritten = rewriteCssUrls(rewritten, tunnelId);
  } else if (contentType.includes('javascript') || contentType.includes('ecmascript')) {
    rewritten = rewritten.replace(/(["'])\/(?!\/)([^"'\r\n]*)\1/g, (match, quote, subPath) => {
      return `${quote}${tunnelPath(`/${subPath}`, tunnelId)}${quote}`;
    });
    rewritten = rewritten.replace(/`\/(?!\/)([^`${}\r\n]*)`/g, (match, subPath) => {
      return `\`${tunnelPath(`/${subPath}`, tunnelId)}\``;
    });
  }
  return rewritten;
}

function rewriteLocation(value, tunnelId, localPort) {
  if (typeof value !== 'string' || !value) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return tunnelPath(value, tunnelId);
  try {
    const target = new URL(value);
    const localHost = target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname === '[::1]';
    if (localHost && (!target.port || Number(target.port) === localPort)) {
      return tunnelPath(`${target.pathname}${target.search}${target.hash}`, tunnelId);
    }
  } catch (_) {}
  return value;
}

function rewriteSetCookie(value, tunnelId) {
  if (typeof value !== 'string') return value;
  const withoutLocalDomain = value.replace(/;\s*Domain=(?:localhost|127\.0\.0\.1|\[::1\])(?=;|$)/gi, '');
  return withoutLocalDomain.replace(/;\s*Path=\/(?!\/)([^;]*)/i, (match, subPath) => `; Path=${tunnelPath(`/${subPath}`, tunnelId)}`);
}

function rewriteResponseHeaders(headers, tunnel) {
  const rewritten = { ...headers };
  for (const [key, value] of Object.entries(rewritten)) {
    const lower = key.toLowerCase();
    if (lower === 'location') rewritten[key] = Array.isArray(value) ? value.map(item => rewriteLocation(item, tunnel.id, tunnel.port)) : rewriteLocation(value, tunnel.id, tunnel.port);
    if (lower === 'set-cookie') rewritten[key] = Array.isArray(value) ? value.map(item => rewriteSetCookie(item, tunnel.id)) : rewriteSetCookie(value, tunnel.id);
    if (lower === 'link') rewritten[key] = String(value).replace(/<\/(?!\/)([^>]+)>/g, (match, subPath) => `<${tunnelPath(`/${subPath}`, tunnel.id)}>`);
  }
  return rewritten;
}

function sendTimeout(requestId) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  pendingRequests.delete(requestId);
  send(pending.res, 504, timeoutPage, { 'Content-Type': 'text/html; charset=utf-8' });
}

function armTimeout(requestId, seconds) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  if (pending.timeoutId) clearTimeout(pending.timeoutId);
  pending.timeoutId = setTimeout(() => sendTimeout(requestId), seconds * 1000);
}

function serveStatic(urlPath, res) {
  const asset = staticCache.get(urlPath);
  if (!asset) return false;
  send(res, 200, asset.body, { 'Content-Type': asset.type, 'Cache-Control': urlPath.endsWith('.css') || urlPath.endsWith('.js') ? 'public, max-age=300' : 'no-cache' });
  return true;
}

function serveDownload(filename, res) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) return send(res, 404, 'Client is not available.');
  setSecurityHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', fs.statSync(filePath).size);
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const body = await readJson(req);
  if (pathname === '/api/register') {
    const id = String(body.id || '').trim().toLowerCase();
    const port = Number(body.port);
    const timeout = Math.min(MAX_TIMEOUT_SECONDS, Math.max(5, Number(body.timeout) || 30));
    if (!isValidTunnelId(id) || !Number.isInteger(port) || port < 1 || port > 65535) return sendJson(res, 400, { success: false, reason: 'invalid_configuration' });
    const current = tunnels.get(id);
    if (current && Date.now() - current.lastActive <= ACTIVE_WINDOW_MS) return sendJson(res, 409, { success: false, reason: 'in_use' });
    const token = base64url(crypto.randomBytes(32));
    const key = crypto.randomBytes(32);
    tunnels.set(id, { id, port, timeout, tokenHash: hashToken(token), key, lastActive: Date.now(), queue: [] });
    return sendJson(res, 200, { success: true, token, encryptionKey: base64url(key), encryption: 'AES-256-GCM', pollIntervalMs: 1500 });
  }
  if (pathname === '/api/reqs') {
    const id = String(body.id || '').trim().toLowerCase();
    if (!isValidTunnelId(id)) return sendJson(res, 400, { error: 'Invalid tunnel ID' });
    const tunnel = authenticateAgent(req, res, id);
    if (!tunnel) return;
    const requests = tunnel.queue.splice(0, tunnel.queue.length);
    for (const request of requests) queuedBodyBytes = Math.max(0, queuedBodyBytes - request.bodyBytes);
    return sendJson(res, 200, { requests });
  }
  if (pathname === '/api/keepalive') {
    const pending = pendingRequests.get(body.requestId);
    if (!pending) return sendJson(res, 404, { error: 'Request not found' });
    const tunnel = authenticateAgent(req, res, pending.tunnelId);
    if (!tunnel) return;
    armTimeout(body.requestId, tunnel.timeout);
    return sendJson(res, 200, { success: true });
  }
  if (pathname === '/api/res') {
    const pending = pendingRequests.get(body.requestId);
    if (!pending) return sendJson(res, 404, { error: 'Request expired or not found' });
    const tunnel = authenticateAgent(req, res, pending.tunnelId);
    if (!tunnel) return;
    let responseBody;
    try { responseBody = decryptPayload(body.payload, tunnel.key); }
    catch (_) { return sendJson(res, 400, { error: 'Payload authentication failed' }); }
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    pendingRequests.delete(body.requestId);
    const responseHeaders = rewriteResponseHeaders(sanitizeForwardHeaders(body.headers && typeof body.headers === 'object' ? body.headers : {}), tunnel);
    const contentType = String(responseHeaders['content-type'] || responseHeaders['Content-Type'] || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('text/css') || contentType.includes('javascript') || contentType.includes('ecmascript')) {
      responseBody = Buffer.from(rewriteUrls(responseBody.toString('utf8'), pending.tunnelId, contentType));
    }
    const safeStatus = Number.isInteger(Number(body.status)) && Number(body.status) >= 100 && Number(body.status) <= 599 ? Number(body.status) : 200;
    send(pending.res, safeStatus, responseBody, { ...responseHeaders, 'X-Via': 'WebTNX', 'X-Request-Id': body.requestId });
    return sendJson(res, 200, { success: true });
  }
  return sendJson(res, 404, { error: 'API route not found' });
}

async function handleTunnel(req, res, url) {
  const match = url.pathname.match(/^\/([^/]+)(\/.*)?$/);
  if (!match) return false;
  const tunnelId = decodeURIComponent(match[1]).toLowerCase();
  if (!isValidTunnelId(tunnelId)) return false;
  if (!match[2]) { send(res, 302, '', { Location: `/${tunnelId}/` }); return true; }
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel || Date.now() - tunnel.lastActive > ACTIVE_WINDOW_MS) { send(res, 404, 'Tunnel not active or expired.'); return true; }
  if (pendingRequests.size >= MAX_PENDING_REQUESTS || tunnel.queue.length >= MAX_QUEUE_PER_TUNNEL) { send(res, 503, 'Tunnel is busy. Please retry shortly.'); return true; }
  const rawBody = await readBody(req, MAX_REQUEST_BODY_BYTES);
  if (queuedBodyBytes + rawBody.length > MAX_QUEUED_BODY_BYTES) { send(res, 503, 'Relay memory budget is busy. Please retry shortly.'); return true; }
  const requestId = base64url(crypto.randomBytes(24));
  const requestData = {
    id: requestId, method: req.method, headers: sanitizeForwardHeaders(req.headers),
    path: match[2] || '/', query: queryObject(url.searchParams), payload: encryptPayload(rawBody, tunnel.key),
    bodyBytes: rawBody.length, source: sourceDetails(req)
  };
  tunnel.queue.push(requestData);
  queuedBodyBytes += rawBody.length;
  pendingRequests.set(requestId, { res, tunnelId, timeoutId: null });
  armTimeout(requestId, tunnel.timeout);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://webtnx.local');
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(url.pathname, res)) return;
    if (req.method === 'GET' && url.pathname === '/download/windows') return serveDownload('webtnx.exe', res);
    if (req.method === 'GET' && url.pathname === '/download/python') return serveDownload('webtnx.py', res);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    if (await handleTunnel(req, res, url)) return;
    send(res, 404, 'Not found.');
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, error.status === 413 ? '413 Payload Too Large: WebTNX limit is 2 MB.' : 'WebTNX internal error.');
    if (error.status !== 413) console.error(error);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [id, tunnel] of tunnels) {
    if (now - tunnel.lastActive <= ACTIVE_WINDOW_MS * 3) continue;
    for (const request of tunnel.queue) {
      queuedBodyBytes = Math.max(0, queuedBodyBytes - request.bodyBytes);
      sendTimeout(request.id);
    }
    tunnels.delete(id);
  }
}, 10_000).unref();

server.listen(PORT, () => console.log(`WebTNX Server is running on port ${PORT}`));
