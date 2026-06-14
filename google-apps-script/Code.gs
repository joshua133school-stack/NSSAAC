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
    if (!rows.length) {
      return json({ ok: false, error: 'No rows' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    // Write the header row once.
    if (sheet.getLastRow() === 0 && columns.length) {
      sheet.appendRow(columns);
      sheet.setFrozenRows(1);
    }

    // Append all rows for this submission in one efficient write.
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);

    return json({ ok: true, added: rows.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// A quick sanity check you can open in a browser (shows the script is live).
function doGet() {
  return json({ ok: true, message: 'NSSAAC results collector is running.' });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
