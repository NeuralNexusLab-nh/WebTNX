const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 關閉 Express 預設的 X-Powered-By 標頭
app.disable('x-powered-by');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 初始化必要的目錄與檔案
const dataDir = path.join(__dirname, 'data');
const reqsDir = path.join(__dirname, 'data', 'requests');
const idsPath = path.join(__dirname, 'data', 'ids.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(reqsDir)) fs.mkdirSync(reqsDir, { recursive: true });
if (!fs.existsSync(idsPath)) fs.writeFileSync(idsPath, '{}');

// 記憶體中掛起的連線暫存 (requestId -> { resolve, timeoutId })
const pendingRequests = new Map();

// 靜態路由服務
app.use(express.static(path.join(__dirname, 'pages')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'index.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'create.html')));
app.get('/tunnel', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'tunnel.html')));

// 路徑改寫函式
function rewriteUrls(content, tunnelId) {
    if (typeof content !== 'string') return content;
    // 改寫 HTML 中的 href, src, action 絕對路徑
    let rewritten = content.replace(/(href|src|action)=["']\/(?!\/)([^"']*)["']/g, (match, prop, subPath) => {
        if (subPath.startsWith(tunnelId + '/')) return `${prop}="/${subPath}"`;
        return `${prop}="/${tunnelId}/${subPath}"`;
    });
    // 改寫 CSS 中的 url('/...')
    rewritten = rewritten.replace(/url\(["']\/(?!\/)([^"']*)["']\)/g, (match, subPath) => {
        if (subPath.startsWith(tunnelId + '/')) return `url("/${subPath}")`;
        return `url("/${tunnelId}/${subPath}")`;
    });
    return rewritten;
}

// ==========================================
// API 路由
// ==========================================

// 註冊 / 驗證 ID 的可用性
app.post('/api/register', (req, res) => {
    const { id, port, timeout } = req.body;
    if (!id || !port) return res.status(400).json({ success: false, reason: 'invalid' });

    const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    const now = Date.now();

    // 檢查是否有正在使用（且未過期）的同名 ID
    if (ids[id] && (now - ids[id].lastActive <= 20000)) {
        return res.json({ success: false, reason: 'in_use' });
    }

    ids[id] = {
        port: parseInt(port, 10),
        timeout: parseInt(timeout, 10) || 30,
        lastActive: now
    };
    fs.writeFileSync(idsPath, JSON.stringify(ids, null, 2));
    res.json({ success: true });
});

// 代理端輪詢請求內容
app.post('/api/reqs', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing ID' });

    const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    if (ids[id]) {
        ids[id].lastActive = Date.now(); // 往後延展 20s 壽命
        fs.writeFileSync(idsPath, JSON.stringify(ids, null, 2));
    }

    const reqFilePath = path.join(reqsDir, `${id}.json`);
    let requests = [];
    if (fs.existsSync(reqFilePath)) {
        try {
            requests = JSON.parse(fs.readFileSync(reqFilePath, 'utf8'));
            fs.writeFileSync(reqFilePath, '[]'); // 讀取後立即清空檔案
        } catch (e) {
            requests = [];
        }
    }
    res.json({ requests });
});

// 代理端回傳 Response
app.post('/api/res', (req, res) => {
    const { requestId, status, headers, body } = req.body;
    const pending = pendingRequests.get(requestId);
    if (!pending) return res.status(404).send('Request expired or not found.');

    if (pending.timeoutId) clearTimeout(pending.timeoutId);

    pending.resolve({ status, headers, body });
    pendingRequests.delete(requestId);
    res.sendStatus(200);
});

// ==========================================
// 訪客流量分流入口 (Wildcard Router)
// ==========================================
app.all('/:tunnelId/*', (req, res, next) => {
    const { tunnelId } = req.params;
    // 排除系統內置路徑
    if (['tunnel', 'api', 'create', 'timeout'].includes(tunnelId) || req.path === '/' || req.path === '/index.html') {
        return next();
    }

    const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    const now = Date.now();

    // 檢查隧道是否仍然啟動（小於 20 秒內有心跳）
    if (!ids[tunnelId] || (now - ids[tunnelId].lastActive > 20000)) {
        return res.status(404).send('Tunnel not active or expired.');
    }

    // 生成 32-byte 的隨機請求 ID
    const requestId = crypto.randomBytes(32).toString('hex');
    const subPath = '/' + (req.params[0] || '');

    const reqData = {
        id: requestId,
        method: req.method,
        headers: Object.assign({}, req.headers, { host: undefined }),
        path: subPath,
        query: req.query
    };

    // 寫入 /data/requests/{id}.json 陣列
    const reqFilePath = path.join(reqsDir, `${tunnelId}.json`);
    let list = [];
    if (fs.existsSync(reqFilePath)) {
        try {
            list = JSON.parse(fs.readFileSync(reqFilePath, 'utf8'));
        } catch (e) {}
    }
    list.push(reqData);
    fs.writeFileSync(reqFilePath, JSON.stringify(list, null, 2));

    // 使用 Promise 掛起連線，完全不消耗 CPU
    let resolveRequest;
    const promise = new Promise((resolve) => {
        resolveRequest = resolve;
    });

    const timeoutSeconds = ids[tunnelId].timeout || 30;
    const tId = setTimeout(() => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            const timeoutHtmlPath = path.join(__dirname, 'pages', 'timeout.html');
            const html = fs.existsSync(timeoutHtmlPath) 
                ? fs.readFileSync(timeoutHtmlPath, 'utf8') 
                : '504 Gateway Timeout (WebTNX)';
            res.status(504).send(html);
        }
    }, timeoutSeconds * 1000);

    pendingRequests.set(requestId, {
        resolve: resolveRequest,
        timeoutId: tId,
        tunnelId: tunnelId
    });

    promise.then(({ status, headers: resHeaders, body }) => {
        let finalBody = body;
        const contentType = resHeaders['content-type'] || '';
        
        if (contentType.includes('text/html') || contentType.includes('application/javascript')) {
            finalBody = rewriteUrls(body, tunnelId);
        }

        // 轉發 Headers，並移除 X-Powered-By
        Object.keys(resHeaders).forEach(key => {
            if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length' && key.toLowerCase() !== 'x-powered-by') {
                res.setHeader(key, resHeaders[key]);
            }
        });

        // 補上 WebTNX 的專屬標頭
        res.setHeader('X-Via', 'WebTNX');
        res.setHeader('X-Tunneled-By', 'WebTNX');
        res.setHeader('X-Request-Id', requestId);

        res.status(status || 200).send(finalBody);
    });
});

app.listen(PORT, () => {
    console.log(`WebTNX Server is running on port ${PORT}`);
});
