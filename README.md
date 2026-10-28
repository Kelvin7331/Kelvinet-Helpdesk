# 🛡️ Kelvinet Smart IT Helpdesk

An AI-powered IT support chatbot and ticketing system built with **vanilla HTML, CSS and JavaScript**, **Firebase** (Auth + Firestore) and a **Cloudflare Worker** that keeps the AI key off the browser. Users describe a problem in chat, get step-by-step help instantly, and escalate to a ticket when the bot can't fix it. Engineers and admins manage everything from a live dashboard.

Built by [Kelvinet Technologies](https://github.com/) — Maua, Meru, Kenya.

> **Live demo:** `https://YOUR-USERNAME.github.io/YOUR-REPO/`

---

## ✨ Features

**For users**
- 💬 AI support chat with answers formatted as clear numbered steps and bullet lists
- 🎫 One-click ticket creation — the AI pre-fills the title, description, category and priority from your conversation
- 🖼️ Attach screenshots in chat and files to tickets
- 🖥️ Optional remote-support request: share your **RustDesk** or **AnyDesk** session ID on a ticket
- 📧 Email confirmation for every ticket (EmailJS)
- 💡 Proactive tips based on the day, time and season
- 🌓 Light / dark mode

**For engineers and admins**
- 📊 Live dashboard: KPIs, tickets by category and priority, resolution rate, activity feed, prioritised action queue
- 🎟️ All tickets in real time, with search, filters, status workflow (Open → In Progress → Waiting → Resolved), notes and CSV export
- 📚 Knowledge Base builder (add, edit, delete, search)
- ⚡ **Resolved tickets automatically become KB articles** (AI-written, tagged "Auto" for review)
- 👥 Admin-only user management and role changes
- 🏷️ Sequential ticket IDs: `T_KT001`, `T_KT002`, …

**Resilience**
- If the AI is unreachable the chatbot falls back to an offline keyword bot that searches the Knowledge Base, so users are never left without a reply.

---

## 👥 Roles & permissions

| Capability | User | Engineer | Admin |
|---|:--:|:--:|:--:|
| Chat with the AI assistant | ✅ | ✅ | ✅ |
| Create tickets | ✅ | ✅ | ✅ |
| View own tickets | ✅ | ✅ | ✅ |
| View **all** tickets | ❌ | ✅ | ✅ |
| Change ticket status / add notes | ❌ | ✅ | ✅ |
| Dashboard & CSV export | ❌ | ✅ | ✅ |
| Create / edit Knowledge Base articles | ❌ | ✅ | ✅ |
| Delete tickets | ❌ | ❌ | ✅ |
| Manage users & roles | ❌ | ❌ | ✅ |

New sign-ups are always **User**. Roles are enforced by Firestore Security Rules, not just hidden in the UI.

---

## 🏗️ Architecture

```mermaid
flowchart LR
    B[Browser<br/>GitHub Pages<br/>HTML / CSS / JS] -->|Auth + realtime data| F[(Firebase<br/>Auth + Firestore)]
    B -->|Firebase ID token + chat| W[Cloudflare Worker<br/>AI proxy]
    W -->|verifies login, adds secret key| A[AI provider<br/>Claude or Gemini]
    B -->|ticket confirmation| E[EmailJS]
```

The browser never sees the AI key. The Worker accepts a request only if it carries a valid Firebase login token for **your** project.

---

## 🧰 Tech stack

| Layer | Technology |
|---|---|
| Front end | HTML5, CSS3, vanilla JavaScript (ES modules) |
| Auth & database | Firebase Authentication, Cloud Firestore |
| AI proxy | Cloudflare Workers (free plan, no card needed) |
| AI | Google Gemini (default model `gemini-3.5-flash-lite`) **or** Anthropic Claude |
| Email | EmailJS |
| Hosting | GitHub Pages |

---

## 📁 Project structure

```
├── index.html              # App shell: auth screen, chat, tickets, dashboard, KB
├── chatbot.css             # Styles (dark/light themes, responsive)
├── chatbot.js              # All app logic
├── firestore.rules         # Firestore security rules (publish in Firebase console)
├── worker/
│   └── cloudflare-worker.js  # AI proxy (paste into a Cloudflare Worker)
└── README.md
```

---

## 🚀 Getting started

### 1. Firebase

1. Create a project at the [Firebase console](https://console.firebase.google.com) (the free **Spark** plan is enough).
2. **Authentication → Sign-in method →** enable **Email/Password**.
3. **Authentication → Settings → Authorized domains →** add `YOUR-USERNAME.github.io`.
4. **Firestore Database → Create database** (production mode).
5. **Firestore → Rules →** paste the contents of `firestore.rules` and **Publish**.
6. **Project settings → Your apps → Web app (`</>`)** → copy the `firebaseConfig` into `chatbot.js`.

### 2. AI proxy (Cloudflare Worker)

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (email only).
2. **Workers & Pages → Create application → Start with Hello World → Deploy.**
3. **Edit code**, paste `worker/cloudflare-worker.js`, **Deploy**.
4. **Settings → Variables and Secrets** and add:

| Name | Type | Value |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Text | your Firebase `projectId` |
| `GEMINI_API_KEY` | **Secret** | your key from [Google AI Studio](https://aistudio.google.com/apikey) |
| `PROVIDER` | Text | optional: `gemini` or `anthropic` (auto-detected from which key you set) |
| `GEMINI_MODEL` | Text | optional, default `gemini-3.5-flash-lite` |
| `GEMINI_THINKING_LEVEL` | Text | optional: `minimal`, `low`, `medium` or `high` |
| `ANTHROPIC_API_KEY` | **Secret** | only if you use Claude instead |
| `ALLOWED_ORIGINS` | Text | `https://YOUR-USERNAME.github.io,http://localhost:5500` |

> **Model names change.** Google retires models regularly — `gemini-2.5-*` is now closed to new accounts and returns a 404. If the AI ever stops working, check the [deprecations page](https://ai.google.dev/gemini-api/docs/deprecations) and update `GEMINI_MODEL`; no code change is needed.

5. Open your Worker URL in a browser. You should see `{"status":"ok", …}` with `firebaseProjectIdSet` and `providerKeySet` both `true`.
6. In `chatbot.js`, set `AI_PROXY_URL` to your Worker URL.

### 3. Email notifications (optional)

Create a free [EmailJS](https://www.emailjs.com) account, add an email service and a template using these variables: `to_email`, `to_name`, `ticket_id`, `ticket_title`, `ticket_desc`, `ticket_priority`, `ticket_category`, `ticket_status`, `created_at`, `company_name`, `support_email`. Put the Service ID, Template ID and Public Key in the `CONFIG` block of `chatbot.js`.

### 4. Firestore index

Users' "My Tickets" view needs a composite index. The first time it loads, open the browser console, click the link in the `failed-precondition` error, and press **Create index**. (Or create it manually: collection `tickets`, fields `uid` ↑ and `ts` ↓.)

### 5. Create the first admin

1. Open the site and **Create Account**.
2. In the Firebase console go to **Firestore → `users` →** your document and change `role` to `admin`.
3. Sign out and back in. From the **Users** tab you can now promote others to Engineer or Admin.

### 6. Deploy to GitHub Pages

**Repo → Settings → Pages → Deploy from a branch → `main` / root.** The files are static, so there's no build step. For local testing, serve the folder over HTTP (for example the VS Code *Live Server* extension); opening `index.html` directly with `file://` won't work with ES modules.

---

## 🔐 Security notes

- **The Firebase `apiKey` in `chatbot.js` is not a secret.** It only identifies your project to Google, and every Firebase web app ships it to the browser by design. GitHub's secret scanner flags the `AIza…` pattern automatically; the alert can be closed. What actually protects your data is **Authentication + Firestore Security Rules**, which are in this repo. For defence in depth, restrict the key to your website in **Google Cloud Console → APIs & Services → Credentials → Browser key → Application restrictions → Websites**, adding `https://YOUR-USERNAME.github.io/*` (and `http://localhost:5500/*` for local work).
- **The AI key is a real secret** and lives only in Cloudflare as an encrypted Worker secret. Never commit it.
- The Worker verifies each caller's Firebase ID token (signature, issuer, audience, expiry) before spending any AI credit, and caps message count and response length.
- **Privacy:** on Google's free Gemini tier, prompts may be used to improve Google's products. Tell users not to paste passwords or confidential data into the chat, or move to a paid key if that matters for your organisation.
- Roles can't be self-assigned: Firestore rules only allow new profiles with `role: "user"`.
- EmailJS public keys are also designed to be public; use EmailJS's domain allow-list to restrict them.

---

## 🩺 Troubleshooting

The "AI unavailable" banner now states the reason:

| Message | Fix |
|---|---|
| `AI_PROXY_URL is not set` | Put your Worker URL in `chatbot.js`. |
| `cannot reach the AI proxy` | Wrong Worker URL, or `ALLOWED_ORIGINS` doesn't include your site's origin (`https://name.github.io`, no repo path needed). |
| `Invalid or expired login` `[HTTP 401]` | `FIREBASE_PROJECT_ID` is wrong or missing in the Worker. |
| `Server misconfiguration …` `[HTTP 500]` | A Worker variable is missing; open the Worker URL to see which one. |
| `Gemini 404 … Model "…" is unavailable` `[HTTP 502]` | The model was retired. Set `GEMINI_MODEL` to `gemini-3.5-flash-lite` (or delete the variable to use the default). |
| `Gemini 429 …` `[HTTP 502]` | Free-tier rate limit reached. Wait a minute, or enable billing in AI Studio for higher limits. |
| `Gemini 400/403 …` `[HTTP 502]` | `GEMINI_API_KEY` is wrong or from a different Google product. Create a fresh key in AI Studio. |
| `AI provider rejected the request (Anthropic …)` | Invalid Claude key or no account credit. Check the Worker's **Logs**. |

Other common issues: users seeing an empty "My Tickets" list usually means the Firestore index in step 4 is missing; password-reset emails need your domain in Firebase's authorized domains.

---

## 🗺️ Roadmap

- Persistent file storage for ticket attachments (currently filenames are recorded)
- SLA timers and escalation
- Satisfaction rating after resolution
- Ticket comment threads between user and engineer
- Multi-language support
- Voice input

---

## 👤 Author

**Kelvin Mwichwiri Gitonga** — Founder, [Kelvinet Technologies](https://github.com/) · Maua, Meru, Kenya
Web development · Networking · Cybersecurity · IT support · IT consultancy

## 📄 License

Released under the MIT License. See `LICENSE` for details.
