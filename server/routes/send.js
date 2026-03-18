'use strict';

// ── Send route ────────────────────────────────────────────────────────────────
// POST /api/send — submits RTIs in bulk, streams progress back as NDJSON
//
// Request body:
//   payloads: Array<{ institutionId, details, dryRun }>
//
// Response: chunked NDJSON, one JSON object per line:
//   { type: 'result', name, success, dryRun, error? }

const router                             = require('express').Router();
const { fetchInstitutions, submitRTI }   = require('../lib/icom');
const { requireAuth }                    = require('../middleware/session');
const { sendLimiter }                    = require('../middleware/rateLimit');
const { storeLabel }                     = require('../lib/labelStore');
const { logSubmission }                  = require('../lib/submissionLog');

const DELAY_MIN = parseInt(process.env.DELAY_MIN_MS || '4000', 10);
const DELAY_MAX = parseInt(process.env.DELAY_MAX_MS || '9000', 10);

const sleep       = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = () => sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));

router.post('/', requireAuth, sendLimiter, async (req, res) => {
  const { payloads } = req.body;

  if (!Array.isArray(payloads) || payloads.length === 0) {
    return res.status(400).json({ error: 'No payloads provided' });
  }

  // Fetch institution list to resolve IDs → names (before streaming, so we can return JSON errors)
  let institutions;
  try {
    institutions = await fetchInstitutions(req.session.token);
  } catch (e) {
    return res.status(502).json({ error: 'Failed to fetch institutions' });
  }

  if (payloads.length > institutions.length) {
    return res.status(400).json({ error: `Too many payloads (max ${institutions.length})` });
  }

  // Stream NDJSON back so the frontend can show live progress
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  for (let i = 0; i < payloads.length; i++) {
    let { institutionId, applicant, details, dryRun } = payloads[i];

    // Validate details field
    if (typeof details !== 'string' || !details.trim()) {
      res.write(JSON.stringify({ type: 'result', name: institutionId, success: false, error: 'RTI message is required', dryRun }) + '\n');
      continue;
    }
    details = details.trim().slice(0, 5000);
    const inst = institutions.find(x => x._id === institutionId);

    if (!inst) {
      res.write(JSON.stringify({ type: 'result', name: institutionId, success: false, error: 'Institution not found', dryRun }) + '\n');
      continue;
    }

    if (dryRun) {
      res.write(JSON.stringify({ type: 'result', name: inst.name, success: true, dryRun: true }) + '\n');
      continue;
    }

    // Validate applicant fields
    const aName = String(applicant?.name || '').trim();
    const aPhone = String(applicant?.phone || '').trim();
    const aAddr = String(applicant?.currentAddress || '').trim();
    if (!aName || aName.length > 50) {
      res.write(JSON.stringify({ type: 'result', name: inst.name, success: false, error: 'Invalid name (1-50 characters)', dryRun }) + '\n');
      continue;
    }
    if (!aPhone || !/^\d{7}$/.test(aPhone)) {
      res.write(JSON.stringify({ type: 'result', name: inst.name, success: false, error: 'Invalid phone (7 digits)', dryRun }) + '\n');
      continue;
    }
    if (!aAddr || aAddr.length > 200) {
      res.write(JSON.stringify({ type: 'result', name: inst.name, success: false, error: 'Invalid address (1-200 characters)', dryRun }) + '\n');
      continue;
    }
    const aLabel = applicant?.label ? String(applicant.label).trim() : '';
    if (aLabel && !/^[a-z0-9_-]+$/.test(aLabel)) {
      res.write(JSON.stringify({ type: 'result', name: inst.name, success: false, error: 'Invalid label', dryRun }) + '\n');
      continue;
    }

    const payload = {
      language:         'en',
      delivery:         'digital copy',
      name:             aName,
      nameDv:           '',
      email:            req.session.email,
      phone:            aPhone,
      nationality:      'Maldivian',
      legalId:          '',
      currentAddress:   aAddr,
      permanentAddress: '',
      institution: {
        _id:    inst._id,
        name:   inst.name,
        nameDv: inst.nameDv || inst.name,
      },
      details,
      agree: true,
    };

    try {
      const result  = await submitRTI(req.session.token, payload);
      const reqId   = result?.data?._id || result?._id;
      if (reqId && aLabel) storeLabel(req.session.email, reqId, aLabel);
      logSubmission(inst.name);
      res.write(JSON.stringify({ type: 'result', name: inst.name, success: true, dryRun: false }) + '\n');
    } catch (e) {
      console.error(`[send] RTI failed for ${inst.name}:`, e.response?.data?.message || e.message);
      res.write(JSON.stringify({ type: 'result', name: inst.name, success: false, error: 'Submission failed', dryRun: false }) + '\n');
    }

    if (i < payloads.length - 1) await randomDelay();
  }

  res.end();
});

module.exports = router;
