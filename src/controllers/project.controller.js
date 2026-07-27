const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { isProjectOverdue } = require('../utils/projectStatus');
const { diffFields, recordAudit } = require('../utils/audit');
const { isAdminLike, isSuperAdmin } = require('../utils/roles');

// Mirrors task.controller's ownerOutranksAdmin: a plain admin reviewing an admin (or super
// admin)'s own project would defeat the point of review, so that tier requires a super admin.
function ownerOutranksAdmin(ownerRole) {
  return ownerRole === 'admin' || ownerRole === 'super_admin';
}

const PROJECT_STATUSES = ['active', 'completed'];

function validateEnumValue(res, field, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) {
    res.status(400).json({ error: `${field} must be one of: ${allowed.join(', ')}` });
    return false;
  }
  return true;
}

function serializeWithOverdue(project) {
  const obj = project.toObject ? project.toObject() : project;
  return { ...obj, overdue: isProjectOverdue(obj) };
}

function validateDateRange(res, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    res.status(400).json({ error: 'startDate and endDate must be valid dates' });
    return null;
  }
  if (end < start) {
    res.status(400).json({ error: 'endDate must be on or after startDate' });
    return null;
  }
  return { start, end };
}

/**
 * Admin-like caller can request any employeeId (view-gated to super admin if that id outranks a
 * plain admin), or omit it for their own projects; a non-admin is always forced to their own id.
 * Mirrors task.controller's listTasks.
 */
async function listProjects(req, res) {
  let employeeId;
  let employeeInfo;
  if (isAdminLike(req.user) && req.query.employeeId) {
    employeeId = req.query.employeeId;
    if (!mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ error: 'employeeId query param must be a valid id' });
    }
    const target = await User.findById(employeeId);
    if (ownerOutranksAdmin(target?.role) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can view an admin\'s projects' });
    }
    if (target) {
      employeeInfo = { id: target._id, name: target.name, jobTitle: target.jobTitle, role: target.role };
    }
  } else {
    employeeId = String(req.user._id);
  }

  if (!validateEnumValue(res, 'status', req.query.status, PROJECT_STATUSES)) return;

  const filter = { employee: employeeId };
  if (req.query.status) filter.status = req.query.status;

  const projects = await Project.find(filter).sort({ endDate: 1, createdAt: 1 });

  return res.json({ projects: projects.map(serializeWithOverdue), employee: employeeInfo });
}

/**
 * Admin-only: every visible employee's projects in one list, flagged with a live `overdue`
 * computation, for a reviewer to triage instead of clicking into each employee individually.
 * Visibility mirrors task.controller's searchTasks: a plain admin sees employees only, a super
 * admin also sees other admins.
 */
async function reviewList(req, res) {
  if (!validateEnumValue(res, 'status', req.query.status, PROJECT_STATUSES)) return;

  const visibleRoles = isSuperAdmin(req.user) ? ['employee', 'admin'] : ['employee'];
  const employees = await User.find({ role: { $in: visibleRoles } }).select('name jobTitle role');
  const employeeMap = new Map(employees.map((e) => [String(e._id), e]));

  const filter = { employee: { $in: [...employeeMap.keys()] } };
  if (req.query.status) filter.status = req.query.status;

  const projects = await Project.find(filter).sort({ endDate: 1 });

  let results = projects.map((p) => {
    const emp = employeeMap.get(String(p.employee));
    return {
      ...serializeWithOverdue(p),
      employee: emp ? { id: String(p.employee), name: emp.name, jobTitle: emp.jobTitle, role: emp.role } : { id: String(p.employee) },
    };
  });

  if (req.query.overdueOnly === 'true') {
    results = results.filter((p) => p.overdue);
  }

  return res.json({ projects: results });
}

/**
 * A single project plus every daily task entry logged against it — the owner can always view
 * their own; an admin-like caller can view it subject to the same rank rule as everywhere else.
 */
async function getProject(req, res) {
  const project = await Project.findById(req.params.id).populate('employee', 'name jobTitle role');
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const isOwner = String(project.employee._id) === String(req.user._id);
  if (!isOwner) {
    if (!isAdminLike(req.user)) return res.status(403).json({ error: 'You cannot view this project' });
    if (ownerOutranksAdmin(project.employee.role) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: "Only a super admin can view an admin's project" });
    }
  }

  const tasks = await Task.find({ project: project._id }).sort({ date: 1, createdAt: 1 });
  return res.json({
    project: {
      ...serializeWithOverdue(project),
      employee: { id: String(project.employee._id), name: project.employee.name, jobTitle: project.employee.jobTitle, role: project.employee.role },
    },
    tasks,
  });
}

/** Admin-only: assigns a new project to a given employee. */
async function createOrAssignProject(req, res) {
  const { employeeId, title, brief, startDate, endDate } = req.body;
  const trimmedTitle = title?.trim();
  if (!employeeId || !trimmedTitle || !startDate || !endDate) {
    return res.status(400).json({ error: 'employeeId, title, startDate and endDate are required' });
  }
  if (!mongoose.isValidObjectId(employeeId)) {
    return res.status(400).json({ error: 'employeeId must be a valid id' });
  }
  const range = validateDateRange(res, startDate, endDate);
  if (!range) return;

  const employee = await User.findOne({ _id: employeeId, role: 'employee', status: 'active' });
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  const project = await Project.create({
    employee: employeeId,
    title: trimmedTitle,
    brief: brief ?? '',
    startDate: range.start,
    endDate: range.end,
    createdBy: 'admin',
  });

  await recordAudit({
    actor: req.user,
    action: 'project.assigned',
    targetType: 'project',
    targetId: project._id,
    targetLabel: employee.name,
    summary: `Assigned project "${project.title}" to ${employee.name}`,
    metadata: { employeeId: String(employee._id), employeeName: employee.name, title: project.title },
  });

  // Unlike overdue alerts (recomputed live on every fetch), an assignment is a one-time event —
  // there's no ongoing state to recompute it from later, so it has to be persisted here or it's
  // gone the moment this response is sent.
  await Notification.create({
    user: employee._id,
    type: 'assigned',
    message: `You were assigned a new project: "${project.title}" (due ${range.end.toISOString().slice(0, 10)})`,
    link: `/employee/projects/${project._id}`,
  });

  return res.status(201).json({ project: serializeWithOverdue(project) });
}

/** Employee-only: adds a project for themselves. */
async function employeeCreateProject(req, res) {
  const { title, brief, startDate, endDate } = req.body;
  const trimmedTitle = title?.trim();
  if (!trimmedTitle || !startDate || !endDate) {
    return res.status(400).json({ error: 'title, startDate and endDate are required' });
  }
  const range = validateDateRange(res, startDate, endDate);
  if (!range) return;

  const project = await Project.create({
    employee: req.user._id,
    title: trimmedTitle,
    brief: brief ?? '',
    startDate: range.start,
    endDate: range.end,
    createdBy: 'employee',
  });

  return res.status(201).json({ project: serializeWithOverdue(project) });
}

// Mirrors task.controller's EMPLOYEE_OWN_TASK_FIELDS / EMPLOYEE_ASSIGNED_TASK_FIELDS split: a
// self-added project is fully the owner's to edit, but an admin-assigned project's terms
// (title/brief/dates) stay admin-owned — the owner can only report their own status on it.
const OWN_PROJECT_FIELDS = ['title', 'brief', 'startDate', 'endDate', 'status'];
const ASSIGNED_PROJECT_FIELDS = ['status'];
const REVIEWER_FIELDS = ['status', 'reviewerNotes'];

function pickWhitelisted(body, fields) {
  const update = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) update[field] = body[field];
  }
  return update;
}

/**
 * Single entry point for editing a project, branching on whether the caller owns it. The owner
 * can edit their own project's details and mark it complete; reviewerNotes is only ever set
 * through the reviewer branch below, never by the owner — even an owner who is themselves an
 * admin only ever hits the owner branch for their own project.
 */
async function updateProject(req, res) {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const isOwner = String(project.employee) === String(req.user._id);

  if (isOwner) {
    const fields = project.createdBy === 'employee' ? OWN_PROJECT_FIELDS : ASSIGNED_PROJECT_FIELDS;
    const update = pickWhitelisted(req.body, fields);
    if (!validateEnumValue(res, 'status', update.status, PROJECT_STATUSES)) return;
    if (update.title !== undefined) update.title = update.title?.trim();
    if (update.startDate || update.endDate) {
      const range = validateDateRange(res, update.startDate || project.startDate, update.endDate || project.endDate);
      if (!range) return;
      update.startDate = range.start;
      update.endDate = range.end;
    }

    Object.assign(project, update);
    await project.save();
    return res.json({ project: serializeWithOverdue(project) });
  }

  if (!isAdminLike(req.user)) {
    return res.status(403).json({ error: 'You can only update your own project' });
  }

  const employee = await User.findById(project.employee);
  if (ownerOutranksAdmin(employee?.role) && !isSuperAdmin(req.user)) {
    return res.status(403).json({ error: 'Only a super admin can review an admin\'s project' });
  }

  const update = pickWhitelisted(req.body, REVIEWER_FIELDS);
  if (!validateEnumValue(res, 'status', update.status, PROJECT_STATUSES)) return;

  const before = { status: project.status, reviewerNotes: project.reviewerNotes };
  Object.assign(project, update);
  await project.save();

  await recordAudit({
    actor: req.user,
    action: 'project.reviewed',
    targetType: 'project',
    targetId: project._id,
    targetLabel: employee?.name || String(project.employee),
    summary: `Updated ${employee?.name || 'employee'}'s project "${project.title}"`,
    changes: diffFields(before, project, REVIEWER_FIELDS),
    metadata: { employeeId: String(project.employee), employeeName: employee?.name || '', title: project.title },
  });

  return res.json({ project: serializeWithOverdue(project) });
}

async function deleteProject(req, res) {
  const project = await Project.findById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const employee = isAdminLike(req.user) ? await User.findById(project.employee) : req.user;
  if (!isAdminLike(req.user)) {
    if (String(project.employee) !== String(req.user._id)) {
      return res.status(403).json({ error: 'You can only delete your own project' });
    }
    if (project.createdBy !== 'employee') {
      return res.status(403).json({ error: 'You cannot delete a project assigned by an admin' });
    }
  } else if (ownerOutranksAdmin(employee?.role) && !isSuperAdmin(req.user) && String(project.employee) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Only a super admin can delete another admin\'s project' });
  }

  // Unlink rather than cascade-delete — the underlying Task rows are still real logged (and
  // possibly reviewed) work and shouldn't vanish just because their parent project was removed.
  await Task.updateMany({ project: project._id }, { $set: { project: null } });
  await project.deleteOne();

  await recordAudit({
    actor: req.user,
    action: 'project.deleted',
    targetType: 'project',
    targetId: project._id,
    targetLabel: employee?.name || String(project.employee),
    summary: `Deleted ${employee?.name || 'employee'}'s project "${project.title}"`,
    metadata: { employeeId: String(project.employee), employeeName: employee?.name || '', title: project.title, createdBy: project.createdBy },
  });

  return res.status(204).send();
}

module.exports = {
  listProjects,
  reviewList,
  getProject,
  createOrAssignProject,
  employeeCreateProject,
  updateProject,
  deleteProject,
};
