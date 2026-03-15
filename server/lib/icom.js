'use strict';

// ── ICOM API client factory ───────────────────────────────────────────────────
// Each call to makeClient() returns a fresh axios instance.
// Pass a token to authenticate as a specific user.
// All outbound requests are routed through PROXY_URL if set (e.g. Tor SOCKS5).

const axios = require('axios');

const BASE_URL = 'https://icom.mv/api/v1';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Accept':       'application/json, text/plain, */*',
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin':       'https://icom.mv',
  'Referer':      'https://icom.mv/portal/request',
};

function makeClient(token = null) {
  const cfg = {
    baseURL:  BASE_URL,
    timeout:  30_000,
    headers:  { ...BASE_HEADERS },
  };

  // Route through proxy (Tor or HTTP) if configured
  const proxyUrl = process.env.PROXY_URL;
  if (proxyUrl) {
    if (proxyUrl.startsWith('socks')) {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      const agent = new SocksProxyAgent(proxyUrl);
      cfg.httpsAgent = agent;
      cfg.httpAgent  = agent;
    } else {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      cfg.httpsAgent = new HttpsProxyAgent(proxyUrl);
    }
    cfg.proxy = false; // tell axios not to use env-level proxy
  }

  const client = axios.create(cfg);

  if (token) {
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  return client;
}

// Login with ICOM credentials, returns the JWT token string
async function icomLogin(email, password) {
  const client = makeClient();
  try {
    const res   = await client.post('/auth/login', { email, password });
    const body  = res.data;
    const token = body?.data?.token ?? body?.token ?? body?.data?.data?.token;
    if (!token) throw new Error('email or password is incorrect');
    return token;
  } catch (e) {
    if (e.response) throw new Error('email or password is incorrect');
    throw e;
  }
}

// Fetch full institution list (no auth required)
async function fetchInstitutions(token) {
  const client = makeClient(token);
  const res    = await client.get('/institutions');
  return res.data?.data ?? res.data;
}

// Submit a single RTI request
async function submitRTI(token, payload) {
  const client = makeClient(token);
  const res    = await client.post('/requests', payload);
  return res.data;
}

// Fetch the user's own submitted requests (paginated, returns all)
async function fetchMyRequests(token) {
  const client = makeClient(token);
  const LIMIT  = 50;
  let all      = [];
  let page     = 0;

  while (true) {
    const res   = await client.get('/requests', { params: { page, limit: LIMIT, sortBy: 'createdDate', sortDesc: 1 } });
    const body  = res.data;
    const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    const total = body?.total ?? body?.totalDocs ?? null;

    all = all.concat(items);
    if (total !== null ? all.length >= total : items.length < LIMIT) break;
    page++;
  }

  return all;
}

module.exports = { makeClient, icomLogin, fetchInstitutions, submitRTI, fetchMyRequests };
