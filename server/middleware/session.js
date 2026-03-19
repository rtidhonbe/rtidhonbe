'use strict';

// ── Session middleware ────────────────────────────────────────────────────────
// Uses session-file-store so sessions survive server restarts.
// Sessions expire after SESSION_TTL_MS (default: 8 hours).
// rememberMe sessions are extended to 30 days in auth.js.

const session   = require('express-session');
const FileStore = require('session-file-store')(session);
const path      = require('path');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const sessionMiddleware = session({
  name: '__sid',
  store: new FileStore({
    path:   path.join(__dirname, '../../data/sessions'),
    ttl:    30 * 24 * 60 * 60, // max session file lifetime in seconds (30 days)
    reapInterval: 3600,        // clean up expired sessions every hour
  }),
  secret:            process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET environment variable is required'); })(),
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV !== 'development',
    maxAge:   SESSION_TTL_MS,
    sameSite: 'strict',
  },
});

// Route guard — rejects requests that have no active session
function requireAuth(req, res, next) {
  if (req.session?.token) return next();
  res.status(401).json({ error: 'Not logged in' });
}

module.exports = { sessionMiddleware, requireAuth };
