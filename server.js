const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dataDir = path.join(__dirname, 'data');
const reqsDir = path.join(__dirname, 'data', 'requests');
const idsPath = path.join(__dirname, 'data', 'ids.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(reqsDir)) fs.mkdirSync(reqsDir, { recursive: true });
if (!fs.existsSync(idsPath)) fs.writeFileSync(idsPath, '{}');

const pendingRequests = new Map();

app.use(express.static(path.join(__dirname, 'pages')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'index.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'create.html')));
app.get('/tunnel', (req, res) => res.sendFile(path.join(__dirname, 'pages', 'tunnel.html')));

function rewriteUrls(content, tunnelId) {
    if (typeof content !== 'string') return content;
    let rewritten = content.replace(/(href|src|action)=["']\/(?!\/)([^"']*)["']/g, (match, prop, subPath) => {
        if (subPath.startsWith(tunnelId + '/')) return `${prop}="/${subPath}"`;
        return `${prop}="/${tunnelId}/${subPath}"`;
    });
    rewritten = rewritten.replace(/url\(["']\/(?!\/)([^"']*)["']\)/g, (match, subPath) => {
        if (subPath.startsWith(tunnelId + '/')) return `url("/${subPath}")`;
        return `url("/${tunnelId}/${subPath}")`;
    });
    return rewritten;
}

app.post('/api/register', (req, res) => {
    const { id, port, timeout } = req.body;
    if (!id || !port) return res.status(400).json({ success: false, reason: 'invalid' });

    const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    const now = Date.now();

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

app.post('/api/reqs', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing ID' });

    const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    if (ids[id]) {
        ids[id].lastActive = Date.now(); 
        fs.writeFileSync(idsPath, JSON.stringify(ids, null, 2));
    }

    const reqFilePath = path.join(reqsDir, `${id}.json`);
    let requests = [];
    if (fs.existsSync(reqFilePath)) {
        try {
            requests = JSON.parse(fs.readFileSync(reqFilePath, 'utf8'));
            fs.writeFileSync(reqFilePath, '[]'); 
        } catch (e) {
            requests = [];
        }
    }
    res.json({ requests });
});

app.post('/api/res', (req, res) => {
    const { requestId, status, headers, body } = req.body;
    const pending = pendingRequests.get(requestId);
    if (!pending) return res.status(404).send('Request expired or not found.');

    if (pending.timeoutId) clearTimeout(pending.timeoutId);

    pending.resolve({ status, headers, body });
    pendingRequests.delete(requestId);
    res.sendStatus(200);
});

app.get('/:tunnelId', (req, res, next) => {
    const { tunnelId } = req.params;

    if (['tunnel', 'api', 'create', 'timeout'].includes(tunnelId) || req.path === '/' || req.path === '/index.html') {
        return next();
    }

    if(req.path.endsWith("/")) {
        return next();
    }

    res.redirect(302, `/${tunnelId}/`);
});

app.all('/:tunnelId/*', (req, res, next) => {
    const { tunnelId } = req.params;
    if (['tunnel', 'api', 'create', 'timeout'].includes(tunnelId) || req.path === '/' || req.path === '/index.html') {
        return next();
    }

    const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    const now = Date.now();

    if (!ids[tunnelId] || (now - ids[tunnelId].lastActive > 20000)) {
        return res.status(404).send('Tunnel not active or expired.');
    }

    const requestId = crypto.randomBytes(32).toString('hex');
    const subPath = '/' + (req.params[0] || '');

    const reqData = {
        id: requestId,
        method: req.method,
        headers: Object.assign({}, req.headers, { host: undefined }),
        path: subPath,
        query: req.query
    };

    const reqFilePath = path.join(reqsDir, `${tunnelId}.json`);
    let list = [];
    if (fs.existsSync(reqFilePath)) {
        try {
            list = JSON.parse(fs.readFileSync(reqFilePath, 'utf8'));
        } catch (e) {}
    }
    list.push(reqData);
    fs.writeFileSync(reqFilePath, JSON.stringify(list, null, 2));

    let resolveRequest;
    const promise = new Promise((resolve) => {
        resolveRequest = resolve;
    });

    const timeoutSeconds = ids[tunnelId].timeout || 30;
    
    const tId = setTimeout(() => {
        if (pendingResponses.has(requestId)) {
            pendingResponses.delete(requestId);

            if (fs.existsSync(reqFilePath)) {
                try {
                    let currentList = JSON.parse(fs.readFileSync(reqFilePath, 'utf8'));
                    currentList = currentList.filter(item => item.id !== requestId);
                    
                    fs.writeFileSync(reqFilePath, JSON.stringify(currentList, null, 2));
                } catch (err) {
                }
            }

            const timeoutHtmlPath = path.join(__dirname, 'pages', 'timeout.html');
            const html = fs.existsSync(timeoutHtmlPath) 
                ? fs.readFileSync(timeoutHtmlPath, 'utf8') 
                : '504 Gateway Timeout (WebTNX)';
            res.status(504).send(html);
        }
    }, timeoutSeconds * 1000);

    pendingResponses.set(requestId, {
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

        Object.keys(resHeaders).forEach(key => {
            if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length' && key.toLowerCase() !== 'x-powered-by') {
                res.setHeader(key, resHeaders[key]);
            }
        });

        res.setHeader('X-Via', 'WebTNX');
        res.setHeader('X-Tunneled-By', 'WebTNX');
        res.setHeader('X-Request-Id', requestId);
        res.setHeader('X-Website', 'https://webtnx.zone.id/');

        res.status(status || 200).send(finalBody);
    });
});

app.listen(PORT, () => {
    console.log(`WebTNX Server is running on port ${PORT}`);
});
