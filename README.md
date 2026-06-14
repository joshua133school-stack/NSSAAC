# Real, or Rendered? — *Can people tell AI images from real ones?*

A small, self-contained website for a **statistics project**. Participants look
at a random series of photographs — some AI-generated, some real — and decide,
for each, which is which. The site collects demographics and the reasoning
behind each choice, and saves everything to a tidy CSV you can analyse.

It looks like a minimal gallery / art installation: a living, drifting colour
field in the background and text that fades in letter by letter.

---

## 1. What you need to do first: add photos

This is the only manual step. Drop your images into two folders:

```
photos/ai/     ← AI-generated images
photos/real/   ← real (camera) photographs
```

- Any common image type works (`.jpg .png .webp .gif .avif` …).
- Aim for **at least 10–15 in each** folder (more is better — variety matters).
- For a fair study, keep the **subject matter and quality similar** across both
  folders. The server automatically shuffles and shows a balanced mix.

You can keep the `README.md` files that are already in those folders — the
server ignores non-image files.

## 2. Run it

You need [Node.js](https://nodejs.org) (v18 or newer). Then, in this folder:

```bash
npm install
npm start
```

Open **http://localhost:3000** in a browser.

Useful settings (optional, set before `npm start`):

| Variable              | Default | What it does                                          |
|-----------------------|---------|-------------------------------------------------------|
| `PORT`                | `3000`  | Port to serve on                                      |
| `PHOTOS_PER_SESSION`  | `20`    | How many images each participant sees                 |
| `SHEET_WEBHOOK_URL`   | *(off)* | Google Apps Script web-app URL — saves data to a Sheet|
| `SHEET_SHARED_SECRET` | *(off)* | Must match `SHARED_SECRET` in the Apps Script         |
| `ADMIN_KEY`           | *(off)* | Password for the local results download               |
| `DATA_DIR`            | `./data`| Where the local backup CSV/JSON is written            |

Example: `PHOTOS_PER_SESSION=24 npm start`

## 3. Collect responses

Share the link with participants. Each person:

1. reads a short intro,
2. fills in demographics + their experience with AI,
3. judges ~20 images one at a time (real vs. AI), rating their confidence and
   tagging *why* they decided,
4. sees their score at the end.

To let people outside your own computer take part, run it on a host that's
reachable on your network or deploy it (see **Deploying** below).

## 4. Get the data

There are two ways data is stored. **For real deployment, use the Google Sheet**
(option A) — it's free and permanent. The local file (option B) is mainly for
testing on your own computer.

### A) Google Sheet (recommended — used in deployment)

When the `SHEET_WEBHOOK_URL` variable is set, every submission is appended to a
Google Sheet you own — **one row per (participant × photo)** — landing straight
in a spreadsheet you can sort, chart, and analyse. Setup takes ~10 minutes and
is described in [`google-apps-script/Code.gs`](google-apps-script/Code.gs):

1. Create a Google Sheet, open **Extensions ▸ Apps Script**, paste in the
   contents of `google-apps-script/Code.gs`, and **Deploy ▸ New deployment ▸
   Web app** with access set to **Anyone**.
2. Copy the web-app URL it gives you (ends in `/exec`).
3. Set it as the `SHEET_WEBHOOK_URL` environment variable on your host
   (see **Deploying** below). Optionally set a matching secret in both places
   (`SHARED_SECRET` in the script, `SHEET_SHARED_SECRET` on the server).

That's it — responses appear in the sheet as people take part.

### B) Local file (for testing only)

If `SHEET_WEBHOOK_URL` is **not** set, submissions are written to:

- `data/results.csv` — one row per (participant × photo).
- `data/results.json` — the same data, nested.

Download the CSV from the running site at `http://localhost:3000/api/results.csv`
(add `?key=YOUR_KEY` if you set `ADMIN_KEY`).

> ⚠ On free cloud hosts (like Render's free tier) the local disk is wiped on
> every restart, so don't rely on the local file in production — use the Sheet.

### Columns in `results.csv`

| Column                | Meaning                                               |
|-----------------------|-------------------------------------------------------|
| `submission_id`       | Random id shared by all rows from one participant     |
| `timestamp`           | When they submitted (ISO time)                        |
| `age`, `gender`, `education`, `country`, `occupation_field`, `native_english` | Demographics |
| `ai_used_before`, `ai_use_frequency`, `ai_types_used`, `image_ai_experience`  | AI-experience questions |
| `self_rated_ability`  | Self-rated skill at spotting AI (1–10)                |
| `vision_corrected`    | Whether they're viewing with corrected vision         |
| `overall_comments`    | Reserved for free-text overall comments               |
| `photo_index`         | 1…N within that participant's sequence                |
| `photo_src`           | Which image was shown                                  |
| `photo_truth`         | The real answer: `ai` or `real`                       |
| `guess`               | What they chose: `ai` or `real`                       |
| `is_correct`          | `1` if guess matched the truth, else `0`              |
| `confidence`          | Their confidence on that image (1–10)                 |
| `reason_tags`         | Cues they picked (e.g. "Hands / fingers; Lighting")   |
| `reason_text`         | Optional free-text reason for that image              |

> **Tip for analysis:** `is_correct` averaged per participant gives an accuracy
> score; you can then test whether accuracy relates to age, AI experience,
> self-rated ability, confidence, etc.

## Why these demographic questions?

The survey follows common social-science practice — the "gold standard"
background variables are **age, gender, education, country/region, and
occupation/field** — plus a question on whether English is the participant's
first language (the interface is in English). On top of that, and specific to
this study, it asks about **prior AI use, how often, which kinds of AI,
familiarity with AI images, self-rated detection ability, and corrected
vision** — all plausible predictors of how well someone can spot AI images.

## Privacy & ethics

- No names, emails, or accounts — responses are anonymous.
- `data/` is git-ignored so participant data isn't accidentally committed.
- The intro tells participants the data is for a school statistics project.
- If you run this for a class, mention voluntary participation in your write-up.

## Deploying to Render (recommended, free)

This repo includes a [`render.yaml`](render.yaml) blueprint. The flow:

1. **Set up the Google Sheet first** (see *Get the data ▸ A*) and copy its
   web-app URL — you'll need it in step 4.
2. **Push your code to GitHub** including your images in `photos/ai` and
   `photos/real`. (Images committed to the repo are deployed with the app.)
3. In [Render](https://render.com): **New ▸ Blueprint**, pick this repo, and
   Render will read `render.yaml` and create the service.
   - If your code is on a feature branch, set the service's branch accordingly
     (or merge to `main`).
4. Open the service's **Environment** tab and add:
   - `SHEET_WEBHOOK_URL` = your Apps Script `/exec` URL
   - `SHEET_SHARED_SECRET` = the same secret you put in the Apps Script (optional)
5. Deploy. Render gives you a public `https://…onrender.com` link — that's the
   link you share with participants.

Notes:
- The free plan **sleeps after ~15 min idle**; the first visit then takes ~30s
  to wake. That's fine for a study, and because data goes to the Sheet, nothing
  is lost when it sleeps.
- Any other Node host works too (Railway, Fly.io, a VPS). Just set the same
  environment variables and make sure the `photos/` images are deployed.

## Project layout

```
server.js               Express server: serves photos, hands out sessions, saves results
render.yaml             Render deployment blueprint
google-apps-script/
  Code.gs               Paste into your Google Sheet to collect responses
public/
  index.html            The whole single-page experience
  styles.css            Visual design (animated background, fade-in text)
  app.js                Screen flow + quiz logic
photos/ai/              ← your AI images
photos/real/            ← your real images
data/                   Local backup results (git-ignored; testing only)
```
