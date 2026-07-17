const { google } = require('googleapis');

const SHEET_HEADER = [
  'Date',
  'Name',
  'Company',
  'Job Title',
  'Phone',
  'Email',
  'Website',
  'Address',
  'State',
  'Pincode',
  'Notes',
  'Captured By',
];

const REQUIRED_ENV_VARS = ['GOOGLE_SHEETS_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'];

function missingSheetsEnvVars() {
  return REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
}

function isSheetsEnabled() {
  return missingSheetsEnvVars().length === 0;
}

// The private key is a multi-line PEM block. Env vars can't hold real newlines, so it's normally
// stored with literal "\n" escapes and unescaped here — but that format is fragile to carry
// through copy/paste into a host's env-var UI (any dropped/doubled backslash silently corrupts
// the key, which is exactly what caused repeated "DECODER routines::unsupported" errors even
// though the same key string worked fine tested directly). If the value is base64 instead (no
// backslashes or newlines to mangle at all), decode it; otherwise fall back to the "\n" literal.
function getPrivateKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
  if (!raw.includes('BEGIN PRIVATE KEY')) {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.includes('BEGIN PRIVATE KEY')) return decoded;
  }
  return raw.replace(/\\n/g, '\n');
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
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A1:L1` });
  const currentHeader = existing.data.values?.[0] || [];
  // Also re-writes if a header is present but stale (an older version of this code wrote fewer
  // columns) — comparing lengths is enough to catch that without clobbering a genuinely blank row.
  if (currentHeader.length < SHEET_HEADER.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:L1`,
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
    range: `${sheetName}!A:L`,
    // RAW, not USER_ENTERED — a phone/note/address starting with "+" or "-" (e.g. an un-normalized
    // "+91..." number, or a note like "-50% mentioned") gets parsed by Sheets as a formula under
    // USER_ENTERED and lands as a literal #ERROR! cell instead of the text that was actually sent.
    valueInputOption: 'RAW',
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
          contact.state,
          contact.pincode,
          contact.notes,
          agentName || '',
        ],
      ],
    },
  });
}

module.exports = { isSheetsEnabled, missingSheetsEnvVars, appendContactRow };
