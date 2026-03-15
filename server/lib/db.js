'use strict';

// ── SQLite database ────────────────────────────────────────────────────────────
// Single shared better-sqlite3 instance used by all server modules.
// Database file lives at data/mahoali.db (same directory as old JSON files).

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = path.join(__dirname, '../../data/mahoali.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    email   TEXT PRIMARY KEY,
    presets TEXT NOT NULL DEFAULT '[]',
    active  TEXT
  );

  CREATE TABLE IF NOT EXISTS request_labels (
    email         TEXT NOT NULL,
    request_id    TEXT NOT NULL,
    profile_label TEXT NOT NULL,
    PRIMARY KEY (email, request_id)
  );
`);

module.exports = db;
