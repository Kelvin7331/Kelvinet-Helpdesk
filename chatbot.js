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
  EMAILJS_SERVICE_ID:  'service_5ajsa5e',
  EMAILJS_TEMPLATE_ID: 'template_83iqk19',
  EMAILJS_PUBLIC_KEY:  '6oZmlbZJrM4eKcjS6',
  MAX_MESSAGES:    150,
  MAX_FILE_SIZE_MB: 5,
  TYPING_DELAY_MS: 600,
  COMPANY_NAME: 'Kelvinet Technologies',
  SUPPORT_EMAIL: 'support@kelvinet.co.ke',
  // Your logo. Put the file next to index.html (names are case-sensitive on GitHub Pages).
  // If it loads, it replaces the robot icon and becomes the browser-tab icon.
  // Set to '' to always use the robot icon.
  LOGO_URL: 'logo.png',
  // Facts the assistant may share when users ask who built it or what the company does.
  DEVELOPER_NAME:  'Kelvin Mwichwiri Gitonga',
  DEVELOPER_ROLE:  'founder and lead developer of Kelvinet Technologies',
  COMPANY_SERVICES: 'web development, networking, cybersecurity, IT support, digital marketing and IT consultancy',
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
  onSnapshot, serverTimestamp, runTransaction, increment, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { STARTER_KB, STARTER_KB_VERSION, LEGACY_STARTER_TITLES } from './kb-seed.js';
import {
  tokenize, topRelevant, buildKBContext, isSmallTalk, redactSensitive,
  normalizeQuestion, groupGaps, articleHealth, effectiveStatus, articlePreview,
} from './kb-engine.js';

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
   🤖  AI PROXY — Cloudflare Worker
   The AI key lives in the Worker (server side), never in this file.
   See worker/cloudflare-worker.js and the README.
═══════════════════════════════════════════════ */

// Paste your Worker URL here (Cloudflare → Workers & Pages → your worker).
// Must be the bare URL, e.g. https://kelvinet-ai-proxy.yourname.workers.dev
const AI_PROXY_URL = 'https://kelvinet-ai-proxy.kelvinmwichwiri1.workers.dev';

/**
 * Calls the Worker with the signed-in user's Firebase ID token.
 * Returns { data: { text } }. Throws an Error whose message explains
 * exactly what went wrong (shown in the "AI unavailable" toast).
 */
async function askClaude(payload) {
  if (!AI_PROXY_URL || AI_PROXY_URL.includes('YOUR_')) {
    throw new Error('AI_PROXY_URL is not set in chatbot.js');
  }
  if (!auth.currentUser) {
    throw new Error('you are not signed in');
  }
  const idToken = await auth.currentUser.getIdToken();

  let res;
  try {
    res = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (netErr) {
    // fetch() only throws on network failure or a CORS block
    throw new Error('cannot reach the AI proxy (wrong Worker URL, or ALLOWED_ORIGINS does not include this site)');
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`${errBody.error || 'proxy error'} [HTTP ${res.status}]`);
  }

  const data = await res.json();
  return { data };
}

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

// ── Learning-loop state ──
let kbCache         = [];          // KB docs visible to this user (staff: all, user: approved only)
let kbListener      = null;        // Firestore unsubscribe for the KB listener
let appEventsBound  = false;       // bindAppEvents() must only run once per page load
let loggedGapKeys   = new Set();   // de-duplicates gap logging within a session
let pendingGapIds   = [];          // gaps to close when an engineer saves an article written from a gap
let resolvingTicket = null;        // { firestoreId, data } while the Resolve modal is open
let gapGroups       = [];          // last grouped gaps shown on the dashboard
let lastRetrieval   = [];          // articles that answered the last substantive question (reused for short follow-ups)

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
  const role  = 'user';   // roles are never self-assigned; an admin promotes accounts in the Users tab
  clearAuthError('signup');
  if (!name)        { showAuthError('signup','Full name is required.'); return; }
  if (!email)       { showAuthError('signup','Email address is required.'); return; }
  if (pw.length<8)  { showAuthError('signup','Password must be at least 8 characters.'); return; }
  const btn = document.getElementById('signupBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Creating account…';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await setDoc(doc(db, 'users', cred.user.uid), {
      name, email, role, uid: cred.user.uid,
      createdAt: serverTimestamp(),
    });
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
  if (kbListener) { kbListener(); kbListener = null; }
  localMessages = [];
  kbCache = []; pendingGapIds = []; gapGroups = []; resolvingTicket = null; lastRetrieval = [];
  conversationHistory.length = 0;   // never carry one person's chat into the next session
  loggedGapKeys.clear(); chatAttachments = [];
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
   📚  KNOWLEDGE BASE — LIVE CACHE + STARTER IMPORT
   Staff receive every article (incl. drafts); users only ever
   receive APPROVED ones, so unreviewed AI drafts never reach them.
═══════════════════════════════════════════════ */
const kbApproved = () => kbCache.filter(a => effectiveStatus(a) === 'approved');

function updateKBCounts() {
  const el = document.getElementById('sSKB'); if (el) el.textContent = kbApproved().length;
  renderCategoryChips(kbApproved());
}

function setupKBListener() {
  if (kbListener) { kbListener(); kbListener = null; }
  const src = isStaff()
    ? collection(db, 'kb')
    : query(collection(db, 'kb'), where('status', '==', 'approved'));
  kbListener = onSnapshot(src, snap => {
    kbCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateKBCounts();
    if (document.getElementById('view-kb')?.classList.contains('active')) renderKB();
    if (isStaff() && document.getElementById('view-dashboard')?.classList.contains('active')) renderLearningPanel();
  }, err => {
    console.error('[KB]', err);
    showToast('Could not load the Knowledge Base. Check Firestore rules.', 'error');
  });
}

async function seedKBIfEmpty() {
  if (!isStaff()) return;
  try {
    const snap = await getDocs(query(collection(db, 'kb'), limit(1)));
    if (snap.empty) await importStarterArticles({ silent: true });
  } catch (e) { console.warn('[KB seed]', e); }
}

/** Adds the professional starter articles (idempotent via seedKey) and tidies legacy docs. */
async function importStarterArticles({ silent = false } = {}) {
  if (!isStaff()) return;
  const snap     = await getDocs(collection(db, 'kb'));
  const existing = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const haveKeys = new Set(existing.map(a => a.seedKey).filter(Boolean));
  const toAdd    = STARTER_KB.filter(a => !haveKeys.has(a.seedKey));
  const legacy   = existing.filter(a => !a.seedKey && !a.autoGenerated &&
                     LEGACY_STARTER_TITLES.includes(String(a.title || '').trim().toLowerCase()));
  const needStatus = existing.filter(a => !a.status && !legacy.includes(a));

  if (!toAdd.length && !legacy.length && !needStatus.length) {
    if (!silent) showToast('Starter articles are already up to date.', 'info');
    return;
  }
  if (!silent) {
    const msg = `Add ${toAdd.length} professional article(s)` +
      (legacy.length ? ` and replace ${legacy.length} older starter article(s) with the same topics` : '') + '?';
    if (!confirm(msg)) return;
  }

  const batch = writeBatch(db);
  toAdd.forEach(a => batch.set(doc(collection(db, 'kb')), {
    ...a, status: 'approved', helpful: 0, unhelpful: 0, views: 0,
    seedVersion: STARTER_KB_VERSION, ts: serverTimestamp(), createdBy: currentUser.uid,
  }));
  legacy.forEach(a => batch.delete(doc(db, 'kb', a.id)));
  needStatus.forEach(a => batch.update(doc(db, 'kb', a.id), { status: a.autoGenerated ? 'draft' : 'approved' }));
  await batch.commit();
  await logActivity(`Starter Knowledge Base loaded (${toAdd.length} added, ${legacy.length} replaced)`);
  if (!silent) showToast(`Knowledge Base updated: ${toAdd.length} added, ${legacy.length} replaced.`, 'success', 6000);
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
- Only answer IT-related questions, plus questions about this assistant, the company and its developer (see ABOUT below). Politely redirect anything else.
- If the issue cannot be resolved remotely, suggest creating a support ticket.
- When recommending a ticket, end your message with: [SUGGEST_TICKET]
- When you can categorize the issue, append: [CATEGORY:hardware|software|network|account|email|security|other]
- When you can suggest a priority, append: [PRIORITY:low|normal|high|critical]

ABOUT THIS ASSISTANT (use this when asked who built you, who the developer is, or what the company does):
- You were designed and built by ${CONFIG.DEVELOPER_NAME}, ${CONFIG.DEVELOPER_ROLE}, based in Maua, Meru, Kenya.
- ${CONFIG.COMPANY_NAME} offers ${CONFIG.COMPANY_SERVICES}.
- To contact the company, users can email ${CONFIG.SUPPORT_EMAIL} or raise a ticket in this app.
- You are an AI assistant, never a human. If asked which AI model you run on, say it is a third-party language model; do not claim Kelvinet trained it.
- Share only this professional information. Never guess or invent personal details (phone numbers, addresses, family, finances), credentials, awards or links.

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

Never ask the user to share passwords, MFA codes or card numbers, and warn them not to if they offer.

Always be professional, empathetic, and solution-focused.`;

/**
 * Finds approved articles for a question. Short follow-ups such as
 * "it still doesn't work" reuse the articles from the previous answer.
 */
function retrieveFor(userText) {
  const own = topRelevant(userText, kbApproved(), 3);
  if (own.length) { lastRetrieval = own; return own; }
  if (tokenize(userText).length >= 3) { lastRetrieval = []; return []; }   // a real new question we cannot answer
  // A short follow-up ("it still fails") that matches nothing by itself keeps working
  // with the articles that answered the previous question.
  return lastRetrieval;
}

/** Attaches the feedback context + sources, and logs a knowledge gap when nothing matched. */
function finalizeReply(userText, reply, results) {
  const smallTalk = isSmallTalk(userText);
  const matched   = results.length > 0;
  reply.sources     = results.map(r => r.article.title);
  reply.feedbackCtx = smallTalk ? null : {
    question: userText, answer: reply.text,
    articleIds: results.map(r => r.article.id).filter(Boolean), matched,
  };
  if (!matched && !smallTalk && tokenize(userText).length >= 2) logGap(userText, 'no_match');
  return reply;
}

async function getAIReply(userText, attachmentInfo = '') {
  const results = retrieveFor(userText);                    // must run BEFORE the new turn is pushed
  const system  = SYSTEM_PROMPT + '\n\n' + buildKBContext(results);
  const content = attachmentInfo ? `${userText}\n\n[User has attached: ${attachmentInfo}]` : userText;
  conversationHistory.push({ role: 'user', content });
  let recent = conversationHistory.slice(-10);
  while (recent.length && recent[0].role !== 'user') recent.shift();   // window must start with a user turn
  try {
    const result = await askClaude({ system, messages: recent, max_tokens: 700 });
    const text = result.data?.text || '';
    if (!text) throw new Error('Empty response from AI proxy');
    conversationHistory.push({ role: 'assistant', content: text });
    return finalizeReply(userText, parseAIResponse(text), results);
  } catch(e) {
    console.error('[AI]', e);
    conversationHistory.pop();   // drop the failed turn so history stays valid
    showToast(`AI unavailable: ${e.message} — using offline mode.`, 'warning', 9000);
    return finalizeReply(userText, getFallbackReply(userText, results), results);
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

function getFallbackReply(userText, results = []) {
  const t = (userText || '').toLowerCase().trim();
  if (!t) return { text: 'Could you describe the issue in more detail?', suggestTicket: false };
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(t)) return { text: `Hi! I'm the Kelvinet IT Assistant. How can I help you today?` };
  if (/^(thanks?|thank you)\b/.test(t))  return { text: "You're welcome! Happy to help. 😊" };
  if (/^(bye|goodbye)\b/.test(t))        return { text: 'Goodbye! Have a productive day. 👋' };
  if (/\b(who|which company)\b.*\b(made|built|created|developed|designed|programmed|owns)\b.*\byou\b|\b(your|the)\s+(developer|creator|maker)\b|\bwho is kelvin\b/.test(t))
    return { text: `I was designed and built by ${CONFIG.DEVELOPER_NAME}, ${CONFIG.DEVELOPER_ROLE}, in Maua, Meru, Kenya. You can reach the team at ${CONFIG.SUPPORT_EMAIL}.` };
  if (/\b(about|what does|who is)\b.*\bkelvinet\b/.test(t))
    return { text: `${CONFIG.COMPANY_NAME} offers ${CONFIG.COMPANY_SERVICES}. You can reach the team at ${CONFIG.SUPPORT_EMAIL}.` };
  if (results.length) {
    const a = results[0].article;
    return { text: `I'm in offline mode, but our guide on **${a.title}** should help:\n\n${a.content}`, suggestTicket: false, category: a.category };
  }
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
/** Escapes first, then applies a safe subset of inline markdown. */
function inlineFmt(str) {
  return escapeHtml(str)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function formatMessageText(raw) {
  if (!raw) return '';
  const lines = String(raw).split('\n');
  let html = '', inOL = false, inUL = false;
  const closeOL = () => { if (inOL) { html += '</ol>'; inOL = false; } };
  const closeUL = () => { if (inUL) { html += '</ul>'; inUL = false; } };
  lines.forEach(line => {
    const tr = line.trim();
    if (!tr) { closeOL(); closeUL(); return; }
    const hm = tr.match(/^#{1,4}\s+(.+)/);
    if (hm) { closeOL(); closeUL(); html += `<h5 class="msg-h">${inlineFmt(hm[1])}</h5>`; return; }
    const nm = tr.match(/^(\d+)\.\s+(.+)/);
    if (nm) { closeUL(); if (!inOL) { html += '<ol>'; inOL = true; } html += `<li>${inlineFmt(nm[2])}</li>`; return; }
    const bm = tr.match(/^[-•*–]\s+(.+)/);
    if (bm) { closeOL(); if (!inUL) { html += '<ul>'; inUL = true; } html += `<li>${inlineFmt(bm[1])}</li>`; return; }
    closeOL(); closeUL(); html += `<p>${inlineFmt(tr)}</p>`;
  });
  closeOL(); closeUL();
  return html;
}

function appendMessage({ from = 'bot', text = '', save = true, imageDataUrl = null, feedback = null, sources = null }) {
  const el  = document.createElement('div'); el.className = `msg-row ${from}`;
  const av  = document.createElement('div'); av.className = 'msg-avatar'; av.setAttribute('aria-hidden','true');
  av.innerHTML = from === 'bot' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
  const bub = document.createElement('div'); bub.className = 'msg-bubble';
  const tn  = document.createElement('div'); tn.className = 'msg-text'; tn.innerHTML = formatMessageText(text); bub.appendChild(tn);
  if (imageDataUrl) {
    const img = document.createElement('img'); img.src = imageDataUrl; img.className = 'msg-img'; img.alt = 'Attachment';
    img.onclick = () => window.open(imageDataUrl, '_blank'); bub.appendChild(img);
  }
  if (sources && sources.length) {
    const src = document.createElement('div'); src.className = 'msg-sources';
    src.innerHTML = '<i class="fas fa-book-open"></i> Based on: ' + sources.map(escapeHtml).join(' · ');
    bub.appendChild(src);
  }
  const meta = document.createElement('div'); meta.className = 'msg-meta';
  meta.textContent = new Date().toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' }); bub.appendChild(meta);
  if (feedback) bub.appendChild(buildFeedbackRow(feedback));
  el.appendChild(av); el.appendChild(bub);
  const msgs = document.getElementById('messages'); msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
  if (save) {
    localMessages.push({ id: uid('m'), ts: Date.now(), from, text });
    if (localMessages.length > CONFIG.MAX_MESSAGES) localMessages = localMessages.slice(-CONFIG.MAX_MESSAGES);
  }
}

/* ═══════════════════════════════════════════════
   👍👎  FEEDBACK  →  ARTICLE SCORES + KNOWLEDGE GAPS
═══════════════════════════════════════════════ */
function buildFeedbackRow(ctx) {
  const row = document.createElement('div'); row.className = 'msg-feedback';
  row.innerHTML =
    '<span class="fb-label">Was this helpful?</span>' +
    '<button type="button" class="fb-btn" data-v="up" title="Helpful" aria-label="Helpful"><i class="fas fa-thumbs-up"></i></button>' +
    '<button type="button" class="fb-btn" data-v="down" title="Not helpful" aria-label="Not helpful"><i class="fas fa-thumbs-down"></i></button>';
  row.querySelectorAll('.fb-btn').forEach(b => b.addEventListener('click', () => submitFeedback(ctx, b.dataset.v, row)));
  return row;
}

async function submitFeedback(ctx, value, row) {
  if (row.dataset.done) return;
  row.dataset.done = '1';
  row.querySelectorAll('.fb-btn').forEach(b => { b.disabled = true; b.classList.toggle('chosen', b.dataset.v === value); });
  row.querySelector('.fb-label').textContent = value === 'up' ? 'Thanks for the feedback!' : "Thanks, I've noted this so the team can improve it.";
  try {
    await addDoc(collection(db, 'feedback'), {
      uid: currentUser.uid, value,
      question: redactSensitive(ctx.question).slice(0, 400),
      answer:   redactSensitive(ctx.answer).slice(0, 1500),
      articleIds: ctx.articleIds || [], matched: !!ctx.matched,
      ts: serverTimestamp(),
    });
    // Score the articles that grounded this answer (rules only allow +1 on these two counters)
    await Promise.all((ctx.articleIds || []).map(id =>
      updateDoc(doc(db, 'kb', id), value === 'up' ? { helpful: increment(1) } : { unhelpful: increment(1) }).catch(() => {})));
    if (value === 'down') {
      logGap(ctx.question, 'downvoted');
      appendMessage({ from: 'bot', text: "Sorry that didn't solve it. Would you like me to open a support ticket so an engineer can help?", save: false });
      addSuggestion('🎫 Create ticket now', () => openAIFilledTicket());
    }
  } catch (e) { console.warn('[Feedback]', e); }
}

/** Records something the knowledge base could not answer (staff review these on the dashboard). */
async function logGap(question, reason, extra = {}) {
  try {
    const clean = redactSensitive(question).trim().slice(0, 300);
    if (!clean || !currentUser) return;
    const key = normalizeQuestion(clean);
    const sig = `${key}|${reason}|${extra.ticketId || ''}`;
    if (loggedGapKeys.has(sig)) return;
    loggedGapKeys.add(sig);
    await addDoc(collection(db, 'gaps'), {
      question: clean, key, reason, ticketId: extra.ticketId || null,
      uid: currentUser.uid, status: 'open', ts: serverTimestamp(),
    });
  } catch (e) { console.warn('[Gap]', e); }
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
        <button class="action-btn view-btn" data-fid="${t.firestoreId}" title="View ticket ${escapeHtml(t.id||'')}" aria-label="View ticket ${escapeHtml(t.id||'')}"><i class="fas fa-eye"></i> View Ticket</button>
        ${isStaff() && t.status !== 'resolved' ? `<button class="action-btn resolve-btn" data-fid="${t.firestoreId}" title="Resolve ticket ${escapeHtml(t.id||'')}" aria-label="Resolve ticket ${escapeHtml(t.id||'')}"><i class="fas fa-circle-check"></i> Resolve Ticket</button>` : ''}
        ${isStaff() && t.status === 'resolved' ? `<span class="resolved-mark"><i class="fas fa-check"></i> Resolved</span>` : ''}
        ${isAdmin() ? `<button class="action-btn del-btn" data-fid="${t.firestoreId}" title="Delete" style="color:var(--danger)"><i class="fas fa-trash"></i></button>` : ''}
      </div></td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.view-btn').forEach(b => b.addEventListener('click', () => openTicketDetail(b.dataset.fid)));
  tbody.querySelectorAll('.resolve-btn').forEach(b => b.addEventListener('click', () => openResolveModal(b.dataset.fid)));
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
   ✅  RESOLVE A TICKET  →  DRAFT KNOWLEDGE ARTICLE
   The engineer clicks "Resolve Ticket", records what fixed it, and
   (optionally) a DRAFT article is written for review. Nothing the
   AI writes reaches users until a human approves it.
═══════════════════════════════════════════════ */
const KB_WRITER_PROMPT = [
  'You write knowledge base articles for an IT helpdesk. Turn ONE resolved ticket into a reusable article for ANY user who has the same problem.',
  'Rules:',
  '- Use ONLY facts given in the ticket and the resolution. Never invent steps, menus, commands, file paths or version numbers.',
  '- Remove all personal data: names, email addresses, phone numbers, passwords, IP addresses, device names, asset tags.',
  '- Write for a non-technical office worker. Short sentences. Put button and menu names in **bold**.',
  'Respond with ONLY a JSON object, no markdown fences, in exactly this shape:',
  '{"title":"...","tags":["..."],"lines":["## Summary","...","## Steps","1. ...","2. ...","## Escalate to IT if","- ..."]}',
  '"lines" is the article, one line per array item. Use these headings in this order: "## Summary" (1-2 sentences), "## Quick checks" (bullets starting "- ", only if the ticket supports them, otherwise omit the section), "## Steps" (numbered "1. "), "## Escalate to IT if" (bullets, only if supported, otherwise omit).',
  'The title should read like the problem a user would describe. Give 4-8 lowercase tags that include words a user would type.',
].join('\n');

function extractJson(raw) {
  const t = String(raw || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('No JSON in AI reply');
  return JSON.parse(t.slice(a, b + 1));
}

/** Writes a DRAFT article from a resolved ticket (AI when available, plain template otherwise). */
async function convertTicketToKB(ticket) {
  const resolution = (ticket.resolution || ticket.notes || '').trim();
  let title, content, tags;
  try {
    const result = await askClaude({
      system: KB_WRITER_PROMPT,
      messages: [{ role: 'user', content: [
        `Ticket title: ${ticket.title}`,
        `Category: ${ticket.category || 'other'}`,
        `Problem description: ${ticket.desc}`,
        ticket.rootCause ? `Root cause: ${ticket.rootCause}` : '',
        `How it was fixed: ${resolution || '(not recorded)'}`,
      ].filter(Boolean).join('\n') }],
      max_tokens: 800,
    });
    const p = extractJson(result.data?.text);
    title   = String(p.title || '').trim() || ticket.title;
    content = Array.isArray(p.lines) ? p.lines.join('\n') : String(p.content || '');
    if (content.trim().length < 40) throw new Error('AI article too short');
    tags    = Array.isArray(p.tags) ? p.tags.map(x => String(x).toLowerCase().trim()).filter(Boolean).slice(0, 8) : [];
  } catch (e) {
    console.warn('[KB draft] AI generation failed, using plain template:', e);
    title = ticket.title;
    const steps = resolution.split(/\n+/).map(x => x.trim()).filter(Boolean);
    content = ['## Summary', `How this was resolved: ${ticket.title}.`, '## Problem', ticket.desc, '## Resolution',
      ...steps.map((x, i) => `${i + 1}. ${x.replace(/^\d+[.)]\s*/, '')}`)].join('\n');
    tags = [];
  }
  title   = redactSensitive(title);
  content = redactSensitive(content);
  if (!tags.length) tags = [...new Set(tokenize(title))].slice(0, 6);

  await addDoc(collection(db, 'kb'), {
    title, category: ticket.category || 'other', tags, content,
    status: 'draft', autoGenerated: true, sourceTicketId: ticket.id || null,
    helpful: 0, unhelpful: 0, views: 0,
    ts: serverTimestamp(), createdBy: currentUser.uid,
  });
  await logActivity(`Draft KB article created from resolved ticket ${ticket.id}: "${title}"`);
  showToast('Draft article created. Review and approve it in the Knowledge Base tab.', 'success', 8000);
}

async function openResolveModal(firestoreId) {
  if (!isStaff()) return;
  const snap = await getDoc(doc(db, 'tickets', firestoreId));
  if (!snap.exists()) return;
  const t = snap.data();
  if (t.status === 'resolved') { showToast('This ticket is already resolved.', 'info'); return; }
  resolvingTicket = { firestoreId, data: t };
  document.getElementById('resolveTicketId').textContent = t.id || '';
  document.getElementById('resolveSummary').innerHTML = `
    <div class="rs-title">${escapeHtml(t.title)}</div>
    <div class="rs-desc">${escapeHtml(t.desc)}</div>
    <div class="rs-meta">
      <span class="chip ${getPriorityChipClass(t.priority)}">${escapeHtml(PRIORITY_LABELS[t.priority] || t.priority)}</span>
      <span class="cat-badge">${escapeHtml(t.category || 'other')}</span>
      <span class="muted small">${escapeHtml(t.email || '')}</span>
    </div>`;
  document.getElementById('resolveText').value  = t.resolution || t.notes || '';
  document.getElementById('resolveCause').value = t.rootCause || '';
  const mk = document.getElementById('resolveMakeKB');
  mk.checked  = !t.kbConverted;
  mk.disabled = !!t.kbConverted;
  closeModal('ticketDetailBackdrop');
  openModal('resolveBackdrop');
  document.getElementById('resolveText').focus();
}

async function confirmResolve() {
  if (!resolvingTicket) return;
  const { firestoreId, data: t } = resolvingTicket;
  const resolution = document.getElementById('resolveText').value.trim();
  const rootCause  = document.getElementById('resolveCause').value.trim();
  if (resolution.length < 15) { showToast('Please describe what fixed the problem (at least 15 characters).', 'error'); return; }
  const makeKB = document.getElementById('resolveMakeKB').checked && !t.kbConverted;
  const me  = currentProfile.name || currentProfile.email;
  const btn = document.getElementById('confirmResolve');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Resolving…';
  try {
    await updateDoc(doc(db, 'tickets', firestoreId), {
      status: 'resolved', resolution, rootCause: rootCause || null,
      resolvedBy: me, resolvedByUid: currentUser.uid,
      resolvedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      assigned: t.assigned || me,
      kbConverted: makeKB ? true : !!t.kbConverted,
    });
    await logActivity(`Ticket ${t.id} resolved by ${me}`);
    closeModal('resolveBackdrop');
    resolvingTicket = null;
    showToast(`Ticket ${t.id} resolved.`, 'success');
    if (document.getElementById('view-dashboard')?.classList.contains('active')) renderDashboard();
    if (makeKB) await convertTicketToKB({ ...t, firestoreId, resolution, rootCause });
  } catch (e) {
    console.error('[Resolve]', e);
    showToast('Could not resolve the ticket. Please try again.', 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-circle-check"></i> Resolve Ticket';
  }
}

async function startWork(firestoreId) {
  if (!isStaff()) return;
  const me = currentProfile.name || currentProfile.email;
  try {
    await updateDoc(doc(db, 'tickets', firestoreId), {
      assigned: me, status: 'in-progress', startedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await logActivity(`${me} started work on a ticket`);
    showToast('Ticket assigned to you and marked In Progress.', 'success');
    closeModal('ticketDetailBackdrop');
  } catch (e) { showToast('Could not update the ticket.', 'error'); }
}

/** Kept for compatibility: moves a ticket one step forward; the last step opens the Resolve dialog. */
async function advanceTicketStatus(firestoreId) {
  const snap = await getDoc(doc(db, 'tickets', firestoreId));
  if (!snap.exists()) return;
  const idx = STATUS_FLOW.indexOf(snap.data().status);
  if (idx >= STATUS_FLOW.length - 1) { showToast('Ticket is already resolved.', 'info'); return; }
  await setTicketStatusDirect(firestoreId, STATUS_FLOW[idx + 1]);
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
    logGap(title, 'ticket', { ticketId });   // the KB could not solve this: flag it for a new article
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
  const t        = { firestoreId, ...snap.data() };
  const staff    = isStaff();
  const me       = currentProfile?.name || currentProfile?.email;
  const resolved = t.status === 'resolved';
  const body = document.getElementById('ticketDetailBody');
  body.innerHTML = `
    <div class="detail-grid">
      <div class="detail-field"><label>Ticket ID</label><div class="val" style="font-family:monospace;color:var(--accent)">${escapeHtml(t.id||'—')}</div></div>
      <div class="detail-field"><label>Created</label><div class="val">${formatDate(t.ts)}</div></div>
      <div class="detail-field"><label>Category</label><div class="val"><span class="cat-badge">${escapeHtml(t.category||'other')}</span></div></div>
      <div class="detail-field"><label>Priority</label><div class="val"><span class="chip ${getPriorityChipClass(t.priority)}">${escapeHtml(PRIORITY_LABELS[t.priority]||t.priority)}</span></div></div>
      <div class="detail-field"><label>Status</label><div class="val"><span class="chip ${getStatusChipClass(t.status)}">${escapeHtml(STATUS_LABELS[t.status]||t.status)}</span></div></div>
      <div class="detail-field"><label>Email</label><div class="val">${escapeHtml(t.email)}</div></div>
      ${staff ? `<div class="detail-field"><label>Assigned To</label><div class="val">${escapeHtml(t.assigned||'Unassigned')}</div></div>` : ''}
      ${staff ? `<div class="detail-field"><label>Created By</label><div class="val">${escapeHtml(t.createdBy||'—')}</div></div>` : ''}
    </div>
    <div class="detail-desc"><label>Description</label><p>${escapeHtml(t.desc)}</p></div>
    ${t.remoteId ? `
    <div class="detail-desc">
      <label><i class="fas fa-desktop"></i> Remote Support Session</label>
      <div class="remote-session-display">
        <span class="rs-client">${escapeHtml(t.remoteClient || 'Remote client')}</span>
        <span class="rs-id" id="remoteIdText">${escapeHtml(t.remoteId)}</span>
        ${staff ? `<button class="copy-id-btn" onclick="copyRemoteId('${escapeHtml(t.remoteId).replace(/'/g,"\\'")}')"><i class="fas fa-copy"></i> Copy ID</button>
        <span class="small muted">Open your own ${escapeHtml(t.remoteClient || 'remote')} client and connect to this ID.</span>` : ''}
      </div>
    </div>` : ''}
    ${resolved && t.resolution ? `
    <div class="detail-desc resolution-block">
      <label><i class="fas fa-circle-check"></i> Resolution</label>
      <p>${escapeHtml(t.resolution)}</p>
      <div class="small muted">Resolved by ${escapeHtml(t.resolvedBy||'IT')}${t.resolvedAt ? ' · ' + formatDate(t.resolvedAt) : ''}${staff && t.rootCause ? ' · Root cause: ' + escapeHtml(t.rootCause) : ''}</div>
    </div>` : ''}
    ${staff ? `
    <div class="detail-actions">
      ${!resolved && t.assigned !== me ? `<button class="btn btn-ghost" onclick="startWork('${firestoreId}')"><i class="fas fa-hand"></i> Assign to me &amp; start</button>` : ''}
      ${!resolved
        ? `<button class="btn" onclick="openResolveModal('${firestoreId}')"><i class="fas fa-circle-check"></i> Resolve Ticket</button>`
        : `<button class="btn btn-ghost" onclick="setTicketStatusDirect('${firestoreId}','open');closeModal('ticketDetailBackdrop');"><i class="fas fa-rotate-left"></i> Reopen ticket</button>`}
    </div>
    <label class="detail-label">Change status</label>
    <div class="detail-status-row">
      ${STATUS_FLOW.filter(x => x !== 'resolved').map(x => `<button class="btn ${t.status===x?'':'btn-ghost'}" style="font-size:12px;" onclick="setTicketStatusDirect('${firestoreId}','${x}');closeModal('ticketDetailBackdrop');">${STATUS_LABELS[x]}</button>`).join('')}
    </div>
    <div class="detail-notes">
      <label>Internal notes</label>
      <textarea id="detailNotes" rows="3" placeholder="Working notes (only staff can see these)…">${escapeHtml(t.notes||'')}</textarea>
      <button class="btn" style="margin-top:8px;font-size:12px;" onclick="saveTicketNotes('${firestoreId}')">Save Notes</button>
      <p class="field-hint" style="margin-top:6px;"><i class="fas fa-circle-info"></i> When you click <strong>Resolve Ticket</strong> you'll record the final fix. That is what the user sees and what a draft Knowledge Base article is written from.</p>
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
  if (status === 'resolved') { openResolveModal(firestoreId); return; }   // resolving always records the fix
  const ref  = doc(db,'tickets',firestoreId);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? snap.data().status : null;
  const patch = { status, updatedAt: serverTimestamp() };
  if (prev === 'resolved') patch.reopenedAt = serverTimestamp();
  await updateDoc(ref, patch);
  await logActivity(`Ticket status set to ${STATUS_LABELS[status]}`);
  showToast(`Status updated to "${STATUS_LABELS[status]}"`, 'success');
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
  const ticketSnap = await getDocs(collection(db,'tickets'));
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
  document.getElementById('kpiKB').textContent       = kbApproved().length;

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
  await renderLearningPanel();

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
        <button class="action-btn" onclick="openTicketDetail('${t.firestoreId}')"><i class="fas fa-eye"></i> View Ticket</button>
        <button class="action-btn resolve-btn" onclick="openResolveModal('${t.firestoreId}')"><i class="fas fa-circle-check"></i> Resolve Ticket</button>
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
const ARTICLE_TEMPLATE = [
  '## Summary', 'One or two sentences: what problem this solves.',
  '## Quick checks', '- First thing to check',
  '## Steps', '1. First step', '2. Second step',
  '## Escalate to IT if', '- When the user should raise a ticket',
].join('\n');

async function renderKB() {
  const filter = (document.getElementById('kbSearch')?.value || '').toLowerCase();
  const cat    = document.getElementById('kbFilter')?.value  || '';
  const st     = document.getElementById('kbStatusFilter')?.value || '';
  const grid   = document.getElementById('kbGrid');
  const empty  = document.getElementById('kbEmpty');
  const banner = document.getElementById('kbReviewBanner');
  if (!grid) return;

  const all    = kbCache.map(a => ({ ...a, _st: effectiveStatus(a) }));
  const drafts = all.filter(a => a._st === 'draft');
  if (banner) {
    if (isStaff() && drafts.length) {
      banner.style.display = 'flex';
      banner.innerHTML = `<i class="fas fa-clipboard-check"></i><span><strong>${drafts.length}</strong> AI-drafted article${drafts.length > 1 ? 's' : ''} waiting for review. The chatbot does not use drafts until you approve them.</span><button class="btn btn-ghost" id="showDraftsBtn">Review now</button>`;
      banner.querySelector('#showDraftsBtn').addEventListener('click', () => { document.getElementById('kbStatusFilter').value = 'draft'; renderKB(); });
    } else banner.style.display = 'none';
  }

  const list = all.filter(a => {
    const ms = !filter || (a.title||'').toLowerCase().includes(filter) || (a.content||'').toLowerCase().includes(filter) || (a.tags||[]).some(t => t.toLowerCase().includes(filter));
    return ms && (!cat || a.category === cat) && (!st || a._st === st);
  }).sort((x, y) => (x._st === 'draft' ? 0 : 1) - (y._st === 'draft' ? 0 : 1) || String(x.title).localeCompare(String(y.title)));

  grid.innerHTML = '';
  if (!list.length) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';

  list.forEach(a => {
    const h = articleHealth(a);
    const card = document.createElement('div');
    card.className = 'kb-card' + (a._st === 'draft' ? ' kb-draft' : '');
    card.dataset.id = a.id;
    card.innerHTML = `
      <div class="kb-card-header">
        <div class="kb-card-title">${escapeHtml(a.title)}</div>
        <div class="kb-badges">
          <span class="kb-status ${a._st}">${a._st === 'draft' ? 'Draft' : 'Approved'}</span>
          ${a.autoGenerated ? `<span class="ai-badge" title="Auto-generated from ticket ${escapeHtml(a.sourceTicketId||'')}"><i class="fas fa-wand-magic-sparkles"></i> Auto</span>` : ''}
          <span class="cat-badge">${escapeHtml(a.category||'other')}</span>
        </div>
      </div>
      <div class="kb-card-body">${escapeHtml(articlePreview(a.content))}</div>
      <div class="kb-card-footer">
        ${(a.tags||[]).slice(0,4).map(t => `<span class="kb-tag">${escapeHtml(t)}</span>`).join('')}
        ${h.votes ? `<span class="kb-votes ${h.flagged ? 'flagged' : ''}" title="Helpful / not helpful votes"><i class="fas fa-thumbs-up"></i> ${h.helpful} <i class="fas fa-thumbs-down"></i> ${h.unhelpful}</span>` : ''}
        <div class="kb-card-actions">
          ${a._st === 'draft' ? `<button class="kb-approve-btn" data-id="${a.id}" title="Approve so the chatbot can use it"><i class="fas fa-check"></i> Approve</button>` : ''}
          <button class="kb-edit-btn" data-id="${a.id}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="kb-del-btn" data-id="${a.id}" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.kb-card').forEach(c => c.addEventListener('click', () => openKBView(c.dataset.id)));
  grid.querySelectorAll('.kb-edit-btn').forEach(b    => b.addEventListener('click', e => { e.stopPropagation(); openKBModal(b.dataset.id); }));
  grid.querySelectorAll('.kb-del-btn').forEach(b     => b.addEventListener('click', e => { e.stopPropagation(); deleteKBArticle(b.dataset.id); }));
  grid.querySelectorAll('.kb-approve-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); setKBStatus(b.dataset.id, 'approved'); }));
}

function openKBView(id) {
  const a = kbCache.find(x => x.id === id); if (!a) return;
  const st = effectiveStatus(a), h = articleHealth(a);
  document.getElementById('kbViewTitle').textContent = a.title;
  document.getElementById('kbViewBody').innerHTML = `
    <div class="kb-view-meta">
      <span class="kb-status ${st}">${st === 'draft' ? 'Draft: not used by the chatbot' : 'Approved'}</span>
      <span class="cat-badge">${escapeHtml(a.category||'other')}</span>
      ${a.autoGenerated ? `<span class="ai-badge"><i class="fas fa-wand-magic-sparkles"></i> Auto-generated${a.sourceTicketId ? ' from ' + escapeHtml(a.sourceTicketId) : ''}</span>` : ''}
      <span class="kb-votes ${h.flagged ? 'flagged' : ''}"><i class="fas fa-thumbs-up"></i> ${h.helpful} <i class="fas fa-thumbs-down"></i> ${h.unhelpful}${h.flagged ? ' · needs review' : ''}</span>
    </div>
    ${(a.tags||[]).length ? `<div class="kb-view-tags">${a.tags.map(t => `<span class="kb-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    <div class="kb-article msg-text">${formatMessageText(a.content)}</div>
    ${a.autoGenerated && st === 'draft' ? '<p class="field-hint"><i class="fas fa-circle-info"></i> Written by AI from the resolved ticket. Check every step is correct, edit if needed, then approve.</p>' : ''}`;
  const act = document.getElementById('kbViewActions'); act.innerHTML = '';
  const mk = (cls, html, fn) => { const b = document.createElement('button'); b.className = cls; b.innerHTML = html; b.addEventListener('click', fn); act.appendChild(b); };
  if (st === 'draft') mk('btn', '<i class="fas fa-check"></i> Approve', () => setKBStatus(id, 'approved'));
  else                mk('btn btn-ghost', '<i class="fas fa-eye-slash"></i> Unpublish', () => setKBStatus(id, 'draft'));
  mk('btn btn-ghost', '<i class="fas fa-pen"></i> Edit', () => openKBModal(id));
  if (h.votes) mk('btn btn-ghost', '<i class="fas fa-rotate-left"></i> Reset votes', () => resetKBVotes(id));
  openModal('kbViewBackdrop');
}

async function setKBStatus(id, status) {
  const a = kbCache.find(x => x.id === id); if (!a) return;
  const me = currentProfile.name || currentProfile.email;
  const patch = { status, updatedAt: serverTimestamp() };
  if (status === 'approved') { patch.approvedBy = me; patch.approvedAt = serverTimestamp(); }
  try {
    await updateDoc(doc(db, 'kb', id), patch);
    await logActivity(`KB article ${status === 'approved' ? 'approved' : 'unpublished'}: "${a.title}"`);
    showToast(status === 'approved' ? 'Article approved. The chatbot can now use it.' : 'Article unpublished.', 'success');
    if (status === 'approved' && a.sourceTicketId) await resolveGapsForTicket(a.sourceTicketId);
    closeModal('kbViewBackdrop');
  } catch (e) { console.error('[KB]', e); showToast('Could not update the article.', 'error'); }
}

async function resetKBVotes(id) {
  if (!confirm('Reset the helpful / not helpful votes for this article?')) return;
  try {
    await updateDoc(doc(db, 'kb', id), { helpful: 0, unhelpful: 0 });
    showToast('Votes reset.', 'success');
    closeModal('kbViewBackdrop');
  } catch (e) { showToast('Could not reset votes.', 'error'); }
}

function openKBModal(editId = null, prefill = null) {
  editingKBId   = editId;
  pendingGapIds = prefill?.gapIds || [];
  closeModal('kbViewBackdrop');
  document.getElementById('kbModalTitleText').textContent = editId ? 'Edit KB Article' : 'Add KB Article';
  const titleIn = document.getElementById('kbTitle'), catIn = document.getElementById('kbCategory');
  const tagsIn  = document.getElementById('kbTags'),  contIn = document.getElementById('kbContent');
  const statIn  = document.getElementById('kbStatus');
  if (editId) {
    const a = kbCache.find(x => x.id === editId); if (!a) return;
    titleIn.value = a.title; catIn.value = a.category || 'other'; tagsIn.value = (a.tags||[]).join(', ');
    contIn.value = a.content; statIn.value = effectiveStatus(a);
  } else {
    titleIn.value = prefill?.title || ''; catIn.value = prefill?.category || 'other';
    tagsIn.value  = prefill?.tags  || ''; contIn.value = prefill?.content || ''; statIn.value = 'approved';
  }
  openModal('kbModalBackdrop'); titleIn.focus();
}

async function saveKBArticle() {
  const title   = document.getElementById('kbTitle').value.trim();
  const cat     = document.getElementById('kbCategory').value;
  const tags    = document.getElementById('kbTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const content = document.getElementById('kbContent').value.trim();
  const status  = document.getElementById('kbStatus').value || 'approved';
  if (!title)   { showToast('Title is required.','error'); return; }
  if (!content) { showToast('Content is required.','error'); return; }
  const me = currentProfile.name || currentProfile.email;
  try {
    let sourceTicketId = null;
    if (editingKBId) {
      const prev  = kbCache.find(x => x.id === editingKBId);
      const patch = { title, category: cat, tags, content, status, updatedAt: serverTimestamp(), updatedBy: me };
      if (status === 'approved' && effectiveStatus(prev || {}) !== 'approved') { patch.approvedBy = me; patch.approvedAt = serverTimestamp(); }
      await updateDoc(doc(db,'kb',editingKBId), patch);
      sourceTicketId = prev?.sourceTicketId || null;
      showToast('Article updated!','success');
      await logActivity(`KB article updated: "${title}"`);
    } else {
      await addDoc(collection(db,'kb'), {
        title, category: cat, tags, content, status, helpful: 0, unhelpful: 0, views: 0,
        ts: serverTimestamp(), createdBy: currentUser.uid, approvedBy: status === 'approved' ? me : null,
      });
      showToast('Article added!','success');
      await logActivity(`KB article added: "${title}"`);
    }
    if (status === 'approved') {
      if (pendingGapIds.length) await closeGaps(pendingGapIds, 'resolved');
      if (sourceTicketId)       await resolveGapsForTicket(sourceTicketId);
    }
    pendingGapIds = [];
    closeModal('kbModalBackdrop');
  } catch(e) { console.error('[KB]', e); showToast('Failed to save article.','error'); }
}

async function deleteKBArticle(id) {
  if (!confirm('Delete this KB article?')) return;
  try { await deleteDoc(doc(db,'kb',id)); showToast('Article deleted.','info'); }
  catch (e) { showToast('Could not delete the article.','error'); }
}

/* ═══════════════════════════════════════════════
   🧠  KNOWLEDGE GAPS + LEARNING PANEL (dashboard)
═══════════════════════════════════════════════ */
async function closeGaps(ids, status) {
  if (!ids?.length) return;
  const batch = writeBatch(db);
  ids.forEach(id => batch.update(doc(db, 'gaps', id), { status, closedBy: currentUser.uid, closedAt: serverTimestamp() }));
  await batch.commit();
}

async function resolveGapsForTicket(ticketId) {
  try {
    const snap = await getDocs(query(collection(db, 'gaps'), where('ticketId', '==', ticketId)));
    await closeGaps(snap.docs.filter(d => d.data().status === 'open').map(d => d.id), 'resolved');
  } catch (e) { console.warn('[Gaps]', e); }
}

const GAP_LABELS = { no_match: 'No article', downvoted: 'Not helpful', ticket: 'Led to ticket' };

async function renderLearningPanel() {
  if (!isStaff() || !document.getElementById('learningPanel')) return;
  const approved = kbApproved();
  const drafts   = kbCache.filter(a => effectiveStatus(a) === 'draft');
  document.getElementById('lsApproved').textContent = approved.length;
  document.getElementById('lsDrafts').textContent   = drafts.length;

  let up = 0, down = 0;
  try {
    const fs = await getDocs(query(collection(db, 'feedback'), orderBy('ts', 'desc'), limit(200)));
    fs.docs.forEach(d => (d.data().value === 'up' ? up++ : down++));
  } catch (e) { console.warn('[Feedback read]', e); }
  const hr = document.getElementById('lsHelpful');
  hr.textContent = (up + down) ? Math.round(up / (up + down) * 100) + '%' : '–';
  hr.title = `${up} helpful, ${down} not helpful (latest ${up + down} ratings)`;

  let gaps = [];
  try {
    const gs = await getDocs(query(collection(db, 'gaps'), where('status', '==', 'open')));
    gaps = gs.docs.map(d => { const g = d.data(); return { id: d.id, question: g.question, key: g.key, reason: g.reason, ticketId: g.ticketId, tsMs: g.ts?.toMillis ? g.ts.toMillis() : 0 }; });
  } catch (e) { console.warn('[Gaps read]', e); }
  gapGroups = groupGaps(gaps);
  document.getElementById('lsGaps').textContent = gapGroups.length;

  const list = document.getElementById('gapList');
  list.innerHTML = gapGroups.length ? '' : '<div class="gap-empty"><i class="fas fa-circle-check"></i> No open gaps. The knowledge base is keeping up.</div>';
  gapGroups.slice(0, 8).forEach((g, i) => {
    const item = document.createElement('div'); item.className = 'gap-item';
    item.innerHTML = `
      <div class="gap-main">
        <div class="gap-q">${escapeHtml(g.question)}</div>
        <div class="gap-meta">${g.count > 1 ? `<span class="gap-count">×${g.count}</span>` : ''}${g.reasons.map(r => `<span class="gap-reason ${r}">${GAP_LABELS[r] || r}</span>`).join('')}${g.lastTs ? `<span class="muted small">${timeAgo(g.lastTs)}</span>` : ''}</div>
      </div>
      <div class="gap-actions">
        <button class="action-btn" data-act="write" data-i="${i}"><i class="fas fa-pen"></i> Write article</button>
        <button class="action-btn" data-act="dismiss" data-i="${i}" title="Dismiss (not a real gap)"><i class="fas fa-xmark"></i></button>
      </div>`;
    list.appendChild(item);
  });
  list.querySelectorAll('[data-act="write"]').forEach(b   => b.addEventListener('click', () => startArticleFromGap(+b.dataset.i)));
  list.querySelectorAll('[data-act="dismiss"]').forEach(b => b.addEventListener('click', () => dismissGap(+b.dataset.i)));

  const flagged = approved.filter(a => articleHealth(a).flagged);
  const fl = document.getElementById('flaggedList');
  fl.innerHTML = flagged.length ? '' : '<div class="gap-empty"><i class="fas fa-circle-check"></i> No articles are underperforming.</div>';
  flagged.forEach(a => {
    const h = articleHealth(a);
    const item = document.createElement('div'); item.className = 'gap-item flagged';
    item.innerHTML = `<div class="gap-main"><div class="gap-q">${escapeHtml(a.title)}</div><div class="gap-meta"><span class="kb-votes flagged"><i class="fas fa-thumbs-up"></i> ${h.helpful} <i class="fas fa-thumbs-down"></i> ${h.unhelpful}</span></div></div><div class="gap-actions"><button class="action-btn" data-id="${a.id}"><i class="fas fa-eye"></i> Review</button></div>`;
    item.querySelector('button').addEventListener('click', () => { switchView('kb'); openKBView(a.id); });
    fl.appendChild(item);
  });
}

function startArticleFromGap(i) {
  const g = gapGroups[i]; if (!g) return;
  const q = g.question.replace(/[?.!\s]+$/, '');
  switchView('kb');
  openKBModal(null, { title: q.charAt(0).toUpperCase() + q.slice(1), category: 'other', content: ARTICLE_TEMPLATE, gapIds: g.ids });
}

async function dismissGap(i) {
  const g = gapGroups[i]; if (!g) return;
  try { await closeGaps(g.ids, 'dismissed'); showToast('Gap dismissed.', 'info'); renderLearningPanel(); }
  catch (e) { showToast('Could not dismiss the gap.', 'error'); }
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
  appendMessage({ from:'bot', text: aiResult.text, feedback: aiResult.feedbackCtx, sources: aiResult.sources });
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
  if (appEventsBound) return;   // otherwise every re-login would stack duplicate handlers
  appEventsBound = true;
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
  // Knowledge base: review, import, viewer
  document.getElementById('importStarterBtn')?.addEventListener('click', () => importStarterArticles());
  document.getElementById('kbStatusFilter')?.addEventListener('change', () => renderKB());
  document.getElementById('closeKbView')?.addEventListener('click',  () => closeModal('kbViewBackdrop'));
  document.getElementById('closeKbView2')?.addEventListener('click', () => closeModal('kbViewBackdrop'));
  // Resolve ticket
  document.getElementById('closeResolve')?.addEventListener('click',   () => closeModal('resolveBackdrop'));
  document.getElementById('cancelResolve')?.addEventListener('click',  () => closeModal('resolveBackdrop'));
  document.getElementById('confirmResolve')?.addEventListener('click', confirmResolve);
  // Close modals on backdrop click
  ['ticketModalBackdrop','kbModalBackdrop','ticketDetailBackdrop','changeRoleBackdrop','kbViewBackdrop','resolveBackdrop'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => { if (e.target.id === id) closeModal(id); });
  });
  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['ticketModalBackdrop','kbModalBackdrop','ticketDetailBackdrop','changeRoleBackdrop','kbViewBackdrop','resolveBackdrop'].forEach(id => closeModal(id));
  });
}

/* ═══════════════════════════════════════════════
   🚀  BOOTSTRAP
═══════════════════════════════════════════════ */
/** Swaps the robot icon for the logo if the file exists; otherwise the robot icon is kept. */
function applyLogo() {
  if (!CONFIG.LOGO_URL) return;
  const img = new Image();
  img.onload = () => {
    const root = document.documentElement;
    root.style.setProperty('--logo-url', `url("${CONFIG.LOGO_URL}")`);
    root.classList.add('has-logo');
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = CONFIG.LOGO_URL;
  };
  img.onerror = () => console.info('[Logo] not found, keeping the robot icon:', CONFIG.LOGO_URL);
  img.src = CONFIG.LOGO_URL;
}

function bootstrap() {
  applyLogo();
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
      setupKBListener();   // live KB cache: powers retrieval, the KB tab and the dashboard

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
window.openResolveModal      = openResolveModal;
window.startWork             = startWork;
window.closeModal            = closeModal;
window.renderDashboard       = renderDashboard;
