const AuditLog = require('../models/AuditLog');

function normalizeValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object' && value && value._id) return String(value._id);
  return value;
}

function diffFields(before, after, fields) {
  const changes = {};

  for (const field of fields) {
    const previous = normalizeValue(before?.[field]);
    const next = normalizeValue(after?.[field]);
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes[field] = {
        before: previous ?? null,
        after: next ?? null,
      };
    }
  }

  return changes;
}

async function recordAudit({ actor, action, targetType, targetId, targetLabel = '', summary, changes = {}, metadata = {} }) {
  if (!actor) return null;

  return AuditLog.create({
    actor: actor._id,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    targetType,
    targetId: String(targetId),
    targetLabel,
    summary,
    changes,
    metadata,
  });
}

module.exports = { diffFields, recordAudit };
