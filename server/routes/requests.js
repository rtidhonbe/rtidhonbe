'use strict';

const router               = require('express').Router();
const { fetchMyRequests }  = require('../lib/icom');
const { requireAuth }      = require('../middleware/session');
const { getLabels }        = require('../lib/labelStore');

router.get('/', requireAuth, async (req, res) => {
  try {
    const data   = await fetchMyRequests(req.session.token);
    const labels = getLabels(req.session.email);
    const tagged = data.map(r => {
      const id = r._id || r.id;
      return id && labels[String(id)] ? { ...r, profileLabel: labels[String(id)] } : r;
    });
    res.json(tagged);
  } catch (e) {
    console.error('[requests] fetch failed:', e.response?.data?.message || e.message);
    const status = e.response?.status || 500;
    res.status(status).json({ error: 'Failed to load requests' });
  }
});

module.exports = router;
