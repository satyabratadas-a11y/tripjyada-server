const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const COLUMNS = [
  'Date',
  'Day',
  'Time',
  'Format',
  'Pillar',
  'Campaign',
  'Content Idea',
  'Hook / Angle',
  'Caption',
  'CTA',
  'Platform',
  'Assigned Team Member',
  'Status',
  'Approval Status',
];

function dayName(date) {
  return new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
}

function toRow(entry) {
  return [
    new Date(entry.date).toISOString().slice(0, 10),
    dayName(entry.date),
    entry.time || '',
    entry.format,
    entry.pillar?.name || '',
    entry.campaign?.name || '',
    entry.idea || '',
    entry.hook || '',
    entry.caption || '',
    entry.cta || '',
    entry.platform,
    entry.assignee?.name || 'Unassigned',
    entry.status,
    entry.approvalStatus,
  ];
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildCSV(entries) {
  const lines = [COLUMNS.join(',')];
  for (const entry of entries) {
    lines.push(toRow(entry).map(csvEscape).join(','));
  }
  return lines.join('\n');
}

async function buildExcelBuffer(entries, sheetTitle = 'Content Calendar') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Content Calendar';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetTitle.slice(0, 31) || 'Content Calendar');
  const header = sheet.addRow(COLUMNS);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  });

  for (const entry of entries) {
    sheet.addRow(toRow(entry));
  }

  sheet.columns.forEach((col) => {
    col.width = 20;
  });

  return workbook.xlsx.writeBuffer();
}

function buildPDF(res, entries, title = 'Content Calendar') {
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  doc.pipe(res);

  doc.fontSize(16).text(title);
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#555').text(`Generated: ${new Date().toLocaleString()}`);
  doc.moveDown();

  doc.fillColor('#000').fontSize(9);
  for (const entry of entries) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    const row = toRow(entry);
    doc.font('Helvetica-Bold').text(`${row[0]} (${row[1]}) ${row[2] ? `at ${row[2]}` : ''} — ${row[3]} on ${row[10]}`);
    doc
      .font('Helvetica')
      .text(`Pillar: ${row[4] || '—'} | Campaign: ${row[5] || '—'} | Assigned: ${row[11]}`)
      .text(`Idea: ${row[6] || '—'}`)
      .text(`Hook: ${row[7] || '—'}`);
    if (row[8]) doc.text(`Caption: ${row[8]}`);
    if (row[9]) doc.text(`CTA: ${row[9]}`);
    doc.text(`Status: ${row[12]} | Approval: ${row[13]}`);
    doc.moveDown(0.6);
  }

  doc.end();
}

module.exports = { buildCSV, buildExcelBuffer, buildPDF, COLUMNS };
