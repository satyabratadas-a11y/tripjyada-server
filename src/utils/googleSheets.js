const { google } = require('googleapis');

const SHEET_HEADER = ['Date', 'Name', 'Company', 'Job Title', 'Phone', 'Email', 'Website', 'Address', 'Notes', 'Captured By'];

function isSheetsEnabled() {
  return Boolean(
    process.env.GOOGLE_SHEETS_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  );
}

// The private key is a multi-line PEM block, which env vars can't hold with real newlines — it's
// stored with literal "\n" escapes and unescaped here.
function getPrivateKey() {
  return process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n');
}

let sheetsClientPromise;

function getSheetsClient() {
  if (!sheetsClientPromise) {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: getPrivateKey(),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClientPromise = auth.authorize().then(() => google.sheets({ version: 'v4', auth }));
  }
  return sheetsClientPromise;
}

// Written once per process (not once per contact) — a freshly-connected sheet starts blank, and
// this backfills the header row the first time this process appends a row to it.
let headerEnsured = false;

async function ensureHeaderRow(sheets, spreadsheetId, sheetName) {
  if (headerEnsured) return;
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A1:J1` });
  if (!existing.data.values?.[0]?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:J1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADER] },
    });
  }
  headerEnsured = true;
}

async function appendContactRow({ contact, agentName }) {
  if (!isSheetsEnabled()) return;

  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const sheetName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Sheet1';
  const sheets = await getSheetsClient();

  await ensureHeaderRow(sheets, spreadsheetId, sheetName);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          new Date(contact.createdAt).toISOString().slice(0, 10),
          contact.name,
          contact.company,
          contact.jobTitle,
          contact.phone,
          contact.email,
          contact.website,
          contact.address,
          contact.notes,
          agentName || '',
        ],
      ],
    },
  });
}

module.exports = { isSheetsEnabled, appendContactRow };
