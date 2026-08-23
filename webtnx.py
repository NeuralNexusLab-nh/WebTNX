#!/usr/bin/env python3
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SERVER_URL = os.environ.get('WEBTNX_SERVER_URL', 'https://webtnx.nxlabtw.com').rstrip('/')
GREEN, BLUE, YELLOW, CYAN, RED = '\033[92m', '\033[94m', '\033[93m', '\033[96m', '\033[91m'
BOLD, RESET = '\033[1m', '\033[0m'
HOP_HEADERS = {
    'connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade',
    'te', 'trailer', 'host', 'content-length', 'proxy-authenticate', 'proxy-authorization'
}


def b64decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def b64encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def decrypt_payload(payload, key):
    if payload.get('algorithm') != 'AES-256-GCM':
        raise ValueError('Unsupported encryption algorithm')
    return AESGCM(key).decrypt(b64decode(payload['iv']), b64decode(payload['data']), None)


def encrypt_payload(data, key):
    iv = os.urandom(12)
    return {'algorithm': 'AES-256-GCM', 'iv': b64encode(iv), 'data': b64encode(AESGCM(key).encrypt(iv, data, None))}


def post_json(path, data, token=None):
    headers = {'Content-Type': 'application/json', 'User-Agent': 'WebTNX'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request(
        f'{SERVER_URL}{path}', data=json.dumps(data).encode('utf-8'), headers=headers, method='POST'
    )
    with urllib.request.urlopen(request, timeout=135) as response:
        raw = response.read()
        return json.loads(raw.decode('utf-8')) if raw else {}


def clean_headers(headers):
    return {key: value for key, value in headers.items() if key.lower() not in HOP_HEADERS}


def source_line(source):
    return (
        f"IP {source.get('ip', 'unknown')}  |  {source.get('protocol', 'http').upper()}  |  "
        f"{source.get('userAgent', 'unknown')}"
    )


def main():
    print(f'{BLUE}{BOLD}WebTNX | AES-256-GCM authenticated HTTP tunnel{RESET}')
    print(f'{CYAN}Enter the local service details below. No command-line parameters are needed.{RESET}')
    try:
        tunnel_id = input(f'{CYAN}Tunnel ID: {RESET}').strip().lower()
        port = input(f'{CYAN}Local port [3000]: {RESET}').strip() or '3000'
        timeout = input(f'{CYAN}Timeout seconds [30]: {RESET}').strip() or '30'
    except (KeyboardInterrupt, EOFError):
        return 1
    if not tunnel_id or not port.isdigit() or not timeout.isdigit():
        print(f'{RED}Tunnel ID, local port, or timeout is invalid.{RESET}')
        return 1
    if not 1 <= int(port) <= 65535 or not 5 <= int(timeout) <= 120:
        print(f'{RED}Port must be 1-65535 and timeout must be 5-120 seconds.{RESET}')
        return 1

    try:
        registration = post_json('/api/register', {'id': tunnel_id, 'port': int(port), 'timeout': int(timeout)})
    except Exception as error:
        print(f'{RED}Registration failed: {error}{RESET}')
        return 1
    if not registration.get('success'):
        print(f'{RED}Tunnel ID is in use or invalid.{RESET}')
        return 1

    token = registration['token']
    key = b64decode(registration['encryptionKey'])
    interval = max(0.5, registration.get('pollIntervalMs', 1500) / 1000)
    print(f'{GREEN}Live:{RESET} {SERVER_URL}/{tunnel_id}/')
    print(f'{GREEN}Local:{RESET} http://localhost:{port}')
    print(f'{GREEN}Security:{RESET} AES-256-GCM payload authentication over TLS')

    while True:
        try:
            queued = post_json('/api/reqs', {'id': tunnel_id}, token).get('requests', [])
            for incoming in queued:
                request_id = incoming['id']
                source = incoming.get('source', {})
                print(f"\n{BLUE}{incoming['method']}{RESET} {incoming['path']}  |  {source_line(source)}")
                try:
                    post_json('/api/keepalive', {'requestId': request_id}, token)
                    body = decrypt_payload(incoming['payload'], key)
                    url = f"http://localhost:{port}{incoming['path']}"
                    query = urllib.parse.urlencode(incoming.get('query') or {}, doseq=True)
                    if query:
                        url += f'?{query}'
                    method = incoming['method'].upper()
                    data = body if method not in {'GET', 'HEAD'} else None
                    local_request = urllib.request.Request(
                        url, data=data, headers=clean_headers(incoming.get('headers', {})), method=method
                    )
                    try:
                        with urllib.request.urlopen(local_request, timeout=int(timeout)) as local_response:
                            status = local_response.status
                            response_headers = dict(local_response.headers.items())
                            response_body = local_response.read()
                    except urllib.error.HTTPError as http_error:
                        status = http_error.code
                        response_headers = dict(http_error.headers.items())
                        response_body = http_error.read()
                except Exception as local_error:
                    status = 502
                    response_headers = {'content-type': 'text/plain; charset=utf-8'}
                    response_body = f'WebTNX local proxy error: {local_error}'.encode('utf-8')

                post_json('/api/res', {
                    'requestId': request_id,
                    'status': status,
                    'headers': clean_headers(response_headers),
                    'payload': encrypt_payload(response_body, key)
                }, token)
                color = GREEN if status < 400 else RED
                print(f'{color}-> {status}{RESET} | {len(response_body)} bytes | source {source.get("ip", "unknown")}')
        except urllib.error.HTTPError as error:
            if error.code == 401:
                print(f'{RED}Tunnel session expired. Restart the client to register again.{RESET}')
                return 1
            print(f'{YELLOW}Control plane warning: HTTP {error.code}{RESET}')
            time.sleep(3)
        except (KeyboardInterrupt, EOFError):
            print('\nTunnel stopped.')
            return 0
        except Exception as error:
            print(f'{YELLOW}Connection warning: {error}; retrying...{RESET}')
            time.sleep(3)
        time.sleep(interval)


if __name__ == '__main__':
    exit_code = main()
    if os.name == 'nt' and not sys.stdin.closed:
        try:
            input('\nPress Enter to close...')
        except (KeyboardInterrupt, EOFError):
            pass
    sys.exit(exit_code)
