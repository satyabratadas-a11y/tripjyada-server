const ContentPillar = require('../models/ContentPillar');

function serialize(p) {
  return {
    id: p._id,
    client: p.client,
    name: p.name,
    color: p.color,
    description: p.description,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function listPillars(req, res) {
  const pillars = await ContentPillar.find({ client: req.client._id }).sort({ name: 1 });
  return res.json({ pillars: pillars.map(serialize) });
}

async function createPillar(req, res) {
  const { name, color, description } = req.body;
  const trimmedName = name?.trim();
  if (!trimmedName) return res.status(400).json({ error: 'name is required' });

  const pillar = await ContentPillar.create({
    client: req.client._id,
    name: trimmedName,
    color: color || '#6366F1',
    description: description || '',
  });
  return res.status(201).json({ pillar: serialize(pillar) });
}

async function updatePillar(req, res) {
  const pillar = await ContentPillar.findOne({ _id: req.params.id, client: req.client._id });
  if (!pillar) return res.status(404).json({ error: 'Pillar not found' });

  const { name, color, description } = req.body;
  if (name !== undefined) pillar.name = name.trim();
  if (color !== undefined) pillar.color = color;
  if (description !== undefined) pillar.description = description;
  await pillar.save();
  return res.json({ pillar: serialize(pillar) });
}

async function deletePillar(req, res) {
  const pillar = await ContentPillar.findOne({ _id: req.params.id, client: req.client._id });
  if (!pillar) return res.status(404).json({ error: 'Pillar not found' });
  await pillar.deleteOne();
  return res.status(204).send();
}

module.exports = { listPillars, createPillar, updatePillar, deletePillar };
