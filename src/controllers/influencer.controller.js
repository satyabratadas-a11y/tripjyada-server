const Influencer = require('../models/Influencer');

function serializeInfluencer(influencer) {
  return {
    id: influencer._id,
    name: influencer.name,
    influencerId: influencer.influencerId,
    niche: influencer.niche,
    phone: influencer.phone,
    remarks: influencer.remarks,
    createdAt: influencer.createdAt,
    updatedAt: influencer.updatedAt,
  };
}

async function listInfluencers(req, res) {
  const { q } = req.query;
  const filter = {};
  if (q) {
    const re = new RegExp(String(q).trim(), 'i');
    filter.$or = [{ name: re }, { influencerId: re }, { niche: re }, { phone: re }];
  }

  const influencers = await Influencer.find(filter).sort({ createdAt: -1 });
  return res.json({ influencers: influencers.map(serializeInfluencer) });
}

async function createInfluencer(req, res) {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const influencer = await Influencer.create({
    name,
    influencerId: req.body.influencerId?.trim() || '',
    niche: req.body.niche?.trim() || '',
    phone: req.body.phone?.trim() || '',
    remarks: req.body.remarks?.trim() || '',
    createdBy: req.user._id,
  });

  return res.status(201).json({ influencer: serializeInfluencer(influencer) });
}

async function updateInfluencer(req, res) {
  const influencer = await Influencer.findById(req.params.id);
  if (!influencer) return res.status(404).json({ error: 'Influencer not found' });

  if (req.body.name !== undefined) {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    influencer.name = name;
  }
  if (req.body.influencerId !== undefined) influencer.influencerId = req.body.influencerId?.trim() || '';
  if (req.body.niche !== undefined) influencer.niche = req.body.niche?.trim() || '';
  if (req.body.phone !== undefined) influencer.phone = req.body.phone?.trim() || '';
  if (req.body.remarks !== undefined) influencer.remarks = req.body.remarks?.trim() || '';

  await influencer.save();
  return res.json({ influencer: serializeInfluencer(influencer) });
}

async function deleteInfluencer(req, res) {
  const influencer = await Influencer.findById(req.params.id);
  if (!influencer) return res.status(404).json({ error: 'Influencer not found' });

  await influencer.deleteOne();
  return res.status(204).send();
}

module.exports = { listInfluencers, createInfluencer, updateInfluencer, deleteInfluencer };
