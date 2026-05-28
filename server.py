# ============================================================
# VOID KIT — LOCAL SERVER + NGROK MANAGER (Python Version)
# ============================================================
import http.server
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import mimetypes
from datetime import datetime, timedelta

PORT = 3000
NGROK_TIMEOUT = 15 * 60  # 15 minutes in seconds

# Global state
ngrok_process = None
ngrok_url = None
link_created_at = None
current_owner_uid = None
expiry_timer = None
lock = threading.Lock()

# ============ NGROK MANAGEMENT ============

def start_ngrok(owner_uid):
    global ngrok_process, ngrok_url, link_created_at, current_owner_uid

    with lock:
        # Kill existing ngrok if running
        kill_ngrok_sync()
        current_owner_uid = owner_uid

    # Spawn ngrok
    ngrok_exe = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ngrok.exe')
    ngrok_process = subprocess.Popen(
        [ngrok_exe, 'http', str(PORT), '--log=stdout'],
        cwd=os.path.dirname(os.path.abspath(__file__)),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    )

    # Poll ngrok API for tunnel URL
    max_attempts = 25
    for attempt in range(max_attempts):
        time.sleep(1.2)
        try:
            req = urllib.request.Request('http://127.0.0.1:4040/api/tunnels')
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                tunnels = data.get('tunnels', [])
                for tunnel in tunnels:
                    public_url = tunnel.get('public_url', '')
                    if public_url.startswith('https'):
                        with lock:
                            ngrok_url = public_url
                            link_created_at = time.time()
                            # Set 15-minute expiry
                            set_expiry_timer()
                        print(f'ngrok tunnel started: {ngrok_url}')
                        return ngrok_url
        except Exception as e:
            # ngrok API not ready yet
            pass

    # Failed to start
    kill_ngrok_sync()
    raise Exception('ngrok failed to start within timeout')

def kill_ngrok_sync():
    global ngrok_process, ngrok_url, current_owner_uid, link_created_at, expiry_timer

    with lock:
        if ngrok_process:
            try:
                if sys.platform == 'win32':
                    ngrok_process.terminate()
                    ngrok_process.wait(timeout=3)
                else:
                    os.kill(ngrok_process.pid, signal.SIGTERM)
            except:
                pass
            ngrok_process = None

        # Force kill all ngrok processes
        try:
            subprocess.run(['taskkill', '/f', '/im', 'ngrok.exe'],
                         capture_output=True, timeout=5)
        except:
            pass

        ngrok_url = None
        current_owner_uid = None
        link_created_at = None
        if expiry_timer:
            expiry_timer.cancel()
            expiry_timer = None

def set_expiry_timer():
    global expiry_timer
    if expiry_timer:
        expiry_timer.cancel()
    expiry_timer = threading.Timer(NGROK_TIMEOUT, kill_ngrok_sync)
    expiry_timer.daemon = True
    expiry_timer.start()

def get_time_remaining():
    with lock:
        if not link_created_at:
            return 0
        elapsed = time.time() - link_created_at
        remaining = NGROK_TIMEOUT - elapsed
        return max(0, int(remaining))

# ============ HTTP REQUEST HANDLER ============

class VoidKitHandler(http.server.BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/ngrok/status':
            self.handle_status()
        elif self.path == '/api/ngrok/owner':
            self.handle_owner()
        else:
            self.serve_static()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'

        if self.path == '/api/ngrok/start':
            self.handle_start(body)
        elif self.path == '/api/ngrok/stop':
            self.handle_stop()
        else:
            self.send_json(404, {'error': 'Not found'})

    def handle_status(self):
        with lock:
            active = ngrok_url is not None and get_time_remaining() > 0
            data = {
                'active': active,
                'url': ngrok_url if active else None,
                'timeRemaining': get_time_remaining(),
                'createdAt': int(link_created_at * 1000) if link_created_at else None,
                'ownerUid': current_owner_uid
            }
        self.send_json(200, data)

    def handle_owner(self):
        with lock:
            data = {'ownerUid': current_owner_uid}
        self.send_json(200, data)

    def handle_start(self, body):
        try:
            data = json.loads(body)
            owner_uid = data.get('ownerUid')
            if not owner_uid:
                self.send_json(400, {'error': 'ownerUid required'})
                return

            with lock:
                # If ngrok is already running for this user, return existing URL
                if ngrok_url and current_owner_uid == owner_uid and get_time_remaining() > 0:
                    self.send_json(200, {
                        'url': ngrok_url,
                        'timeRemaining': get_time_remaining(),
                        'createdAt': int(link_created_at * 1000),
                        'active': True
                    })
                    return

                # If ngrok is running for a different user, kill it
                if ngrok_url:
                    current_uid = current_owner_uid
                    kill_ngrok_sync()

            # Small delay for cleanup
            time.sleep(1)

            tunnel_url = start_ngrok(owner_uid)
            self.send_json(200, {
                'url': tunnel_url,
                'timeRemaining': get_time_remaining(),
                'createdAt': int(time.time() * 1000),
                'active': True
            })
        except Exception as e:
            self.send_json(500, {'error': str(e)})

    def handle_stop(self):
        kill_ngrok_sync()
        self.send_json(200, {'active': False, 'timeRemaining': 0})

    def serve_static(self):
        # Default to dashboard.html
        if self.path == '/':
            file_path = 'dashboard.html'
        else:
            # Clean the path and remove query string
            clean_path = self.path.split('?')[0].lstrip('/')
            file_path = clean_path if clean_path else 'dashboard.html'

        full_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), file_path)
        full_path = os.path.normpath(full_path)

        # Security check - prevent directory traversal
        base_dir = os.path.dirname(os.path.abspath(__file__))
        if not full_path.startswith(base_dir):
            self.send_error(403, 'Forbidden')
            return

        if os.path.isdir(full_path):
            full_path = os.path.join(full_path, 'index.html')

        if os.path.isfile(full_path):
            mime_type, _ = mimetypes.guess_type(full_path)
            if mime_type is None:
                mime_type = 'application/octet-stream'

            with open(full_path, 'rb') as f:
                content = f.read()

            self.send_response(200)
            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_error(404, 'File not found')

    def send_json(self, status, data):
        response = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        # Suppress default logging, use custom format
        print(f'[SERVER] {args[0]} {args[1]} {args[2]}')

# ============ MAIN ============

if __name__ == '__main__':
    # Kill any existing ngrok processes on startup
    try:
        subprocess.run(['taskkill', '/f', '/im', 'ngrok.exe'],
                      capture_output=True, timeout=5)
    except:
        pass

    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('application/javascript', '.mjs')

    server = http.server.HTTPServer(('0.0.0.0', PORT), VoidKitHandler)
    print(f'\n  ╔═══════════════════════════════════╗')
    print(f'  ║   VOID KIT SERVER v2.1            ║')
    print(f'  ║   http://localhost:{PORT}              ║')
    print(f'  ╚═══════════════════════════════════╝\n')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down...')
        kill_ngrok_sync()
        server.shutdown()