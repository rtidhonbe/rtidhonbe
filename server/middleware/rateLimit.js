'use strict';

// ── Rate limiters ─────────────────────────────────────────────────────────────
// loginLimiter   — prevents brute-force on the login endpoint
// sendLimiter    — caps how many RTIs a user can submit per hour
// apiLimiter     — general guard applied to all /api/* routes

const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,              // 10 login attempts per window
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many login attempts — try again in 15 minutes' },
});

const MAX_SENDS = parseInt(process.env.MAX_SENDS_PER_HOUR || '50', 10);

const sendLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              MAX_SENDS,
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => req.session.id, // session always present — requireAuth runs first
  message:          { error: `Send limit reached — max ${MAX_SENDS} RTIs per hour` },
});

// General API limiter — applied to all /api/* routes to prevent abuse and DoS
const apiLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              300,
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => req.session?.id || req.ip,
  message:          { error: 'Too many requests — slow down' },
});

// Vault write limiter — caps post creation and upvote toggling
const vaultWriteLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              30,              // 30 vault writes per hour
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => req.session?.id || req.ip,
  message:          { error: 'Vault rate limit reached — try again later' },
});

const vaultUpvoteLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              60,              // 60 upvote toggles per hour
  standardHeaders:  true,
  legacyHeaders:    false,
  keyGenerator:     (req) => req.session?.id || req.ip,
  message:          { error: 'Too many upvotes — slow down' },
});

module.exports = { loginLimiter, sendLimiter, apiLimiter, vaultWriteLimiter, vaultUpvoteLimiter };
