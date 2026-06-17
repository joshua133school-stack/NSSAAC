/**
 * Google Apps Script — results collector for the "Real, or Rendered?" study.
 *
 * This turns a Google Sheet into the permanent database for your study.
 * The website's server POSTs each submission here, and this script appends
 * one row per (participant × photo).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SETUP (about 10 minutes, one time)
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Create a new Google Sheet (sheets.new). Name it e.g. "NSSAAC Results".
 * 2. In the menu: Extensions ▸ Apps Script. Delete any sample code.
 * 3. Paste THIS entire file in, and Save (the disk icon).
 * 4. (Optional but recommended) Set a shared secret so only your site can
 *    write to the sheet: change SHARED_SECRET below to a random string, and
 *    later put the SAME value in your server's SHEET_SHARED_SECRET variable.
 *    Leave it as '' to allow any caller (fine for a low-stakes class project).
 * 5. Click "Deploy" ▸ "New deployment".
 *      - Click the gear ▸ choose "Web app".
 *      - Description: anything.
 *      - Execute as: "Me".
 *      - Who has access: "Anyone".          ← required so your server can post
 *      - Click "Deploy", then "Authorize access" and allow the permissions.
 * 6. Copy the "Web app URL" it gives you (ends in /exec).
 *      That URL goes into your server's SHEET_WEBHOOK_URL variable.
 *
 * That's it. Responses will start appearing in the sheet as people take part.
 *
 * NOTE: If you ever change this script, you must Deploy ▸ "Manage deployments"
 * ▸ edit ▸ "New version" for the changes to take effect at the same URL.
 */

// If you set this, your server's SHEET_SHARED_SECRET must match it exactly.
const SHARED_SECRET = '';

// Name of the tab to write to (created automatically if missing).
const SHEET_NAME = 'Responses';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // avoid two submissions clobbering each other
  try {
    const body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    const columns = body.columns || [];
    const rows = body.rows || [];
    const images = body.images || []; // base64 JPEG per row ('' if none)
    if (!rows.length) {
      return json({ ok: false, error: 'No rows' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    // The highlighted images are pasted into this column (with a gap so they
    // don't sit on top of the data).
    const imgCol = (columns.length || rows[0].length) + 2;

    // Write the header row once.
    if (sheet.getLastRow() === 0 && columns.length) {
      sheet.appendRow(columns);
      sheet.getRange(1, imgCol).setValue('annotation_image');
      sheet.setFrozenRows(1);
    }

    // Append all rows for this submission in one efficient write.
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);

    // Paste each highlighted image into the sheet, anchored to its row.
    let pasted = 0;
    for (let i = 0; i < images.length; i++) {
      const b64 = images[i];
      if (!b64) continue;
      const cell = sheet.getRange(start + i, imgCol);
      try {
        const blob = Utilities.newBlob(
          Utilities.base64Decode(b64), 'image/jpeg', 'mark_' + (start + i) + '.jpg');
        const oi = sheet.insertImage(blob, imgCol, start + i);
        // shrink to a tidy thumbnail while keeping aspect ratio
        const h = 90;
        const ratio = oi.getWidth() / oi.getHeight();
        oi.setHeight(h).setWidth(Math.round(h * ratio));
        pasted++;
      } catch (imgErr) {
        // Make failures visible instead of silently dropping the image.
        cell.setValue('image error: ' + String(imgErr));
      }
    }

    return json({ ok: true, version: 'v2-images', added: rows.length, images: pasted });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// A quick sanity check you can open in a browser. The "version" confirms which
// code is actually deployed — it must say "v2-images" for highlight images.
function doGet() {
  return json({ ok: true, version: 'v2-images', message: 'NSSAAC results collector is running.' });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
