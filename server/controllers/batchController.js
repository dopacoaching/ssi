const batchModel = require('../models/batchModel');
const { ok } = require('../views/response');

async function listBatches(req, res) {
  const allBatches = await batchModel.findAll();
  if (req.user.role === 'ADMIN') return ok(res, allBatches);
  const filtered = allBatches.filter((b) => req.user.batchIds.includes(b.id));
  return ok(res, filtered);
}

module.exports = { listBatches };
