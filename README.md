# WebTNX 2

WebTNX is a lightweight, self-hosted HTTP relay that gives a local web service a public path. It supports a zero-install browser agent plus native Windows and Python clients.

## What changed in v2

- Complete HTTP request forwarding: method, path, query, body, safe headers, status and binary responses.
- Per-session random agent credentials.
- AES-256-GCM authenticated encryption for request and response bodies, transported over TLS.
- Ephemeral in-memory request queues—no request headers or bodies written to disk.
- Source IP, protocol, user agent, path, status and byte counts in client logs.
- Continuous CORS health checks in the browser agent.
- Bounded queues, request deadlines and inactive-session cleanup for small servers.
- Rebuilt frosted-glass midnight interface.

> WebTNX is not end-to-end encrypted: the relay must decrypt an agent response before returning it to the public visitor. TLS protects the full control plane in transit, while AES-256-GCM adds authenticated payload protection between relay and agent.

## Self-hosting

Requirements: Node.js 18 or later.

```bash
git clone https://github.com/NeuralNexusLab-nh/WebTNX.git
cd WebTNX
npm ci
NODE_OPTIONS=--max-old-space-size=24 PORT=3000 node server.js
```

When running directly behind exactly one trusted reverse proxy, set `TRUST_PROXY=1` so source IP logging uses the forwarded client address. Do not enable this for an untrusted direct deployment.

## Clients

### Windows

```powershell
.\webtnx.exe my-app 3000 30
```

### Python (Windows, Linux, macOS)

```bash
python3 -m pip install cryptography
python3 webtnx.py my-app 3000 30
```

The browser agent is available at `/create`. Browser security rules prevent JavaScript from setting a few restricted headers such as `Cookie`; use the native client when exact header fidelity is required.

## Protocol limits

- Request body limit: 2 MB.
- Timeout: 5–120 seconds.
- 10 queued requests per tunnel; 64 pending requests and a 4 MB queued-body budget per process.
- No WebSocket, SSE or streaming response support.
- Active tunnels end when the WebTNX server restarts.

## Security notes

- Tunnel IDs are public routing identifiers, not passwords.
- Each registration receives a random 256-bit bearer token and independent AES key.
- AES-256-GCM authenticates every body before it is forwarded or returned.
- Public applications should retain their own authentication and authorization.
- Put rate limiting and TLS termination at a trusted reverse proxy for public deployments.

## License

Distributed under the [NeuralNexusLab Shared Source License v1.0](LICENSE). Public instances and modified versions must retain the required attribution. Direct commercial resale of the tunneling service is prohibited; see the license for the complete terms.
