'use strict';

// ── Auth routes ───────────────────────────────────────────────────────────────
// POST /api/auth/login   — takes ICOM credentials, gets token, stores in session
// POST /api/auth/logout  — destroys session
// GET  /api/auth/me      — returns current session user info

const router          = require('express').Router();
const { icomLogin }   = require('../lib/icom');
const { requireAuth } = require('../middleware/session');
const { loginLimiter } = require('../middleware/rateLimit');

const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const token = await icomLogin(email.trim(), password);
    const remember = !!rememberMe;
    const hadBeta = !!req.session.betaAccess;

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });

      req.session.token = token;
      req.session.email = email.trim();
      if (hadBeta) req.session.betaAccess = true;

      if (remember) {
        req.session.cookie.maxAge = REMEMBER_TTL_MS;
      }

      res.json({ ok: true });
    });
  } catch (e) {
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('__sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me — used by frontend to check if session is still alive
router.get('/me', requireAuth, (req, res) => {
  res.json({ email: req.session.email });
});

module.exports = router;
