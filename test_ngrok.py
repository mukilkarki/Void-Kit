import urllib.request
import json
import time

BASE = 'http://localhost:3000'

# Test 1: Check server is alive
print('=== TEST 1: Check server status ===')
try:
    req = urllib.request.Request(f'{BASE}/api/ngrok/check')
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read().decode())
    print(f'ngrok installed: {data["ngrok_installed"]}')
    print(f'API reachable: {data["api_reachable"]}')
    print(f'Message: {data["message"]}')
except Exception as e:
    print(f'ERROR: {e}')
    print('Is the server running (python server.py)?')
    exit(1)

# Test 2: Start ngrok
print('\n=== TEST 2: Start ngrok tunnel ===')
try:
    body = json.dumps({'ownerUid': 'test123'}).encode()
    req = urllib.request.Request(f'{BASE}/api/ngrok/start', data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    resp = urllib.request.urlopen(req, timeout=60)
    data = json.loads(resp.read().decode())
    print(f'Active: {data.get("active")}')
    print(f'URL: {data.get("url")}')
    print(f'Time remaining: {data.get("timeRemaining")}s')
except Exception as e:
    print(f'ERROR: {e}')
    import traceback
    traceback.print_exc()

# Test 3: Check status after start
print('\n=== TEST 3: Check status after start ===')
try:
    req = urllib.request.Request(f'{BASE}/api/ngrok/status')
    resp = urllib.request.urlopen(req, timeout=5)
    data = json.loads(resp.read().decode())
    print(f'Active: {data.get("active")}')
    print(f'URL: {data.get("url")}')
    print(f'Time remaining: {data.get("timeRemaining")}s')
except Exception as e:
    print(f'ERROR: {e}')