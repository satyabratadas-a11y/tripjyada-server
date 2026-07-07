const Campaign = require('../models/Campaign');

function serialize(c) {
  return {
    id: c._id,
    client: c.client,
    name: c.name,
    phase: c.phase,
    startDate: c.startDate,
    endDate: c.endDate,
    color: c.color,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function listCampaigns(req, res) {
  const campaigns = await Campaign.find({ client: req.client._id }).sort({ startDate: 1, name: 1 });
  return res.json({ campaigns: campaigns.map(serialize) });
}

async function createCampaign(req, res) {
  const { name, phase, startDate, endDate, color, status } = req.body;
  const trimmedName = name?.trim();
  if (!trimmedName) return res.status(400).json({ error: 'name is required' });
  if (status && !['planned', 'active', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be planned, active, or completed' });
  }

  const campaign = await Campaign.create({
    client: req.client._id,
    name: trimmedName,
    phase: phase || '',
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    color: color || '#10B981',
    status: status || 'planned',
  });
  return res.status(201).json({ campaign: serialize(campaign) });
}

async function updateCampaign(req, res) {
  const campaign = await Campaign.findOne({ _id: req.params.id, client: req.client._id });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { name, phase, startDate, endDate, color, status } = req.body;
  if (status && !['planned', 'active', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be planned, active, or completed' });
  }
  if (name !== undefined) campaign.name = name.trim();
  if (phase !== undefined) campaign.phase = phase;
  if (startDate !== undefined) campaign.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) campaign.endDate = endDate ? new Date(endDate) : null;
  if (color !== undefined) campaign.color = color;
  if (status !== undefined) campaign.status = status;
  await campaign.save();
  return res.json({ campaign: serialize(campaign) });
}

async function deleteCampaign(req, res) {
  const campaign = await Campaign.findOne({ _id: req.params.id, client: req.client._id });
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  await campaign.deleteOne();
  return res.status(204).send();
}

module.exports = { listCampaigns, createCampaign, updateCampaign, deleteCampaign };
