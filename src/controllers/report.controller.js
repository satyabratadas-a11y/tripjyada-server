const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const User = require('../models/User');
const Task = require('../models/Task');
const { startOfMonth, endOfMonthExclusive, rollupTasks } = require('../utils/scoring');
const { drawTable, drawStatTiles, drawSectionTitle, BRAND_DARK, BORDER, SUBTEXT } = require('../utils/pdfTable');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'doc_logo.png');
const PAGE_MARGIN = 40;

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// The report is already scoped to a single month (shown in the cover header), so each row only
// needs day + month — the full ISO date was wrapping mid-number in the table's narrow column.
function formatTaskDateShort(date) {
  return new Date(date).toLocaleString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function formatDayType(dayType) {
  return dayType === 'optional_sunday' ? 'Optional Sunday' : 'Working';
}

function formatAdminStatus(status) {
  return status.replaceAll('_', ' ');
}

function formatMemberStatus(status) {
  return status.replaceAll('_', ' ');
}

function createUniqueSheetName(name, usedNames) {
  const base = (name || 'Employee').replace(/[\\/*?:[\]]/g, '').slice(0, 31) || 'Employee';
  let candidate = base;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    const suffixText = ` ${suffix}`;
    candidate = `${base.slice(0, Math.max(0, 31 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

async function buildMonthlyReport(year, month) {
  // Admins do real assigned/logged work too and belong in the roll-up; super_admin is excluded —
  // that role is account oversight, not a member of the team being reported on.
  const employees = await User.find({ role: { $in: ['employee', 'admin'] }, status: 'active' }).sort({ name: 1 });
  const rangeStart = startOfMonth(year, month);
  const rangeEnd = endOfMonthExclusive(year, month);

  // One query for the whole team instead of one per employee — same result, fewer round trips as
  // the team grows.
  const employeeIds = employees.map((e) => e._id);
  const allTasks = await Task.find({ employee: { $in: employeeIds }, date: { $gte: rangeStart, $lt: rangeEnd } }).sort({
    date: 1,
  });
  const tasksByEmployee = new Map();
  for (const task of allTasks) {
    const key = String(task.employee);
    if (!tasksByEmployee.has(key)) tasksByEmployee.set(key, []);
    tasksByEmployee.get(key).push(task);
  }

  const rows = employees.map((emp) => {
    const tasks = tasksByEmployee.get(String(emp._id)) || [];
    const rollup = rollupTasks(tasks);
    return {
      employee: emp,
      tasks,
      ...rollup,
      integrity: rollup.flags > 0 ? `${rollup.flags} flag(s)` : 'All clear',
    };
  });

  const team = rows.reduce(
    (acc, r) => {
      acc.assignedDays += r.assignedDays;
      acc.completed += r.completed;
      acc.onProgress += r.onProgress;
      acc.incomplete += r.incomplete;
      acc.flags += r.flags;
      return acc;
    },
    { assignedDays: 0, completed: 0, onProgress: 0, incomplete: 0, flags: 0 }
  );
  team.progressPct =
    team.assignedDays === 0
      ? 0
      : Math.round(((team.completed + 0.5 * team.onProgress) / team.assignedDays) * 1000) / 10;

  return { rows, team };
}

async function getMonthlyReportJSON(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  const { rows, team } = await buildMonthlyReport(year, month);

  return res.json({
    month,
    year,
    team,
    rows: rows.map((r) => ({
      employee: { id: r.employee._id, name: r.employee.name, jobTitle: r.employee.jobTitle },
      assignedDays: r.assignedDays,
      completed: r.completed,
      onProgress: r.onProgress,
      incomplete: r.incomplete,
      flags: r.flags,
      progressPct: r.progressPct,
      integrity: r.integrity,
    })),
  });
}

async function downloadMonthlyReport(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  const { rows, team } = await buildMonthlyReport(year, month);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Task Tracker';
  workbook.created = new Date(Date.UTC(year, month - 1, 1));
  const usedSheetNames = new Set();

  const summary = workbook.addWorksheet('HR Report');
  summary.addRow([`MONTHLY PROGRESS REPORT — MANAGER & HR (${year}-${String(month).padStart(2, '0')})`]);
  summary.mergeCells('A1:G1');
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.addRow([]);

  const header = summary.addRow([
    'Team Member',
    'Role',
    'Assigned',
    'Completed',
    'On Progress',
    'Incomplete',
    'Flags',
    'Progress %',
    'Integrity',
  ]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  for (const r of rows) {
    summary.addRow([
      r.employee.name,
      r.employee.jobTitle,
      r.assignedDays,
      r.completed,
      r.onProgress,
      r.incomplete,
      r.flags,
      r.progressPct,
      r.integrity,
    ]);
  }

  const teamRow = summary.addRow([
    'TEAM AVERAGE',
    '',
    team.assignedDays,
    team.completed,
    team.onProgress,
    team.incomplete,
    team.flags,
    team.progressPct,
    team.flags > 0 ? `${team.flags} flag(s)` : 'All clear',
  ]);
  teamRow.font = { bold: true };

  summary.columns.forEach((col) => {
    col.width = 16;
  });
  // Progress % (column H) as a real number rather than a "83%" string, so it can drive a native
  // Excel data-bar chart below — a plain data label would sort/filter fine but can't be a graph.
  summary.getColumn(8).numFmt = '0.0"%"';

  const firstDataRow = 4;
  const lastDataRow = firstDataRow + rows.length; // includes the TEAM AVERAGE row
  summary.addConditionalFormatting({
    ref: `H${firstDataRow}:H${lastDataRow}`,
    rules: [
      {
        type: 'dataBar',
        priority: 1,
        cfvo: [
          { type: 'num', value: 0 },
          { type: 'num', value: 100 },
        ],
        color: { argb: 'FF34A853' },
        border: true,
        showValue: true,
      },
    ],
  });

  for (const r of rows) {
    const sheetName = createUniqueSheetName(r.employee.name, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName || `Employee ${r.employee._id}`);
    const detailHeader = sheet.addRow([
      'Date',
      'Day Type',
      'Assigned Task',
      'Member Status',
      'Proof Link',
      'Admin Status',
      'Reviewer Notes',
    ]);
    detailHeader.font = { bold: true };
    for (const t of r.tasks) {
      sheet.addRow([
        t.date.toISOString().slice(0, 10),
        t.dayType,
        t.assignedTask,
        t.memberStatus,
        t.proofLink,
        t.adminStatus,
        t.reviewerNotes,
      ]);
    }
    sheet.columns.forEach((col) => {
      col.width = 20;
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="monthly-report-${year}-${String(month).padStart(2, '0')}.xlsx"`
  );

  await workbook.xlsx.write(res);
  res.end();
}

function monthLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function progressColor(pct) {
  if (pct >= 80) return '#1E8E3E';
  if (pct >= 50) return '#B45309';
  return '#DC2626';
}

/** Full-bleed brand header for the report's cover page — logo, title, and month/generated. */
function drawCoverBand(doc, { year, month }) {
  const width = doc.page.width;
  doc.rect(0, 0, width, 90).fill(BRAND_DARK);
  doc.image(LOGO_PATH, PAGE_MARGIN, 18, { width: 150 });

  doc.font('Helvetica-Bold').fontSize(15).fillColor('#FFFFFF').text('MONTHLY PROGRESS REPORT', PAGE_MARGIN, 54);
  doc.font('Helvetica').fontSize(9).fillColor('#D1D5DB').text('Manager & HR Performance Overview', PAGE_MARGIN, 72);

  const rightWidth = 220;
  const rightX = width - PAGE_MARGIN - rightWidth;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#D1D5DB')
    .text(`Month: ${monthLabel(year, month)}`, rightX, 32, { width: rightWidth, align: 'right' })
    .text(`Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`, rightX, 46, {
      width: rightWidth,
      align: 'right',
    });

  return 90 + 30;
}

/** Every page's footer — a rule plus "Page X of Y", drawn last once the total page count is known. */
function drawPageFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Writing inside the bottom margin makes pdfkit think the text overflows the page and
    // silently insert a *new* blank page to hold it instead of rendering it here — dropping the
    // footer entirely and corrupting the page count. Zeroing the margin during this draw stops
    // that; it's restored right after so nothing else on the page is affected.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const bottom = doc.page.height - 26;
    doc
      .moveTo(PAGE_MARGIN, bottom)
      .lineTo(doc.page.width - PAGE_MARGIN, bottom)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();
    doc.font('Helvetica').fontSize(8).fillColor(SUBTEXT);
    doc.text('Tripjyada — Monthly Progress Report', PAGE_MARGIN, bottom + 8, { width: 300, lineBreak: false });
    doc.text(`Page ${i + 1 - range.start} of ${range.count}`, doc.page.width - PAGE_MARGIN - 150, bottom + 8, {
      width: 150,
      align: 'right',
      lineBreak: false,
    });

    doc.page.margins.bottom = bottomMargin;
  }
}

const TEAM_TABLE_COLUMNS = [
  { header: 'Team Member', width: 120 },
  { header: 'Role', width: 115 },
  { header: 'Assigned', width: 65, align: 'right' },
  { header: 'Completed', width: 70, align: 'right' },
  { header: 'Progress', width: 75, align: 'right' },
  { header: 'Status', width: 70 },
];

const TASK_TABLE_COLUMNS = [
  { header: 'Date', width: 50 },
  { header: 'Day Type', width: 65 },
  { header: 'Task', width: 160 },
  { header: 'Status', width: 65 },
  { header: 'Verified', width: 65 },
  { header: 'Notes', width: 110 },
];

function teamTiles(team) {
  return [
    { label: 'Assigned', value: team.assignedDays },
    { label: 'Completed', value: team.completed },
    { label: 'On Progress', value: team.onProgress },
    { label: 'Incomplete', value: team.incomplete },
    { label: 'Flags', value: team.flags, accent: team.flags > 0 ? '#DC2626' : undefined },
    { label: 'Progress', value: `${team.progressPct}%`, accent: progressColor(team.progressPct) },
  ];
}

function taskTableRow(task) {
  const taskCell = task.brief && task.brief !== task.assignedTask ? `${task.assignedTask}\n${task.brief}` : task.assignedTask;
  // A raw Google Drive/Docs URL can run 80+ characters, which alone would force every row with
  // proof attached onto 4-5 wrapped lines — a plain "attached" flag keeps the table scannable,
  // while reviewer notes (genuine human commentary) are still shown in full.
  const notes = [];
  if (task.proofLink) notes.push('Proof attached');
  if (task.reviewerNotes) notes.push(task.reviewerNotes);

  return [
    formatTaskDateShort(task.date),
    formatDayType(task.dayType),
    taskCell,
    formatMemberStatus(task.memberStatus),
    formatAdminStatus(task.adminStatus),
    notes.length ? notes.join('\n') : '—',
  ];
}

async function downloadMonthlyReportPDF(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  const { rows, team } = await buildMonthlyReport(year, month);
  const filename = `monthly-report-${monthKey(year, month)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', bufferPages: true });
  doc.pipe(res);

  let y = drawCoverBand(doc, { year, month });

  y = drawSectionTitle(doc, { x: PAGE_MARGIN, top: y, text: 'Team Summary' });
  y = drawStatTiles(doc, { x: PAGE_MARGIN, top: y, width: 515, tiles: teamTiles(team), columns: 3 }) + 24;

  y = drawSectionTitle(doc, { x: PAGE_MARGIN, top: y, text: 'Team Overview' });
  drawTable(doc, {
    x: PAGE_MARGIN,
    top: y,
    columns: TEAM_TABLE_COLUMNS,
    rows: rows.map((r) => [r.employee.name, r.employee.jobTitle || '—', r.assignedDays, r.completed, `${r.progressPct}%`, r.integrity]),
  });

  for (const row of rows) {
    doc.addPage();
    let ey = PAGE_MARGIN;
    doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND_DARK).text(row.employee.name, PAGE_MARGIN, ey);
    doc.font('Helvetica').fontSize(10).fillColor(SUBTEXT).text(row.employee.jobTitle || 'Team member', PAGE_MARGIN, ey + 20);
    ey += 36;
    doc.moveTo(PAGE_MARGIN, ey).lineTo(PAGE_MARGIN + 515, ey).strokeColor(BORDER).lineWidth(1).stroke();
    ey += 16;

    ey = drawStatTiles(doc, {
      x: PAGE_MARGIN,
      top: ey,
      width: 515,
      tiles: [
        { label: 'Assigned', value: row.assignedDays },
        { label: 'Completed', value: row.completed },
        { label: 'On Progress', value: row.onProgress },
        { label: 'Incomplete', value: row.incomplete },
        { label: 'Flags', value: row.flags, accent: row.flags > 0 ? '#DC2626' : undefined },
        { label: 'Progress', value: `${row.progressPct}%`, accent: progressColor(row.progressPct) },
      ],
      columns: 3,
    });
    ey += 24;

    ey = drawSectionTitle(doc, { x: PAGE_MARGIN, top: ey, text: 'Daily Task Log' });

    if (row.tasks.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor(SUBTEXT).text('No tasks recorded for this month.', PAGE_MARGIN, ey);
      continue;
    }

    drawTable(doc, { x: PAGE_MARGIN, top: ey, columns: TASK_TABLE_COLUMNS, rows: row.tasks.map(taskTableRow) });
  }

  drawPageFooters(doc);
  doc.end();
}

module.exports = { getMonthlyReportJSON, downloadMonthlyReport, downloadMonthlyReportPDF };
