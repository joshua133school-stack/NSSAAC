'use strict';

/**
 * NSSAAC — "Can you tell what is AI?"
 *
 * A small, self-contained Express server for a statistics study.
 * It serves the participant-facing website, hands out a balanced, shuffled
 * set of photographs (some AI-generated, some real), and records every
 * response to a CSV (and JSON) file so the data can be analysed later.
 *
 * Photos live in two folders that YOU populate:
 *   photos/ai/    -> AI-generated images
 *   photos/real/  -> real (non-AI) photographs
 *
 * No database, no third-party services. Just run `npm install` then
 * `npm start`, and open http://localhost:3000
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// How many photos each participant is shown.
const PHOTOS_PER_SESSION = parseInt(process.env.PHOTOS_PER_SESSION || '20', 10);

// Optional password to protect the results download endpoint.
// Set ADMIN_KEY in the environment to enable it.
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// Google Sheet integration. When SHEET_WEBHOOK_URL is set, every submission is
// sent to a Google Apps Script web app that appends it to your spreadsheet.
// This is the primary, permanent store when hosting on Render's free tier
// (whose local disk is wiped on restart). SHEET_SHARED_SECRET, if set here,
// must match the SHARED_SECRET in the Apps Script.
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL || '';
const SHEET_SHARED_SECRET = process.env.SHEET_SHARED_SECRET || '';

const PHOTO_DIRS = {
  ai: path.join(__dirname, 'photos', 'ai'),
  real: path.join(__dirname, 'photos', 'real'),
};

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CSV_PATH = path.join(DATA_DIR, 'results.csv');
const JSON_PATH = path.join(DATA_DIR, 'results.json');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirs() {
  for (const dir of [PHOTO_DIRS.ai, PHOTO_DIRS.real, DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** List image files in a folder (non-recursive, hidden files ignored). */
function listImages(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .filter((e) => IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name);
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a balanced, shuffled selection of photos for one session.
 * Tries to use an even split of AI / real, falling back gracefully when
 * one pool is smaller than the other.
 */
function buildSelection(count) {
  const ai = shuffle(listImages(PHOTO_DIRS.ai)).map((file) => ({
    src: `/photos/ai/${encodeURIComponent(file)}`,
    truth: 'ai',
  }));
  const real = shuffle(listImages(PHOTO_DIRS.real)).map((file) => ({
    src: `/photos/real/${encodeURIComponent(file)}`,
    truth: 'real',
  }));

  const half = Math.floor(count / 2);
  let chosen = [...ai.slice(0, half), ...real.slice(0, half)];

  // If we still need more (one pool was short), top up from whatever remains.
  if (chosen.length < count) {
    const remaining = shuffle([...ai.slice(half), ...real.slice(half)]);
    chosen = chosen.concat(remaining.slice(0, count - chosen.length));
  }

  // Hide the ground truth from the client. Map to opaque ids and keep an
  // answer key server-side embedded in a signed token... but to stay simple
  // and dependency-free, we send the truth too. The study is observational
  // and the client is not graded in real time, so this is acceptable; if you
  // want to be strict, strip `truth` here and score on the server instead.
  return shuffle(chosen).slice(0, count);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// One row per (participant x photo) so the data is "tidy" for analysis.
const CSV_COLUMNS = [
  'submission_id',
  'timestamp',
  'age',
  'gender',
  'education',
  'occupation_field',
  'ai_used_before',
  'ai_use_frequency',
  'ai_image_gen_used',
  'seen_ai_images',
  'self_rated_ability',
  'overall_comments',
  'photo_index',
  'photo_src',
  'photo_truth',
  'guess',
  'is_correct',
  'confidence',
  'reason_tags',
  'reason_other',
];
const CSV_HEADER = CSV_COLUMNS.join(',');

function appendCsv(rows) {
  const needHeader = !fs.existsSync(CSV_PATH) || fs.statSync(CSV_PATH).size === 0;
  const lines = rows.map((r) => r.map(csvEscape).join(','));
  const out = (needHeader ? CSV_HEADER + '\n' : '') + lines.join('\n') + '\n';
  fs.appendFileSync(CSV_PATH, out, 'utf8');
}

function appendJson(record) {
  let all = [];
  try {
    all = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    if (!Array.isArray(all)) all = [];
  } catch (err) {
    all = [];
  }
  all.push(record);
  fs.writeFileSync(JSON_PATH, JSON.stringify(all, null, 2), 'utf8');
}

/**
 * Send the flattened rows to a Google Sheet via an Apps Script web app.
 * Resolves on success, throws on any failure so the caller can react.
 */
async function sendToSheet(columns, rows) {
  const res = await fetch(SHEET_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Apps Script web apps don't enforce CORS for server-to-server calls,
    // and redirect on success — follow it to read the result.
    redirect: 'follow',
    body: JSON.stringify({
      secret: SHEET_SHARED_SECRET,
      columns,
      rows,
    }),
  });
  if (!res.ok) {
    throw new Error(`Sheet webhook returned HTTP ${res.status}`);
  }
  const text = await res.text();
  // The Apps Script returns {"ok":true}; treat anything else as a failure.
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  if (!parsed || parsed.ok !== true) {
    throw new Error(`Sheet webhook did not confirm success: ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Middleware & routes
// ---------------------------------------------------------------------------

ensureDirs();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve the photos. They are public by necessity (the browser must load them),
// but the folder listing is never exposed.
app.use('/photos', express.static(path.join(__dirname, 'photos'), {
  index: false,
  dotfiles: 'ignore',
}));

// Hand out a fresh, shuffled selection for a session.
app.get('/api/photos', (req, res) => {
  const selection = buildSelection(PHOTOS_PER_SESSION);
  res.json({
    count: selection.length,
    requested: PHOTOS_PER_SESSION,
    photos: selection,
  });
});

// Quick health/inventory check (handy while setting the study up).
app.get('/api/status', (req, res) => {
  res.json({
    ai_photos: listImages(PHOTO_DIRS.ai).length,
    real_photos: listImages(PHOTO_DIRS.real).length,
    photos_per_session: PHOTOS_PER_SESSION,
    // true once SHEET_WEBHOOK_URL is set on the host (does not reveal the URL)
    sheet_configured: !!SHEET_WEBHOOK_URL,
  });
});

// Receive a completed survey.
app.post('/api/submit', async (req, res) => {
  const body = req.body || {};
  const demo = body.demographics || {};
  const responses = Array.isArray(body.responses) ? body.responses : [];

  if (responses.length === 0) {
    return res.status(400).json({ ok: false, error: 'No responses provided.' });
  }

  const submissionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const flat = (v) => (Array.isArray(v) ? v.join('; ') : v);

  const rows = responses.map((r, i) => {
    const guess = r.guess;
    const truth = r.truth;
    const isCorrect = (guess && truth) ? (guess === truth ? 1 : 0) : '';
    return [
      submissionId,
      timestamp,
      demo.age,
      demo.gender,
      demo.education,
      demo.occupationField,
      demo.aiUsedBefore,
      demo.aiUseFrequency,
      demo.aiImageGenUsed,
      demo.seenAiImages,
      demo.selfRatedAbility,
      demo.overallComments,
      i + 1,
      r.src,
      truth,
      guess,
      isCorrect,
      r.confidence,
      flat(r.reasonTags),
      r.reasonOther,
    ];
  });

  // Best-effort local backup. On hosts with an ephemeral disk (e.g. Render's
  // free tier) this may not persist, which is fine — the Google Sheet is the
  // source of truth. So we never fail the request just because disk writes did.
  let localSaved = false;
  try {
    appendCsv(rows);
    appendJson({ submissionId, timestamp, demographics: demo, responses });
    localSaved = true;
  } catch (err) {
    console.warn('Local backup write failed (continuing):', err.message);
  }

  // Primary store: the Google Sheet, when configured.
  if (SHEET_WEBHOOK_URL) {
    try {
      await sendToSheet(CSV_COLUMNS, rows);
    } catch (err) {
      console.error('Failed to send submission to Google Sheet:', err.message);
      return res.status(502).json({ ok: false, error: 'Could not save response.' });
    }
  } else if (!localSaved) {
    // No Sheet configured and the disk write failed — nothing was saved.
    return res.status(500).json({ ok: false, error: 'Could not save response.' });
  }

  const correct = responses.filter((r) => r.guess && r.truth && r.guess === r.truth).length;
  res.json({
    ok: true,
    submissionId,
    score: { correct, total: responses.length },
  });
});

// Download the raw CSV (optionally password-protected via ADMIN_KEY).
app.get('/api/results.csv', (req, res) => {
  if (ADMIN_KEY && req.query.key !== ADMIN_KEY) {
    return res.status(401).send('Unauthorized. Provide ?key=YOUR_ADMIN_KEY');
  }
  if (!fs.existsSync(CSV_PATH)) {
    return res.status(404).send('No results recorded yet.');
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="results.csv"');
  fs.createReadStream(CSV_PATH).pipe(res);
});

app.listen(PORT, () => {
  const ai = listImages(PHOTO_DIRS.ai).length;
  const real = listImages(PHOTO_DIRS.real).length;
  console.log(`\n  NSSAAC study running at  http://localhost:${PORT}`);
  console.log(`  Photos loaded -> AI: ${ai}, real: ${real}`);
  if (ai + real < PHOTOS_PER_SESSION) {
    console.log(`  ⚠  Add more images to photos/ai and photos/real (need ~${PHOTOS_PER_SESSION}).`);
  }
  if (SHEET_WEBHOOK_URL) {
    console.log('  Results -> Google Sheet (webhook configured) + local backup');
  } else {
    console.log(`  Results -> ${path.relative(__dirname, CSV_PATH)} (local only — set SHEET_WEBHOOK_URL to use a Google Sheet)`);
  }
  console.log('');
});
