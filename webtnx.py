#!/usr/bin/env python3
import sys
import json
import time
import base64
import urllib.request
import urllib.error
SERVER_URL = "https://webtnx.zone.id"
def xor_encrypt(text_str, key_str):
    text_bytes = text_str.encode('utf-8')
    key_bytes = key_str.encode('utf-8')
    encrypted_bytes = bytearray(len(text_bytes))
    for i in range(len(text_bytes)):
        encrypted_bytes[i] = text_bytes[i] ^ key_bytes[i % len(key_bytes)]
    return base64.b64encode(encrypted_bytes).decode('utf-8')
def send_post(url, data_dict):
    req_data = json.dumps(data_dict).encode('utf-8')
    req = urllib.request.Request(
        url, 
        data=req_data, 
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))
def main():
    if len(sys.argv) < 3:
        print("Usage: python webtnx.py <tunnel_id> <local_port> [timeout_seconds]")
        print("Example: python webtnx.py my-app 8080 15")
        sys.exit(1)
    tunnel_id = sys.argv[1].strip().lower()
    port = sys.argv[2].strip()
    timeout = sys.argv[3].strip() if len(sys.argv) > 3 else "15"
    secret_key = f"{tunnel_id}_{port}_{timeout}"
    print(f"🚀 Starting WebTNX CLI Client...")
    print(f"🔗 Public URL: {SERVER_URL}/{tunnel_id}/")
    print(f"🏠 Local Target: http://localhost:{port}")
    try {
        reg_res = send_post(f"{SERVER_URL}/api/register", {
            "id": tunnel_id,
            "port": int(port),
            "timeout": int(timeout)
        })
        if not reg_res.get("success"):
            print(f"❌ Error: ID '{tunnel_id}' is already in use or reserved.")
            sys.exit(1)
        print("✅ Tunnel registered successfully. Keep this terminal open.")
    except Exception as e:
        print(f"❌ Network Error during registration: {e}")
        sys.exit(1)
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
                print(f"📥 [{req_method}] {req_path} (ID: {req_id[:10]}..)")
                try:
                    send_post(f"{SERVER_URL}/api/keepalive", {"requestId": req_id})
                except Exception:
                    pass 
                target_url = f"http://localhost:{port}{req_path}"
                if req_query:
                    query_str = urllib.parse.urlencode(req_query)
                    target_url += f"?{query_str}"
                try:
                    local_req = urllib.request.Request(
                        target_url,
                        headers=req_headers,
                        method=req_method
                    )
                    with urllib.request.urlopen(local_req) as local_res:
                        local_status = local_res.status
                        content_type = local_res.headers.get('content-type', '')
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
                try {
                    send_post(f"{SERVER_URL}/api/res", {
                        "requestId": req_id,
                        "status": local_status,
                        "headers": res_headers,
                        "body": encrypted_body,
                        "isBase64": is_base64,
                        "isEncrypted": True
                    })
                    print(f"📤 Responded {local_status} (Bytes: {len(encrypted_body)})")
                except Exception as re:
                    print(f"❌ Failed to send response back to WebTNX: {re}")
        except Exception as pe:
            print(f"⚠️ Polling connection warning: {pe}")
            time.sleep(5) 
        time.sleep(2) 
if __name__ == "__main__":
    main()
