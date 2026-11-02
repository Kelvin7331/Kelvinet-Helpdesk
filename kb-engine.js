/**
 * KELVINET HELPDESK — kb-engine.js
 * ═══════════════════════════════════════════════════════════
 * Pure logic for the "learning loop". No DOM, no Firebase, so it can be
 * unit-tested in Node and imported by chatbot.js as an ES module.
 *
 *  - tokenize()          lightweight stemming + synonym folding
 *  - scoreArticles()     BM25-style retrieval, boosted/penalised by feedback
 *  - buildKBContext()    formats the best articles for the AI prompt
 *  - articleHealth()     helpful / unhelpful statistics and flagging
 *  - redactSensitive()   strips emails, numbers, passwords before logging
 *  - normalizeQuestion() / groupGaps()   knowledge-gap grouping
 */

/* ── words that carry no meaning for matching ─────────────── */
const STOP = new Set((
  'a an the and or but if then so to of in on at by for with from as is are was were be been being am ' +
  'do does did done have has had having i me my mine we our you your it its this that these those there here ' +
  'what which who whom how when where why can could should would will shall may might must not no yes please pls ' +
  'help need needs want wants get gets got getting just still also very really about into out up down over under ' +
  'again more most some any all each other than too only own same such both few once he she they them his her their ' +
  'hi hello hey thanks thank issue problem problems trouble keep keeps kept work works working worked ' +
  'cant cannot wont dont doesnt didnt isnt arent wasnt couldnt wouldnt shouldnt ive im id youre theyre ' +
  'like some something someone anything one two new now today yesterday always never sometimes try tried trying ' +
  'unable able make makes made using use used show shows showing says say tell see seem seems'
).split(/\s+/));

/* ── phrase normalisation before tokenising ───────────────── */
const PHRASES = [
  [/wi[\s-]?fi/g, 'wifi'],
  [/e[\s-]?mail/g, 'email'],
  [/\b(log|sign)[\s-]?(in|on)\b/g, 'login'],
  [/\b(log|sign)[\s-]?out\b/g, 'logout'],
  [/\b(2fa|two[\s-]?factor|multi[\s-]?factor|mfa)\b/g, 'mfa'],
  [/blue[\s-]?screen/g, 'bsod'],
  [/\bany[\s-]?desk\b/g, 'anydesk'],
  [/\brust[\s-]?desk\b/g, 'rustdesk'],
  [/\bms\s+(office|word|excel|outlook|teams)\b/g, '$1'],
  [/\bmicrosoft\s+/g, ''],
  [/\bno\s+signal\b/g, 'nosignal display'],
  [/\bblack\s+screen\b/g, 'blackscreen display'],
  [/\bpower\s+(on|up)\b/g, 'poweron'],
  [/\bturn\s+on\b/g, 'poweron'],
  [/\bstart\s*up\b/g, 'startup'],
  [/\bout\s+of\s+office\b/g, 'ooo'],
  [/\b(keeps?|kept|keep)\s+(restarting|rebooting|shutting\s+down)\b/g, 'bsod'],
  [/\b(restarts?|reboots?|restarting|rebooting|shuts?\s+down)\s+(by\s+itself|on\s+its\s+own|randomly|unexpectedly|suddenly|without\s+warning|repeatedly)\b/g, 'bsod'],
  [/\b(random|unexpected|sudden|spontaneous)\s+(restarts?|reboots?|shutdowns?)\b/g, 'bsod'],
];

/* ── synonyms: every variant folds into the first word ─────── */
const SYNONYM_GROUPS = [
  ['print', 'printer', 'printing', 'printed', 'toner', 'spooler'],
  ['password', 'passwd', 'pwd', 'passcode', 'passphrase', 'credentials'],
  ['login', 'authenticate', 'authentication', 'signin'],
  ['lock', 'locked', 'lockout', 'disabled', 'blocked', 'suspended'],
  ['expire', 'expired', 'expiry'],
  ['mfa', 'authenticator', 'otp', 'verification'],
  ['wifi', 'wireless', 'wlan', 'hotspot', 'ssid', 'accesspoint'],
  ['internet', 'online', 'connectivity', 'browsing'],
  ['connect', 'connection', 'connected', 'disconnect', 'disconnected', 'dropping', 'drops', 'dropout'],
  ['slow', 'sluggish', 'lag', 'laggy', 'lagging', 'freeze', 'freezing', 'frozen', 'hang', 'hanging', 'hung', 'unresponsive', 'stuck'],
  ['crash', 'crashing', 'crashed', 'closes', 'quits', 'shutsdown'],
  ['email', 'mail', 'outlook', 'inbox', 'mailbox', 'gmail'],
  ['send', 'sending', 'sent', 'outbox'],
  ['receive', 'receiving', 'received'],
  ['display', 'monitor', 'screen', 'projector', 'hdmi', 'vga', 'displayport', 'blackscreen', 'nosignal'],
  ['battery', 'charge', 'charging', 'charger', 'adapter', 'poweron'],
  ['bsod', 'bluescreen', 'stopcode'],
  ['virus', 'malware', 'ransomware', 'trojan', 'spyware', 'infected', 'infection', 'adware', 'hacked', 'compromised'],
  ['phishing', 'phish', 'scam', 'spoof', 'spoofed', 'fraud', 'suspicious', 'fake'],
  ['stolen', 'theft', 'lost', 'misplaced'],
  ['install', 'installation', 'installer', 'setup', 'upgrade'],
  ['update', 'updates', 'patch', 'patches'],
  ['delete', 'deleted', 'recover', 'recovery', 'restore', 'undelete', 'recycle', 'overwritten'],
  ['file', 'document', 'folder', 'spreadsheet'],
  ['share', 'shared', 'sharing', 'mapped', 'fileserver'],
  ['camera', 'webcam', 'video'],
  ['microphone', 'mic', 'audio', 'speaker', 'speakers', 'headset', 'headphones', 'sound'],
  ['meeting', 'teams', 'zoom'],
  ['browser', 'chrome', 'edge', 'firefox', 'safari', 'website', 'webpage'],
  ['keyboard', 'mouse', 'usb', 'peripheral', 'touchpad', 'trackpad'],
  ['remote', 'rustdesk', 'anydesk', 'teamviewer', 'remotely'],
  ['laptop', 'notebook', 'computer', 'pc', 'desktop', 'workstation'],
  ['vpn', 'tunnel'],
  ['ticket', 'raise'],
  ['space', 'storage', 'quota'],
  ['burn', 'burning', 'smell', 'swollen', 'overheat', 'overheating', 'hot'],
];

/* ── light stemmer ────────────────────────────────────────── */
function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (/(ch|sh|x|ss|z)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  if (/([^aeiou])\1$/.test(w) && w.length > 3) w = w.slice(0, -1);
  return w;
}

/* Build variant→canonical map using stemmed forms */
const SYN = new Map();
for (const group of SYNONYM_GROUPS) {
  const canon = stem(group[0]);
  for (const v of group) SYN.set(stem(v), canon);
}

/** Text → array of normalised tokens (stemmed, synonym-folded, stop-words removed). */
export function tokenize(text) {
  let t = String(text || '').toLowerCase().replace(/['’`]/g, '');
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  const out = [];
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2 || STOP.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    const s = stem(raw);
    out.push(SYN.get(s) || s);
  }
  return out;
}

const unique = (arr) => [...new Set(arr)];
function freq(arr) { const m = Object.create(null); for (const x of arr) m[x] = (m[x] || 0) + 1; return m; }

/* ── status & health ──────────────────────────────────────── */
/** Legacy articles with no status: hand-written = approved, AI-generated = draft. */
export function effectiveStatus(a) {
  return a.status || (a.autoGenerated ? 'draft' : 'approved');
}

export function articleHealth(a) {
  const helpful = Number(a.helpful) || 0;
  const unhelpful = Number(a.unhelpful) || 0;
  const votes = helpful + unhelpful;
  const rate = votes ? helpful / votes : null;
  return { helpful, unhelpful, votes, rate, flagged: votes >= 3 && rate < 0.5 };
}

/** Laplace-smoothed quality multiplier: 1.0 with no votes, ~0.55 when mostly 👎, ~1.4 when mostly 👍. */
function qualityFactor(a) {
  const { helpful, unhelpful } = articleHealth(a);
  return 0.5 + (helpful + 1) / (helpful + unhelpful + 2);
}

/* ── retrieval ────────────────────────────────────────────── */
/**
 * Rank articles for a question.
 * @returns {Array<{article, score, matched:string[], coverage:number, relevant:boolean}>}
 *          sorted best-first. `relevant` is a confidence flag used for gap detection.
 */
export function scoreArticles(question, articles, opts = {}) {
  const limit = opts.limit ?? 3;
  const q = unique(tokenize(question));
  if (!q.length || !articles.length) return [];

  const docs = articles.map((a) => {
    const t = freq(tokenize(a.title));
    const g = freq(tokenize((a.tags || []).join(' ')));
    const c = freq(tokenize(a.content));
    return { a, t, g, c };
  });

  const N = docs.length;
  const df = Object.create(null);
  for (const d of docs) {
    for (const term of new Set([...Object.keys(d.t), ...Object.keys(d.g), ...Object.keys(d.c)])) {
      df[term] = (df[term] || 0) + 1;
    }
  }
  const idf = (term) => Math.log(1 + (N - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5));

  const results = [];
  for (const d of docs) {
    let score = 0;
    let titleTagHits = 0;
    const matched = [];
    for (const term of q) {
      const inT = d.t[term] ? 1 : 0;
      const inG = d.g[term] ? 1 : 0;
      const tfC = d.c[term] || 0;
      if (!inT && !inG && !tfC) continue;
      matched.push(term);
      if (inT || inG) titleTagHits++;
      score += idf(term) * (3 * inT + 3 * inG + Math.log(1 + tfC));
    }
    if (!matched.length) continue;
    const coverage = matched.length / q.length;
    // Two hits in the title/tags is a strong signal that filler words (emails, pleasantries,
    // pasted error text) cannot dilute.
    const strong = titleTagHits >= 2;
    const relevant =
      strong ||
      (matched.length >= Math.min(2, q.length) && (coverage >= 0.5 || matched.length >= 3)) ||
      (matched.length >= 1 && titleTagHits >= 1 && coverage >= 0.5);
    score = score * (0.6 + 0.8 * coverage) * qualityFactor(d.a);
    results.push({ article: d.a, score, matched, coverage, relevant, strong });
  }
  results.sort((x, y) => y.score - x.score);
  // With a clear, strong winner, drop weak partial matches so they do not pollute the AI context.
  const best = results[0];
  if (best && best.strong) {
    for (const r of results) if (!r.strong && r.score < 0.4 * best.score) r.relevant = false;
  }
  return results.slice(0, Math.max(limit, 1) * 2);   // keep a few extras for callers that want them
}

/** Top relevant results only (what we actually show to the AI). */
export function topRelevant(question, articles, limit = 3) {
  return scoreArticles(question, articles, { limit }).filter((r) => r.relevant).slice(0, limit);
}

/** Format retrieved articles as grounding context for the AI. */
export function buildKBContext(results, { perArticle = 1300, total = 3600 } = {}) {
  if (!results.length) {
    return [
      'KNOWLEDGE BASE: no approved company article matched this question.',
      'Give brief, safe, general guidance, say you are not certain, and offer to create a support ticket.',
      'Do not invent company-specific procedures, URLs, names or phone numbers.',
    ].join('\n');
  }
  let used = 0;
  const parts = [];
  results.forEach((r, i) => {
    let body = String(r.article.content || '');
    if (body.length > perArticle) body = body.slice(0, perArticle).replace(/\s+\S*$/, '') + ' …';
    const block = `### Article ${i + 1}: ${r.article.title}\n${body}`;
    if (used + block.length > total && parts.length) return;
    parts.push(block);
    used += block.length;
  });
  return [
    'KNOWLEDGE BASE — approved company articles, best match first:',
    parts.join('\n\n'),
    '',
    'Answer using these articles. Adapt the steps to the user\'s situation, keep them in order, and do not add steps',
    'that contradict them. If they only partly apply, use what fits and say what is missing, then offer a ticket.',
  ].join('\n');
}

/* ── small talk ───────────────────────────────────────────── */
export function isSmallTalk(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return true;
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|thanks?( you)?|thank you|ok(ay)?|cool|great|bye|goodbye|cheers)\b[\s!.?]*$/.test(t)) return true;
  if (/^(how are you|who are you|what can you do|who (made|built|created|developed|designed|programmed|owns) you|who (is|are) (your|the) (developer|creator|maker|owner)s?|tell me about (your|the) (developer|creator))\b/.test(t)) return true;
  return tokenize(t).length === 0;
}

/* ── privacy ──────────────────────────────────────────────── */
/** Strip things we should never store in feedback / gap logs. */
export function redactSensitive(text) {
  return String(text || '')
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, '[email]')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/g, '[key]')
    .replace(/\b(pass(?:word|code|phrase)?|pwd|pin|otp|secret|token)\b(\s*(?:is|=|:)\s*)\S+/gi, '$1$2[redacted]')
    .replace(/\d[\d\s-]{5,}\d/g, '[number]');
}

/* ── knowledge-gap grouping ───────────────────────────────── */
export function normalizeQuestion(q) {
  const toks = unique(tokenize(q)).sort();
  const key = toks.join(' ');
  return (key || String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).slice(0, 120);
}

const REASON_WEIGHT = { ticket: 3, downvoted: 2, no_match: 1 };

/**
 * @param gaps [{id, question, key, reason, ticketId, tsMs}]
 * @returns groups sorted by priority: [{key, question, count, reasons[], ids[], ticketIds[], lastTs, priority}]
 */
export function groupGaps(gaps) {
  const map = new Map();
  for (const g of gaps) {
    const key = g.key || normalizeQuestion(g.question);
    let grp = map.get(key);
    if (!grp) { grp = { key, question: g.question, count: 0, reasons: new Set(), ids: [], ticketIds: [], lastTs: 0 }; map.set(key, grp); }
    grp.count++;
    grp.reasons.add(g.reason);
    grp.ids.push(g.id);
    if (g.ticketId) grp.ticketIds.push(g.ticketId);
    if ((g.tsMs || 0) >= grp.lastTs) { grp.lastTs = g.tsMs || 0; grp.question = g.question; }
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      reasons: [...g.reasons],
      priority: g.count + [...g.reasons].reduce((s, r) => s + (REASON_WEIGHT[r] || 0), 0),
    }))
    .sort((a, b) => b.priority - a.priority || b.lastTs - a.lastTs);
}

/* ── display helpers ──────────────────────────────────────── */
/** Plain-text preview for KB cards (uses the Summary section when present). */
export function articlePreview(content, max = 170) {
  let t = String(content || '');
  const m = t.match(/##\s*Summary\s*\n([\s\S]*?)(?:\n##|$)/i);
  if (m) t = m[1];
  t = t.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/^\s*(?:[-•*]|\d+\.)\s+/gm, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}
