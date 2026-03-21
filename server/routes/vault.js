'use strict';

const { Router } = require('express');
const crypto     = require('crypto');
const path       = require('path');
const fs         = require('fs');
const db         = require('../lib/db');
const { requireAuth } = require('../middleware/session');
const { vaultWriteLimiter, vaultUpvoteLimiter } = require('../middleware/rateLimit');
const { containsProfanity } = require('../lib/profanity');

const MAX_POSTS_PER_USER = 300;

// ── Institution → flair lookup (loaded once at startup) ─────────────────────
const instFlairMap = new Map(); // institution name (lowercase) → Set of flair strings
try {
  const csvPath = path.join(__dirname, '../../institutions.csv');
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const parts = line.split(',');
    const name = (parts[0] || '').trim().toLowerCase();
    if (!name) continue;
    const flairs = new Set();
    if (parts[1]?.trim()) flairs.add(parts[1].trim());
    if (parts[2]?.trim()) flairs.add(parts[2].trim());
    if (flairs.size) instFlairMap.set(name, flairs);
  }
} catch (e) {
  console.warn('[vault] Could not load institutions.csv for flairs:', e.message);
}

// Get deduplicated flairs for a single post
function getPostFlairs(postId) {
  const rows = db.prepare('SELECT institution FROM vault_post_requests WHERE post_id = ?').all(postId);
  const seen = new Set();
  for (const r of rows) {
    const flairs = instFlairMap.get((r.institution || '').toLowerCase());
    if (flairs) flairs.forEach(f => seen.add(f));
  }
  return [...seen].sort();
}

// Batch-fetch flairs for multiple posts in one query
function batchPostFlairs(postIds) {
  if (!postIds.length) return new Map();
  const placeholders = postIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT post_id, institution FROM vault_post_requests WHERE post_id IN (${placeholders})`).all(...postIds);
  const flairMap = new Map();
  for (const r of rows) {
    const flairs = instFlairMap.get((r.institution || '').toLowerCase());
    if (flairs) {
      if (!flairMap.has(r.post_id)) flairMap.set(r.post_id, new Set());
      flairs.forEach(f => flairMap.get(r.post_id).add(f));
    }
  }
  const result = new Map();
  for (const [pid, fset] of flairMap) result.set(pid, [...fset].sort());
  return result;
}

// Validate and sanitize files array — only allow https URLs, max 2048 chars each
function sanitizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map(f => {
      if (typeof f === 'string') return f;
      if (f && typeof f === 'object') return f.url || f.fileUrl || f.link || f.path || '';
      return '';
    })
    .filter(url => typeof url === 'string' && /^https?:\/\//.test(url) && url.length <= 2048)
    .slice(0, 50); // max 50 file URLs per RTI
}

const router = Router();

// ── Resolve display name from display_as preference ─────────────────────────
function resolveDisplayName(email, displayAs, displayProfile) {
  if (displayAs === 'label') {
    const row = db.prepare('SELECT presets, active FROM profiles WHERE email = ?').get(email);
    if (row) {
      try {
        const presets = JSON.parse(row.presets || '[]');
        const chosen = displayProfile
          ? presets.find(p => p.label === displayProfile)
          : null;
        const active = chosen || presets.find(p => p.label === row.active) || presets[0];
        if (active) {
          const tag = active.tag ? `#${active.tag}` : '';
          return (active.label + tag) || 'anonymous';
        }
      } catch { /* fall through */ }
    }
    return 'anonymous';
  }
  return 'anonymous';
}

// ── Public: list vault posts (sorted by upvotes desc, then newest) ───────────
router.get('/', (req, res) => {
  const sort = req.query.sort === 'new' ? 'created_at DESC' : 'upvotes DESC, created_at DESC';

  const timeMap = {
    today: "created_at >= datetime('now', '-1 day')",
    week:  "created_at >= datetime('now', '-7 days')",
    month: "created_at >= datetime('now', '-1 month')",
    year:  "created_at >= datetime('now', '-1 year')",
  };
  const timeFilter = timeMap[req.query.time] || '';
  const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  // Flair filter — find institution names that belong to selected flair categories
  const flairParam = typeof req.query.flairs === 'string' ? req.query.flairs.trim() : '';
  const selectedFlairs = flairParam ? flairParam.split(',').map(f => f.trim().toLowerCase()).filter(Boolean) : [];

  const conditions = [];
  const params = [];
  if (timeFilter) conditions.push(timeFilter);
  if (searchQuery) {
    conditions.push(`(vault_posts.title LIKE ? OR vault_posts.description LIKE ? OR vault_posts.id IN (SELECT post_id FROM vault_post_requests WHERE institution LIKE ? OR details LIKE ? OR remarks LIKE ?))`);
    const like = `%${searchQuery}%`;
    params.push(like, like, like, like, like);
  }
  if (selectedFlairs.length) {
    // Find all institution names matching selected flairs
    const matchingInsts = [];
    for (const [instName, flairs] of instFlairMap) {
      for (const f of flairs) {
        if (selectedFlairs.includes(f.toLowerCase())) { matchingInsts.push(instName); break; }
      }
    }
    if (matchingInsts.length) {
      const placeholders = matchingInsts.map(() => '?').join(',');
      conditions.push(`vault_posts.id IN (SELECT post_id FROM vault_post_requests WHERE LOWER(institution) IN (${placeholders}))`);
      params.push(...matchingInsts);
    } else {
      // No institutions match these flairs — return empty
      return res.json([]);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const posts = db.prepare(`
    SELECT id, title, description, email, display_as, display_profile, created_at, upvotes,
      (SELECT COUNT(*) FROM vault_post_requests WHERE post_id = vault_posts.id) AS rti_count
    FROM vault_posts
    ${where}
    ORDER BY ${sort}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const postIds = posts.map(p => p.id);

  // Batch: votes + flairs
  const votedSet = new Set();
  if (req.session?.email && postIds.length) {
    const placeholders = postIds.map(() => '?').join(',');
    const votes = db.prepare(`SELECT post_id FROM vault_votes WHERE email = ? AND post_id IN (${placeholders})`).all(req.session.email, ...postIds);
    votes.forEach(v => votedSet.add(v.post_id));
  }

  const flairsMap = batchPostFlairs(postIds);

  const result = posts.map(p => ({
    id: p.id,
    title: p.title,
    description: p.description || '',
    display_name: resolveDisplayName(p.email, p.display_as, p.display_profile),
    created_at: p.created_at,
    upvotes: p.upvotes,
    rti_count: p.rti_count,
    hasVoted: votedSet.has(p.id),
    flairs: flairsMap.get(p.id) || [],
  }));

  res.json(result);
});

// ── Auth: list own posts ──────────────────────────────────────────────────
router.get('/mine', requireAuth, (req, res) => {
  const posts = db.prepare(`
    SELECT id, title, description, display_as, display_profile, created_at, upvotes,
      (SELECT COUNT(*) FROM vault_post_requests WHERE post_id = vault_posts.id) AS rti_count
    FROM vault_posts
    WHERE email = ?
    ORDER BY created_at DESC
  `).all(req.session.email);

  const postIds = posts.map(p => p.id);
  const flairsMap = batchPostFlairs(postIds);

  const result = posts.map(p => ({
    id: p.id,
    title: p.title,
    description: p.description || '',
    display_name: resolveDisplayName(req.session.email, p.display_as, p.display_profile),
    created_at: p.created_at,
    upvotes: p.upvotes,
    rti_count: p.rti_count,
    flairs: flairsMap.get(p.id) || [],
  }));

  res.json(result);
});

// ── Public: view single post with its RTIs ──────────────────────────────────
router.get('/:id', (req, res) => {
  const post = db.prepare('SELECT id, title, description, email, display_as, display_profile, created_at, upvotes FROM vault_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const requests = db.prepare('SELECT institution, details, status, files, created_date, remarks FROM vault_post_requests WHERE post_id = ? ORDER BY id').all(post.id);

  // Parse files JSON
  const parsed = requests.map(r => ({
    institution: r.institution,
    details: r.details,
    status: r.status,
    files: (() => { try { return JSON.parse(r.files); } catch { return []; } })(),
    created_date: r.created_date,
    remarks: r.remarks,
  }));

  // Check if current user has upvoted
  let hasVoted = false;
  if (req.session?.email) {
    hasVoted = !!db.prepare('SELECT 1 FROM vault_votes WHERE post_id = ? AND email = ?').get(post.id, req.session.email);
  }

  res.json({
    id: post.id,
    title: post.title,
    description: post.description || '',
    display_name: resolveDisplayName(post.email, post.display_as, post.display_profile),
    created_at: post.created_at,
    upvotes: post.upvotes,
    requests: parsed,
    hasVoted,
    flairs: getPostFlairs(post.id),
  });
});

// ── Auth: update own post (add RTIs, edit title/desc within 1hr) ────────
router.put('/:id', requireAuth, vaultWriteLimiter, (req, res) => {
  const post = db.prepare('SELECT id, email, created_at FROM vault_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.email !== req.session.email) return res.status(403).json({ error: 'Not your post' });

  const { title, description, addRequests } = req.body;

  // Check if within 1 hour for title/desc edits
  const createdAt = new Date(post.created_at + (post.created_at.includes('Z') ? '' : 'Z'));
  const withinHour = (Date.now() - createdAt.getTime()) < 3600000;

  // Profanity check on edits
  const editRemarks = Array.isArray(addRequests) ? addRequests.map(r => r.remarks || '') : [];
  if (containsProfanity(title, description, ...editRemarks)) {
    return res.status(400).json({ error: 'Post contains inappropriate language' });
  }

  const updates = [];
  const params = [];

  if (title !== undefined) {
    if (!withinHour) return res.status(400).json({ error: 'Title can only be edited within 1 hour of posting' });
    if (typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 70) {
      return res.status(400).json({ error: 'Invalid title' });
    }
    updates.push('title = ?');
    params.push(title.trim());
  }

  if (description !== undefined) {
    if (!withinHour) return res.status(400).json({ error: 'Description can only be edited within 1 hour of posting' });
    const safeDesc = typeof description === 'string' ? description.trim().slice(0, 600) : '';
    if (safeDesc.replace(/\s/g, '').length > 500) {
      return res.status(400).json({ error: 'Description too long (max 500 characters excluding spaces)' });
    }
    updates.push('description = ?');
    params.push(safeDesc);
  }

  if (updates.length) {
    params.push(post.id);
    db.prepare(`UPDATE vault_posts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  // Add new RTIs (cannot remove existing ones)
  if (Array.isArray(addRequests) && addRequests.length > 0) {
    const existingCount = db.prepare('SELECT COUNT(*) AS c FROM vault_post_requests WHERE post_id = ?').get(post.id).c;
    if (existingCount + addRequests.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 requests per post' });
    }

    const insertReq = db.prepare('INSERT INTO vault_post_requests (post_id, request_id, institution, details, status, files, created_date, is_display, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const tx = db.transaction(() => {
      for (const r of addRequests) {
        insertReq.run(
          post.id,
          String(r.requestId || ''),
          String(r.institution || ''),
          String(r.details || '').slice(0, 5000),
          String(r.status || ''),
          JSON.stringify(sanitizeFiles(r.files)),
          String(r.createdDate || ''),
          0,
          String(r.remarks || '').slice(0, 100),
        );
      }
    });
    tx();
  }

  res.json({ ok: true });
});

// ── Auth: create vault post ─────────────────────────────────────────────────
router.post('/', requireAuth, vaultWriteLimiter, (req, res) => {
  // Per-user post cap
  const userPostCount = db.prepare('SELECT COUNT(*) AS c FROM vault_posts WHERE email = ?').get(req.session.email).c;
  if (userPostCount >= MAX_POSTS_PER_USER) {
    return res.status(400).json({ error: `Maximum ${MAX_POSTS_PER_USER} posts per user` });
  }

  const { title, description, requests, displayAs, displayProfile } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length === 0 || title.trim().length > 70) {
    return res.status(400).json({ error: 'Title is required (max 200 characters)' });
  }

  const safeDesc = typeof description === 'string' ? description.trim().slice(0, 600) : '';
  // Validate: max 500 chars excluding spaces
  if (safeDesc.replace(/\s/g, '').length > 500) {
    return res.status(400).json({ error: 'Description too long (max 500 characters excluding spaces)' });
  }
  if (!Array.isArray(requests) || requests.length === 0) {
    return res.status(400).json({ error: 'At least one RTI request is required' });
  }
  if (requests.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 requests per post' });
  }

  // Profanity check on title, description, and remarks
  const allRemarks = requests.map(r => r.remarks || '');
  if (containsProfanity(title, description, ...allRemarks)) {
    return res.status(400).json({ error: 'Post contains inappropriate language' });
  }

  const validDisplayAs = ['anonymous', 'label'];
  const safeDisplayAs = validDisplayAs.includes(displayAs) ? displayAs : 'anonymous';

  const id = crypto.randomBytes(8).toString('hex');
  const email = req.session.email;

  // Validate displayProfile against user's actual profiles
  let safeDisplayProfile = null;
  if (safeDisplayAs !== 'anonymous' && typeof displayProfile === 'string') {
    const profRow = db.prepare('SELECT presets FROM profiles WHERE email = ?').get(email);
    if (profRow) {
      try {
        const presets = JSON.parse(profRow.presets || '[]');
        const match = presets.find(p => p.label === displayProfile);
        if (match) safeDisplayProfile = displayProfile.slice(0, 20);
      } catch { /* fall through — keep null */ }
    }
    // If profile not found, force anonymous
    if (!safeDisplayProfile && safeDisplayAs !== 'anonymous') {
      return res.status(400).json({ error: 'Selected profile not found' });
    }
  }

  const insertPost = db.prepare('INSERT INTO vault_posts (id, email, title, description, display_as, display_profile) VALUES (?, ?, ?, ?, ?, ?)');
  const insertReq  = db.prepare('INSERT INTO vault_post_requests (post_id, request_id, institution, details, status, files, created_date, is_display, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

  const tx = db.transaction(() => {
    insertPost.run(id, email, title.trim(), safeDesc, safeDisplayAs, safeDisplayProfile);
    for (const r of requests) {
      insertReq.run(
        id,
        String(r.requestId || ''),
        String(r.institution || ''),
        String(r.details || '').slice(0, 5000),
        String(r.status || ''),
        JSON.stringify(sanitizeFiles(r.files)),
        String(r.createdDate || ''),
        0,
        String(r.remarks || '').slice(0, 100),
      );
    }
  });
  tx();

  res.json({ id });
});

// ── Auth: upvote a post ─────────────────────────────────────────────────────
const toggleVote = db.transaction((postId, email) => {
  const existing = db.prepare('SELECT 1 FROM vault_votes WHERE post_id = ? AND email = ?').get(postId, email);
  if (existing) {
    db.prepare('DELETE FROM vault_votes WHERE post_id = ? AND email = ?').run(postId, email);
    db.prepare('UPDATE vault_posts SET upvotes = MAX(upvotes - 1, 0) WHERE id = ?').run(postId);
    return { upvotes: db.prepare('SELECT upvotes FROM vault_posts WHERE id = ?').get(postId).upvotes, hasVoted: false };
  }
  db.prepare('INSERT INTO vault_votes (post_id, email) VALUES (?, ?)').run(postId, email);
  db.prepare('UPDATE vault_posts SET upvotes = upvotes + 1 WHERE id = ?').run(postId);
  return { upvotes: db.prepare('SELECT upvotes FROM vault_posts WHERE id = ?').get(postId).upvotes, hasVoted: true };
});

router.post('/:id/upvote', requireAuth, vaultUpvoteLimiter, (req, res) => {
  const post = db.prepare('SELECT id FROM vault_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const result = toggleVote(req.params.id, req.session.email);
  res.json(result);
});

// ── Auth: delete own post ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT email FROM vault_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.email !== req.session.email) return res.status(403).json({ error: 'Not your post' });

  db.prepare('DELETE FROM vault_posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
