# [WebTNX](https://webtnx.nxlabtw.com/)
```
https://webtnx.nxlabtw.com
```

WebTNX is a lightweight HTTP relay that gives a local web service a public path. It supports a zero-install browser agent plus native Windows and Python clients.

## Features

- Complete HTTP request forwarding: method, path, query, body, safe headers, status and binary responses.
- Per-session random agent credentials.
- AES-256-GCM authenticated encryption for request and response bodies, transported over TLS.
- Ephemeral in-memory request queues—no request headers or bodies written to disk.
- Source IP, protocol, user agent, path, status and byte counts in client logs.
- Continuous CORS health checks in the browser agent.
- Each tunnel receives its own public subdomain: `https://YOUR-ID.webtnx.nxlabtw.com/`, so same-site paths, cookies, and SPA routing work naturally. Legacy path routing remains available for existing links.
- Bounded queues, request deadlines and inactive-session cleanup for small servers.
- Rebuilt frosted-glass midnight interface.

> WebTNX is not end-to-end encrypted: the relay must decrypt an agent response before returning it to the public visitor. TLS protects the full control plane in transit, while AES-256-GCM adds authenticated payload protection between relay and agent.

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

## License

Distributed under the [NXLabTW Shared Source License v1.0](LICENSE). Public instances and modified versions must retain the required attribution. Direct commercial resale of the tunneling service is prohibited; see the license for the complete terms.
