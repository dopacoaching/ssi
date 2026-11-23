const { LibrarySettings, normalize } = require('./schemas');

// Single global doc; auto-created with schema defaults on first read.
// Two concurrent first reads can race on the upsert (E11000 on key) — retry once.
const upsertGlobal = () =>
  LibrarySettings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: {} },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

const get = () =>
  upsertGlobal()
    .catch((err) => (err?.code === 11000 ? upsertGlobal() : Promise.reject(err)))
    .then(normalize);

const update = (data) =>
  LibrarySettings.findOneAndUpdate(
    { key: 'global' },
    { $set: data },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean().then(normalize);

module.exports = { get, update };
