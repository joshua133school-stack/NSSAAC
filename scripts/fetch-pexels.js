'use strict';

/**
 * fetch-pexels.js — download RANDOM real photos into photos/real/ and record
 * what each one is.
 *
 * Pexels prohibits AI-generated uploads, so its library is genuine photography
 * — a good fit for the "real" side of the study.
 *
 * How it works: rather than choosing categories up front, this pulls photos at
 * random from Pexels' curated feed, then captures each photo's description /
 * classification (Pexels' "alt" text) into a credits file. So the categories
 * come FROM the photos, not the other way around.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USAGE
 *   1. Get a free API key: https://www.pexels.com/api/  (sign up, copy key)
 *   2. Run it (from inside the project folder):
 *        PEXELS_API_KEY=your_key_here npm run fetch:real
 *      or choose how many:
 *        PEXELS_API_KEY=key COUNT=40 npm run fetch:real
 *
 * Options (environment variables):
 *   PEXELS_API_KEY  (required) your Pexels API key
 *   COUNT           how many photos to download in total   (default 40)
 *   SIZE            pexels size field: large | large2x | medium (default large)
 *
 * Output:
 *   photos/real/<slug>_<id>.jpg          the images (named after their content)
 *   photos/real/_pexels_credits.csv      filename, description, photographer, links
 *
 * ⚠ These are RANDOM, so the mix of subjects is whatever comes up (could be
 *   light on people/faces). Spot-check the results and, if your AI set has lots
 *   of portraits, you may want to add a few real portraits by hand to match.
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.PEXELS_API_KEY;
const COUNT = parseInt(process.env.COUNT || '40', 10);
const SIZE = process.env.SIZE || 'large';
const OUT_DIR = path.join(__dirname, '..', 'photos', 'real');
const CREDITS_PATH = path.join(OUT_DIR, '_pexels_credits.csv');

const PER_PAGE = 80;          // Pexels max per request
const MAX_PAGE = 50;          // pick random pages within the curated feed

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (n) => 1 + Math.floor(Math.random() * n);

async function fetchCuratedPage(page) {
  const url = `https://api.pexels.com/v1/curated?per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, { headers: { Authorization: API_KEY } });
  if (res.status === 429) {
    throw new Error('Rate limited by Pexels (free tier ~200 req/hour). Try later.');
  }
  if (!res.ok) {
    throw new Error(`Pexels curated request failed (${res.status})`);
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

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  if (!API_KEY) {
    console.error('\n  Missing PEXELS_API_KEY.');
    console.error('  Get one free at https://www.pexels.com/api/ then run:');
    console.error('    PEXELS_API_KEY=your_key npm run fetch:real\n');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(CREDITS_PATH)) {
    fs.writeFileSync(CREDITS_PATH,
      'filename,description,photographer,photographer_url,pexels_url\n');
  }

  const seen = new Set();
  let saved = 0;
  let attempts = 0;

  console.log(`\n  Downloading ${COUNT} RANDOM real photos from Pexels into photos/real/`);
  console.log('  Recording each photo\'s description as we go...\n');

  while (saved < COUNT && attempts < 40) {
    attempts++;
    let photos = [];
    try {
      photos = await fetchCuratedPage(randInt(MAX_PAGE));
    } catch (err) {
      console.warn(`  ! ${err.message}`);
      if (/Rate limited/.test(err.message)) break;
      continue;
    }

    // shuffle the page so we don't always take the same ones
    photos.sort(() => Math.random() - 0.5);

    for (const p of photos) {
      if (saved >= COUNT) break;
      if (seen.has(p.id)) continue;
      seen.add(p.id);

      const description = p.alt || '';        // the "name / classification"
      const slug = slugify(description) || 'photo';
      const filename = `real_${slug}_${p.id}.jpg`;
      const dest = path.join(OUT_DIR, filename);
      if (fs.existsSync(dest)) continue;

      const src = p.src[SIZE] || p.src.large || p.src.original;
      try {
        await download(src, dest);
        fs.appendFileSync(CREDITS_PATH, [
          filename, description, p.photographer, p.photographer_url, p.url,
        ].map(csvEscape).join(',') + '\n');
        saved++;
        process.stdout.write(
          `  ✓ ${saved.toString().padStart(3)}  ${(description || '(no description)').slice(0, 48)}\n`);
      } catch (err) {
        console.warn(`  ! download error: ${err.message}`);
      }
      await sleep(120); // be gentle with the API
    }
  }

  console.log(`\n  Done. Saved ${saved} photos to photos/real/`);
  console.log(`  Descriptions/credits -> ${path.relative(path.join(__dirname, '..'), CREDITS_PATH)}`);
  if (saved < COUNT) {
    console.log(`  (Wanted ${COUNT}; got ${saved}. Re-run to top up.)`);
  }
  console.log('  ⚠ Random mix — spot-check, and add real portraits by hand if your AI set has many.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
