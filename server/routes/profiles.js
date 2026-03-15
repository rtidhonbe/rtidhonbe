'use strict';

// ── Profiles routes ────────────────────────────────────────────────────────────
// GET  /api/profiles  — returns the logged-in user's profiles
// POST /api/profiles  — saves the logged-in user's profiles

const router          = require('express').Router();
const { requireAuth } = require('../middleware/session');
const db              = require('../lib/db');

const stmtGet = db.prepare(`SELECT presets, active FROM profiles WHERE email = ?`);
const stmtSet = db.prepare(`
  INSERT INTO profiles (email, presets, active)
  VALUES (?, ?, ?)
  ON CONFLICT (email) DO UPDATE SET presets = excluded.presets, active = excluded.active
`);

// GET /api/profiles
router.get('/', requireAuth, (req, res) => {
  const row = stmtGet.get(req.session.email);
  if (!row) return res.json({ presets: [], active: null });
  res.json({ presets: JSON.parse(row.presets), active: row.active });
});

// POST /api/profiles
router.post('/', requireAuth, (req, res) => {
  const { presets, active } = req.body;
  if (!Array.isArray(presets)) return res.status(400).json({ error: 'Invalid payload' });
  if (presets.length > 20) return res.status(400).json({ error: 'Too many profiles' });

  for (const p of presets) {
    if (typeof p.label !== 'string' || p.label.length === 0 || p.label.length > 10)
      return res.status(400).json({ error: 'Invalid profile label' });
    if (!/^[a-z0-9_-]+$/.test(p.label))
      return res.status(400).json({ error: 'Invalid profile label format' });
    if (typeof p.name !== 'string' || p.name.length === 0 || p.name.replace(/\s/g, '').length > 40)
      return res.status(400).json({ error: 'Invalid full name' });
    if (!/^[a-zA-Z\s'\-.,]+$/.test(p.name))
      return res.status(400).json({ error: 'Invalid full name format' });
    if (typeof p.phone !== 'string' || !/^[0-9]{7}$/.test(p.phone))
      return res.status(400).json({ error: 'Invalid phone number' });
    if (typeof p.currentAddress !== 'string' || p.currentAddress.length === 0 || p.currentAddress.length > 40)
      return res.status(400).json({ error: 'Invalid address' });
  }

  stmtSet.run(req.session.email, JSON.stringify(presets), active || null);
  res.json({ ok: true });
});

module.exports = router;
