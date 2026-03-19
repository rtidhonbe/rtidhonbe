'use strict';

// ── Profiles routes ────────────────────────────────────────────────────────────
// GET  /api/profiles  — returns the logged-in user's profiles
// POST /api/profiles  — saves the logged-in user's profiles

const router          = require('express').Router();
const crypto          = require('crypto');
const { requireAuth } = require('../middleware/session');
const db              = require('../lib/db');

const stmtGet = db.prepare(`SELECT presets, active FROM profiles WHERE email = ?`);
const stmtSet = db.prepare(`
  INSERT INTO profiles (email, presets, active)
  VALUES (?, ?, ?)
  ON CONFLICT (email) DO UPDATE SET presets = excluded.presets, active = excluded.active
`);
// Check if a specific label#tag combo already exists across all users
function tagExists(label, tag) {
  const pattern = `"label":"${label}"%"tag":"${tag}"`;
  const row = db.prepare(`SELECT 1 FROM profiles WHERE presets LIKE ? LIMIT 1`).get(`%${pattern}%`);
  return !!row;
}

// Generate a unique 4-digit tag for a given profile label
function generateTag(label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const tag = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    if (!tagExists(label, tag)) return tag;
  }
  // Fallback: use 5-digit
  return String(crypto.randomInt(10000, 100000));
}

// GET /api/profiles
router.get('/', requireAuth, (req, res) => {
  const row = stmtGet.get(req.session.email);
  if (!row) return res.json({ presets: [], active: null });
  const presets = JSON.parse(row.presets);
  // Backfill tags for profiles created before tag system
  let changed = false;
  for (const p of presets) {
    if (!p.tag) {
      p.tag = generateTag(p.label);
      changed = true;
    }
  }
  if (changed) {
    stmtSet.run(req.session.email, JSON.stringify(presets), row.active);
  }
  res.json({ presets, active: row.active });
});

// POST /api/profiles
router.post('/', requireAuth, (req, res) => {
  const { presets, active } = req.body;
  if (!Array.isArray(presets)) return res.status(400).json({ error: 'Invalid payload' });
  if (presets.length > 10) return res.status(400).json({ error: 'Maximum 10 profiles per account' });

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
    // Validate optional email
    if (p.email !== undefined && p.email !== '') {
      if (typeof p.email !== 'string' || p.email.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
        return res.status(400).json({ error: 'Invalid email format' });
    }

    // Ban reserved profile names
    const lowerLabel = p.label.toLowerCase();
    if (lowerLabel === 'anon' || lowerLabel === 'anonymous' || lowerLabel === 'rtidhonbe')
      return res.status(400).json({ error: 'This profile name is not allowed' });

    // Check for duplicate labels within this account
    const dupes = presets.filter(x => x.label.toLowerCase() === lowerLabel);
    if (dupes.length > 1)
      return res.status(400).json({ error: 'You already have a profile with this name' });

    // Assign tag if not already present
    if (!p.tag) {
      p.tag = generateTag(p.label);
    }
  }

  stmtSet.run(req.session.email, JSON.stringify(presets), active || null);
  res.json({ ok: true });
});

module.exports = router;
