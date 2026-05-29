# Void Kit – Deployment Guide

## Overview
This repository contains **Void Kit**, a local server with an Ngrok manager and a web UI.  
The project is now configured to be deployed on **Vercel** (or any similar serverless platform) with secure handling of secrets.

## Prerequisites
- **Node.js** (v14 or newer) installed locally.
- **Vercel CLI** (`npm i -g vercel`) – optional if you prefer the web UI.
- **Firebase** project (for authentication & database) – obtain the required keys.
- **Ngrok** account – generate an auth token.

## 1. Clone the Repository
```bash
git clone https://github.com/your-username/void-kit.git
cd void-kit
```

## 2. Install Dependencies
```bash
npm install
```
> No external dependencies are required yet, but this will create a `node_modules` folder for Vercel.

## 3. Configure Environment Variables
Create a `.env` file (already present) and replace the placeholder values with your real credentials:

```dotenv
FIREBASE_API_KEY=YOUR_FIREBASE_API_KEY
FIREBASE_PROJECT_ID=YOUR_FIREBASE_PROJECT_ID
FIREBASE_DATABASE_URL=https://YOUR_PROJECT_ID.firebaseio.com
FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com
FIREBASE_STORAGE_BUCKET=YOUR_PROJECT_ID.appspot.com
FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID
FIREBASE_APP_ID=YOUR_APP_ID
NGROK_AUTHTOKEN=YOUR_NGROK_AUTH_TOKEN
PORT=3000   # Vercel will override this automatically
```

**Important:** `.env` is listed in `.gitignore` so it will never be committed.

## 4. Add Secrets to Vercel
Vercel injects environment variables at runtime via its secret system. Run the following commands, replacing `<value>` with the actual secret:

```bash
vercel secret add firebase_api_key        <YOUR_FIREBASE_API_KEY>
vercel secret add firebase_project_id     <YOUR_FIREBASE_PROJECT_ID>
vercel secret add firebase_database_url   <YOUR_FIREBASE_DATABASE_URL>
vercel secret add firebase_auth_domain    <YOUR_FIREBASE_AUTH_DOMAIN>
vercel secret add firebase_storage_bucket <YOUR_FIREBASE_STORAGE_BUCKET>
vercel secret add firebase_messaging_sender_id <YOUR_FIREBASE_MESSAGING_SENDER_ID>
vercel secret add firebase_app_id         <YOUR_FIREBASE_APP_ID>
vercel secret add ngrok_authtoken         <YOUR_NGROK_AUTHTOKEN>
```

These secrets correspond to the entries in `vercel.json` under the `env` section.

## 5. Verify Local Run (Optional)
You can test the server locally before deploying:

```bash
npm start
# or
node server.js
```

Open `http://localhost:3000` in a browser. The UI should load and Ngrok will start when you request a tunnel via the UI.

## 6. Deploy to Vercel
From the project root, run:

```bash
vercel
```

Follow the prompts:
- Choose the existing project or create a new one.
- Select the appropriate scope (personal or team).
- When asked about the framework, choose **“Other”** (the project uses a custom Node server).
- Confirm the `vercel.json` configuration.

For a production deployment:

```bash
vercel --prod
```

Vercel will:
1. Install Node.js (as defined in `package.json`).
2. Build static assets (`dashboard.html`, `app.js`, `sites/**`).
3. Deploy the server (`server.js`) as a serverless function.
4. Inject the secrets you added earlier.

## 7. Post‑Deployment Checks
- Visit the generated Vercel URL (e.g., `https://void-kit.vercel.app`).
- Test the API endpoints:
  - `GET /api/ngrok/status`
  - `POST /api/ngrok/start` (requires `ownerUid` in JSON body)
- Ensure the UI can start an Ngrok tunnel and that the tunnel URL appears correctly.
- Verify that Firebase authentication works (login/registration).

## 8. Keep the Server Alive (Optional)
Vercel serverless functions may go idle after a period of inactivity. If you need the Ngrok tunnel to stay active continuously:

1. Use a **cron job** (e.g., GitHub Actions, GitLab CI, or a third‑party scheduler) that pings `/api/ngrok/status` every few minutes.
2. Alternatively, upgrade to a Vercel **Pro** plan which offers longer execution times.

## 9. Monitoring & Logs
- Vercel provides logs in the dashboard under **“Functions”**.
- For more detailed monitoring, integrate a service like **Sentry** or **LogRocket** and add the corresponding keys to Vercel secrets.

## 10. Clean‑up
If you ever need to remove the deployment:

```bash
vercel remove <project-name>
```

And delete the secrets:

```bash
vercel secret rm firebase_api_key
# repeat for each secret
```

---

### Quick Reference Commands

| Step | Command |
|------|---------|
| Install Vercel CLI | `npm i -g vercel` |
| Install project deps | `npm install` |
| Add Vercel secret | `vercel secret add <name> <value>` |
| Deploy (dev) | `vercel` |
| Deploy (prod) | `vercel --prod` |
| Remove deployment | `vercel remove <project>` |

---

You now have a complete, secure, and production‑ready deployment pipeline for **Void Kit**. Happy hacking!