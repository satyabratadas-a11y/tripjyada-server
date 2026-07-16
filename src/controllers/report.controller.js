const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const User = require('../models/User');
const Task = require('../models/Task');
const { startOfMonth, endOfMonthExclusive, rollupTasks } = require('../utils/scoring');

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function formatTaskDate(date) {
  return new Date(date).toISOString().slice(0, 10);
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

function ensurePdfSpace(doc, needed = 40) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

async function buildMonthlyReport(year, month) {
  const employees = await User.find({ role: 'employee', status: 'active' }).sort({ name: 1 });
  const rangeStart = startOfMonth(year, month);
  const rangeEnd = endOfMonthExclusive(year, month);

  const rows = await Promise.all(
    employees.map(async (emp) => {
      const tasks = await Task.find({ employee: emp._id, date: { $gte: rangeStart, $lt: rangeEnd } }).sort({
        date: 1,
      });
      const rollup = rollupTasks(tasks);
      return {
        employee: emp,
        tasks,
        ...rollup,
        integrity: rollup.flags > 0 ? `${rollup.flags} flag(s)` : 'All clear',
      };
    })
  );

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

async function downloadMonthlyReportPDF(req, res) {
  const month = parseInt(req.query.month, 10);
  const year = parseInt(req.query.year, 10);
  if (!month || !year) return res.status(400).json({ error: 'month and year query params are required' });

  const { rows, team } = await buildMonthlyReport(year, month);
  const filename = `monthly-report-${monthKey(year, month)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  doc.fontSize(18).text('Monthly Progress Report - Manager & HR');
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#555').text(`Month: ${monthKey(year, month)}`);
  doc.text(`Generated: ${new Date().toLocaleString()}`);
  doc.moveDown();

  doc.fillColor('#000').fontSize(13).text('Team Summary');
  doc.moveDown(0.4);
  doc.fontSize(11);
  doc.text(`Assigned: ${team.assignedDays}`);
  doc.text(`Completed: ${team.completed}`);
  doc.text(`On Progress: ${team.onProgress}`);
  doc.text(`Incomplete: ${team.incomplete}`);
  doc.text(`Flags: ${team.flags}`);
  doc.text(`Progress: ${team.progressPct}%`);
  doc.moveDown();

  doc.fontSize(13).text('Members');
  doc.moveDown(0.4);
  doc.fontSize(10);
  for (const row of rows) {
    ensurePdfSpace(doc, 28);
    doc.font('Helvetica-Bold').text(row.employee.name, { continued: true });
    doc
      .font('Helvetica')
      .text(
        `  ${row.employee.jobTitle || '—'} | Assigned ${row.assignedDays} | Completed ${row.completed} | Progress ${row.progressPct}% | Flags ${row.flags}`
      );
  }

  for (const row of rows) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(15).text(row.employee.name);
    doc.font('Helvetica').fontSize(11).fillColor('#555').text(row.employee.jobTitle || '—');
    doc.moveDown(0.5);
    doc
      .fillColor('#000')
      .fontSize(10)
      .text(
        `Assigned ${row.assignedDays} | Completed ${row.completed} | On Progress ${row.onProgress} | Incomplete ${row.incomplete} | Flags ${row.flags} | Progress ${row.progressPct}%`
      );
    doc.moveDown();

    if (row.tasks.length === 0) {
      doc.fillColor('#555').text('No tasks recorded for this month.');
      continue;
    }

    for (const task of row.tasks) {
      ensurePdfSpace(doc, 90);
      doc.font('Helvetica-Bold').fillColor('#000').text(`${formatTaskDate(task.date)}  ${task.assignedTask}`);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#333')
        .text(`Day type: ${formatDayType(task.dayType)} | Source: ${task.createdBy}`)
        .text(`Member status: ${formatMemberStatus(task.memberStatus)} | Verified: ${formatAdminStatus(task.adminStatus)}`);

      if (task.brief) doc.text(`Brief: ${task.brief}`);
      if (task.proofLink) doc.text(`Proof: ${task.proofLink}`);
      if (task.reviewerNotes) doc.text(`Reviewer notes: ${task.reviewerNotes}`);
      doc.moveDown(0.7);
    }
  }

  doc.end();
}

module.exports = { getMonthlyReportJSON, downloadMonthlyReport, downloadMonthlyReportPDF };
