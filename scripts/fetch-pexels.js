'use strict';

/**
 * fetch-pexels.js — download a diverse batch of REAL photos into photos/real/
 *
 * Pexels prohibits AI-generated uploads, so its library is genuine photography
 * — a good fit for the "real" side of the study. This script spreads the
 * download across many subjects (people, food, streets, nature, objects…) so
 * your real set isn't all landscapes, and writes a credits file you can cite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USAGE
 *   1. Get a free API key: https://www.pexels.com/api/  (sign up, copy key)
 *   2. Run it:
 *        PEXELS_API_KEY=your_key_here node scripts/fetch-pexels.js
 *      or with options:
 *        PEXELS_API_KEY=key COUNT=40 node scripts/fetch-pexels.js
 *        PEXELS_API_KEY=key COUNT=30 TOPICS="portrait,food,city" node scripts/fetch-pexels.js
 *
 * Options (environment variables):
 *   PEXELS_API_KEY  (required) your Pexels API key
 *   COUNT           how many photos to download in total      (default 40)
 *   TOPICS          comma-separated subjects to spread across (default: a
 *                   broad mix; see DEFAULT_TOPICS below)
 *   SIZE            pexels size field: large | large2x | medium (default large)
 *
 * ⚠ Spot-check the results before using them. Policy forbids AI images, but
 *   enforcement isn't perfect, and you want your real/AI sets to cover similar
 *   subjects so participants can't "cheat" on subject alone.
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.PEXELS_API_KEY;
const COUNT = parseInt(process.env.COUNT || '40', 10);
const SIZE = process.env.SIZE || 'large';
const OUT_DIR = path.join(__dirname, '..', 'photos', 'real');
const CREDITS_PATH = path.join(OUT_DIR, '_pexels_credits.csv');

// A broad spread of everyday subjects. Includes people-heavy topics on purpose,
// since AI images are often easiest to judge on faces/hands.
const DEFAULT_TOPICS = [
  'portrait', 'candid people', 'street photography', 'food', 'coffee',
  'landscape', 'mountains', 'ocean', 'forest', 'animals', 'dog', 'bird',
  'architecture', 'city at night', 'interior room', 'desk workspace',
  'flowers', 'market', 'sports', 'car', 'kitchen', 'children playing',
];
const TOPICS = (process.env.TOPICS
  ? process.env.TOPICS.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_TOPICS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (n) => Math.floor(Math.random() * n);

async function searchTopic(topic, perPage) {
  // random early page for variety run-to-run (pages 1..5)
  const page = 1 + randInt(5);
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(topic)}`
    + `&per_page=${perPage}&page=${page}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: API_KEY } });
  if (res.status === 429) {
    throw new Error('Rate limited by Pexels (free tier ~200 req/hour). Try later.');
  }
  if (!res.ok) {
    throw new Error(`Pexels search failed (${res.status}) for "${topic}"`);
  }
  const data = await res.json();
  return data.photos || [];
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  if (!API_KEY) {
    console.error('\n  Missing PEXELS_API_KEY.');
    console.error('  Get one free at https://www.pexels.com/api/ then run:');
    console.error('    PEXELS_API_KEY=your_key node scripts/fetch-pexels.js\n');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const needHeader = !fs.existsSync(CREDITS_PATH);
  if (needHeader) {
    fs.writeFileSync(CREDITS_PATH, 'filename,photographer,photographer_url,pexels_url,topic\n');
  }

  const perTopic = Math.max(2, Math.ceil(COUNT / TOPICS.length));
  const seen = new Set();
  let saved = 0;

  console.log(`\n  Downloading ~${COUNT} real photos from Pexels into photos/real/`);
  console.log(`  Spreading across ${TOPICS.length} topics...\n`);

  for (const topic of TOPICS) {
    if (saved >= COUNT) break;
    let photos = [];
    try {
      photos = await searchTopic(topic, Math.min(perTopic + 4, 30));
    } catch (err) {
      console.warn(`  ! ${topic}: ${err.message}`);
      if (/Rate limited/.test(err.message)) break;
      continue;
    }

    let fromTopic = 0;
    for (const p of photos) {
      if (saved >= COUNT || fromTopic >= perTopic) break;
      if (seen.has(p.id)) continue;
      seen.add(p.id);

      const src = p.src[SIZE] || p.src.large || p.src.original;
      const filename = `real_pexels_${p.id}.jpg`;
      const dest = path.join(OUT_DIR, filename);
      if (fs.existsSync(dest)) continue;

      try {
        await download(src, dest);
        fs.appendFileSync(CREDITS_PATH, [
          filename, p.photographer, p.photographer_url, p.url, topic,
        ].map(csvEscape).join(',') + '\n');
        saved++;
        fromTopic++;
        process.stdout.write(`  ✓ ${saved.toString().padStart(3)}  ${topic.padEnd(20)} ${filename}\n`);
      } catch (err) {
        console.warn(`  ! download error: ${err.message}`);
      }
      await sleep(120); // be gentle with the API
    }
  }

  console.log(`\n  Done. Saved ${saved} photos to photos/real/`);
  console.log(`  Credits written to ${path.relative(path.join(__dirname, '..'), CREDITS_PATH)}`);
  if (saved < COUNT) {
    console.log(`  (Wanted ${COUNT}; got ${saved}. Re-run for more, or add TOPICS.)`);
  }
  console.log('  ⚠ Spot-check the images, and match subjects to your AI set.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
