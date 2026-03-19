'use strict';

const $ = id => document.getElementById(id);

let currentSort = 'new';
let currentTime = 'today';
let isLoggedIn  = false;
let cachedRtis  = null;
let rtiLoadPromise = null;
let cachedProfile = null;
let profileLoadPromise = null;
let selectedRtis = new Set();
let displayAs = 'anonymous'; // 'anonymous' or 'label'
let selectedFlairs = new Set();

// Flair color map (must match vault.css flair classes)
const FLAIR_COLORS = {
  'Council': '#2d5a8e', 'Court': '#4a4b8a', 'Government': '#4a5568',
  'Healthcare': '#1a6b4a', 'Independent Institution': '#8a6d2b',
  'Ministry': '#8b3232', 'NGO': '#1a6b5a', 'Other': '#3a3f47',
  'Parliament': '#1a2e45', 'Political Party': '#7a3460',
  'SOE': '#5a3d8a', 'School': '#1a2e52',
};
const FLAIR_TEXT = {
  'Council': '#c5d8ed', 'Court': '#c8c9e8', 'Government': '#b8c2cc',
  'Healthcare': '#b0dbc8', 'Independent Institution': '#e4d5a8',
  'Ministry': '#e4b5b5', 'NGO': '#b0d8cc', 'Other': '#a0a8b2',
  'Parliament': '#99b3cc', 'Political Party': '#dbb5cc',
  'SOE': '#c4b3e0', 'School': '#99adc8',
};
const ALL_FLAIRS = Object.keys(FLAIR_COLORS).sort();

// ── Flair pill helper ────────────────────────────────────────────────────────
function renderFlairs(flairs) {
  if (!flairs || !flairs.length) return '';
  return '<div class="flair-row">' + flairs.map(f => {
    const cls = 'flair-' + f.toLowerCase().replace(/\s+/g, '-');
    return `<span class="flair-pill ${esc(cls)}">${esc(f)}</span>`;
  }).join('') + '</div>';
}

// ── Load vault posts ────────────────────────────────────────────────────────
async function loadVault(sort, time) {
  currentSort = sort || 'top';
  if (currentSort === 'top') currentTime = time || 'today';
  let url = `/api/vault?sort=${currentSort}`;
  if (currentSort === 'top' && currentTime !== 'all') url += `&time=${currentTime}`;
  if (currentSearchQuery) url += `&q=${encodeURIComponent(currentSearchQuery)}`;
  if (selectedFlairs.size) url += `&flairs=${encodeURIComponent([...selectedFlairs].join(','))}`;
  const res = await fetch(url);
  if (!res.ok) return;
  const posts = await res.json();

  const list = $('vault-list');
  if (posts.length === 0) {
    list.innerHTML = '<div class="vault-empty">no posts yet</div>';
    return;
  }

  list.innerHTML = posts.map(p => {
    const desc = p.description || '';
    const authorLabel = formatAuthorLabel(p.display_name);
    return `
    <div class="vault-row" data-id="${esc(p.id)}">
      <div class="vault-row-top">
        <span class="vault-row-author">${esc(authorLabel)}</span>
        <span class="vault-row-dot">•</span>
        <span class="vault-row-time">${timeAgo(p.created_at)}</span>
      </div>
      <div class="vault-row-title">${esc(p.title)}</div>
      ${desc ? `<div class="vault-row-body">${esc(desc)}</div>` : ''}
      ${renderFlairs(p.flairs)}
      <div class="vault-row-footer">
        <button class="pill-btn heart-btn${p.hasVoted ? ' hearted' : ''}" data-post-id="${esc(p.id)}" title="heart">
          ${heartSvg(p.hasVoted)}
          <span class="heart-count">${p.upvotes}</span>
        </button>
        <div class="share-wrapper">
          <button class="pill-btn share-btn" data-post-id="${esc(p.id)}" title="share">
            ${shareSvg}
            <span class="share-label">Share</span>
          </button>
          <div class="share-dropdown">
            <button class="share-dropdown-item" data-copy-id="${esc(p.id)}">Copy link</button>
          </div>
        </div>
      </div>
    </div>
  `;
  }).join('');

  // Attach event listeners (no inline onclick — CSP safe)
  list.querySelectorAll('.vault-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't navigate if clicking footer buttons
      if (e.target.closest('.heart-btn') || e.target.closest('.share-wrapper')) return;
      viewPost(row.dataset.id);
    });
  });

  list.querySelectorAll('.heart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      heart(btn.dataset.postId, btn);
    });
  });

  list.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sharePost(btn.dataset.postId, btn);
    });
  });

  list.querySelectorAll('.share-dropdown-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyLink(btn.dataset.copyId);
    });
  });
}

// ── Heart (upvote) from list ────────────────────────────────────────────────
async function heart(postId, btn) {
  const res = await fetch(`/api/vault/${postId}/upvote`, { method: 'POST' });
  if (res.status === 401) {
    window.location.href = '/login';
    return;
  }
  if (!res.ok) return;
  const data = await res.json();
  btn.querySelector('.heart-count').textContent = data.upvotes;
  btn.querySelector('svg').outerHTML = heartSvg(data.hasVoted);
  btn.classList.toggle('hearted', data.hasVoted);
}

// ── Share ────────────────────────────────────────────────────────────────────
function sharePost(postId, btn) {
  const url = `${window.location.origin}/vault/${postId}`;

  // Mobile only: use native share (check for touch + small screen)
  const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
  if (isMobile && navigator.share) {
    navigator.share({ title: 'Vault Post', url }).catch(() => {});
    return;
  }

  // Desktop: toggle dropdown
  const wrapper = btn.closest('.share-wrapper');
  const dropdown = wrapper.querySelector('.share-dropdown');
  const isOpen = dropdown.classList.contains('open');
  closeAllShareDropdowns();
  if (!isOpen) dropdown.classList.add('open');
}

function copyLink(postId) {
  const url = `${window.location.origin}/vault/${postId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied');
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Link copied');
  });
  closeAllShareDropdowns();
}

function closeAllShareDropdowns() {
  document.querySelectorAll('.share-dropdown').forEach(d => d.classList.remove('open'));
}

function showToast(msg) {
  const toast = $('vault-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ── View single post ────────────────────────────────────────────────────────
async function viewPost(id) {
  const res = await fetch(`/api/vault/${id}`);
  if (!res.ok) {
    alert('Post not found');
    return;
  }
  const post = await res.json();

  $('vault-index').style.display = 'none';
  $('vault-sort-bar').style.display = 'none';
  $('vault-post').style.display = '';

  $('post-author').textContent = formatAuthorLabel(post.display_name);
  $('post-date').textContent = timeAgo(post.created_at);
  $('post-title').textContent = post.title;
  $('post-description').textContent = post.description || '';
  $('post-flairs').innerHTML = renderFlairs(post.flairs);

  // Heart button
  const heartBtn = $('post-heart-btn');
  const heartCount = $('post-heart-count');
  heartBtn.querySelector('svg').outerHTML = heartSvg(post.hasVoted);
  heartCount.textContent = post.upvotes;
  heartBtn.classList.toggle('hearted', post.hasVoted);
  heartBtn.onclick = async () => {
    const r = await fetch(`/api/vault/${id}/upvote`, { method: 'POST' });
    if (r.status === 401) { window.location.href = '/login'; return; }
    if (!r.ok) return;
    const d = await r.json();
    heartBtn.querySelector('svg').outerHTML = heartSvg(d.hasVoted);
    heartCount.textContent = d.upvotes;
    heartBtn.classList.toggle('hearted', d.hasVoted);
  };

  // Share button (single post)
  $('post-share-btn').onclick = () => {
    const url = `${window.location.origin}/vault/${id}`;
    const isMobile = 'ontouchstart' in window && window.innerWidth < 768;
    if (isMobile && navigator.share) {
      navigator.share({ title: post.title, url }).catch(() => {});
      return;
    }
    const dropdown = $('post-share-dropdown');
    const isOpen = dropdown.classList.contains('open');
    closeAllShareDropdowns();
    if (!isOpen) dropdown.classList.add('open');
  };
  $('post-copy-link').onclick = (e) => {
    e.stopPropagation();
    copyLink(id);
  };

  const reqsDiv = $('post-requests');
  if (post.requests.length === 0) {
    reqsDiv.innerHTML = '<div class="vault-empty">no RTIs attached</div>';
  } else {
    const totalRtis = post.requests.length;

    // Build table 1:1 with My RTIs layout (same classes, same structure)
    const wrap = document.createElement('div');
    wrap.className = 'req-table-wrap';

    const table = document.createElement('table');
    table.className = 'req-table';
    table.innerHTML = `
      <thead><tr>
        <th style="width:36px;color:var(--text-dim);text-align:right;padding-right:6px">#</th>
        <th style="width:36px"></th>
        <th>Institution</th>
        <th><span class="th-long">Date Submitted</span><span class="th-short" style="display:none">Date</span></th>
        <th>Remarks</th>
      </tr></thead>
    `;

    const tbody = document.createElement('tbody');

    post.requests.forEach((r, i) => {
      const seqNum = i + 1;
      const dateStr = r.created_date ? formatDate(r.created_date) : '—';
      const remarksStr = r.remarks || '—';
      const docFiles = (r.files || []).filter(f => {
        const url = typeof f === 'string' ? f : (f.url || f.fileUrl || f.link || f.path || '');
        return /^https?:\/\//i.test(url);
      });

      const dataRow = document.createElement('tr');
      dataRow.className = 'data-row';
      dataRow.innerHTML = `
        <td style="color:var(--text-dim);font-size:11px;text-align:right;padding-right:6px">${seqNum}</td>
        <td><button class="expand-chevron" aria-label="Toggle details"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button></td>
        <td>${esc(r.institution)}</td>
        <td>${dateStr}</td>
        <td>${esc(remarksStr)}</td>
      `;

      const detailRow = document.createElement('tr');
      detailRow.className = 'detail-row';
      detailRow.id = `post-detail-${i}`;

      let docsHtml = '';
      if (docFiles.length) {
        docsHtml = `<div class="doc-links">
          <div class="doc-link-label">documents</div>
          ${docFiles.map(f => {
            const url = typeof f === 'string' ? f : (f.url || f.fileUrl || f.link || f.path || '');
            const name = typeof f === 'string' ? url.split('/').pop() : (f.name || f.originalname || f.fileName || url.split('/').pop());
            return `<a class="doc-link-item" href="${esc(url)}" target="_blank" rel="noopener noreferrer">&#128196; ${esc(name)}</a>`;
          }).join('')}
        </div>`;
      }

      detailRow.innerHTML = `
        <td colspan="5">
          <div class="detail-inner">
            <div class="detail-label">rti message</div>
            ${r.details
              ? `<div class="detail-text">${esc(r.details)}</div>`
              : `<div class="detail-no-msg">no message content available.</div>`}
            ${docsHtml}
          </div>
        </td>
      `;

      dataRow.addEventListener('click', () => {
        const isOpen = detailRow.classList.contains('show');
        detailRow.classList.toggle('show', !isOpen);
        dataRow.classList.toggle('expanded', !isOpen);
        dataRow.querySelector('.expand-chevron').classList.toggle('open', !isOpen);
      });

      tbody.appendChild(dataRow);
      tbody.appendChild(detailRow);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    reqsDiv.innerHTML = '';
    reqsDiv.appendChild(wrap);
  }

  history.pushState(null, '', `/vault/${id}`);
}

// ── Back to list ────────────────────────────────────────────────────────────
$('post-back').addEventListener('click', (e) => {
  e.preventDefault();
  $('vault-post').style.display = 'none';
  $('vault-sort-bar').style.display = '';
  $('vault-index').style.display = '';
  history.pushState(null, '', '/vault');
  // Load posts if list is empty (e.g. direct link to post page)
  if (!$('vault-list').children.length) loadVault(currentSort, currentTime);
});

// ── Vault auth header handlers ───────────────────────────────────────────────
document.getElementById('vault-logo-auth')?.addEventListener('click', () => {
  window.location.href = '/home';
});
document.getElementById('vault-logout-btn')?.addEventListener('click', () => {
  fetch('/api/auth/logout', { method: 'POST' }).then(() => {
    window.location.href = '/login';
  });
});

// ── Sort dropdowns ──────────────────────────────────────────────────────────
function toggleDropdown(toggleBtn, menu) {
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    menu.classList.add('open');
    toggleBtn.classList.add('open');
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.sort-menu').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.sort-toggle').forEach(t => t.classList.remove('open'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.sort-dropdown')) closeAllDropdowns();
  if (!e.target.closest('.share-wrapper')) closeAllShareDropdowns();
});

// Sort dropdown (TOP / NEW)
$('sort-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown($('sort-toggle'), $('sort-menu'));
});

$('sort-menu').querySelectorAll('.sort-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    const sort = opt.dataset.sort;
    $('sort-menu').querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    $('sort-toggle').innerHTML = `${opt.textContent} <span class="chevron">▾</span>`;
    $('time-dropdown').style.display = sort === 'top' ? '' : 'none';
    closeAllDropdowns();
    loadVault(sort, sort === 'top' ? currentTime : undefined);
  });
});

// Time dropdown (TODAY / THIS WEEK / THIS MONTH / THIS YEAR / ALL TIME)
$('time-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown($('time-toggle'), $('time-menu'));
});

$('time-menu').querySelectorAll('.sort-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    const time = opt.dataset.time;
    $('time-menu').querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    $('time-toggle').innerHTML = `${opt.textContent} <span class="chevron">▾</span>`;
    closeAllDropdowns();
    loadVault('top', time);
  });
});

// ── Flair filter ──────────────────────────────────────────────────────────
(function initFlairDropdown() {
  const menu = $('flair-menu');
  menu.innerHTML = ALL_FLAIRS.map(f =>
    `<button class="flair-option" data-flair="${esc(f)}">` +
    `<span class="flair-dot" style="background:${FLAIR_COLORS[f]}"></span>${esc(f)}</button>`
  ).join('') + `<button class="flair-option flair-clear" id="flair-clear-btn">CLEAR</button>`;
})();

$('flair-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown($('flair-toggle'), $('flair-menu'));
});

$('flair-menu').addEventListener('click', (e) => {
  const opt = e.target.closest('.flair-option');
  if (!opt) return;
  e.stopPropagation();
  if (opt.id === 'flair-clear-btn') {
    selectedFlairs.clear();
    $('flair-menu').querySelectorAll('.flair-option').forEach(o => o.classList.remove('active'));
    updateFlairUI();
    loadVault(currentSort, currentTime);
    return;
  }
  const f = opt.dataset.flair;
  if (selectedFlairs.has(f)) {
    selectedFlairs.delete(f);
    opt.classList.remove('active');
  } else {
    selectedFlairs.add(f);
    opt.classList.add('active');
  }
  updateFlairUI();
  loadVault(currentSort, currentTime);
});

function updateFlairUI() {
  // Update toggle text
  const toggle = $('flair-toggle');
  if (selectedFlairs.size) {
    toggle.innerHTML = `FILTERED ${selectedFlairs.size} <span class="chevron">▾</span>`;
  } else {
    toggle.innerHTML = `FILTER <span class="chevron">▾</span>`;
  }
  // Update search bar pills
  const pillsEl = $('search-flair-pills');
  const isMobile = window.innerWidth <= 600;
  if (isMobile && selectedFlairs.size > 0) {
    pillsEl.innerHTML = `<span class="search-flair-pill flair-summary" data-flair="__all">${selectedFlairs.size} filter${selectedFlairs.size > 1 ? 's' : ''} selected</span>`;
  } else {
    pillsEl.innerHTML = [...selectedFlairs].map(f => {
      const cls = 'flair-' + f.toLowerCase().replace(/\s+/g, '-');
      return `<span class="search-flair-pill ${cls}" data-flair="${esc(f)}">${esc(f)}</span>`;
    }).join('');
  }
}

// Click on search bar flair pill to remove it
$('search-flair-pills').addEventListener('click', (e) => {
  const pill = e.target.closest('.search-flair-pill');
  if (!pill) return;
  const f = pill.dataset.flair;
  if (f === '__all') {
    // Mobile summary pill — clear all filters
    selectedFlairs.clear();
    $('flair-menu').querySelectorAll('.flair-option').forEach(o => o.classList.remove('active'));
  } else {
    selectedFlairs.delete(f);
    $('flair-menu').querySelectorAll('.flair-option').forEach(opt => {
      if (opt.dataset.flair === f) opt.classList.remove('active');
    });
  }
  updateFlairUI();
  loadVault(currentSort, currentTime);
});

// ── Vault search ─────────────────────────────────────────────────────────
let vaultSearchTimeout = null;
let currentSearchQuery = '';
$('vault-search').addEventListener('input', function() {
  clearTimeout(vaultSearchTimeout);
  vaultSearchTimeout = setTimeout(() => {
    currentSearchQuery = this.value.trim();
    loadVault(currentSort, currentTime);
  }, 300);
});

// Backspace on empty search removes last flair filter
$('vault-search').addEventListener('keydown', function(e) {
  if (e.key === 'Backspace' && this.value === '' && selectedFlairs.size) {
    const last = [...selectedFlairs].pop();
    selectedFlairs.delete(last);
    $('flair-menu').querySelectorAll('.flair-option').forEach(opt => {
      if (opt.dataset.flair === last) opt.classList.remove('active');
    });
    updateFlairUI();
    loadVault(currentSort, currentTime);
  }
});

// ── My Posts Modal ────────────────────────────────────────────────────────
$('my-posts-btn').addEventListener('click', () => {
  if (!isLoggedIn) {
    window.location.href = '/login';
    return;
  }
  openMyPostsModal();
});

async function openMyPostsModal() {
  $('myposts-overlay').style.display = '';
  $('myposts-list').innerHTML = '<div class="vault-empty" style="padding:20px">loading...</div>';

  const res = await fetch('/api/vault/mine');
  if (!res.ok) { $('myposts-list').innerHTML = '<div class="vault-empty">failed to load</div>'; return; }
  const posts = await res.json();

  if (posts.length === 0) {
    $('myposts-list').innerHTML = `
      <div class="myposts-empty">
        <div>no posts yet</div>
        <button class="myposts-empty-cta" id="myposts-new-btn">submit your first post</button>
      </div>
    `;
    $('myposts-new-btn').addEventListener('click', () => {
      closeMyPostsModal();
      openModal();
    });
    return;
  }

  const list = $('myposts-list');
  list.innerHTML = '';
  posts.forEach(p => {
    const item = document.createElement('div');
    item.className = 'myposts-item';
    item.innerHTML = `
      <div class="myposts-item-title">${esc(p.title)}</div>
      <div class="myposts-item-meta">
        <span>${timeAgo(p.created_at)}</span>
        <span>${p.rti_count} RTI${p.rti_count !== 1 ? 's' : ''}</span>
        <span>${p.upvotes} heart${p.upvotes !== 1 ? 's' : ''}</span>
      </div>
    `;
    item.addEventListener('click', () => {
      closeMyPostsModal();
      openEditModal(p.id);
    });
    list.appendChild(item);
  });
}

function closeMyPostsModal() {
  $('myposts-overlay').style.display = 'none';
}

$('myposts-close').addEventListener('click', closeMyPostsModal);
$('myposts-overlay').addEventListener('click', (e) => {
  if (e.target === $('myposts-overlay')) closeMyPostsModal();
});

// ── Edit Post Modal ──────────────────────────────────────────────────────
let editPostId = null;
let editPostData = null;
let editSelectedRtis = new Set();
let editRtiRemarks = {};
let editLastFilteredIds = [];

async function openEditModal(postId) {
  editPostId = postId;
  $('edit-overlay').style.display = '';
  $('edit-error').style.display = 'none';
  editSelectedRtis.clear();
  editRtiRemarks = {};

  // Fetch the full post
  const res = await fetch(`/api/vault/${postId}`);
  if (!res.ok) { showEditError('Post not found'); return; }
  editPostData = await res.json();

  const p = editPostData;
  const createdAt = new Date(p.created_at + (p.created_at.includes('Z') ? '' : 'Z'));
  const withinHour = (Date.now() - createdAt.getTime()) < 3600000;

  // Title + description
  $('edit-title').value = p.title;
  $('edit-title-count').textContent = p.title.length;
  $('edit-description').value = p.description || '';
  $('edit-desc-count').textContent = (p.description || '').replace(/\s/g, '').length;

  // Disable title/desc if past 1 hour
  $('edit-title').disabled = !withinHour;
  $('edit-description').disabled = !withinHour;
  if (!withinHour) {
    $('edit-time-warning').style.display = '';
    $('edit-time-warning').textContent = 'title and description can no longer be edited (1 hour window has passed)';
  } else {
    const minsLeft = Math.ceil((3600000 - (Date.now() - createdAt.getTime())) / 60000);
    $('edit-time-warning').style.display = '';
    $('edit-time-warning').textContent = `you have ${minsLeft} minute${minsLeft !== 1 ? 's' : ''} left to edit title and description`;
  }

  // Existing RTIs (read-only)
  const existingDiv = $('edit-existing-rtis');
  if (p.requests.length === 0) {
    existingDiv.innerHTML = '<div class="vault-empty" style="padding:10px">no RTIs</div>';
  } else {
    existingDiv.innerHTML = p.requests.map((r, i) => `
      <div class="edit-existing-rti">
        <span class="edit-existing-rti-num">${i + 1}</span>
        <span class="edit-existing-rti-inst">${esc(r.institution)}</span>
        <span class="edit-existing-rti-remark">${esc(r.remarks || '')}</span>
      </div>
    `).join('');
  }

  // Preload RTIs for adding
  if (!cachedRtis) await preloadRtis();

  // Get existing request IDs to exclude from the add list
  const existingIds = new Set(p.requests.map(r => r.request_id));
  renderEditRtiList('', existingIds);
}

function renderEditRtiList(query, existingIds) {
  const q = query.toLowerCase();
  const exIds = existingIds || new Set();
  const filtered = (cachedRtis || []).filter(r => {
    const id = r._id || r.id;
    if (exIds.has(id)) return false; // exclude already-attached RTIs
    if (!q) return true;
    const inst = (r.institution?.name || r.institutionName || '').toLowerCase();
    const details = (r.details || '').toLowerCase();
    return inst.includes(q) || details.includes(q);
  });

  editLastFilteredIds = filtered.map(r => r._id || r.id);

  const tbody = $('edit-rti-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="vault-empty" style="padding:20px">${q ? 'no matching rtis' : 'no additional rtis available'}</div></td></tr>`;
    updateEditSelectionActions();
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(r => {
    const id = r._id || r.id;
    const inst = r.institution?.name || r.institutionName || '—';
    const msg = r.details || '';
    const checked = editSelectedRtis.has(id);

    const dataRow = document.createElement('tr');
    dataRow.className = 'rti-data-row' + (checked ? ' selected' : '');
    dataRow.dataset.id = id;
    dataRow.innerHTML = `
      <td><input type="checkbox" ${checked ? 'checked' : ''}></td>
      <td><span class="rti-inst-name">${esc(inst)}</span></td>
      <td style="text-align:right"><button class="rti-expand-chevron" aria-label="Toggle details"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button></td>
    `;

    const detailRow = document.createElement('tr');
    detailRow.className = 'rti-detail-row';
    detailRow.innerHTML = `
      <td colspan="3">
        <div class="rti-detail-inner">
          <div class="rti-detail-label">rti message</div>
          ${msg ? `<div class="rti-detail-text">${esc(msg)}</div>` : `<div class="rti-detail-no-msg">no message content available.</div>`}
        </div>
      </td>
    `;

    const cb = dataRow.querySelector('input[type="checkbox"]');
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cb.checked) { editSelectedRtis.add(id); dataRow.classList.add('selected'); }
      else { editSelectedRtis.delete(id); dataRow.classList.remove('selected'); }
      updateEditRemarksSection();
      updateEditSelectionActions();
    });

    dataRow.addEventListener('click', (e) => {
      if (e.target.closest('input[type="checkbox"]')) return;
      const chevron = dataRow.querySelector('.rti-expand-chevron');
      const isOpen = detailRow.classList.contains('show');
      detailRow.classList.toggle('show', !isOpen);
      dataRow.classList.toggle('expanded', !isOpen);
      chevron.classList.toggle('open', !isOpen);
    });

    tbody.appendChild(dataRow);
    tbody.appendChild(detailRow);
  });

  updateEditSelectionActions();
}

function updateEditSelectionActions() {
  const count = editSelectedRtis.size;
  $('edit-sel-count').textContent = count ? `${count} selected` : '';
}

function updateEditRemarksSection() {
  const section = $('edit-remarks-section');
  const list = $('edit-remarks-list');

  if (editSelectedRtis.size === 0) { section.style.display = 'none'; return; }

  section.style.display = '';
  list.innerHTML = '';

  for (const key of Object.keys(editRtiRemarks)) {
    if (!editSelectedRtis.has(key)) delete editRtiRemarks[key];
  }

  for (const id of editSelectedRtis) {
    const r = cachedRtis.find(x => (x._id || x.id) === id);
    if (!r) continue;
    const inst = r.institution?.name || r.institutionName || '—';
    const div = document.createElement('div');
    div.className = 'remarks-item';
    div.innerHTML = `
      <div class="remarks-item-label">${esc(inst)}</div>
      <input type="text" placeholder="add a remark (optional)..." maxlength="100" value="${esc(editRtiRemarks[id] || '')}">
    `;
    div.querySelector('input').addEventListener('input', function() { editRtiRemarks[id] = this.value; });
    list.appendChild(div);
  }
}

// Edit modal event listeners
$('edit-title').addEventListener('input', function() {
  $('edit-title-count').textContent = this.value.length;
});
$('edit-description').addEventListener('input', function() {
  const count = this.value.replace(/\s/g, '').length;
  $('edit-desc-count').textContent = count;
  $('edit-desc-count').style.color = count > 500 ? 'var(--red)' : '';
});
$('edit-rti-search').addEventListener('input', function() {
  const existingIds = editPostData ? new Set(editPostData.requests.map(r => r.request_id)) : new Set();
  renderEditRtiList(this.value.trim(), existingIds);
});
$('edit-sel-filtered-btn').addEventListener('click', () => {
  editLastFilteredIds.forEach(id => editSelectedRtis.add(id));
  const existingIds = editPostData ? new Set(editPostData.requests.map(r => r.request_id)) : new Set();
  renderEditRtiList($('edit-rti-search').value.trim(), existingIds);
  updateEditRemarksSection();
});
$('edit-sel-clear-btn').addEventListener('click', () => {
  editSelectedRtis.clear();
  const existingIds = editPostData ? new Set(editPostData.requests.map(r => r.request_id)) : new Set();
  renderEditRtiList($('edit-rti-search').value.trim(), existingIds);
  updateEditRemarksSection();
});

$('edit-close').addEventListener('click', closeEditModal);
$('edit-overlay').addEventListener('click', (e) => {
  if (e.target === $('edit-overlay')) closeEditModal();
});

function closeEditModal() {
  $('edit-overlay').style.display = 'none';
  editPostId = null;
  editPostData = null;
}

// Save changes
$('edit-save').addEventListener('click', async () => {
  if (!editPostId || !editPostData) return;

  const body = {};
  const p = editPostData;
  const createdAt = new Date(p.created_at + (p.created_at.includes('Z') ? '' : 'Z'));
  const withinHour = (Date.now() - createdAt.getTime()) < 3600000;

  // Only send title/desc if within hour and changed
  if (withinHour) {
    const newTitle = $('edit-title').value.trim();
    const newDesc = $('edit-description').value.trim();
    if (newTitle !== p.title) {
      if (!newTitle) { showEditError('Title cannot be empty'); return; }
      body.title = newTitle;
    }
    if (newDesc !== (p.description || '')) {
      if (newDesc.replace(/\s/g, '').length > 500) { showEditError('Description too long'); return; }
      body.description = newDesc;
    }
  }

  // Build new RTIs to add
  if (editSelectedRtis.size > 0) {
    const addRequests = [];
    for (const id of editSelectedRtis) {
      const r = cachedRtis.find(x => (x._id || x.id) === id);
      if (!r) continue;
      addRequests.push({
        requestId: r._id || r.id,
        institution: r.institution?.name || r.institutionName || '',
        details: r.details || '',
        status: r.status || '',
        files: r.ioFiles || r.userFiles || r.files || [],
        createdDate: r.createdDate || '',
        remarks: editRtiRemarks[id] || '',
      });
    }
    body.addRequests = addRequests;
  }

  if (!body.title && body.description === undefined && !body.addRequests) {
    showEditError('No changes to save');
    return;
  }

  $('edit-save').disabled = true;
  $('edit-save').textContent = 'SAVING...';
  $('edit-error').style.display = 'none';

  try {
    const res = await fetch(`/api/vault/${editPostId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save');

    closeEditModal();
    loadVault(currentSort, currentTime);
    showToast('Post updated');
  } catch (e) {
    showEditError(e.message);
  } finally {
    $('edit-save').disabled = false;
    $('edit-save').textContent = 'SAVE CHANGES';
  }
});

// Delete post
$('edit-delete').addEventListener('click', async () => {
  if (!editPostId) return;
  if (!confirm('Delete this post? This cannot be undone.')) return;

  $('edit-delete').disabled = true;
  try {
    const res = await fetch(`/api/vault/${editPostId}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to delete'); }
    closeEditModal();
    loadVault(currentSort, currentTime);
    showToast('Post deleted');
  } catch (e) {
    showEditError(e.message);
  } finally {
    $('edit-delete').disabled = false;
  }
});

function showEditError(msg) {
  $('edit-error').textContent = msg;
  $('edit-error').style.display = 'block';
}

// ── New Post Modal ──────────────────────────────────────────────────────────
$('new-post-btn').addEventListener('click', () => {
  if (!isLoggedIn) {
    window.location.href = '/login';
    return;
  }
  openModal();
});

// ── Preload RTIs and profile in background ──────────────────────────────────
function preloadRtis() {
  if (cachedRtis || rtiLoadPromise) return rtiLoadPromise;
  rtiLoadPromise = fetch('/api/my-requests')
    .then(r => r.json())
    .then(data => {
      const raw = Array.isArray(data) ? data : (data.data ?? []);
      cachedRtis = raw.filter(r => statusState(r.status) === 'processed');
    })
    .catch(() => { cachedRtis = []; });
  return rtiLoadPromise;
}

function preloadProfile() {
  if (cachedProfile || profileLoadPromise) return profileLoadPromise;
  profileLoadPromise = fetch('/api/profiles')
    .then(r => r.json())
    .then(data => { cachedProfile = data; })
    .catch(() => { cachedProfile = { presets: [], active: null }; });
  return profileLoadPromise;
}

async function openModal() {
  $('modal-overlay').style.display = '';
  $('modal-title').value = '';
  $('modal-title-count').textContent = '0';
  $('modal-description').value = '';
  $('modal-desc-count').textContent = '0';
  $('modal-desc-count').style.color = '';
  $('modal-rti-search').value = '';
  $('modal-error').style.display = 'none';
  selectedRtis.clear();
  displayAs = 'anonymous';
  rtiRemarks = {};
  $('remarks-section').style.display = 'none';

  // Wait for preloads (already started on auth, so should be fast or instant)
  if (!cachedRtis) {
    $('modal-rti-tbody').innerHTML = '<tr><td colspan="3"><div class="vault-empty" style="padding:20px">loading rtis...</div></td></tr>';
    await preloadRtis();
  }
  if (!cachedProfile) await preloadProfile();
  renderRtiList('');
  renderDisplayNameOptions();
}

let lastFilteredIds = [];

function renderRtiList(query) {
  const q = query.toLowerCase();
  const filtered = (cachedRtis || []).filter(r => {
    if (!q) return true;
    const inst = (r.institution?.name || r.institutionName || '').toLowerCase();
    const details = (r.details || '').toLowerCase();
    return inst.includes(q) || details.includes(q);
  });

  lastFilteredIds = filtered.map(r => r._id || r.id);

  const tbody = $('modal-rti-tbody');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="vault-empty" style="padding:20px">${q ? 'no matching rtis' : 'no processed rtis found'}</div></td></tr>`;
    updateSelectionActions();
    return;
  }

  tbody.innerHTML = '';

  filtered.forEach((r, idx) => {
    const id = r._id || r.id;
    const inst = r.institution?.name || r.institutionName || '—';
    const msg = r.details || '';
    const checked = selectedRtis.has(id);

    // Data row: checkbox | institution name | chevron (right)
    const dataRow = document.createElement('tr');
    dataRow.className = 'rti-data-row' + (checked ? ' selected' : '');
    dataRow.dataset.id = id;
    dataRow.innerHTML = `
      <td><input type="checkbox" ${checked ? 'checked' : ''}></td>
      <td><span class="rti-inst-name">${esc(inst)}</span></td>
      <td style="text-align:right"><button class="rti-expand-chevron" aria-label="Toggle details"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button></td>
    `;

    // Detail row (hidden by default)
    const detailRow = document.createElement('tr');
    detailRow.className = 'rti-detail-row';
    detailRow.innerHTML = `
      <td colspan="3">
        <div class="rti-detail-inner">
          <div class="rti-detail-label">rti message</div>
          ${msg
            ? `<div class="rti-detail-text">${esc(msg)}</div>`
            : `<div class="rti-detail-no-msg">no message content available.</div>`}
        </div>
      </td>
    `;

    // Clicking checkbox toggles selection
    const cb = dataRow.querySelector('input[type="checkbox"]');
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cb.checked) {
        selectedRtis.add(id);
        dataRow.classList.add('selected');
      } else {
        selectedRtis.delete(id);
        dataRow.classList.remove('selected');
      }
      updateRemarksSection();
      updateSelectionActions();
    });

    // Clicking row (except checkbox) expands/collapses detail
    dataRow.addEventListener('click', (e) => {
      if (e.target.closest('input[type="checkbox"]')) return;
      const chevron = dataRow.querySelector('.rti-expand-chevron');
      const isOpen = detailRow.classList.contains('show');
      detailRow.classList.toggle('show', !isOpen);
      dataRow.classList.toggle('expanded', !isOpen);
      chevron.classList.toggle('open', !isOpen);
    });

    tbody.appendChild(dataRow);
    tbody.appendChild(detailRow);
  });

  updateSelectionActions();
}

function updateSelectionActions() {
  const bar = $('rti-selection-bar');
  if (!bar) return;
  const count = selectedRtis.size;
  bar.querySelector('.sel-count').textContent = count ? `${count} selected` : '';
}

function selectFiltered() {
  lastFilteredIds.forEach(id => selectedRtis.add(id));
  renderRtiList($('modal-rti-search').value.trim());
  updateRemarksSection();
}

function clearSelection() {
  selectedRtis.clear();
  renderRtiList($('modal-rti-search').value.trim());
  updateRemarksSection();
}

// ── Remarks (when RTIs selected) ────────────────────────────────────────────
let rtiRemarks = {}; // { rtiId: 'remark text' }

function updateRemarksSection() {
  const remarksSection = $('remarks-section');
  const remarksList = $('remarks-list');

  if (selectedRtis.size === 0) {
    remarksSection.style.display = 'none';
    return;
  }

  // Remarks inputs (always shown when RTIs selected)
  remarksSection.style.display = '';
  remarksList.innerHTML = '';

  // Clean up stale remarks
  for (const key of Object.keys(rtiRemarks)) {
    if (!selectedRtis.has(key)) delete rtiRemarks[key];
  }

  for (const id of selectedRtis) {
    const r = cachedRtis.find(x => (x._id || x.id) === id);
    if (!r) continue;
    const inst = r.institution?.name || r.institutionName || '—';
    const div = document.createElement('div');
    div.className = 'remarks-item';
    div.innerHTML = `
      <div class="remarks-item-label">${esc(inst)}</div>
      <input type="text" placeholder="add a remark (optional)..." maxlength="100" value="${esc(rtiRemarks[id] || '')}">
    `;
    div.querySelector('input').addEventListener('input', function() {
      rtiRemarks[id] = this.value;
    });
    remarksList.appendChild(div);
  }
}

// ── Display name options (anonymous or profile label#tag) ───────────────────
let vaultActiveProfile = null; // which profile label is selected for vault display

function renderDisplayNameOptions() {
  const section = $('display-name-section');
  const opts = $('display-name-options');
  const pillsContainer = $('vault-profile-pills');

  const profile = cachedProfile;
  const presets = profile?.presets || [];

  if (!presets.length) {
    // No profiles — force anonymous, hide section
    section.style.display = 'none';
    displayAs = 'anonymous';
    return;
  }

  section.style.display = '';

  // Set vault active profile to the user's active profile if not set
  if (!vaultActiveProfile || !presets.find(p => p.label === vaultActiveProfile)) {
    vaultActiveProfile = profile?.active || presets[0]?.label;
  }

  const activePreset = presets.find(p => p.label === vaultActiveProfile) || presets[0];

  // Render profile pills
  pillsContainer.innerHTML = '';
  presets.forEach(p => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'vault-profile-pill' + (p.label === vaultActiveProfile ? ' active' : '');
    pill.textContent = p.label;
    pill.addEventListener('click', () => {
      vaultActiveProfile = p.label;
      renderDisplayNameOptions();
    });
    pillsContainer.appendChild(pill);
  });

  // Render radio options
  const tag = activePreset.tag ? `#${activePreset.tag}` : '';
  const labelDisplay = `@${activePreset.label}${tag}`;

  opts.innerHTML = '';

  // Anonymous option
  const anonLabel = document.createElement('label');
  anonLabel.className = 'display-name-option';
  anonLabel.innerHTML = `
    <input type="radio" name="vaultDisplayAs" value="anonymous" ${displayAs === 'anonymous' ? 'checked' : ''}>
    <span>@Anonymous</span>
  `;
  anonLabel.querySelector('input').addEventListener('change', () => { displayAs = 'anonymous'; });
  opts.appendChild(anonLabel);

  // Profile label option
  const profileLabel = document.createElement('label');
  profileLabel.className = 'display-name-option';
  profileLabel.innerHTML = `
    <input type="radio" name="vaultDisplayAs" value="label" ${displayAs === 'label' ? 'checked' : ''}>
    <span>${esc(labelDisplay)}</span>
  `;
  profileLabel.querySelector('input').addEventListener('change', () => { displayAs = 'label'; });
  opts.appendChild(profileLabel);
}

// Title char counter
$('modal-title').addEventListener('input', function() {
  $('modal-title-count').textContent = this.value.length;
});

// Description char counter (excluding spaces)
$('modal-description').addEventListener('input', function() {
  const count = this.value.replace(/\s/g, '').length;
  $('modal-desc-count').textContent = count;
  $('modal-desc-count').style.color = count > 500 ? 'var(--red)' : '';
});

// RTI search
$('modal-rti-search').addEventListener('input', function() {
  renderRtiList(this.value.trim());
});

// Selection action buttons
$('sel-filtered-btn').addEventListener('click', selectFiltered);
$('sel-clear-btn').addEventListener('click', clearSelection);

// Close modal
$('modal-close').addEventListener('click', closeModal);
$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay')) closeModal();
});

function closeModal(smooth) {
  const overlay = $('modal-overlay');
  if (smooth) {
    overlay.classList.add('fade-out');
    overlay.addEventListener('animationend', () => {
      overlay.style.display = 'none';
      overlay.classList.remove('fade-out');
    }, { once: true });
  } else {
    overlay.style.display = 'none';
  }
}

// Submit post
$('modal-submit').addEventListener('click', async () => {
  const title = $('modal-title').value.trim();
  if (!title) {
    showModalError('Please enter a title');
    return;
  }
  const description = $('modal-description').value.trim();
  const descNoSpaces = description.replace(/\s/g, '').length;
  if (descNoSpaces > 500) {
    showModalError('Description too long (max 500 characters excluding spaces)');
    return;
  }
  if (selectedRtis.size === 0) {
    showModalError('Please select at least one RTI');
    return;
  }

  // Build request objects from cached RTI data
  const requests = [];
  for (const id of selectedRtis) {
    const r = cachedRtis.find(x => (x._id || x.id) === id);
    if (!r) continue;
    requests.push({
      requestId: r._id || r.id,
      institution: r.institution?.name || r.institutionName || '',
      details: r.details || '',
      status: r.status || '',
      files: r.ioFiles || r.userFiles || r.files || [],
      createdDate: r.createdDate || '',
      remarks: rtiRemarks[id] || '',
    });
  }

  $('modal-submit').disabled = true;
  $('modal-submit').textContent = 'POSTING...';
  $('modal-error').style.display = 'none';

  try {
    const res = await fetch('/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, requests, displayAs, displayProfile: vaultActiveProfile }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create post');

    closeModal(true);
    loadVault(currentSort, currentTime);
    showToast('Post created');
  } catch (e) {
    showModalError(e.message);
  } finally {
    $('modal-submit').disabled = false;
    $('modal-submit').textContent = 'POST TO VAULT';
  }
});

function showModalError(msg) {
  $('modal-error').textContent = msg;
  $('modal-error').style.display = 'block';
}

// ── Handle direct /vault/:id URLs ───────────────────────────────────────────
(function init() {
  const path = window.location.pathname;
  const match = path.match(/^\/vault\/(.+)$/);
  if (match) {
    viewPost(match[1]);
  } else {
    loadVault('top', 'today');
  }

  // Show correct header based on auth
  fetch('/api/auth/status').then(r => r.json()).then(d => {
    if (d.loggedIn) {
      isLoggedIn = true;
      $('header-anon').style.display = 'none';
      $('header-auth').style.display = '';
      $('tabs-anon').style.display = 'none';
      $('tabs-auth').style.display = '';
      if (d.email) $('vault-user-email').textContent = d.email;
      // Clear stale cache from previous session, then preload
      cachedRtis = null; rtiLoadPromise = null;
      cachedProfile = null; profileLoadPromise = null;
      preloadRtis();
      preloadProfile();
    }
  }).catch(() => {});
})();

// ── Handle browser back/forward ─────────────────────────────────────────────
window.addEventListener('popstate', () => {
  const match = location.pathname.match(/^\/vault\/(.+)$/);
  if (match) {
    viewPost(match[1]);
  } else {
    $('vault-post').style.display = 'none';
    $('vault-sort-bar').style.display = '';
    $('vault-index').style.display = '';
    loadVault(currentSort, currentTime);
  }
});

// ── SVG icons ───────────────────────────────────────────────────────────────
function heartSvg(filled) {
  if (filled) return '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor" stroke="none"/></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
}
const shareSvg = '<svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="16 6 12 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="2" x2="12" y2="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// ── Helpers ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function timeAgo(dateStr) {
  const d = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
  if (diff < 31536000) return Math.floor(diff / 2592000) + 'mo ago';
  return Math.floor(diff / 31536000) + 'y ago';
}

function statusState(s) {
  return (s || '').toLowerCase().trim().split(/\s+/)[0];
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatAuthorLabel(displayName) {
  if (!displayName || displayName === 'anonymous') return '@Anonymous';
  // If it looks like a full name (has a space), show as-is
  if (displayName.includes(' ')) return displayName;
  // Otherwise it's a profile label — prefix with @
  return '@' + displayName;
}
