#!/usr/bin/env python3
import sys
import json
import time
import base64
import urllib.request
import urllib.error
import urllib.parse
import platform
SERVER_URL = "https://webtnx.zone.id"
GREEN = '\033[92m'
BLUE = '\033[94m'
YELLOW = '\033[93m'
CYAN = '\033[96m'
RED = '\033[91m'
BOLD = '\033[1m'
RESET = '\033[0m'
def exit_with_pause(code=1):
    try:
        input(f"\n{YELLOW}[PROMPT]{RESET} Press ENTER to exit...")
    except (KeyboardInterrupt, EOFError):
        pass
    sys.exit(code)
def xor_encrypt(text_str, key_str):
    text_bytes = text_str.encode('utf-8')
    key_bytes = key_str.encode('utf-8')
    encrypted_bytes = bytearray(len(text_bytes))
    for i in range(len(text_bytes)):
        encrypted_bytes[i] = text_bytes[i] ^ key_bytes[i % len(key_bytes)]
    return base64.b64encode(encrypted_bytes).decode('utf-8')
def send_post(url, data_dict):
    req_data = json.dumps(data_dict).encode('utf-8')
    req = urllib.request.Request(url, data=req_data, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req) as response:
        raw_res = response.read()
        try:
            return json.loads(raw_res.decode('utf-8'))
        except Exception:
            return {"success": True, "raw": raw_res.decode('utf-8')}
def main():
    if len(sys.argv) < 3:
        is_windows = platform.system().lower() == "windows"
        print(f"{RED}[USAGE]{RESET} WebTNX CLI Client")
        if is_windows:
            print("Run command:\n  webtnx.exe <tunnel_id> <local_port> [timeout_seconds]\nOR:\n  python webtnx.py <tunnel_id> <local_port> [timeout_seconds]")
            print("\nExamples:\n  webtnx.exe my-app 8080 15\n  python webtnx.py my-app 3000 30")
        else:
            print("Run command:\n  ./webtnx <tunnel_id> <local_port> [timeout_seconds]\nOR:\n  python3 webtnx.py <tunnel_id> <local_port> [timeout_seconds]")
            print("\nExamples:\n  ./webtnx my-app 8080 15\n  python3 webtnx.py my-app 3000 30")
        print("\nParameters:\n  <tunnel_id>      : The unique subdomain/name for your public URL (e.g., https://webtnx.zone.id/my-app/)\n  <local_port>     : The port your local server is running on (e.g., 8080, 3000)\n  [timeout_seconds]: Optional. Maximum seconds to wait for a local response before timing out (Default: 15)")
        exit_with_pause(1)
    tunnel_id = sys.argv[1].strip().lower()
    port = sys.argv[2].strip()
    timeout = sys.argv[3].strip() if len(sys.argv) > 3 else "15"
    secret_key = f"{tunnel_id}_{port}_{timeout}"
    logo = f"{BLUE}{BOLD} _ _ _         _   _______ _   _ __  __ \n| | | | ___  | | |__   __| \\ | |\\ \\/ / \n| | |  / _ \\| '_ \\| |  |  \\| | \\  /  \n| | | \\  __/| |_) || |  | . ` | /  \\  \n|_____/\\___||_.__/ |_|  |_|\\_|_/_/\\_\\ {RESET}"
    print(logo)
    print(f"{BLUE}===================================================={RESET}")
    print(f"{GREEN}[INFO]{RESET} Starting WebTNX CLI Client...")
    print(f"{GREEN}[LINK]{RESET} Public URL   : {CYAN}{SERVER_URL}/{tunnel_id}/{RESET}")
    print(f"{GREEN}[HOST]{RESET} Local Target : {CYAN}http://localhost:{port}{RESET}")
    print(f"{GREEN}[KEYS]{RESET} Secure Key   : {YELLOW}{secret_key} (Encrypted){RESET}")
    print(f"{GREEN}[COPY]{RESET} Copyright (c) 2026 {BOLD}NeuralNexusLab{RESET}. All Rights Reserved.")
    print(f"{BLUE}===================================================={RESET}")
    try:
        reg_res = send_post(f"{SERVER_URL}/api/register", {"id": tunnel_id, "port": int(port), "timeout": int(timeout)})
        if not reg_res.get("success"):
            print(f"{RED}[ERROR]{RESET} ID '{tunnel_id}' is already in use or reserved.")
            exit_with_pause(1)
        print(f"{GREEN}[OK]{RESET} Tunnel registered successfully. Keep this terminal open.\n")
    except Exception as e:
        print(f"{RED}[ERROR]{RESET} Network Error during registration: {e}")
        exit_with_pause(1)
    print(f"{YELLOW}[LOG]{RESET} Polling tunnel requests active...")
    while True:
        try:
            poll_res = send_post(f"{SERVER_URL}/api/reqs", {"id": tunnel_id})
            requests = poll_res.get("requests", [])
            for req in requests:
                req_id = req["id"]
                req_path = req["path"]
                req_method = req["method"]
                req_headers = req.get("headers", {})
                req_query = req.get("query", {})
                method_color = GREEN if req_method == 'POST' else BLUE
                print(f"📥 {method_color}[{req_method}]{RESET} {req_path}", end="", flush=True)
                try:
                    send_post(f"{SERVER_URL}/api/keepalive", {"requestId": req_id})
                except Exception:
                    pass
                target_url = f"http://localhost:{port}{req_path}"
                if req_query:
                    query_str = urllib.parse.urlencode(req_query)
                    target_url += f"?{query_str}"
                headers_to_remove = ['host', 'connection', 'accept-encoding', 'content-length']
                cleaned_headers = {}
                for k, v in req_headers.items():
                    if k.lower() not in headers_to_remove:
                        cleaned_headers[k] = v
                try:
                    local_req = urllib.request.Request(target_url, headers=cleaned_headers, method=req_method)
                    with urllib.request.urlopen(local_req) as local_res:
                        local_status = getattr(local_res, 'status', None) or local_res.getcode()
                        content_type = (local_res.headers.get('content-type') or '').lower()
                        res_headers = {}
                        for key, val in local_res.headers.items():
                            res_headers[key.lower()] = val
                        is_binary = not any(t in content_type for t in ["text/", "json", "javascript", "xml"])
                        raw_body_bytes = local_res.read()
                        if is_binary:
                            raw_body_data = base64.b64encode(raw_body_bytes).decode('utf-8')
                            is_base64 = True
                        else:
                            raw_body_data = raw_body_bytes.decode('utf-8', errors='ignore')
                            is_base64 = False
                        encrypted_body = xor_encrypt(raw_body_data, secret_key)
                except urllib.error.HTTPError as he:
                    local_status = he.code
                    res_headers = {k.lower(): v for k, v in he.headers.items()}
                    raw_body_data = he.read().decode('utf-8', errors='ignore')
                    encrypted_body = xor_encrypt(raw_body_data, secret_key)
                    is_base64 = False
                except Exception as le:
                    local_status = 502
                    res_headers = {"content-type": "text/plain"}
                    raw_body_data = f"WebTNX Proxy Error: Local service offline. {le}"
                    encrypted_body = xor_encrypt(raw_body_data, secret_key)
                    is_base64 = False
                try:
                    send_post(f"{SERVER_URL}/api/res", {"requestId": req_id, "status": local_status, "headers": res_headers, "body": encrypted_body, "isBase64": is_base64, "isEncrypted": True})
                    status_color = GREEN if local_status < 400 else RED
                    print(f"  --> {status_color}📤 [{local_status}]{RESET} (Bytes: {len(encrypted_body)})" + (f" {YELLOW}(Binary){RESET}" if is_base64 else ""))
                except Exception as re:
                    print(f"  --> {RED}📤 [FAIL]{RESET} Send response back failed: {re}")
        except Exception as pe:
            print(f"\r⚠️ {YELLOW}[WARN]{RESET} Polling connection warning: {pe}")
            time.sleep(5)
        time.sleep(2)
if __name__ == "__main__":
    main()
