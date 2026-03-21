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

  CREATE TABLE IF NOT EXISTS vault_posts (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    title       TEXT NOT NULL,
    display_as  TEXT NOT NULL DEFAULT 'anonymous',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    upvotes     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS vault_post_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id      TEXT NOT NULL REFERENCES vault_posts(id) ON DELETE CASCADE,
    request_id   TEXT NOT NULL,
    institution  TEXT NOT NULL,
    details      TEXT,
    status       TEXT,
    files        TEXT NOT NULL DEFAULT '[]',
    created_date TEXT
  );

  CREATE TABLE IF NOT EXISTS vault_votes (
    post_id     TEXT NOT NULL REFERENCES vault_posts(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    PRIMARY KEY (post_id, email)
  );
`);

// ── Migrations ───────────────────────────────────────────────────────────────
// Add display_as column to vault_posts if it doesn't exist yet
try {
  db.prepare("SELECT display_as FROM vault_posts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE vault_posts ADD COLUMN display_as TEXT NOT NULL DEFAULT 'anonymous'");
}

// Add is_display column to vault_post_requests if it doesn't exist yet
try {
  db.prepare("SELECT is_display FROM vault_post_requests LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE vault_post_requests ADD COLUMN is_display INTEGER NOT NULL DEFAULT 0");
}

// Add remarks column to vault_post_requests if it doesn't exist yet
try {
  db.prepare("SELECT remarks FROM vault_post_requests LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE vault_post_requests ADD COLUMN remarks TEXT NOT NULL DEFAULT ''");
}

// Add description column to vault_posts if it doesn't exist yet
try {
  db.prepare("SELECT description FROM vault_posts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE vault_posts ADD COLUMN description TEXT NOT NULL DEFAULT ''");
}

// Add display_profile column to vault_posts if it doesn't exist yet
try {
  db.prepare("SELECT display_profile FROM vault_posts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE vault_posts ADD COLUMN display_profile TEXT");
}

module.exports = db;
