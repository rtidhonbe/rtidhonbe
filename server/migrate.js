'use strict';

// ── One-time JSON → SQLite migration ──────────────────────────────────────────
// Run once on the server: node server/migrate.js
// Safe to re-run — uses upserts, won't duplicate data.

const fs   = require('fs');
const path = require('path');
const db   = require('./lib/db');

const PROFILES_JSON = path.join(__dirname, '../data/profiles.json');
const LABELS_JSON   = path.join(__dirname, '../data/request-labels.json');

const stmtProfile = db.prepare(`
  INSERT INTO profiles (email, presets, active)
  VALUES (?, ?, ?)
  ON CONFLICT (email) DO UPDATE SET presets = excluded.presets, active = excluded.active
`);

const stmtLabel = db.prepare(`
  INSERT INTO request_labels (email, request_id, profile_label)
  VALUES (?, ?, ?)
  ON CONFLICT (email, request_id) DO UPDATE SET profile_label = excluded.profile_label
`);

let profileCount = 0;
let labelCount   = 0;

// ── Migrate profiles.json ─────────────────────────────────────────────────────
if (fs.existsSync(PROFILES_JSON)) {
  const all = JSON.parse(fs.readFileSync(PROFILES_JSON, 'utf8'));
  const insert = db.transaction(() => {
    for (const [email, data] of Object.entries(all)) {
      stmtProfile.run(email, JSON.stringify(data.presets || []), data.active || null);
      profileCount++;
    }
  });
  insert();
  console.log(`profiles.json: migrated ${profileCount} user(s)`);
} else {
  console.log('profiles.json: not found, skipping');
}

// ── Migrate request-labels.json ───────────────────────────────────────────────
if (fs.existsSync(LABELS_JSON)) {
  const all = JSON.parse(fs.readFileSync(LABELS_JSON, 'utf8'));
  const insert = db.transaction(() => {
    for (const [email, labels] of Object.entries(all)) {
      for (const [requestId, profileLabel] of Object.entries(labels)) {
        stmtLabel.run(email, requestId, profileLabel);
        labelCount++;
      }
    }
  });
  insert();
  console.log(`request-labels.json: migrated ${labelCount} label(s)`);
} else {
  console.log('request-labels.json: not found, skipping');
}

console.log('\nMigration complete.');
