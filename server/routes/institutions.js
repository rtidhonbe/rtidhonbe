'use strict';

// ── Institutions route ────────────────────────────────────────────────────────
// GET /api/institutions — returns full list from ICOM
// List is cached in memory for CACHE_TTL_MS to avoid hammering ICOM on every page load

const router               = require('express').Router();
const { fetchInstitutions } = require('../lib/icom');
const { requireAuth }       = require('../middleware/session');

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let cache = { data: null, fetchedAt: 0 };

router.get('/', requireAuth, async (req, res) => {
  try {
    const now = Date.now();

    if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
      return res.json(cache.data);
    }

    const list = await fetchInstitutions(req.session.token);
    cache = { data: list, fetchedAt: now };
    res.json(list);
  } catch (e) {
    console.error('[institutions] fetch failed:', e.response?.data?.message || e.message);
    const status = e.response?.status || 500;
    res.status(status).json({ error: 'Failed to load institutions' });
  }
});

module.exports = router;
