'use strict';

// ── Request-label store ────────────────────────────────────────────────────────
// Persists a mapping of { email, requestId → profileLabel } so that the
// "Profile" column in My Requests can show which profile alias an RTI was
// filed under, even though ICOM's API doesn't return this information.

const db = require('./db');

const stmtUpsert = db.prepare(`
  INSERT INTO request_labels (email, request_id, profile_label)
  VALUES (?, ?, ?)
  ON CONFLICT (email, request_id) DO UPDATE SET profile_label = excluded.profile_label
`);

const stmtGetAll = db.prepare(`
  SELECT request_id, profile_label FROM request_labels WHERE email = ?
`);

function storeLabel(email, requestId, profileLabel) {
  if (!email || !requestId || !profileLabel) return;
  stmtUpsert.run(email, String(requestId), profileLabel);
}

function getLabels(email) {
  if (!email) return {};
  const rows = stmtGetAll.all(email);
  return Object.fromEntries(rows.map(r => [r.request_id, r.profile_label]));
}

module.exports = { storeLabel, getLabels };
