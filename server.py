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
import urllib.error
import mimetypes

PORT = 3000
NGROK_TIMEOUT = 15 * 60  # 15 minutes in seconds

# Global state
ngrok_process = None
ngrok_url = None
link_created_at = None
current_owner_uid = None
expiry_timer = None
ngrok_starting = False
lock = threading.Lock()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_ngrok_path():
    """Get ngrok.exe path, using short path on Windows to avoid spaces."""
    ngrok_exe = os.path.join(BASE_DIR, 'ngrok.exe')
    if not os.path.exists(ngrok_exe):
        return None
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(260)
        ret = ctypes.windll.kernel32.GetShortPathNameW(ngrok_exe, buf, 260)
        if ret > 0 and ret < 260:
            sp = buf.value
            if os.path.exists(sp):
                return sp
    except:
        pass
    return ngrok_exe

def is_port_in_use(port):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return False
        except OSError:
            return True

def check_ngrok_api():
    """Quick check if ngrok API is reachable. Returns (ready, url_or_None)."""
    try:
        req = urllib.request.Request('http://127.0.0.1:4040/api/tunnels')
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode())
            for t in data.get('tunnels', []):
                u = t.get('public_url', '')
                if u.startswith('https'):
                    return True, u
            return True, None
    except:
        return False, None

# ============ NGROK MANAGEMENT ============

def start_ngrok_async(owner_uid):
    """Start ngrok in background thread. Updates global state when ready."""
    global ngrok_process, ngrok_url, link_created_at, current_owner_uid, ngrok_starting

    with lock:
        if ngrok_starting:
            return
        ngrok_starting = True
        current_owner_uid = owner_uid

    def _run():
        global ngrok_process, ngrok_url, link_created_at, ngrok_starting
        try:
            # Check if already running
            ready, existing = check_ngrok_api()
            if ready and existing:
                print(f'ngrok already active: {existing}')
                with lock:
                    ngrok_url = existing
                    link_created_at = time.time()
                    set_expiry_timer()
                    ngrok_starting = False
                return

            # Kill existing processes
            subprocess.run(['taskkill', '/f', '/im', 'ngrok.exe'],
                         capture_output=True, timeout=5)
            time.sleep(1)

            ngrok_exe = get_ngrok_path()
            if not ngrok_exe:
                raise Exception('ngrok.exe not found')

            print(f'Starting: {ngrok_exe} http {PORT}')

            # Start ngrok with output to devnull to avoid pipe deadlocks
            ngrok_process = subprocess.Popen(
                [ngrok_exe, 'http', str(PORT), '--log=stdout', '--log-level=info'],
                cwd=BASE_DIR,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )

            # Wait for tunnel URL (up to 60 seconds)
            for i in range(60):
                time.sleep(1)
                ready, url = check_ngrok_api()
                if ready and url:
                    with lock:
                        ngrok_url = url
                        link_created_at = time.time()
                        set_expiry_timer()
                    print(f'✓ Tunnel active: {url}')
                    with lock:
                        ngrok_starting = False
                    return
                elif ready and i == 2:
                    print('API ready, waiting for tunnel assignment...')
                elif not ready and i == 2:
                    print('Waiting for API...')

            # Timed out - check if process is alive
            if ngrok_process and ngrok_process.poll() is not None:
                print('ngrok process exited prematurely')
            else:
                print('ngrok running but tunnel not assigned (check auth/network)')

            with lock:
                ngrok_starting = False

        except Exception as e:
            print(f'ngrok error: {e}')
            with lock:
                ngrok_starting = False

    t = threading.Thread(target=_run, daemon=True)
    t.start()

def kill_ngrok_sync():
    global ngrok_process, ngrok_url, current_owner_uid, link_created_at, expiry_timer, ngrok_starting
    with lock:
        if ngrok_process:
            try:
                ngrok_process.terminate()
                ngrok_process.wait(timeout=3)
            except:
                pass
            ngrok_process = None
        subprocess.run(['taskkill', '/f', '/im', 'ngrok.exe'],
                     capture_output=True, timeout=5)
        ngrok_url = None
        current_owner_uid = None
        link_created_at = None
        ngrok_starting = False
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
    if not link_created_at:
        return 0
    return max(0, int(NGROK_TIMEOUT - (time.time() - link_created_at)))

# ============ HTTP HANDLER ============

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
        elif self.path == '/api/ngrok/check':
            self.handle_check()
        else:
            self.serve_static()

    def do_POST(self):
        cl = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(cl).decode('utf-8') if cl > 0 else '{}'
        if self.path == '/api/ngrok/start':
            self.handle_start(body)
        elif self.path == '/api/ngrok/stop':
            self.handle_stop()
        else:
            self.send_json(404, {'error': 'Not found'})

    def handle_check(self):
        ready, url = check_ngrok_api()
        self.send_json(200, {
            'ngrok_installed': os.path.exists(os.path.join(BASE_DIR, 'ngrok.exe')),
            'api_reachable': ready,
            'tunnel_active': url is not None,
            'url': url,
            'message': 'ok' if ready else 'ngrok not started'
        })

    def handle_status(self):
        active = ngrok_url is not None and get_time_remaining() > 0
        self.send_json(200, {
            'active': active,
            'url': ngrok_url if active else None,
            'timeRemaining': get_time_remaining(),
            'createdAt': int(link_created_at * 1000) if link_created_at else None,
            'ownerUid': current_owner_uid,
            'starting': ngrok_starting
        })

    def handle_owner(self):
        self.send_json(200, {'ownerUid': current_owner_uid})

    def handle_start(self, body):
        try:
            data = json.loads(body)
            owner_uid = data.get('ownerUid')
            if not owner_uid:
                self.send_json(400, {'error': 'ownerUid required'})
                return

            # Check if already running for this user
            if ngrok_url and current_owner_uid == owner_uid and get_time_remaining() > 0:
                self.send_json(200, {
                    'url': ngrok_url,
                    'timeRemaining': get_time_remaining(),
                    'createdAt': int(link_created_at * 1000),
                    'active': True,
                    'message': 'Tunnel already active'
                })
                return

            # Kill existing tunnel for different user
            if ngrok_url:
                kill_ngrok_sync()

            # Start async (non-blocking)
            start_ngrok_async(owner_uid)

            # Return immediately - client will poll /api/ngrok/status
            self.send_json(202, {
                'url': None,
                'timeRemaining': 900,
                'active': False,
                'starting': True,
                'message': 'ngrok starting...'
            })

        except Exception as e:
            print(f'Start error: {e}')
            self.send_json(500, {'error': str(e)})

    def handle_stop(self):
        kill_ngrok_sync()
        self.send_json(200, {'active': False, 'timeRemaining': 0})

    def serve_static(self):
        if self.path == '/':
            file_path = 'index.html'
        else:
            clean_path = self.path.split('?')[0].lstrip('/')
            file_path = clean_path if clean_path else 'dashboard.html'
        full_path = os.path.normpath(os.path.join(BASE_DIR, file_path))
        if not full_path.startswith(BASE_DIR):
            self.send_error(403)
            return
        if os.path.isdir(full_path):
            full_path = os.path.join(full_path, 'index.html')
        if os.path.isfile(full_path):
            mt, _ = mimetypes.guess_type(full_path)
            with open(full_path, 'rb') as f:
                c = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mt or 'application/octet-stream')
            self.send_header('Content-Length', str(len(c)))
            self.end_headers()
            self.wfile.write(c)
        else:
            self.send_error(404)

    def send_json(self, status, data):
        r = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(r)))
        self.end_headers()
        self.wfile.write(r)

    def log_message(self, fmt, *args):
        print(f'[SERVER] {args[0]} {args[1]} {args[2]}')

# ============ MAIN ============
if __name__ == '__main__':
    subprocess.run(['taskkill', '/f', '/im', 'ngrok.exe'], capture_output=True, timeout=5)
    if is_port_in_use(PORT):
        print(f'WARNING: Port {PORT} is in use!')
    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('text/css', '.css')
    server = http.server.HTTPServer(('0.0.0.0', PORT), VoidKitHandler)
    print(f'\n╔═══════════════════════════════════╗')
    print(f'  ║   VOID KIT SERVER v2.1            ║')
    print(f'  ║   https://void-kit.onrender.com   ║')
    print(f'  ╚═══════════════════════════════════╝\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        kill_ngrok_sync()
        server.shutdown()