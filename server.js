// ============================================================
// VOID KIT — LOCAL SERVER + NGROK MANAGER
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const ngrok = require('ngrok');

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

async function startNgrok(ownerUid) {
  // Kill existing ngrok if running
  killNgrokSync();

  currentOwnerUid = ownerUid;

  try {
    const url = await ngrok.connect({
      addr: PORT,
      authtoken: process.env.NGROK_AUTHTOKEN,
    });

    linkCreatedAt = Date.now();

    // Set 15-minute expiry
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      killNgrokSync();
      console.log('ngrok tunnel auto-expired after 15 minutes');
    }, NGROK_TIMEOUT);

    ngrokUrl = url;
    console.log('ngrok tunnel started:', ngrokUrl);
    return ngrokUrl;
  } catch (err) {
    console.error('ngrok connect error:', err.message);
    throw err;
  }
}

async function killNgrokSync() {
  try {
    await ngrok.disconnect();
  } catch (e) {
    // Ignore disconnect errors if no tunnel was active
  }

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
          console.log('Returning existing tunnel for user:', ownerUid);
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
          console.log('Restarting tunnel for new user');
          await killNgrokSync();
          // Small delay for cleanup
          await new Promise(r => setTimeout(r, 1000));
        }

        console.log('Starting new tunnel for user:', ownerUid);
        const tunnelUrl = await startNgrok(ownerUid);
        console.log('Tunnel started successfully:', tunnelUrl);
        writeJson(res, 200, {
          url: tunnelUrl,
          timeRemaining: getTimeRemaining(),
          createdAt: linkCreatedAt,
          active: true
        });
      } catch (e) {
        console.error('Error starting tunnel:', e.message);
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

// No need for taskkill on startup when using the ngrok npm package

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