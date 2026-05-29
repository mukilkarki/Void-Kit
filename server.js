// ============================================================
// VOID KIT — LOCAL SERVER + NGROK MANAGER
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const PORT = 3000;
const NGROK_TIMEOUT = 15 * 60 * 1000; // 15 minutes

let ngrokProcess = null;
let ngrokUrl = null;
let linkCreatedAt = null;
let currentOwnerUid = null;
let expiryTimer = null;

// MIME types
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.exe': 'application/octet-stream',
};

// ============ NGROK MANAGEMENT ============

function startNgrok(ownerUid) {
  return new Promise((resolve, reject) => {
    // Kill existing ngrok if running
    killNgrokSync();

    currentOwnerUid = ownerUid;

    // Spawn ngrok
    ngrokProcess = spawn('ngrok', ['http', PORT.toString(), '--log=stdout', '--authtoken', process.env.NGROK_AUTHTOKEN], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    ngrokProcess.on('error', (err) => {
      console.error('ngrok spawn error:', err.message);
      reject(err);
    });

    ngrokProcess.stdout.on('data', (data) => {
      console.log('ngrok:', data.toString());
    });

    ngrokProcess.stderr.on('data', (data) => {
      console.log('ngrok:', data.toString());
    });

    // Poll ngrok API for tunnel URL
    let attempts = 0;
    const maxAttempts = 25;
    const pollInterval = setInterval(async () => {
      attempts++;
      try {
        const resp = await fetch('http://127.0.0.1:4040/api/tunnels');
        if (resp.ok) {
          const data = await resp.json();
          const tunnels = data.tunnels || [];
          const httpsTunnel = tunnels.find(t => t.public_url && t.public_url.startsWith('https'));
          if (httpsTunnel) {
            ngrokUrl = httpsTunnel.public_url;
            linkCreatedAt = Date.now();
            clearInterval(pollInterval);

            // Set 15-minute expiry
            if (expiryTimer) clearTimeout(expiryTimer);
            expiryTimer = setTimeout(() => {
              killNgrokSync();
              console.log('ngrok tunnel auto-expired after 15 minutes');
            }, NGROK_TIMEOUT);

            console.log('ngrok tunnel started:', ngrokUrl);
            resolve(ngrokUrl);
            return;
          }
        }
      } catch (e) {
        // ngrok API not ready yet
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        killNgrokSync();
        reject(new Error('ngrok failed to start within timeout'));
      }
    }, 1200);
  });
}

function killNgrokSync() {
  if (ngrokProcess) {
    try { ngrokProcess.kill('SIGTERM'); } catch(e) {}
    ngrokProcess = null;
  }
  // Force kill all ngrok processes
  try {
    exec('taskkill /f /im ngrok.exe 2>nul', () => {});
  } catch(e) {}

  ngrokUrl = null;
  currentOwnerUid = null;
  linkCreatedAt = null;
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function getTimeRemaining() {
  if (!linkCreatedAt) return 0;
  const elapsed = Date.now() - linkCreatedAt;
  const remaining = NGROK_TIMEOUT - elapsed;
  return Math.max(0, Math.floor(remaining / 1000));
}

// ============ HTTP SERVER ============

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `https://void-kit.onrender.com`);
  const pathname = url.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // === API ENDPOINTS ===

  // POST /api/ngrok/start
  if (pathname === '/api/ngrok/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { ownerUid } = JSON.parse(body);
        if (!ownerUid) {
          writeJson(res, 400, { error: 'ownerUid required' });
          return;
        }

        // If ngrok is already running for this user, return existing URL
        if (ngrokUrl && currentOwnerUid === ownerUid && getTimeRemaining() > 0) {
          writeJson(res, 200, {
            url: ngrokUrl,
            timeRemaining: getTimeRemaining(),
            createdAt: linkCreatedAt,
            active: true
          });
          return;
        }

        // If ngrok is running for a different user or expired, restart
        if (ngrokUrl) {
          killNgrokSync();
          // Small delay for cleanup
          await new Promise(r => setTimeout(r, 1000));
        }

        const tunnelUrl = await startNgrok(ownerUid);
        writeJson(res, 200, {
          url: tunnelUrl,
          timeRemaining: getTimeRemaining(),
          createdAt: linkCreatedAt,
          active: true
        });
      } catch (e) {
        writeJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  // POST /api/ngrok/stop
  if (pathname === '/api/ngrok/stop' && req.method === 'POST') {
    killNgrokSync();
    writeJson(res, 200, { active: false, timeRemaining: 0 });
    return;
  }

  // GET /api/ngrok/owner — returns current owner UID (so template pages know who owns the link)
  if (pathname === '/api/ngrok/owner' && req.method === 'GET') {
    writeJson(res, 200, { ownerUid: currentOwnerUid });
    return;
  }

  // GET /api/ngrok/status
  if (pathname === '/api/ngrok/status') {
    writeJson(res, 200, {
      active: ngrokUrl !== null && getTimeRemaining() > 0,
      url: ngrokUrl,
      timeRemaining: getTimeRemaining(),
      createdAt: linkCreatedAt,
      ownerUid: currentOwnerUid
    });
    return;
  }

  // === STATIC FILE SERVING ===
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try index.html for directory paths
      if (err.code === 'EISDIR' || err.code === 'ENOENT') {
        const indexPath = path.join(filePath, 'index.html');
        fs.readFile(indexPath, (err2, data2) => {
          if (err2) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': MIME['.html'] || 'text/html' });
            res.end(data2);
          }
        });
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

function writeJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// ============ START ============

// Kill any existing ngrok processes on startup
try {
  exec('taskkill /f /im ngrok.exe 2>nul', () => {});
} catch(e) {}

server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════╗`);
  console.log(`  ║   VOID KIT SERVER v2.1            ║`);
  console.log(`  ║   https://void-kit.onrender.com   ║`);
  console.log(`  ╚═══════════════════════════════════╝\n`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  killNgrokSync();
  process.exit();
});
process.on('SIGTERM', () => {
  killNgrokSync();
  process.exit();
});
process.on('exit', () => {
  killNgrokSync();
});