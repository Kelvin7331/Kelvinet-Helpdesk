/**
 * KELVINET SMART IT HELPDESK — chatbot.js v3.1
 * ═══════════════════════════════════════════════
 * - Firebase Auth  : email/password login, signup, password reset
 * - Firestore DB   : tickets, KB articles, users, activity log
 * - Role-based UI  : user | engineer | admin
 *   • user     → chat + own tickets only
 *   • engineer → all tickets + dashboard + KB
 *   • admin    → everything + user management + role changes
 * - Sequential ticket IDs : T_KT001, T_KT002 … (Firestore transaction)
 * - Real-time listeners    : tickets update live across sessions
 * - Claude AI responses    : proxied via Firebase Cloud Function
 *                            (see functions/index.js) — API key never
 *                            touches the browser. Falls back to an
 *                            offline keyword bot if the proxy fails.
 * - EmailJS notifications  : on ticket creation
 * - File attachments       : drag-drop in chat + ticket modal
 * - Proactive banner       : time/season/day aware
 */

'use strict';

/* ═══════════════════════════════════════════════
   ⚙️  CONFIGURATION  — fill in your keys here
═══════════════════════════════════════════════ */
const CONFIG = {
  // Claude API key is no longer stored here — it lives server-side in
  // Firebase Cloud Functions (Secret Manager). See functions/index.js.
  EMAILJS_SERVICE_ID:  'YOUR_SERVICE_ID',
  EMAILJS_TEMPLATE_ID: 'YOUR_TEMPLATE_ID',
  EMAILJS_PUBLIC_KEY:  'YOUR_PUBLIC_KEY',
  MAX_MESSAGES:    150,
  MAX_FILE_SIZE_MB: 5,
  TYPING_DELAY_MS: 600,
  COMPANY_NAME:    'Kelvinet Technologies',
  SUPPORT_EMAIL:   'support@kelvinet.co.ke',
};

/* ═══════════════════════════════════════════════
   🔥  FIREBASE INIT
   Replace the firebaseConfig object with values
   from your Firebase Console → Project Settings
═══════════════════════════════════════════════ */
import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs,
  setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit,
  onSnapshot, serverTimestamp, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBlWdrPTp4N3MyWOB3RKr73gbMneRwUQhI",
  authDomain: "kelvinet-helpdesk.firebaseapp.com",
  projectId: "kelvinet-helpdesk",
  storageBucket: "kelvinet-helpdesk.firebasestorage.app",
  messagingSenderId: "728810883020",
  appId: "1:728810883020:web:e1628c3d575932fde8bf69"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ═══════════════════════════════════════════════
   🤖  AI PROXY — plain HTTPS Cloud Function
   Deployed via Google Cloud Console (no Firebase CLI).
   See console-function-index.js for the server-side code.
═══════════════════════════════════════════════ */

// Paste your function's Trigger URL here (Cloud Functions Console →
// your function → Trigger tab → Trigger URL).
const AI_PROXY_URL = 'https://kelvinet-ai-proxy.kelvinmwichwiri1.workers.dev';

/**
 * Drop-in replacement for the Firebase callable SDK's httpsCallable().
 * Same call shape as before — askClaude({ system, messages, max_tokens }) —
 * so none of the call sites elsewhere in this file need to change.
 * Internally: fetches a fresh Firebase ID token and sends it as a Bearer
 * header, since this is a plain HTTPS function doing its own token check
 * (not a Firebase "callable" function, which the CLI-based setup used).
 */
async function askClaude(payload) {
  if (!auth.currentUser) {
    throw new Error('Not signed in — cannot call AI proxy.');
  }
  const idToken = await auth.currentUser.getIdToken();

  const res = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `AI proxy HTTP ${res.status}`);
  }

  const data = await res.json();
  // Wrapped in { data: ... } to match the shape the rest of the file expects
  // from result.data.text (the same shape httpsCallable() returns).
  return { data };
}

/* ═══════════════════════════════════════════════
   📚  SEED KB ARTICLES  (auto-loaded on first run)
═══════════════════════════════════════════════ */
const SEED_KB = [
  {
    title: 'Cannot login / forgot password', category: 'account',
    tags: ['password','login','reset','forgot','locked'],
    content: `Your account may be locked or the password has been forgotten. Here are the steps:
1. Go to the login page and click "Forgot Password".
2. Enter your registered email address.
3. Check your inbox (and spam folder) for the reset link.
4. Click the link and set a new password.
5. If still locked, contact support@kelvinet.co.ke with your employee ID.`,
  },
  {
    title: 'Printer not printing', category: 'hardware',
    tags: ['printer','print','paper jam','toner'],
    content: `Your printer may be offline, out of supplies, or have a stuck print job. Try these steps:
1. Confirm the printer is powered ON and has paper and toner.
2. Set it as the default printer on your PC.
3. On Windows: open services.msc → find "Print Spooler" → click Restart.
4. For network printers: verify it is on the same network subnet.
5. Print a test page directly from the printer to confirm hardware is OK.`,
  },
  {
    title: 'WiFi or Internet not working', category: 'network',
    tags: ['wifi','internet','network','router','connection'],
    content: `Your internet connection may be disrupted. Try these steps:
1. Restart your router and modem — wait 30 seconds before reconnecting.
2. Check if other devices are also affected to isolate the problem.
3. On Windows: open Command Prompt and run "ipconfig /release" then "ipconfig /renew".
4. Forget and re-join the WiFi network on your device.
5. If only your device is affected, update the network adapter driver.`,
  },
  {
    title: 'Computer running slowly', category: 'hardware',
    tags: ['slow','lag','freeze','performance','hanging'],
    content: `A slow computer is usually caused by high resource usage or a full disk. Try:
1. Open Task Manager (Ctrl+Shift+Esc) and check which process is consuming most CPU/RAM.
2. Close unused applications and browser tabs.
3. Run Disk Cleanup to free disk space.
4. Check if disk usage is stuck at 100% — this suggests a failing drive or full storage.
5. Restart the computer to clear memory.
6. If still slow, the device may need a RAM upgrade or SSD replacement.`,
  },
  {
    title: 'Email not working in Outlook', category: 'email',
    tags: ['email','outlook','send','receive','smtp','imap'],
    content: `Outlook may have lost its server connection or have incorrect settings. Try:
1. Check your internet connection first.
2. In Outlook: go to File → Account Settings → Test Account Settings.
3. Verify SMTP and IMAP server details with your IT admin.
4. For corporate accounts: confirm VPN is connected if required.
5. Check the Outbox for stuck messages and delete or resend them.
6. For Gmail in Outlook: ensure an App Password is configured in your Google account.`,
  },
  {
    title: 'Software installation guide', category: 'software',
    tags: ['install','update','software','setup','driver'],
    content: `Follow these steps to safely install approved software:
1. Only install software approved by the IT department.
2. Right-click the installer and select "Run as Administrator".
3. Standard Windows installers use .exe or .msi formats.
4. If antivirus blocks a legitimate installer: temporarily disable it, install, then re-enable immediately.
5. For failed Windows Updates: delete the contents of C:\\Windows\\SoftwareDistribution\\Download and retry.`,
  },
  {
    title: 'VPN connection issues', category: 'network',
    tags: ['vpn','remote','tunnel','connect'],
    content: `VPN issues are usually caused by expired credentials or conflicting software. Try:
1. Ensure you have a stable internet connection before launching VPN.
2. Verify your VPN username and password — corporate passwords expire periodically.
3. Try connecting to a different VPN server if options are available.
4. Disable other VPN clients or conflicting network adapters.
5. Open Command Prompt and run "ipconfig /flushdns".
6. Uninstall and reinstall the VPN client if the problem persists.`,
  },
  {
    title: 'Screen or monitor not displaying', category: 'hardware',
    tags: ['monitor','screen','display','black screen','hdmi','vga'],
    content: `A blank screen is usually a cable, power, or display mode issue. Try:
1. Check all cables (HDMI, VGA, DisplayPort) at both the monitor and PC.
2. Try a different cable if available.
3. Press Win+P to toggle display mode (Duplicate, Extend, Second Screen Only).
4. Check the monitor power indicator light — if off, check the power cable and socket.
5. Test the monitor with a different device to determine whether it is the monitor or the PC at fault.`,
  },
];

/* ═══════════════════════════════════════════════
   🧠  APP STATE
═══════════════════════════════════════════════ */
let currentUser    = null;   // Firebase Auth user object
let currentProfile = null;   // Firestore users/{uid} document data
let ticketListener = null;   // Firestore real-time unsubscribe function
let localMessages  = [];     // Chat messages (session-only)
let darkMode       = true;

const STATUS_FLOW     = ['open','in-progress','waiting','resolved'];
const STATUS_LABELS   = { open:'Open','in-progress':'In Progress',waiting:'Waiting on User',resolved:'Resolved' };
const PRIORITY_LABELS = { low:'Low',normal:'Normal',high:'High',critical:'Critical' };

let chatAttachments  = [];
let modalAttachments = [];
let editingKBId      = null;
let roleTargetUid    = null;
let isResponding     = false;
const conversationHistory = [];

/* ═══════════════════════════════════════════════
   🔧  UTILITIES
═══════════════════════════════════════════════ */
function uid(prefix = 'id') {
  if (crypto?.randomUUID) return prefix + '_' + crypto.randomUUID().replace(/-/g,'').slice(0,12);
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

function formatDate(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-KE', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function timeAgo(ts) {
  const d   = ts?.toDate ? ts.toDate() : new Date(ts);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60)    return 'just now';
  if (sec < 3600)  return Math.floor(sec/60) + 'm ago';
  if (sec < 86400) return Math.floor(sec/3600) + 'h ago';
  return Math.floor(sec/86400) + 'd ago';
}

function escapeHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function isStaff() { return ['admin','engineer'].includes(currentProfile?.role); }
function isAdmin() { return currentProfile?.role === 'admin'; }

/* ═══════════════════════════════════════════════
   🔔  TOAST NOTIFICATIONS
═══════════════════════════════════════════════ */
function showToast(message, type = 'info', duration = 4000) {
  const icons = { success:'fa-circle-check', error:'fa-circle-xmark', info:'fa-circle-info', warning:'fa-triangle-exclamation' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type]||icons.info} toast-icon"></i><span class="toast-msg">${escapeHtml(message)}</span><button class="toast-close"><i class="fas fa-times"></i></button>`;
  document.getElementById('toastContainer').appendChild(t);
  t.querySelector('.toast-close').addEventListener('click', () => t.remove());
  if (duration > 0) setTimeout(() => t.remove(), duration);
  return t;
}

/* ═══════════════════════════════════════════════
   🌓  THEME
═══════════════════════════════════════════════ */
function applyTheme() {
  document.body.classList.toggle('light', !darkMode);
  const btn = document.getElementById('darkToggle');
  if (btn) btn.querySelector('i').className = darkMode ? 'fas fa-moon' : 'fas fa-sun';
  try { localStorage.setItem('kv_theme', darkMode ? 'dark' : 'light'); } catch(e) {}
}

/* ═══════════════════════════════════════════════
   🔐  AUTH
═══════════════════════════════════════════════ */
function showAuthError(formId, msg) {
  const el = document.getElementById(formId + 'Error');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 7000);
}

function clearAuthError(formId) {
  const el = document.getElementById(formId + 'Error');
  if (el) el.classList.remove('visible');
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pw    = document.getElementById('loginPassword').value;
  clearAuthError('login');
  if (!email || !pw) { showAuthError('login','Please enter your email and password.'); return; }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Signing in…';
  try {
    await signInWithEmailAndPassword(auth, email, pw);
    // onAuthStateChanged handles the rest
  } catch(e) {
    const msgs = {
      'auth/user-not-found':     'No account found with this email.',
      'auth/wrong-password':     'Incorrect password. Please try again.',
      'auth/invalid-credential': 'Incorrect email or password.',
      'auth/too-many-requests':  'Too many failed attempts. Please wait a few minutes.',
      'auth/invalid-email':      'Please enter a valid email address.',
      'auth/user-disabled':      'This account has been disabled. Contact your admin.',
    };
    showAuthError('login', msgs[e.code] || `Sign in failed (${e.code}).`);
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Sign In';
  }
}

async function handleSignup() {
  const name  = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const pw    = document.getElementById('signupPassword').value;
  let   role  = document.getElementById('signupRole').value;
  clearAuthError('signup');
  if (!name)        { showAuthError('signup','Full name is required.'); return; }
  if (!email)       { showAuthError('signup','Email address is required.'); return; }
  if (pw.length<8)  { showAuthError('signup','Password must be at least 8 characters.'); return; }
  const btn = document.getElementById('signupBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Creating account…';
  try {
    // ── First-run bootstrap: if no users exist yet, this account becomes admin ──
    // Uses a transaction on meta/bootstrap so two simultaneous signups can't both win.
    let becameFirstAdmin = false;
    try {
      const bootstrapRef = doc(db, 'meta', 'bootstrap');
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(bootstrapRef);
        if (!snap.exists() || !snap.data().adminCreated) {
          tx.set(bootstrapRef, { adminCreated: true, at: serverTimestamp() }, { merge: true });
          becameFirstAdmin = true;
        }
      });
    } catch (e) {
      console.warn('[Bootstrap] Could not check first-run state:', e);
    }
    if (becameFirstAdmin) role = 'admin';

    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await setDoc(doc(db, 'users', cred.user.uid), {
      name, email, role, uid: cred.user.uid,
      createdAt: serverTimestamp(),
    });
    if (becameFirstAdmin) {
      showToast('You are the first account — automatically made Admin!', 'success', 6000);
    }
    // onAuthStateChanged auto-logs them in
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/invalid-email':        'Please enter a valid email address.',
      'auth/weak-password':        'Password is too weak. Use at least 8 characters.',
    };
    showAuthError('signup', msgs[e.code] || `Signup failed (${e.code}).`);
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
  }
}

async function handleSignOut() {
  if (ticketListener) { ticketListener(); ticketListener = null; }
  localMessages = [];
  currentUser = null; currentProfile = null;
  await signOut(auth);
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('messages').innerHTML = '';
}

async function handleForgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) { showAuthError('login','Enter your email address above first.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email}`, 'success');
  } catch(e) {
    showAuthError('login','Could not send reset email. Check the address and try again.');
  }
}

/* ═══════════════════════════════════════════════
   👤  USER PROFILE & ROLE-BASED UI
═══════════════════════════════════════════════ */
async function loadUserProfile(authUid) {
  const snap = await getDoc(doc(db, 'users', authUid));
  if (snap.exists()) return snap.data();
  // First time — create a default user profile
  const profile = {
    name: currentUser.email.split('@')[0],
    email: currentUser.email,
    role: 'user',
    uid: authUid,
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'users', authUid), profile);
  return profile;
}

function applyRoleUI() {
  const role = currentProfile.role;

  // Show/hide nav tabs and elements based on role
  document.querySelectorAll('.staff-only').forEach(el => {
    el.style.display = isStaff() ? '' : 'none';
  });
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // User pill
  const nameEl   = document.getElementById('userDisplayName');
  const roleEl   = document.getElementById('userRoleBadge');
  const avatarEl = document.getElementById('userAvatar');
  if (nameEl)   nameEl.textContent   = currentProfile.name || currentProfile.email;
  if (roleEl)   { roleEl.textContent = role; roleEl.className = `user-role-badge ${role}`; }
  if (avatarEl) avatarEl.textContent = (currentProfile.name || 'U')[0].toUpperCase();

  // Tickets view title
  const titleEl = document.getElementById('ticketsViewTitle');
  if (titleEl) titleEl.textContent = isStaff() ? 'All Tickets' : 'My Tickets';

  // Assigned column header
  const assignedColHeader = document.getElementById('assignedColHeader');
  if (assignedColHeader) assignedColHeader.style.display = isStaff() ? '' : 'none';

  // Assigned row in ticket modal
  const assignedRow = document.getElementById('assignedRow');
  if (assignedRow) assignedRow.style.display = isStaff() ? '' : 'none';

  // Sidebar My Tickets label
  const sidebarTickets = document.getElementById('sidebarViewTickets');
  if (sidebarTickets) sidebarTickets.querySelector('span:last-child') && null;
}

/* ═══════════════════════════════════════════════
   🔥  FIRESTORE — SEQUENTIAL TICKET ID
   Uses a Firestore transaction on meta/ticketCounter
   to guarantee no duplicate IDs even under concurrency
═══════════════════════════════════════════════ */
async function nextTicketId() {
  const counterRef = doc(db, 'meta', 'ticketCounter');
  let newNum = 1;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    newNum = snap.exists() ? (snap.data().count || 0) + 1 : 1;
    tx.set(counterRef, { count: newNum }, { merge: true });
  });
  return 'T_KT' + String(newNum).padStart(3, '0');
}

/* ═══════════════════════════════════════════════
   🔥  FIRESTORE — SEED KB ON FIRST ADMIN/ENGINEER LOGIN
═══════════════════════════════════════════════ */
async function seedKBIfEmpty() {
  if (!isStaff()) return;
  const snap = await getDocs(query(collection(db,'kb'), limit(1)));
  if (!snap.empty) return;
  for (const article of SEED_KB) {
    await addDoc(collection(db, 'kb'), {
      ...article, ts: serverTimestamp(), views: 0, createdBy: currentUser.uid,
    });
  }
}

/* ═══════════════════════════════════════════════
   📅  PROACTIVE BANNER
═══════════════════════════════════════════════ */
function getProactiveMessage() {
  const now = new Date();
  const h = now.getHours(), day = now.getDay(), month = now.getMonth(), date = now.getDate();
  if (day===1 && h>=7 && h<=10) return "🗓️ Good Monday morning! Common issues include VPN and email sync. I'm here if you need help!";
  if (day===5 && h>=15)          return "🎉 Happy Friday! Remember to log out and lock your workstation before the weekend.";
  if (h>=5 && h<9)               return "☀️ Good morning! Need help with login, email setup, or any IT issue? Just ask.";
  if (h>=22 || h<5)              return "🌙 Working late? For urgent issues, use Critical priority when creating a ticket.";
  if ([2,5,8,11].includes(month) && date>=25) return "📊 End of quarter! Ensure all devices are updated and backups are current.";
  if (month===11)                return "🎄 Holiday season! IT support hours may vary. Create a ticket so our team can respond.";
  if (month===0 && date<=7)      return "🎆 Happy New Year! Don't forget to reset any passwords that expired over the holidays.";
  if (h>=12 && h<14)             return "💡 Pro tip: Regular restarts clear memory and improve system performance!";
  return null;
}

/* ═══════════════════════════════════════════════
   🤖  AI — CLAUDE API
═══════════════════════════════════════════════ */
const SYSTEM_PROMPT = `You are "Kelvinet IT Assistant", the AI-powered IT helpdesk bot for ${CONFIG.COMPANY_NAME}, based in Maua, Meru, Kenya.

Your role:
- Provide clear, accurate, friendly IT support answers.
- Only answer IT-related questions; politely redirect anything else.
- If the issue cannot be resolved remotely, suggest creating a support ticket.
- When recommending a ticket, end your message with: [SUGGEST_TICKET]
- When you can categorize the issue, append: [CATEGORY:hardware|software|network|account|email|security|other]
- When you can suggest a priority, append: [PRIORITY:low|normal|high|critical]

FORMATTING RULES — follow strictly every time:
1. NEVER write a large paragraph. Break all responses into short, scannable lines.
2. If the answer involves steps or actions: always use a numbered list (1. 2. 3.).
3. If the answer involves multiple tips, causes, or options: use bullet points starting with "- ".
4. For simple one-line answers (greetings, confirmations): a single sentence is fine.
5. Each list item = one action or fact. Never combine multiple ideas in one point.
6. Start with a one-line summary of what the issue likely is or what to do, then list steps below.

Example of correct format:
"Your printer is likely offline or has a stuck print job. Try these steps:
1. Turn the printer off and back on.
2. Go to Settings → Printers and check the status.
3. Right-click → See what's printing → Cancel all jobs.
4. Print a test page."

Always be professional, empathetic, and solution-focused.`;

async function getAIReply(userText, attachmentInfo = '') {
  const content = attachmentInfo ? `${userText}\n\n[User has attached: ${attachmentInfo}]` : userText;
  conversationHistory.push({ role: 'user', content });
  const recent = conversationHistory.slice(-10);
  try {
    const result = await askClaude({ system: SYSTEM_PROMPT, messages: recent, max_tokens: 512 });
    const text = result.data?.text || '';
    if (!text) throw new Error('Empty response from AI proxy');
    conversationHistory.push({ role: 'assistant', content: text });
    return parseAIResponse(text);
  } catch(e) {
    console.error('[AI]', e);
    showToast('AI unavailable — using offline mode.', 'warning', 3000);
    return getFallbackReply(userText);
  }
}

function parseAIResponse(raw) {
  const r = { text: raw, suggestTicket: false, category: null, priority: null };
  if (raw.includes('[SUGGEST_TICKET]')) { r.suggestTicket = true; r.text = raw.replace('[SUGGEST_TICKET]','').trim(); }
  const cm = raw.match(/\[CATEGORY:(hardware|software|network|account|email|security|other)\]/i);
  if (cm) { r.category = cm[1].toLowerCase(); r.text = r.text.replace(cm[0],'').trim(); }
  const pm = raw.match(/\[PRIORITY:(low|normal|high|critical)\]/i);
  if (pm) { r.priority = pm[1].toLowerCase(); r.text = r.text.replace(pm[0],'').trim(); }
  return r;
}

function getFallbackReply(userText) {
  const t = (userText || '').toLowerCase();
  if (!t.trim()) return { text: "Could you describe the issue in more detail?", suggestTicket: false };
  // Check KB first
  for (const a of SEED_KB) {
    if ((a.tags || []).some(tag => t.includes(tag))) {
      return { text: a.content, suggestTicket: false, category: a.category };
    }
  }
  if (/hello|hi|hey|morning|afternoon/.test(t)) return { text: `Hi! I'm the Kelvinet IT Assistant. How can I help you today?` };
  if (/thank|thanks/.test(t))                   return { text: "You're welcome! Happy to help. 😊" };
  if (/bye|goodbye/.test(t))                    return { text: "Goodbye! Have a productive day. 👋" };
  if (/who (made|built|created) you/.test(t))   return { text: `I was built by ${CONFIG.COMPANY_NAME}, developed by Kelvin Mwichwiri.` };
  return { text: "I couldn't find a specific solution for that. Would you like me to create a support ticket so our IT team can assist you directly?", suggestTicket: true, category: 'other' };
}

async function aiAutoFillTicket() {
  if (localMessages.length < 2) return null;
  const convoText = localMessages.slice(-20).map(m => `${m.from === 'user' ? 'User' : 'Bot'}: ${m.text}`).join('\n');
  try {
    const result = await askClaude({
      system: 'Extract IT ticket details from a chat conversation. Respond ONLY with valid JSON — no markdown, no backticks. Format: {"title":"Short title","desc":"Full description","category":"network","priority":"normal"}. Categories: hardware,software,network,account,email,security,other. Priorities: low,normal,high,critical.',
      messages: [{ role:'user', content: `Extract ticket details from:\n${convoText}` }],
      max_tokens: 300,
    });
    const raw = result.data?.text || '{}';
    return JSON.parse(raw.replace(/```json|```/g,'').trim());
  } catch(e) {
    console.error('[AI AutoFill]', e);
    // Fallback: use the last user message as a basic prefill
    const last = [...localMessages].reverse().find(m => m.from === 'user');
    return last ? { title: last.text.slice(0,80), desc: last.text, category: '', priority: 'normal' } : null;
  }
}

async function aiAutoTag(title, desc) {
  const t = `${title} ${desc}`.toLowerCase();
  const map = {
    network:  ['wifi','internet','network','vpn','router','connection','ip','dns','ethernet'],
    hardware: ['printer','monitor','screen','keyboard','mouse','disk','drive','ram','battery','laptop','desktop'],
    software: ['install','update','crash','error','software','app','driver','windows','office','excel'],
    account:  ['password','login','access','locked','account','permission','user','admin'],
    email:    ['email','outlook','gmail','smtp','imap','inbox','send','receive','mail'],
    security: ['virus','malware','hack','phishing','firewall','antivirus','threat','suspicious'],
  };
  for (const [cat, kws] of Object.entries(map)) {
    if (kws.some(k => t.includes(k))) return cat;
  }
  return 'other';
}

/* ═══════════════════════════════════════════════
   📧  EMAILJS
═══════════════════════════════════════════════ */
async function sendTicketEmail(ticket) {
  if (!CONFIG.EMAILJS_SERVICE_ID || CONFIG.EMAILJS_SERVICE_ID === 'YOUR_SERVICE_ID') return;
  try {
    await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_TEMPLATE_ID, {
      to_email:        ticket.email,
      to_name:         ticket.email.split('@')[0],
      ticket_id:       ticket.id,
      ticket_title:    ticket.title,
      ticket_desc:     ticket.desc,
      ticket_priority: ticket.priority,
      ticket_category: ticket.category,
      ticket_status:   'open',
      support_email:   CONFIG.SUPPORT_EMAIL,
      company_name:    CONFIG.COMPANY_NAME,
      created_at:      new Date().toLocaleString('en-KE'),
    }, CONFIG.EMAILJS_PUBLIC_KEY);
    showToast(`Confirmation sent to ${ticket.email}`, 'success');
  } catch(e) {
    showToast('Email notification failed. Check EmailJS config.', 'warning');
  }
}

/* ═══════════════════════════════════════════════
   💬  CHAT — MESSAGE RENDERING
═══════════════════════════════════════════════ */
function formatMessageText(raw) {
  if (!raw) return '';
  const lines = raw.split('\n');
  let html = '', inOL = false, inUL = false;
  const closeOL = () => { if (inOL) { html += '</ol>'; inOL = false; } };
  const closeUL = () => { if (inUL) { html += '</ul>'; inUL = false; } };
  lines.forEach(line => {
    const tr = line.trim();
    if (!tr) { closeOL(); closeUL(); return; }
    const nm = tr.match(/^(\d+)\.\s+(.+)/);
    if (nm) { closeUL(); if (!inOL) { html += '<ol>'; inOL = true; } html += `<li>${escapeHtml(nm[2])}</li>`; return; }
    const bm = tr.match(/^[-•*–]\s+(.+)/);
    if (bm) { closeOL(); if (!inUL) { html += '<ul>'; inUL = true; } html += `<li>${escapeHtml(bm[1])}</li>`; return; }
    closeOL(); closeUL(); html += `<p>${escapeHtml(tr)}</p>`;
  });
  closeOL(); closeUL();
  return html;
}

function appendMessage({ from = 'bot', text = '', save = true, imageDataUrl = null }) {
  const el  = document.createElement('div'); el.className = `msg-row ${from}`;
  const av  = document.createElement('div'); av.className = 'msg-avatar'; av.setAttribute('aria-hidden','true');
  av.innerHTML = from === 'bot' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
  const bub = document.createElement('div'); bub.className = 'msg-bubble';
  const tn  = document.createElement('div'); tn.className = 'msg-text'; tn.innerHTML = formatMessageText(text); bub.appendChild(tn);
  if (imageDataUrl) {
    const img = document.createElement('img'); img.src = imageDataUrl; img.className = 'msg-img'; img.alt = 'Attachment';
    img.onclick = () => window.open(imageDataUrl, '_blank'); bub.appendChild(img);
  }
  const meta = document.createElement('div'); meta.className = 'msg-meta';
  meta.textContent = new Date().toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' }); bub.appendChild(meta);
  el.appendChild(av); el.appendChild(bub);
  const msgs = document.getElementById('messages'); msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
  if (save) {
    localMessages.push({ id: uid('m'), ts: Date.now(), from, text });
    if (localMessages.length > CONFIG.MAX_MESSAGES) localMessages = localMessages.slice(-CONFIG.MAX_MESSAGES);
  }
}

let typingEl = null;
function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement('div'); typingEl.className = 'msg-row bot';
  typingEl.innerHTML = `<div class="msg-avatar"><i class="fas fa-robot"></i></div><div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div><div class="ai-loading">AI is thinking…</div></div>`;
  const msgs = document.getElementById('messages'); msgs.appendChild(typingEl); msgs.scrollTop = msgs.scrollHeight;
}
function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

const DEFAULT_SUGGESTIONS = ['Cannot login / forgot password','Printer not working','WiFi / Internet is down','Computer is running slow','Software installation help','Create a support ticket'];

function resetSuggestions() {
  const c = document.getElementById('suggestContainer'); if (!c) return; c.innerHTML = '';
  DEFAULT_SUGGESTIONS.forEach(text => {
    const btn = document.createElement('button'); btn.className = 'suggestion'; btn.textContent = text;
    btn.addEventListener('click', () => { document.getElementById('messageInput').value = text; handleSend(); });
    c.appendChild(btn);
  });
}

function addSuggestion(text, onClick) {
  const btn = document.createElement('button'); btn.className = 'suggestion'; btn.textContent = text;
  btn.addEventListener('click', onClick);
  document.getElementById('suggestContainer').appendChild(btn);
}

/* ═══════════════════════════════════════════════
   📎  FILE ATTACHMENTS
═══════════════════════════════════════════════ */
function handleChatFileSelect(files) {
  for (const f of files) {
    if (f.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { showToast(`"${f.name}" exceeds ${CONFIG.MAX_FILE_SIZE_MB}MB.`,'error'); continue; }
    const r = new FileReader(); r.onload = e => { chatAttachments.push({ name:f.name, type:f.type, dataUrl:e.target.result }); renderChatAttachPreview(); }; r.readAsDataURL(f);
  }
}
function renderChatAttachPreview() {
  const p = document.getElementById('attachPreview'); if (!p) return; p.innerHTML = '';
  if (!chatAttachments.length) { p.style.display = 'none'; return; } p.style.display = 'flex';
  chatAttachments.forEach((a, i) => {
    const th = document.createElement('div'); th.className = 'attach-thumb';
    if (a.type.startsWith('image/')) { const img = document.createElement('img'); img.src = a.dataUrl; img.alt = a.name; th.appendChild(img); }
    else th.innerHTML = `<i class="fas fa-file" style="color:var(--accent2);font-size:20px;"></i>`;
    const sp = document.createElement('span'); sp.textContent = a.name.length > 14 ? a.name.slice(0,11) + '…' : a.name; th.appendChild(sp);
    const rm = document.createElement('button'); rm.className = 'attach-remove'; rm.innerHTML = '×';
    rm.addEventListener('click', () => { chatAttachments.splice(i,1); renderChatAttachPreview(); }); th.appendChild(rm);
    p.appendChild(th);
  });
}
function handleModalFileSelect(files) {
  for (const f of files) {
    if (f.size > CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024) { showToast(`"${f.name}" exceeds ${CONFIG.MAX_FILE_SIZE_MB}MB.`,'error'); continue; }
    const r = new FileReader(); r.onload = e => { modalAttachments.push({ name:f.name, type:f.type, dataUrl:e.target.result }); renderModalAttachList(); }; r.readAsDataURL(f);
  }
}
function renderModalAttachList() {
  const list = document.getElementById('modalAttachList'); if (!list) return; list.innerHTML = '';
  modalAttachments.forEach((a, i) => {
    const item = document.createElement('div'); item.className = 'attach-item';
    item.innerHTML = `<i class="fas ${a.type.startsWith('image/') ? 'fa-image' : 'fa-file'}" style="color:var(--accent2)"></i><span>${escapeHtml(a.name)}</span><button class="attach-item-remove"><i class="fas fa-times"></i></button>`;
    item.querySelector('.attach-item-remove').addEventListener('click', () => { modalAttachments.splice(i,1); renderModalAttachList(); });
    list.appendChild(item);
  });
}

/* ═══════════════════════════════════════════════
   🎟️  TICKETS — FIRESTORE
═══════════════════════════════════════════════ */
function getStatusChipClass(s) { return { open:'chip-open','in-progress':'chip-inprog',waiting:'chip-waiting',resolved:'chip-resolved' }[s] || 'chip-open'; }
function getPriorityChipClass(p) { return { low:'chip-low',normal:'chip-normal',high:'chip-high',critical:'chip-critical' }[p] || 'chip-normal'; }

function setupTicketListener() {
  if (ticketListener) { ticketListener(); ticketListener = null; }
  const q = isStaff()
    ? query(collection(db,'tickets'), orderBy('ts','desc'))
    : query(collection(db,'tickets'), where('uid','==',currentUser.uid), orderBy('ts','desc'));

  ticketListener = onSnapshot(q, snap => {
    const tickets = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
    renderTicketRows(tickets);
    updateBadge(tickets);
    updateSidebarStats(tickets);
  }, err => {
    console.error('[Tickets]', err);
    const loading = document.getElementById('ticketLoading');
    if (loading) { loading.innerHTML = '<i class="fas fa-circle-exclamation" style="color:var(--danger)"></i><p>Could not load tickets. Check Firestore rules.</p>'; }
  });
}

function renderTicketRows(tickets) {
  const tbody   = document.getElementById('ticketTableBody');
  const empty   = document.getElementById('ticketEmpty');
  const loading = document.getElementById('ticketLoading');
  if (!tbody) return;
  if (loading) loading.style.display = 'none';

  // Apply client-side filters
  const search   = (document.getElementById('ticketSearch')?.value || '').toLowerCase();
  const fStatus  = document.getElementById('filterStatus')?.value  || '';
  const fCat     = document.getElementById('filterCategory')?.value || '';
  const filtered = tickets.filter(t => {
    const ms  = !search  || (t.id||'').toLowerCase().includes(search) || (t.title||'').toLowerCase().includes(search) || (t.email||'').toLowerCase().includes(search) || (t.category||'').toLowerCase().includes(search);
    const mst = !fStatus || t.status   === fStatus;
    const mc  = !fCat    || t.category === fCat;
    return ms && mst && mc;
  });

  tbody.innerHTML = '';
  if (!filtered.length) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';

  // Stats bar
  const statEl = document.getElementById('ticketStats');
  if (statEl) {
    const o = tickets.filter(t=>t.status==='open').length;
    const p = tickets.filter(t=>t.status==='in-progress').length;
    const r = tickets.filter(t=>t.status==='resolved').length;
    statEl.innerHTML = `Total: <strong>${tickets.length}</strong> &nbsp;•&nbsp; Open: <strong>${o}</strong> &nbsp;•&nbsp; In Progress: <strong>${p}</strong> &nbsp;•&nbsp; Resolved: <strong>${r}</strong>`;
  }

  filtered.forEach(t => {
    const tr = document.createElement('tr');
    const assignedCell = isStaff() ? `<td style="color:var(--text2);font-size:12px;">${escapeHtml(t.assigned||'Unassigned')}</td>` : '';
    tr.innerHTML = `
      <td><span class="tid">${escapeHtml(t.id||'—')}</span></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(t.title)}">${t.remoteId ? `<i class="fas fa-desktop" style="color:var(--accent2);margin-right:5px;" title="Remote support session available"></i>` : ''}${escapeHtml(t.title)}</td>
      <td><span class="cat-badge">${escapeHtml(t.category||'other')}</span></td>
      <td><span class="chip ${getPriorityChipClass(t.priority)}">${escapeHtml(PRIORITY_LABELS[t.priority]||t.priority)}</span></td>
      <td><span class="chip ${getStatusChipClass(t.status)}">${escapeHtml(STATUS_LABELS[t.status]||t.status)}</span></td>
      ${assignedCell}
      <td style="color:var(--text2);font-size:12px;white-space:nowrap;">${timeAgo(t.ts)}</td>
      <td><div class="table-actions">
        <button class="action-btn view-btn" data-fid="${t.firestoreId}" title="View"><i class="fas fa-eye"></i></button>
        ${isStaff() ? `<button class="action-btn next-btn" data-fid="${t.firestoreId}" title="Advance status"><i class="fas fa-arrow-right"></i></button>` : ''}
        ${isAdmin() ? `<button class="action-btn del-btn" data-fid="${t.firestoreId}" title="Delete" style="color:var(--danger)"><i class="fas fa-trash"></i></button>` : ''}
      </div></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.view-btn').forEach(b => b.addEventListener('click', () => openTicketDetail(b.dataset.fid)));
  tbody.querySelectorAll('.next-btn').forEach(b => b.addEventListener('click', () => advanceTicketStatus(b.dataset.fid)));
  tbody.querySelectorAll('.del-btn').forEach(b  => b.addEventListener('click', () => deleteTicket(b.dataset.fid)));
}

function updateBadge(tickets) {
  const open  = tickets.filter(t => t.status === 'open').length;
  const badge = document.getElementById('openBadge');
  if (badge) { badge.textContent = open || ''; badge.classList.toggle('visible', open > 0); }
}

function updateSidebarStats(tickets) {
  const mine = isStaff() ? tickets : tickets.filter(t => t.uid === currentUser?.uid);
  const o    = mine.filter(t => t.status === 'open').length;
  const r    = mine.filter(t => t.status === 'resolved').length;
  const ss1  = document.getElementById('sSOpen');
  const ss2  = document.getElementById('sSResolved');
  if (ss1) ss1.textContent = o;
  if (ss2) ss2.textContent = r;
}

/* ═══════════════════════════════════════════════
   📚  AUTO-CONVERT RESOLVED TICKET → KB ARTICLE
═══════════════════════════════════════════════ */

/**
 * Turns a resolved ticket into a polished KB article using Claude
 * (via the Firebase proxy). Falls back to a plain template if the
 * AI call fails, so the feature never silently does nothing.
 */
async function convertTicketToKB(ticket) {
  let title, content, tags;

  try {
    const result = await askClaude({
      system: 'You turn a resolved IT support ticket into a reusable knowledge base article. Respond ONLY with valid JSON, no markdown or backticks. Format: {"title":"Clear, searchable article title","content":"Step-by-step solution in the same numbered/bulleted format used for IT articles","tags":["tag1","tag2","tag3"]}. Write the content as general guidance other users with the same problem could follow — not tied to this specific person. Use numbered steps if the fix involves actions.',
      messages: [{
        role: 'user',
        content: `Ticket title: ${ticket.title}\nDescription: ${ticket.desc}\nCategory: ${ticket.category}\nResolution notes: ${ticket.notes || '(no notes recorded)'}`,
      }],
      max_tokens: 500,
    });
    const raw = result.data?.text || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    title   = parsed.title   || ticket.title;
    content = parsed.content || ticket.notes || ticket.desc;
    tags    = Array.isArray(parsed.tags) ? parsed.tags : [];
  } catch (e) {
    console.warn('[KB AutoConvert] AI generation failed, using plain fallback:', e);
    title   = ticket.title;
    content = ticket.notes
      ? `Issue: ${ticket.desc}\n\nResolution:\n${ticket.notes}`
      : `Issue: ${ticket.desc}\n\n(No resolution notes were recorded for this ticket.)`;
    tags = [];
  }

  await addDoc(collection(db, 'kb'), {
    title,
    category: ticket.category || 'other',
    tags,
    content,
    ts: serverTimestamp(),
    views: 0,
    createdBy: currentUser.uid,
    sourceTicketId: ticket.id || null,
    autoGenerated: true,
  });

  await logActivity(`KB article auto-created from resolved ticket ${ticket.id}: "${title}"`);
  showToast(`Resolved ticket added to Knowledge Base: "${title}"`, 'success', 6000);
}

async function advanceTicketStatus(firestoreId) {
  const ref  = doc(db,'tickets',firestoreId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const t    = snap.data();
  const idx  = STATUS_FLOW.indexOf(t.status);
  if (idx < STATUS_FLOW.length - 1) {
    const next = STATUS_FLOW[idx + 1];
    await updateDoc(ref, { status: next, updatedAt: serverTimestamp() });
    await logActivity(`Ticket ${t.id} moved to ${STATUS_LABELS[next]}`);
    showToast(`Ticket moved to "${STATUS_LABELS[next]}"`, 'success');
    if (next === 'resolved' && !t.kbConverted) {
      await updateDoc(ref, { kbConverted: true });
      convertTicketToKB({ ...t, firestoreId });
    }
  } else {
    showToast('Ticket is already resolved.', 'info');
  }
}

async function deleteTicket(firestoreId) {
  if (!confirm('Delete this ticket? This cannot be undone.')) return;
  await deleteDoc(doc(db,'tickets',firestoreId));
  await logActivity('A ticket was deleted by admin.');
  showToast('Ticket deleted.', 'info');
}

function validateTicket(title, desc, email) {
  if (!title.trim()) return 'Title is required.';
  if (!desc.trim())  return 'Description is required.';
  if (!email.trim()) return 'Email is required.';
  if (!/^[^\s@]+@([^\s@]+\.)+[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
  return null;
}

async function createTicketFromForm() {
  const title    = document.getElementById('ticketTitle').value.trim();
  const desc     = document.getElementById('ticketDesc').value.trim();
  const email    = document.getElementById('ticketEmail').value.trim();
  const priority = document.getElementById('ticketPriority').value;
  const assigned = document.getElementById('ticketAssigned')?.value || 'unassigned';
  let   category = document.getElementById('ticketCategory').value;
  const remoteClient = document.getElementById('ticketRemoteClient')?.value || '';
  const remoteId     = document.getElementById('ticketRemoteId')?.value.trim() || '';
  const err = validateTicket(title, desc, email); if (err) { showToast(err,'error'); return; }
  if (!category) category = await aiAutoTag(title, desc);
  const saveBtn = document.getElementById('saveTicketBtn');
  saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Creating…';
  try {
    const ticketId = await nextTicketId();
    const ticket   = {
      id: ticketId, title, desc, email, priority, category,
      uid:       currentUser.uid,
      createdBy: currentProfile.name || currentProfile.email,
      assigned:  assigned === 'unassigned' ? null : assigned,
      status:    'open',
      ts:        serverTimestamp(),
      notes:     '',
      attachments: modalAttachments.map(a => ({ name: a.name, type: a.type })),
      remoteClient: remoteClient || null,
      remoteId:     remoteId || null,
    };
    await addDoc(collection(db,'tickets'), ticket);
    await logActivity(`New ticket ${ticketId} created — "${title}"`);
    closeModal('ticketModalBackdrop');
    modalAttachments = []; renderModalAttachList();
    appendMessage({ from:'bot', text:`✅ Ticket ${ticketId} created! Category: ${category}. Our team will respond to ${email} shortly.` });
    showToast(`Ticket ${ticketId} created!`, 'success');
    await sendTicketEmail({ ...ticket, ts: Date.now() });
  } catch(e) {
    console.error('[Ticket]', e); showToast('Failed to create ticket. Please try again.','error');
  } finally {
    saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Create Ticket';
  }
}

async function openTicketDetail(firestoreId) {
  const snap = await getDoc(doc(db,'tickets',firestoreId));
  if (!snap.exists()) return;
  const t    = { firestoreId, ...snap.data() };
  const body = document.getElementById('ticketDetailBody');
  body.innerHTML = `
    <div class="detail-grid">
      <div class="detail-field"><label>Ticket ID</label><div class="val" style="font-family:monospace;color:var(--accent)">${escapeHtml(t.id||'—')}</div></div>
      <div class="detail-field"><label>Created</label><div class="val">${formatDate(t.ts)}</div></div>
      <div class="detail-field"><label>Category</label><div class="val"><span class="cat-badge">${escapeHtml(t.category||'other')}</span></div></div>
      <div class="detail-field"><label>Priority</label><div class="val"><span class="chip ${getPriorityChipClass(t.priority)}">${escapeHtml(PRIORITY_LABELS[t.priority]||t.priority)}</span></div></div>
      <div class="detail-field"><label>Status</label><div class="val"><span class="chip ${getStatusChipClass(t.status)}">${escapeHtml(STATUS_LABELS[t.status]||t.status)}</span></div></div>
      <div class="detail-field"><label>Email</label><div class="val">${escapeHtml(t.email)}</div></div>
      ${isStaff() ? `<div class="detail-field"><label>Assigned To</label><div class="val">${escapeHtml(t.assigned||'Unassigned')}</div></div>` : ''}
      ${isStaff() ? `<div class="detail-field"><label>Created By</label><div class="val">${escapeHtml(t.createdBy||'—')}</div></div>` : ''}
    </div>
    <div class="detail-desc"><label>Description</label><p>${escapeHtml(t.desc)}</p></div>
    ${t.remoteId ? `
    <div class="detail-desc">
      <label><i class="fas fa-desktop"></i> Remote Support Session</label>
      <div class="remote-session-display">
        <span class="rs-client">${escapeHtml(t.remoteClient || 'Remote client')}</span>
        <span class="rs-id" id="remoteIdText">${escapeHtml(t.remoteId)}</span>
        <button class="copy-id-btn" onclick="copyRemoteId('${escapeHtml(t.remoteId).replace(/'/g,"\\'")}')"><i class="fas fa-copy"></i> Copy ID</button>
        <span class="small muted">Open your own ${escapeHtml(t.remoteClient || 'remote')} client and connect to this ID.</span>
      </div>
    </div>` : ''}
    ${isStaff() ? `
    <div class="detail-status-row">
      ${STATUS_FLOW.map(s => `<button class="btn ${t.status===s?'':'btn-ghost'}" style="font-size:12px;" onclick="setTicketStatusDirect('${firestoreId}','${s}');closeModal('ticketDetailBackdrop');">${STATUS_LABELS[s]}</button>`).join('')}
    </div>
    <div class="detail-notes">
      <label>Notes / Updates</label>
      <textarea id="detailNotes" rows="3" placeholder="Add agent notes…">${escapeHtml(t.notes||'')}</textarea>
      <button class="btn" style="margin-top:8px;font-size:12px;" onclick="saveTicketNotes('${firestoreId}')">Save Notes</button>
      <p class="field-hint" style="margin-top:6px;"><i class="fas fa-circle-info"></i> Notes entered here are used to generate the Knowledge Base article automatically when this ticket is marked Resolved.</p>
    </div>` : ''}
  `;
  openModal('ticketDetailBackdrop');
}

function copyRemoteId(id) {
  navigator.clipboard.writeText(id)
    .then(() => showToast('Session ID copied to clipboard.', 'success', 2500))
    .catch(() => showToast('Could not copy automatically — please copy manually.', 'warning'));
}

async function setTicketStatusDirect(firestoreId, status) {
  const ref  = doc(db,'tickets',firestoreId);
  const snap = await getDoc(ref);
  const t    = snap.exists() ? snap.data() : null;
  await updateDoc(ref, { status, updatedAt: serverTimestamp() });
  await logActivity(`Ticket status manually set to ${STATUS_LABELS[status]}`);
  showToast(`Status updated to "${STATUS_LABELS[status]}"`, 'success');
  if (status === 'resolved' && t && !t.kbConverted) {
    await updateDoc(ref, { kbConverted: true });
    convertTicketToKB({ ...t, firestoreId });
  }
}

async function saveTicketNotes(firestoreId) {
  const notes = document.getElementById('detailNotes')?.value || '';
  await updateDoc(doc(db,'tickets',firestoreId), { notes, updatedAt: serverTimestamp() });
  showToast('Notes saved.', 'success');
}

async function openTicketModal(prefill = {}, fromAI = false) {
  document.getElementById('ticketTitle').value    = prefill.title    || '';
  document.getElementById('ticketDesc').value     = prefill.desc     || '';
  document.getElementById('ticketEmail').value    = prefill.email    || currentUser?.email || '';
  document.getElementById('ticketPriority').value = prefill.priority || 'normal';
  document.getElementById('ticketCategory').value = prefill.category || '';
  const ar = document.getElementById('ticketAssigned'); if (ar) ar.value = 'unassigned';
  const rc = document.getElementById('ticketRemoteClient'); if (rc) rc.value = '';
  const ri = document.getElementById('ticketRemoteId');     if (ri) ri.value = '';
  modalAttachments = []; renderModalAttachList();
  document.getElementById('aiFillRow').style.display = fromAI ? 'block' : 'none';
  openModal('ticketModalBackdrop');
  document.getElementById('ticketTitle').focus();
}

async function openAIFilledTicket() {
  const t = showToast('AI is analyzing your conversation…','info',0);
  const data = await aiAutoFillTicket(); t.remove();
  if (data) { showToast('AI auto-filled the ticket!','success'); openTicketModal(data, true); }
  else       { openTicketModal({}, false); showToast('Could not extract details. Fill manually.','warning'); }
}

async function exportTicketsCSV() {
  const q    = isStaff() ? query(collection(db,'tickets'),orderBy('ts','desc')) : query(collection(db,'tickets'),where('uid','==',currentUser.uid),orderBy('ts','desc'));
  const snap = await getDocs(q);
  const tickets = snap.docs.map(d => d.data());
  const headers = ['ID','Title','Category','Priority','Status','Email','Assigned','Created By','Created'];
  const rows    = tickets.map(t => [t.id,t.title,t.category,t.priority,t.status,t.email,t.assigned||'Unassigned',t.createdBy||'',formatDate(t.ts)].map(v => `"${String(v||'').replace(/"/g,'""')}"`));
  const csv     = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const blob    = new Blob([csv], { type:'text/csv' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a'); a.href = url; a.download = `kelvinet-tickets-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
  showToast('Tickets exported as CSV.','success');
}

async function clearResolved() {
  const snap = await getDocs(query(collection(db,'tickets'), where('status','==','resolved')));
  if (snap.empty) { showToast('No resolved tickets to clear.','info'); return; }
  if (!confirm(`Delete ${snap.size} resolved ticket(s)? This cannot be undone.`)) return;
  for (const d of snap.docs) await deleteDoc(d.ref);
  showToast(`${snap.size} resolved ticket(s) deleted.`,'success');
}

/* ═══════════════════════════════════════════════
   📊  DASHBOARD (staff only)
═══════════════════════════════════════════════ */
async function renderDashboard() {
  const [ticketSnap, kbSnap] = await Promise.all([
    getDocs(collection(db,'tickets')),
    getDocs(collection(db,'kb')),
  ]);
  const tickets = ticketSnap.docs.map(d => d.data());
  const total   = tickets.length;
  const open    = tickets.filter(t=>t.status==='open').length;
  const prog    = tickets.filter(t=>t.status==='in-progress').length;
  const res     = tickets.filter(t=>t.status==='resolved').length;
  const high    = tickets.filter(t=>['high','critical'].includes(t.priority)).length;

  document.getElementById('kpiTotal').textContent    = total;
  document.getElementById('kpiOpen').textContent     = open;
  document.getElementById('kpiProgress').textContent = prog;
  document.getElementById('kpiResolved').textContent = res;
  document.getElementById('kpiHigh').textContent     = high;
  document.getElementById('kpiKB').textContent       = kbSnap.size;

  const pct = total > 0 ? Math.round((res/total)*100) : 0;
  const arc  = document.getElementById('resolutionArc');
  if (arc) arc.style.strokeDashoffset = 314 - (314 * pct / 100);
  const pctEl = document.getElementById('resolutionPct');
  if (pctEl) pctEl.textContent = pct + '%';

  const cats = ['hardware','software','network','account','email','security','other'];
  const catC = {}; cats.forEach(c => { catC[c] = tickets.filter(t=>t.category===c).length; });
  renderBarChart('chartCategory', cats, catC, Math.max(...Object.values(catC),1), ['#00d9a6','#00a8ff','#7c6af7','#f0a500','#ff5c5c','#10b981','#8b949e']);

  const pris = ['critical','high','normal','low'];
  const priC = {}; pris.forEach(p => { priC[p] = tickets.filter(t=>t.priority===p).length; });
  renderBarChart('chartPriority', pris, priC, Math.max(...Object.values(priC),1), ['#ff5c5c','#f0a500','#00a8ff','#8b949e']);

  await renderActivityFeed();
  renderAgentQueue(tickets.map((t,i) => ({ firestoreId: ticketSnap.docs[i].id, ...t })));

  const el = document.getElementById('dashLastRefresh');
  if (el) el.textContent = 'Refreshed: ' + new Date().toLocaleTimeString('en-KE');
}

function renderBarChart(cid, keys, counts, max, colors) {
  const el = document.getElementById(cid); if (!el) return; el.innerHTML = '';
  keys.forEach((k,i) => {
    const v   = counts[k] || 0;
    const pct = max > 0 ? (v/max)*100 : 0;
    const row = document.createElement('div'); row.className = 'bar-row';
    row.innerHTML = `<span class="bar-label">${k}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i%colors.length]}"></div></div><span class="bar-value">${v}</span>`;
    el.appendChild(row);
  });
}

async function renderActivityFeed() {
  const feed = document.getElementById('activityFeed'); if (!feed) return; feed.innerHTML = '';
  try {
    const snap = await getDocs(query(collection(db,'activity'), orderBy('ts','desc'), limit(10)));
    if (snap.empty) { feed.innerHTML = '<li style="color:var(--text3);font-size:13px;padding:8px;">No activity yet.</li>'; return; }
    snap.docs.forEach(d => {
      const a  = d.data();
      const li = document.createElement('li'); li.className = 'activity-item';
      li.innerHTML = `<i class="fas fa-circle-dot act-icon"></i><span>${escapeHtml(a.text)}</span><span class="act-time">${timeAgo(a.ts)}</span>`;
      feed.appendChild(li);
    });
  } catch(e) { feed.innerHTML = '<li style="color:var(--text3);font-size:13px;padding:8px;">Could not load activity.</li>'; }
}

function renderAgentQueue(tickets) {
  const queue = document.getElementById('agentQueue'); if (!queue) return;
  const pri   = { critical:0, high:1, normal:2, low:3 };
  const actionable = tickets.filter(t=>t.status==='open'||t.status==='in-progress')
    .sort((a,b) => (pri[a.priority]??2) - (pri[b.priority]??2));
  if (!actionable.length) {
    queue.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-check-circle" style="font-size:32px;color:var(--accent)"></i><p>All caught up! No open tickets.</p></div>';
    return;
  }
  queue.innerHTML = '';
  actionable.forEach(t => {
    const item = document.createElement('div'); item.className = 'queue-item';
    item.innerHTML = `
      <div class="queue-meta">
        <div class="queue-title">${escapeHtml(t.title)}</div>
        <div class="queue-sub">${escapeHtml(t.id||'—')} • ${escapeHtml(t.email)} • ${timeAgo(t.ts)}</div>
      </div>
      <span class="chip ${getPriorityChipClass(t.priority)}">${PRIORITY_LABELS[t.priority]}</span>
      <span class="chip ${getStatusChipClass(t.status)}">${STATUS_LABELS[t.status]}</span>
      <div class="queue-actions">
        <button class="action-btn" onclick="openTicketDetail('${t.firestoreId}')"><i class="fas fa-eye"></i> View</button>
        <button class="action-btn" onclick="advanceTicketStatus('${t.firestoreId}');renderDashboard();"><i class="fas fa-arrow-right"></i> Advance</button>
      </div>`;
    queue.appendChild(item);
  });
}

async function logActivity(text) {
  try { await addDoc(collection(db,'activity'), { text, ts: serverTimestamp(), uid: currentUser?.uid }); } catch(e) {}
}

/* ═══════════════════════════════════════════════
   📚  KNOWLEDGE BASE — FIRESTORE
═══════════════════════════════════════════════ */
async function renderKB() {
  const filter = (document.getElementById('kbSearch')?.value || '').toLowerCase();
  const cat    = document.getElementById('kbFilter')?.value  || '';
  const grid   = document.getElementById('kbGrid');
  const empty  = document.getElementById('kbEmpty');
  if (!grid) return; grid.innerHTML = '';
  try {
    const snap     = await getDocs(collection(db,'kb'));
    const articles = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(a => {
      const ms = !filter || (a.title||'').toLowerCase().includes(filter) || (a.content||'').toLowerCase().includes(filter) || (a.tags||[]).some(t=>t.toLowerCase().includes(filter));
      return ms && (!cat || a.category===cat);
    });
    if (!articles.length) { if (empty) empty.style.display = 'flex'; return; }
    if (empty) empty.style.display = 'none';
    articles.forEach(a => {
      const card = document.createElement('div'); card.className = 'kb-card';
      const canEdit = isStaff();
      card.innerHTML = `
        <div class="kb-card-header"><div class="kb-card-title">${escapeHtml(a.title)}</div><div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">${a.autoGenerated ? `<span class="ai-badge" title="Auto-generated from ticket ${escapeHtml(a.sourceTicketId||'')}"><i class="fas fa-wand-magic-sparkles"></i> Auto</span>` : ''}<span class="cat-badge">${escapeHtml(a.category)}</span></div></div>
        <div class="kb-card-body">${escapeHtml(a.content)}</div>
        <div class="kb-card-footer">
          ${(a.tags||[]).map(t=>`<span class="kb-tag">${escapeHtml(t)}</span>`).join('')}
          ${canEdit ? `<div class="kb-card-actions"><button class="kb-edit-btn" data-id="${a.id}"><i class="fas fa-pen"></i></button><button class="kb-del-btn" data-id="${a.id}"><i class="fas fa-trash"></i></button></div>` : ''}
        </div>`;
      grid.appendChild(card);
    });
    grid.querySelectorAll('.kb-edit-btn').forEach(b => b.addEventListener('click', () => openKBModal(b.dataset.id)));
    grid.querySelectorAll('.kb-del-btn').forEach(b  => b.addEventListener('click', () => deleteKBArticle(b.dataset.id)));
    const ss3 = document.getElementById('sSKB'); if (ss3) ss3.textContent = snap.size;
    renderCategoryChips(articles);
  } catch(e) { console.error('[KB]', e); showToast('Could not load KB articles.','error'); }
}

function openKBModal(editId = null) {
  editingKBId = editId;
  document.getElementById('kbModalTitleText').textContent = editId ? 'Edit KB Article' : 'Add KB Article';
  const titleIn = document.getElementById('kbTitle'), catIn = document.getElementById('kbCategory');
  const tagsIn  = document.getElementById('kbTags'),  contIn = document.getElementById('kbContent');
  if (editId) {
    getDoc(doc(db,'kb',editId)).then(snap => {
      if (!snap.exists()) return;
      const a = snap.data();
      titleIn.value = a.title; catIn.value = a.category; tagsIn.value = (a.tags||[]).join(', '); contIn.value = a.content;
    });
  } else {
    titleIn.value = catIn.value = tagsIn.value = contIn.value = '';
  }
  openModal('kbModalBackdrop'); titleIn.focus();
}

async function saveKBArticle() {
  const title   = document.getElementById('kbTitle').value.trim();
  const cat     = document.getElementById('kbCategory').value;
  const tags    = document.getElementById('kbTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const content = document.getElementById('kbContent').value.trim();
  if (!title)   { showToast('Title is required.','error'); return; }
  if (!content) { showToast('Content is required.','error'); return; }
  try {
    if (editingKBId) {
      await updateDoc(doc(db,'kb',editingKBId), { title,category:cat,tags,content,updatedAt:serverTimestamp() });
      showToast('Article updated!','success');
      await logActivity(`KB article updated: "${title}"`);
    } else {
      await addDoc(collection(db,'kb'), { title,category:cat,tags,content,ts:serverTimestamp(),views:0,createdBy:currentUser.uid });
      showToast('Article added!','success');
      await logActivity(`KB article added: "${title}"`);
    }
    closeModal('kbModalBackdrop'); renderKB();
  } catch(e) { showToast('Failed to save article.','error'); }
}

async function deleteKBArticle(id) {
  if (!confirm('Delete this KB article?')) return;
  await deleteDoc(doc(db,'kb',id));
  showToast('Article deleted.','info'); renderKB();
}

function renderCategoryChips(articles = []) {
  const container = document.getElementById('sideCategoryChips'); if (!container) return; container.innerHTML = '';
  const cats = ['hardware','software','network','account','email','security','other'];
  cats.forEach(c => {
    const count = articles.filter(a => a.category === c).length; if (!count) return;
    const chip  = document.createElement('button'); chip.className = 'cat-chip'; chip.textContent = `${c} (${count})`;
    chip.addEventListener('click', () => { document.getElementById('messageInput').value = `How do I fix a ${c} issue?`; switchView('chat'); });
    container.appendChild(chip);
  });
}

/* ═══════════════════════════════════════════════
   👥  USER MANAGEMENT (admin only)
═══════════════════════════════════════════════ */
async function renderUsersTable() {
  const tbody   = document.getElementById('usersTableBody');
  const empty   = document.getElementById('usersEmpty');
  const loading = document.getElementById('usersLoading');
  if (!tbody) return;
  if (loading) loading.style.display = 'none';
  const search = (document.getElementById('userSearch')?.value || '').toLowerCase();
  try {
    const [userSnap, ticketSnap] = await Promise.all([
      getDocs(collection(db,'users')),
      getDocs(collection(db,'tickets')),
    ]);
    const ticketCounts = {};
    ticketSnap.docs.forEach(d => { const uid = d.data().uid; ticketCounts[uid] = (ticketCounts[uid]||0)+1; });
    const users = userSnap.docs.map(d => ({ firestoreId:d.id, ...d.data() })).filter(u =>
      !search || (u.name||'').toLowerCase().includes(search) || (u.email||'').toLowerCase().includes(search)
    );
    tbody.innerHTML = '';
    if (!users.length) { if (empty) empty.style.display = 'flex'; return; }
    if (empty) empty.style.display = 'none';
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${escapeHtml(u.name||'—')}</td>
        <td style="color:var(--text2);">${escapeHtml(u.email)}</td>
        <td><span class="role-badge ${u.role||'user'}">${escapeHtml(u.role||'user')}</span></td>
        <td style="color:var(--text2);font-size:12px;">${formatDate(u.createdAt)}</td>
        <td style="font-family:monospace;color:var(--accent);">${ticketCounts[u.uid]||0}</td>
        <td><div class="table-actions">
          <button class="action-btn change-role-btn" data-uid="${u.uid}" data-name="${escapeHtml(u.name||u.email)}" data-role="${u.role||'user'}" title="Change role"><i class="fas fa-user-gear"></i> Role</button>
          ${u.uid !== currentUser.uid ? `<button class="action-btn del-user-btn" data-uid="${u.uid}" data-fid="${u.firestoreId}" title="Delete" style="color:var(--danger)"><i class="fas fa-trash"></i></button>` : ''}
        </div></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.change-role-btn').forEach(b => b.addEventListener('click', () => openRoleModal(b.dataset.uid, b.dataset.name, b.dataset.role)));
    tbody.querySelectorAll('.del-user-btn').forEach(b  => b.addEventListener('click', () => deleteUser(b.dataset.uid, b.dataset.fid)));
  } catch(e) { console.error('[Users]',e); showToast('Could not load users.','error'); }
}

function openRoleModal(uid, name, currentRole) {
  roleTargetUid = uid;
  document.getElementById('roleTargetName').textContent = name;
  document.getElementById('newRoleSelect').value = currentRole;
  openModal('changeRoleBackdrop');
}

async function confirmRoleChange() {
  if (!roleTargetUid) return;
  const newRole = document.getElementById('newRoleSelect').value;
  const snap    = await getDocs(query(collection(db,'users'), where('uid','==',roleTargetUid)));
  if (snap.empty) { showToast('User not found.','error'); return; }
  await updateDoc(snap.docs[0].ref, { role: newRole });
  await logActivity(`Admin changed a user role to "${newRole}".`);
  showToast(`Role updated to "${newRole}".`, 'success');
  closeModal('changeRoleBackdrop');
  renderUsersTable();
}

async function deleteUser(authUid, firestoreId) {
  if (authUid === currentUser.uid) { showToast('You cannot delete your own account.','error'); return; }
  if (!confirm('Delete this user profile? This removes their Firestore data but not their Auth account.')) return;
  await deleteDoc(doc(db,'users',firestoreId));
  showToast('User profile deleted.','info');
  renderUsersTable();
}

/* ═══════════════════════════════════════════════
   ⌨️  CHAT SEND
═══════════════════════════════════════════════ */
async function handleSend() {
  if (isResponding) return;
  const input   = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const text    = input.value.trim();
  const hasAtt  = chatAttachments.length > 0;
  if (!text && !hasAtt) return;
  const firstImg = chatAttachments.find(a => a.type.startsWith('image/'));
  appendMessage({ from:'user', text: text || '(Attached file)', imageDataUrl: firstImg?.dataUrl });
  const attInfo = chatAttachments.map(a => a.name).join(', ');
  chatAttachments = []; renderChatAttachPreview();
  input.value = ''; input.style.height = 'auto'; document.getElementById('charCount').textContent = '0';
  isResponding = true; if (sendBtn) sendBtn.disabled = true;
  showTyping();
  const [aiResult] = await Promise.all([
    getAIReply(text, attInfo),
    new Promise(r => setTimeout(r, CONFIG.TYPING_DELAY_MS)),
  ]);
  hideTyping(); resetSuggestions();
  appendMessage({ from:'bot', text: aiResult.text });
  if (aiResult.suggestTicket) {
    addSuggestion('🎫 Create ticket now', () => openAIFilledTicket());
    addSuggestion('✍️ Fill manually',      () => openTicketModal({ title: text }));
  }
  isResponding = false; if (sendBtn) sendBtn.disabled = false; input.focus();
}

/* ═══════════════════════════════════════════════
   🪟  MODAL HELPERS
═══════════════════════════════════════════════ */
function openModal(id)  { const el = document.getElementById(id); if (el) { el.classList.add('open'); el.setAttribute('aria-hidden','false'); } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.classList.remove('open'); el.setAttribute('aria-hidden','true'); } }

/* ═══════════════════════════════════════════════
   🧭  VIEW NAVIGATION
═══════════════════════════════════════════════ */
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
  const view = document.getElementById(`view-${viewId}`);
  const tab  = document.querySelector(`.nav-tab[data-view="${viewId}"]`);
  if (view) view.classList.add('active');
  if (tab)  { tab.classList.add('active'); tab.setAttribute('aria-selected','true'); }
  if (viewId === 'tickets')   setupTicketListener();
  if (viewId === 'dashboard' && isStaff())  renderDashboard();
  if (viewId === 'kb')        renderKB();
  if (viewId === 'users' && isAdmin()) renderUsersTable();
}

/* ═══════════════════════════════════════════════
   🔗  EVENT BINDINGS
═══════════════════════════════════════════════ */
function bindAuthEvents() {
  // Tab switching
  document.getElementById('loginTabBtn')?.addEventListener('click', () => {
    document.getElementById('loginTabBtn').classList.add('active');
    document.getElementById('signupTabBtn').classList.remove('active');
    document.getElementById('loginForm').style.display  = 'flex';
    document.getElementById('signupForm').style.display = 'none';
  });
  document.getElementById('signupTabBtn')?.addEventListener('click', () => {
    document.getElementById('signupTabBtn').classList.add('active');
    document.getElementById('loginTabBtn').classList.remove('active');
    document.getElementById('signupForm').style.display = 'flex';
    document.getElementById('loginForm').style.display  = 'none';
  });
  document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('signupBtn')?.addEventListener('click', handleSignup);
  document.getElementById('forgotPwBtn')?.addEventListener('click', handleForgotPassword);
  // Enter key on login fields
  ['loginEmail','loginPassword'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') handleLogin(); });
  });
  ['signupName','signupEmail','signupPassword'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') handleSignup(); });
  });
  // Password visibility toggles
  const togglePw = (inputId, btnId) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      const inp = document.getElementById(inputId);
      const ico = document.querySelector(`#${btnId} i`);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      ico.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
    });
  };
  togglePw('loginPassword',  'loginPwToggle');
  togglePw('signupPassword', 'signupPwToggle');
}

function bindAppEvents() {
  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
  // Dark mode
  document.getElementById('darkToggle')?.addEventListener('click', () => { darkMode = !darkMode; applyTheme(); });
  // Sign out
  document.getElementById('signOutBtn')?.addEventListener('click', handleSignOut);
  // Proactive banner close
  document.getElementById('closeBanner')?.addEventListener('click', () => { document.getElementById('proactiveBanner').style.display = 'none'; });
  // Chat send
  const input   = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  sendBtn?.addEventListener('click', handleSend);
  input?.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
  input?.addEventListener('input', () => {
    const len = input.value.length;
    const cc  = document.getElementById('charCount'); if (cc) cc.textContent = len;
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight,120) + 'px';
  });
  // Clear chat
  document.getElementById('clearChatBtn')?.addEventListener('click', () => {
    if (!confirm('Clear chat messages?')) return;
    localMessages = []; document.getElementById('messages').innerHTML = '';
    appendMessage({ from:'bot', text:"Chat cleared. How can I help you today?", save:true });
    resetSuggestions();
  });
  // Chat file input
  const fi = document.getElementById('fileInput');
  fi?.addEventListener('change', () => handleChatFileSelect(fi.files));
  // Sidebar quick actions
  document.getElementById('sidebarNewTicket')?.addEventListener('click', () => openAIFilledTicket());
  document.getElementById('sidebarViewTickets')?.addEventListener('click', () => switchView('tickets'));
  document.getElementById('sidebarKB')?.addEventListener('click', () => switchView('kb'));
  // Ticket modal
  document.getElementById('newTicketBtn')?.addEventListener('click', () => openTicketModal());
  document.getElementById('cancelTicketBtn')?.addEventListener('click',  () => closeModal('ticketModalBackdrop'));
  document.getElementById('cancelTicketBtn2')?.addEventListener('click', () => closeModal('ticketModalBackdrop'));
  document.getElementById('saveTicketBtn')?.addEventListener('click', createTicketFromForm);
  document.getElementById('clearAiFill')?.addEventListener('click', () => {
    document.getElementById('aiFillRow').style.display = 'none';
    ['ticketTitle','ticketDesc','ticketCategory'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    document.getElementById('ticketPriority').value = 'normal';
  });
  // Modal file drop zone
  const dropZone     = document.getElementById('modalFileDropZone');
  const modalFileIn  = document.getElementById('modalFileInput');
  if (dropZone) {
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleModalFileSelect(e.dataTransfer.files); });
    dropZone.addEventListener('click', () => modalFileIn.click());
  }
  modalFileIn?.addEventListener('change', () => handleModalFileSelect(modalFileIn.files));
  // Ticket list filters
  document.getElementById('ticketSearch')?.addEventListener('input', () => { if (ticketListener) return; setupTicketListener(); });
  document.getElementById('filterStatus')?.addEventListener('change', () => setupTicketListener());
  document.getElementById('filterCategory')?.addEventListener('change', () => setupTicketListener());
  document.getElementById('clearResolvedBtn')?.addEventListener('click', clearResolved);
  document.getElementById('exportTicketsBtn')?.addEventListener('click', exportTicketsCSV);
  // Ticket detail modal
  document.getElementById('closeTicketDetail')?.addEventListener('click',  () => closeModal('ticketDetailBackdrop'));
  document.getElementById('closeTicketDetail2')?.addEventListener('click', () => closeModal('ticketDetailBackdrop'));
  // KB
  document.getElementById('addKbBtn')?.addEventListener('click', () => openKBModal());
  document.getElementById('saveKbBtn')?.addEventListener('click', saveKBArticle);
  document.getElementById('cancelKbBtn')?.addEventListener('click',  () => closeModal('kbModalBackdrop'));
  document.getElementById('cancelKbBtn2')?.addEventListener('click', () => closeModal('kbModalBackdrop'));
  document.getElementById('kbSearch')?.addEventListener('input',  () => renderKB());
  document.getElementById('kbFilter')?.addEventListener('change', () => renderKB());
  // Dashboard refresh
  document.getElementById('refreshDashBtn')?.addEventListener('click', renderDashboard);
  // User search
  document.getElementById('userSearch')?.addEventListener('input', () => renderUsersTable());
  // Role modal
  document.getElementById('closeRoleModal')?.addEventListener('click',   () => closeModal('changeRoleBackdrop'));
  document.getElementById('cancelRoleChange')?.addEventListener('click', () => closeModal('changeRoleBackdrop'));
  document.getElementById('confirmRoleChange')?.addEventListener('click', confirmRoleChange);
  // Close modals on backdrop click
  ['ticketModalBackdrop','kbModalBackdrop','ticketDetailBackdrop','changeRoleBackdrop'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => { if (e.target.id === id) closeModal(id); });
  });
  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['ticketModalBackdrop','kbModalBackdrop','ticketDetailBackdrop','changeRoleBackdrop'].forEach(id => closeModal(id));
  });
}

/* ═══════════════════════════════════════════════
   🚀  BOOTSTRAP
═══════════════════════════════════════════════ */
function bootstrap() {
  // Restore theme
  try { const saved = localStorage.getItem('kv_theme'); if (saved) darkMode = saved !== 'light'; } catch(e) {}
  applyTheme();

  // Init EmailJS
  if (CONFIG.EMAILJS_PUBLIC_KEY && CONFIG.EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
    if (typeof emailjs !== 'undefined') emailjs.init({ publicKey: CONFIG.EMAILJS_PUBLIC_KEY });
  }

  bindAuthEvents();

  // Firebase Auth state listener — the single source of truth
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      try {
        currentProfile = await loadUserProfile(user.uid);
      } catch(e) {
        showToast('Could not load profile. Check Firestore rules.', 'error');
        return;
      }

      // Switch from auth screen to app
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appShell').style.display   = 'block';

      applyRoleUI();
      bindAppEvents();

      // Welcome message
      if (!localMessages.length) {
        appendMessage({
          from: 'bot',
          text: `Hello ${currentProfile.name}! 👋 I'm the Kelvinet AI IT Assistant. How can I help you today?`,
          save: true,
        });
      }
      resetSuggestions();

      // Seed KB (staff only, idempotent)
      await seedKBIfEmpty();
      renderKB(); // warm up sidebar KB count

      // Show chat ticket listener
      setupTicketListener();

      // Proactive banner
      const proMsg = getProactiveMessage();
      if (proMsg) {
        const banner = document.getElementById('proactiveBanner');
        const textEl = document.getElementById('proactiveText');
        if (banner && textEl) {
          textEl.textContent = proMsg; banner.style.display = 'flex';
          setTimeout(() => { if (banner) banner.style.display = 'none'; }, 12000);
        }
      }

    } else {
      // Not logged in — show auth screen
      document.getElementById('appShell').style.display   = 'none';
      document.getElementById('authScreen').style.display = 'flex';
    }
  });
}

// Wait for DOM
document.addEventListener('DOMContentLoaded', bootstrap);

// Expose functions used via inline onclick in HTML
window.openTicketDetail      = openTicketDetail;
window.advanceTicketStatus   = advanceTicketStatus;
window.setTicketStatusDirect = setTicketStatusDirect;
window.saveTicketNotes       = saveTicketNotes;
window.copyRemoteId          = copyRemoteId;
window.closeModal            = closeModal;
window.renderDashboard       = renderDashboard;
