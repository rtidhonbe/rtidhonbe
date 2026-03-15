'use strict';

// ── Submission log ─────────────────────────────────────────────────────────────
// Append-only NDJSON log of successful RTI submissions.
// Stores ONLY: institution name + ISO date. No user data ever written.
// File permissions are set to 600 (owner read/write only) on first write.
//
// Format (one JSON object per line):
//   {"institution":"Ministry of Finance","date":"2026-03-15T08:42:00.000Z"}

const fs   = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../../data/submission-log.ndjson');

function logSubmission(institutionName) {
  if (!institutionName) return;
  const entry = JSON.stringify({ institution: institutionName, date: new Date().toISOString() }) + '\n';
  try {
    fs.appendFileSync(LOG_PATH, entry, 'utf8');
    // Ensure permissions are 600 (owner only) every write — cheap on Linux
    fs.chmodSync(LOG_PATH, 0o600);
  } catch (e) {
    // Log errors must never crash the app
    console.error('[submissionLog] write error:', e.message);
  }
}

module.exports = { logSubmission };
