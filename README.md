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

| Variable             | Default | What it does                                  |
|----------------------|---------|-----------------------------------------------|
| `PORT`               | `3000`  | Port to serve on                              |
| `PHOTOS_PER_SESSION` | `20`    | How many images each participant sees         |
| `ADMIN_KEY`          | *(off)* | Password for the results download (see below) |

Example: `PHOTOS_PER_SESSION=24 ADMIN_KEY=secret123 npm start`

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

Every submission is appended to:

- `data/results.csv` — **one row per (participant × photo)**, ready for Excel,
  Google Sheets, R, SPSS, or Python/pandas.
- `data/results.json` — the same data, nested, if you prefer.

Download the CSV from the running site:

```
http://localhost:3000/api/results.csv
```

If you set `ADMIN_KEY`, add `?key=YOUR_KEY` to that URL.

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

## Deploying (optional)

Any host that runs Node works (Render, Railway, Fly.io, a VPS, etc.). Make sure
the `photos/` images are deployed too, and note that on ephemeral/serverless
hosts the `data/` file may not persist — for serious collection use a host with
a persistent disk, or periodically download the CSV.

## Project layout

```
server.js          Express server: serves photos, hands out sessions, saves results
public/
  index.html       The whole single-page experience
  styles.css       Visual design (animated background, fade-in text)
  app.js           Screen flow + quiz logic
photos/ai/         ← your AI images
photos/real/       ← your real images
data/              Collected results (git-ignored)
```
