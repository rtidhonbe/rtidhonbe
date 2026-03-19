'use strict';

require('dotenv').config();

const express  = require('express');
const helmet   = require('helmet');
const path     = require('path');

const { sessionMiddleware }    = require('./middleware/session');
const { apiLimiter } = require('./middleware/rateLimit');

const authRoutes         = require('./routes/auth');
const institutionsRoutes = require('./routes/institutions');
const sendRoutes         = require('./routes/send');
const requestsRoutes     = require('./routes/requests');
const profilesRoutes     = require('./routes/profiles');
const vaultRoutes        = require('./routes/vault');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust nginx proxy — required for secure session cookies to work behind HTTPS
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", "data:"],
      connectSrc:     ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: {
    maxAge:            31536000,
    includeSubDomains: true,
    preload:           true,
  },
}));

// ── Allow cross-origin access to OG image for social media crawlers ──────────
app.use('/og-image.png', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// ── No-cache for API responses ────────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── CSRF: reject cross-origin state-changing requests ─────────────────────────
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return res.status(403).json({ error: 'Forbidden' });
  const host = req.headers.host;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── Sessions (in-memory, no DB) ───────────────────────────────────────────────
app.use(sessionMiddleware);

// ── Beta wall ─────────────────────────────────────────────────────────────────
// To disable: remove BETA_PASSWORD from .env and restart.
if (process.env.BETA_PASSWORD) {
  const BETA_ALLOWED = new Set(['/beta.js', '/login.css', '/vault.css', '/vault.js', '/favicon.png', '/favicon.svg', '/robots.txt', '/og-image.png']);
  const { loginLimiter } = require('./middleware/rateLimit');

  app.get('/beta', (_, res) => res.sendFile(path.join(__dirname, '../public/beta.html')));

  app.post('/beta', loginLimiter, (req, res) => {
    const origin = req.headers.origin;
    if (!origin) return res.status(403).json({ error: 'Forbidden' });
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Forbidden' }); }
    catch { return res.status(403).json({ error: 'Forbidden' }); }

    const { code } = req.body;
    if (!code || code !== process.env.BETA_PASSWORD) {
      return res.status(401).json({ error: 'incorrect access code' });
    }
    req.session.betaAccess = true;
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (req.path === '/beta' || req.path === '/' || req.path === '/faq' || req.path.startsWith('/vault') || req.path.startsWith('/api/') || BETA_ALLOWED.has(req.path)) return next();
    if (req.session?.betaAccess) return next();
    res.redirect('/beta');
  });
}

// ── Redirect logged-in users from landing to home ────────────────────────────
app.get('/', (req, res, next) => { if (req.session?.token) return res.redirect('/home'); next(); });

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/', apiLimiter);
app.use('/api/auth',         authRoutes);
app.use('/api/institutions', institutionsRoutes);
app.use('/api/send',         sendRoutes);
app.use('/api/my-requests',  requestsRoutes);
app.use('/api/profiles',     profilesRoutes);
app.use('/api/vault',        vaultRoutes);

// Auth status check (used by vault to show login/app link)
app.get('/api/auth/status', (req, res) => {
  res.json({ loggedIn: !!req.session?.token, email: req.session?.email || null });
});

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/login',    (req, res) => { if (req.session?.token) return res.redirect('/home'); res.type('html'); res.sendFile(path.join(__dirname, '../public/login.html')); });
app.get('/home',     (req, res) => { if (!req.session?.token) return res.redirect('/login'); res.type('html'); res.sendFile(path.join(__dirname, '../public/app.html')); });
app.get('/profiles', (_, res) => { res.type('html'); res.sendFile(path.join(__dirname, '../public/profile.html')); });

// Vault pages (public)
app.get('/vault',      (_, res) => { res.type('html'); res.sendFile(path.join(__dirname, '../public/vault.html')); });
app.get('/vault/:id',  (_, res) => { res.type('html'); res.sendFile(path.join(__dirname, '../public/vault.html')); });

// FAQ (public)
app.get('/faq', (_, res) => { res.type('html'); res.sendFile(path.join(__dirname, '../public/faq.html')); });

// Redirect old .html URLs
app.get('/login.html',   (_, res) => res.redirect(301, '/login'));
app.get('/app.html',     (_, res) => res.redirect(301, '/home'));
app.get('/profile.html', (_, res) => res.redirect(301, '/profiles'));

// Root — landing page or redirect to app if logged in
app.get('/', (req, res) => {
  if (req.session?.token) return res.redirect('/home');
  res.type('html');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Catch-all — 404 page
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// 4-arg signature required by Express to identify this as an error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const proxyNote = process.env.PROXY_URL ? 'via proxy' : 'direct connection';
  console.log(`\nmahoali-web running on http://localhost:${PORT}`);
  console.log(`Outbound: ${proxyNote}\n`);
});
