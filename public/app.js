// ── Navigate helper ───────────────────────────────────────────────────────────
function navigate(url) {
  if (!url.startsWith('/')) return;
  document.body.classList.add('fading-out');
  setTimeout(() => { window.location.href = url; }, 250);
}

document.querySelector('.header-logo')?.addEventListener('click', () => navigate('/home'));

// ── State ─────────────────────────────────────────────────────────────────────
let institutions    = [];
let selected        = new Set();
let customVarVals   = {};
let activeDropLabel = null;
let allRequests     = [];
let reqFilter       = 'all';
let reqSearch       = '';
let requestsLoaded  = false;
let profileData     = { presets: [], active: null };
let isGuestMode     = false;

async function saveProfiles() {
  await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profileData),
  });
}

const BUILTIN = new Set(['RECIPIENT_NAME']);

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function getRti() { return $('rti-body').value; }

function renderText(text, inst) {
  let out = text.replace(/\{\{RECIPIENT_NAME\}\}/g, inst.name);
  const instVars = customVarVals[inst._id] || {};
  for (const [k, v] of Object.entries(instVars)) {
    const safeK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\{\\{${safeK}\\}\\}`, 'gi'), v);
  }
  return out;
}

function detectVars(text) {
  return [...new Set([...text.matchAll(/\{\{([A-Za-z_0-9]+)\}\}/g)].map(m => m[1]))];
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

// Clean up stale localStorage entry left by an older version of this app
localStorage.removeItem('mahoali_user_email');

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const me = await fetch('/api/auth/me').then(r => r.json());
    if (me.error) return navigate('/login');
    $('user-email').textContent = me.email;
  } catch {
    navigate('/login');
    return;
  }

  profileData = await fetch('/api/profiles').then(r => r.json());
  isGuestMode = sessionStorage.getItem('guestMode') === '1';
  if (!profileData.presets.length && !profileData.active && !isGuestMode) {
    navigate('/profiles');
    return;
  }
  if (isGuestMode) profileData.active = null;

  document.body.style.visibility = 'visible';
  renderPresetBar();
  loadInstitutions();
  // Pre-load requests in the background so the tab is ready instantly
  requestsLoaded = true;
  loadRequests();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $('view-compose').style.display  = tab === 'compose'  ? 'flex' : 'none';
    $('view-requests').style.display = tab === 'requests' ? 'flex' : 'none';
    $('view-contact').style.display  = tab === 'contact'  ? 'flex' : 'none';
    if (tab === 'requests' && !requestsLoaded) { requestsLoaded = true; loadRequests(); }
  });
});

// ── Institutions ──────────────────────────────────────────────────────────────
async function loadInstitutions() {
  try {
    const res  = await fetch('/api/institutions');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'failed');
    institutions = data;
    renderList(institutions);
    $('inst-meta').textContent = `${institutions.length} institutions loaded`;
  } catch (e) {
    $('inst-meta').textContent = 'failed to load institutions';
    $('inst-list').innerHTML = `<div class="empty-msg">could not load institutions.<br>${escHtml(e.message)}</div>`;
  }
}

function getFiltered() {
  const q = $('search').value.toLowerCase().trim();
  return q ? institutions.filter(i => i.name.toLowerCase().includes(q)) : institutions;
}

function renderList(list) {
  const container = $('inst-list');
  if (!list.length) {
    container.innerHTML = '<div class="empty-msg">no institutions found</div>';
    return;
  }
  container.innerHTML = '';
  const sorted = [
    ...list.filter(i => selected.has(i._id)),
    ...list.filter(i => !selected.has(i._id)),
  ];
  sorted.forEach(inst => {
    const row   = document.createElement('div');
    row.className = 'inst-item';
    const cb    = document.createElement('input');
    cb.type     = 'checkbox';
    cb.id       = `cb-${inst._id}`;
    cb.checked  = selected.has(inst._id);
    cb.addEventListener('change', () => toggle(inst._id, cb.checked));
    const lbl   = document.createElement('label');
    lbl.htmlFor = `cb-${inst._id}`;
    lbl.textContent = inst.name;
    row.appendChild(cb);
    row.appendChild(lbl);
    row.addEventListener('click', e => {
      if (e.target !== cb) { cb.checked = !cb.checked; }
      toggle(inst._id, cb.checked);
    });
    container.appendChild(row);
  });
  refreshCount();
}

function toggle(id, checked) {
  if (checked) selected.add(id); else selected.delete(id);
  renderList(getFiltered());
  refreshPreview();
  refreshCount();
}

function refreshCount() {
  const n = selected.size;
  $('sel-count').textContent = n ? `${n} selected` : '';
  $('f-count').textContent   = n;
  const hasText = getRti().trim().length > 0;
  $('btn-send').disabled = n === 0 || !hasText;
}

// ── Variables panel ───────────────────────────────────────────────────────────
function refreshVars() {
  const vars     = detectVars(getRti());
  const wrap     = $('vars-wrap');
  const autoVars = vars.filter(v => BUILTIN.has(v));
  if (!autoVars.length) { wrap.innerHTML = ''; return; }

  let html = `<div class="vars-label">auto_variables</div>`;
  autoVars.forEach(v => {
    html += `<div class="var-row">
      <span class="var-chip auto">{{${v}}}</span>
      <span class="var-hint">auto-filled with institution name</span>
    </div>`;
  });
  wrap.innerHTML = html;
}

// ── Per-institution variable rows + expandable preview ───────────────────────
function refreshPreview() {
  const text = getRti().trim();
  const wrap = $('preview-wrap');
  const selectedInsts = institutions.filter(i => selected.has(i._id));

  const customVars = text ? detectVars(text).filter(v => !BUILTIN.has(v)) : [];
  if (!customVars.length || !selectedInsts.length) { wrap.style.display = 'none'; return; }

  let html = `<div class="vars-label">custom_variables</div>`;

  selectedInsts.forEach(inst => {
    const iid = inst._id;
    const instVars = customVarVals[iid] || {};
    html += `<div class="pv-row" data-pv-id="${iid}">`;
    html += `<div class="pv-head" data-pv-toggle="${iid}">`;
    html += `<span class="pv-arrow" id="pv-arrow-${iid}">▸</span>`;
    html += `<span class="pv-name">${escHtml(inst.name)}</span>`;
    html += `</div>`;

    // var inputs inline
    html += `<div class="pv-vars">`;
    customVars.forEach(v => {
      const val = (instVars[v] || '').replace(/"/g, '&quot;');
      html += `<div class="var-row">
        <span class="var-chip">{{${v}}}</span>
        <input class="var-input cv-input" data-var="${v}" data-inst="${iid}" value="${val}"
               placeholder="${v}">
      </div>`;
    });
    html += `</div>`;

    // expandable preview text (hidden by default)
    html += `<div class="pv-preview" id="pv-preview-${iid}" style="display:none">`;
    html += `<div class="preview-text" data-preview="${iid}">${escHtml(renderText(text, inst))}</div>`;
    html += `</div>`;
    html += `</div>`;
  });

  wrap.innerHTML = html;
  wrap.style.display = 'block';

  // var input listeners
  wrap.querySelectorAll('.cv-input').forEach(el => {
    el.addEventListener('input', function() {
      const iid = this.dataset.inst;
      if (!customVarVals[iid]) customVarVals[iid] = {};
      customVarVals[iid][this.dataset.var] = this.value;
      const box = wrap.querySelector(`[data-preview="${iid}"]`);
      const inst = institutions.find(i => i._id === iid);
      if (box && inst) box.textContent = renderText(getRti().trim(), inst);
    });
  });

  // expand/collapse preview toggle per row
  wrap.querySelectorAll('[data-pv-toggle]').forEach(el => {
    el.addEventListener('click', function() {
      const iid = this.dataset.pvToggle;
      const preview = $(`pv-preview-${iid}`);
      const arrow = $(`pv-arrow-${iid}`);
      if (!preview) return;
      const open = preview.style.display !== 'none';
      preview.style.display = open ? 'none' : 'block';
      arrow.textContent = open ? '▸' : '▾';
      // refresh preview text when opening
      if (!open) {
        const box = wrap.querySelector(`[data-preview="${iid}"]`);
        const inst = institutions.find(i => i._id === iid);
        if (box && inst) box.textContent = renderText(getRti().trim(), inst);
      }
    });
  });
}

// ── Event bindings (compose) ──────────────────────────────────────────────────
$('rti-body').addEventListener('input', () => {
  const el = $('rti-body');
  if (el.value.length > 5000) el.value = el.value.slice(0, 5000);
  refreshVars();
  refreshPreview();
  refreshCount();
});
$('search').addEventListener('input', () => renderList(getFiltered()));

$('btn-all').addEventListener('click', () => { institutions.forEach(i => selected.add(i._id)); renderList(getFiltered()); refreshPreview(); });
$('btn-none').addEventListener('click', () => { selected.clear(); renderList(getFiltered()); refreshPreview(); });
$('btn-filtered').addEventListener('click', () => { getFiltered().forEach(i => selected.add(i._id)); renderList(getFiltered()); refreshPreview(); });
$('btn-refresh').addEventListener('click', loadRequests);

// ── Preset bar ────────────────────────────────────────────────────────────────
function renderPresetDetail(p) {
  const detail = $('preset-detail');
  if (!p) { detail.style.display = 'none'; return; }
  detail.style.display = 'flex';
  detail.innerHTML = `
    <div class="pd-info-row">
      <span class="pdl">name</span><span class="pdv">${escHtml(p.name)}</span>
      <span class="preset-detail-sep">·</span>
      <span class="pdl">phone</span><span class="pdv">${escHtml(p.phone)}</span>
      <span class="preset-detail-sep">·</span>
      <span class="pdl">address</span><span class="pdv">${escHtml(p.currentAddress || p.address || '—')}</span>
      <button class="pd-edit-btn">edit</button>
    </div>
  `;
  detail.querySelector('.pd-edit-btn').addEventListener('click', () => showPresetEdit(p));
}

function showPresetEdit(p) {
  const detail = $('preset-detail');
  detail.innerHTML = `
    <div class="pd-edit-form">
      <div class="pd-edit-row">
        <span class="pd-edit-label">name</span>
        <input class="pd-edit-input" id="pde-name" value="${escHtml(p.name)}">
      </div>
      <div class="pd-edit-row">
        <span class="pd-edit-label">phone</span>
        <input class="pd-edit-input" id="pde-phone" value="${escHtml(p.phone)}">
      </div>
      <div class="pd-edit-row">
        <span class="pd-edit-label">address</span>
        <input class="pd-edit-input" id="pde-address" value="${escHtml(p.currentAddress || p.address || '')}">
      </div>
      <span class="pde-err" id="pde-err-name"></span>
      <span class="pde-err" id="pde-err-phone"></span>
      <span class="pde-err" id="pde-err-address"></span>
      <div class="pd-edit-actions">
        <button class="btn btn-sm btn-ghost" id="pde-cancel">cancel</button>
        <button class="btn btn-sm btn-primary" id="pde-save">save</button>
      </div>
    </div>
  `;
  detail.querySelector('#pde-name').addEventListener('input', () => { detail.querySelector('#pde-err-name').textContent = ''; });
  detail.querySelector('#pde-phone').addEventListener('input', () => { detail.querySelector('#pde-err-phone').textContent = ''; });
  detail.querySelector('#pde-address').addEventListener('input', () => { detail.querySelector('#pde-err-address').textContent = ''; });
  detail.querySelector('#pde-cancel').addEventListener('click', () => renderPresetDetail(p));
  detail.querySelector('#pde-save').addEventListener('click', () => {
    const name    = detail.querySelector('#pde-name').value.trim();
    const phone   = detail.querySelector('#pde-phone').value.trim();
    const address = detail.querySelector('#pde-address').value.trim();
    let valid = true;
    if (!name)              { detail.querySelector('#pde-err-name').textContent = 'required'; valid = false; }
    else if (name.length > 50) { detail.querySelector('#pde-err-name').textContent = 'max 50 characters'; valid = false; }
    if (!phone || !/^[0-9]{7}$/.test(phone)) { detail.querySelector('#pde-err-phone').textContent = 'must be 7 digits'; valid = false; }
    if (!address)           { detail.querySelector('#pde-err-address').textContent = 'required'; valid = false; }
    else if (address.length > 200) { detail.querySelector('#pde-err-address').textContent = 'max 200 characters'; valid = false; }
    if (!valid) return;
    const idx = profileData.presets.findIndex(x => x.label === p.label);
    if (idx !== -1) {
      profileData.presets[idx] = { ...profileData.presets[idx], name, phone, currentAddress: address };
      saveProfiles();
      renderPresetBar();
      renderPresetDetail(profileData.presets[idx]);
    }
  });
}

function renderPresetBar() {
  const bar     = $('preset-bar');
  const presets = profileData.presets;
  bar.innerHTML = '';

  // Guest pill (always first, dotted border)
  const guestChip = document.createElement('button');
  guestChip.className = 'preset-chip guest' + (isGuestMode ? ' active' : '');
  guestChip.textContent = 'guest';
  guestChip.addEventListener('click', () => {
    isGuestMode = true;
    profileData.active = null;
    sessionStorage.setItem('guestMode', '1');
    activeDropLabel = null;
    renderPresetBar();
    renderGuestDetail();
  });
  bar.appendChild(guestChip);

  // Vertical separator
  if (presets.length) {
    const sep = document.createElement('span');
    sep.className = 'preset-sep';
    bar.appendChild(sep);
  }

  // Regular profile pills
  presets.forEach(p => {
    const chip = document.createElement('button');
    chip.className = 'preset-chip' + (!isGuestMode && p.label === profileData.active ? ' active' : '');
    chip.textContent = p.label;
    chip.addEventListener('click', () => {
      const wasGuestBefore = isGuestMode;
      isGuestMode = false;
      sessionStorage.removeItem('guestMode');
      const wasActive = !wasGuestBefore && profileData.active === p.label;
      profileData.active = p.label;
      saveProfiles();
      if (wasActive) {
        const isOpen = activeDropLabel === p.label;
        activeDropLabel = isOpen ? null : p.label;
        renderPresetDetail(isOpen ? null : p);
      } else {
        activeDropLabel = null;
        renderPresetDetail(null);
      }
      renderPresetBar();
    });
    bar.appendChild(chip);
  });

  const add = document.createElement('button');
  add.className = 'preset-chip add'; add.textContent = '+ new';
  add.addEventListener('click', () => { openProfileModal(); });
  bar.appendChild(add);

  // If guest mode, always show guest detail panel
  if (isGuestMode) renderGuestDetail();
}

function renderGuestDetail() {
  const detail = $('preset-detail');
  detail.style.display = 'flex';
  const prevName = $('guest-name')?.value || '';
  const prevPhone = $('guest-phone')?.value || '';
  const prevAddr = $('guest-address')?.value || '';
  const hasProfiles = profileData.presets.length > 0;
  const disclaimer = hasProfiles
    ? 'guest mode — details will not be saved.'
    : 'guest mode — details will not be saved. create a profile to save details for next time.';
  detail.innerHTML = `
    <div class="guest-disclaimer">${disclaimer}</div>
    <div class="pd-edit-form">
      <div class="pd-edit-row">
        <span class="pd-edit-label">name</span>
        <input class="pd-edit-input guest-input" id="guest-name" placeholder="full name" autocomplete="off" value="${escHtml(prevName)}">
        <span class="guest-err" id="guest-err-name"></span>
      </div>
      <div class="pd-edit-row">
        <span class="pd-edit-label">phone</span>
        <input class="pd-edit-input guest-input" id="guest-phone" placeholder="7 digits" inputmode="numeric" maxlength="7" autocomplete="off" value="${escHtml(prevPhone)}">
        <span class="guest-err" id="guest-err-phone"></span>
      </div>
      <div class="pd-edit-row">
        <span class="pd-edit-label">address</span>
        <input class="pd-edit-input guest-input" id="guest-address" placeholder="current address" autocomplete="off" value="${escHtml(prevAddr)}">
        <span class="guest-err" id="guest-err-address"></span>
      </div>
    </div>
  `;
  $('guest-phone').addEventListener('input', function() {
    const cleaned = this.value.replace(/[^0-9]/g, '').slice(0, 7);
    if (this.value !== cleaned) this.value = cleaned;
    $('guest-err-phone').textContent = '';
  });
  $('guest-name').addEventListener('input', () => { $('guest-err-name').textContent = ''; });
  $('guest-address').addEventListener('input', () => { $('guest-err-address').textContent = ''; });
}

function getApplicant() {
  if (isGuestMode) {
    return {
      label: null,
      name: ($('guest-name')?.value || '').trim(),
      phone: ($('guest-phone')?.value || '').trim(),
      currentAddress: ($('guest-address')?.value || '').trim(),
    };
  }
  try {
    return profileData.presets.find(p => p.label === profileData.active) || profileData.presets[0] || null;
  } catch { return null; }
}

// ── Send modal ────────────────────────────────────────────────────────────────
$('btn-send').addEventListener('click', () => openSendModal(false));

async function openSendModal(dryRun) {
  // Validate guest fields before sending
  if (isGuestMode) {
    const gName  = ($('guest-name')?.value || '').trim();
    const gPhone = ($('guest-phone')?.value || '').trim();
    const gAddr  = ($('guest-address')?.value || '').trim();
    let valid = true;
    if (!gName)            { $('guest-err-name').textContent = 'required'; valid = false; }
    else if (gName.length > 50) { $('guest-err-name').textContent = 'max 50 characters'; valid = false; }
    if (!gPhone || !/^[0-9]{7}$/.test(gPhone)) { $('guest-err-phone').textContent = 'must be 7 digits'; valid = false; }
    if (!gAddr)            { $('guest-err-address').textContent = 'required'; valid = false; }
    else if (gAddr.length > 200) { $('guest-err-address').textContent = 'max 200 characters'; valid = false; }
    if (!valid) return;
  }

  const insts = institutions.filter(i => selected.has(i._id));
  const text  = getRti().trim();

  $('m-title').textContent  = dryRun ? `preview — ${insts.length} institutions` : `sending to ${insts.length} institutions...`;
  $('m-sub').textContent    = dryRun ? 'nothing will be sent.' : '';
  $('s-total').textContent  = insts.length;
  $('s-sent').textContent   = '0';
  $('s-failed').textContent = '0';
  $('prog-fill').style.width   = '0%';
  $('m-log').innerHTML         = '';
  $('btn-close').style.display = 'none';
  $('overlay').classList.add('show');

  const payloads = insts.map(inst => ({
    institutionId: inst._id,
    applicant:     getApplicant(),
    details:       renderText(text, inst),
    dryRun,
  }));

  let sent = 0, failed = 0, done = 0;
  const total = payloads.length;

  try {
    const res = await fetch('/api/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ payloads }),
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done: sd, value } = await reader.read();
      if (sd) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'result') {
            if (ev.success) sent++; else failed++;
            done++;
            $('s-sent').textContent   = sent;
            $('s-failed').textContent = failed;
            $('prog-fill').style.width = `${(done / total) * 100}%`;
            addLogRow(ev);
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    addLogRow({ success: false, name: 'connection error', error: e.message, dryRun: false });
  }

  $('m-title').textContent     = dryRun ? `preview complete — ${total} requests` : `done — ${sent} sent, ${failed} failed`;
  $('m-sub').textContent       = '';
  $('btn-close').style.display = 'inline-block';
  if (!dryRun && sent > 0) loadRequests();
}

function addLogRow(ev) {
  const cls  = ev.dryRun ? 'dry' : ev.success ? 'ok' : 'fail';
  const icon = ev.dryRun ? '○' : ev.success ? '✓' : '✗';
  const note = ev.dryRun ? 'dry_run' : ev.success ? 'sent' : (ev.error || 'failed');
  const row  = document.createElement('div');
  row.className = `log-row ${cls}`;
  row.innerHTML = `<span class="log-icon">${icon}</span><span class="log-name">${escHtml(ev.name || '?')}</span><span class="log-note">${escHtml(note)}</span>`;
  $('m-log').appendChild(row);
  $('m-log').scrollTop = $('m-log').scrollHeight;
}

function closeModal() {
  $('overlay').classList.remove('show');
  $('rti-body').value = '';
  selected.clear();
  customVarVals = {};
  $('vars-wrap').innerHTML = '';
  $('preview-wrap').innerHTML = '';
  $('preview-wrap').style.display = 'none';
  renderList(getFiltered());
  refreshCount();
}

// ── Requests tab ──────────────────────────────────────────────────────────────
function statusState(s) {
  return (s || '').toLowerCase().trim().split(/\s+/)[0];
}

function statusClass(s) {
  const st = statusState(s);
  if (st === 'open')      return 'open';
  if (st === 'pending')   return 'pending';
  if (st === 'processed') return 'processed';
  if (st === 'rejected')  return 'rejected';
  if (st === 'closed')    return 'closed';
  return 'other';
}

const STATUS_LABELS = {
  open:      'submitted',
  pending:   'accepted',
  processed: 'processed',
  rejected:  'revise',
  closed:    'closed',
};

function statusLabel(s) {
  return STATUS_LABELS[statusState(s)] || (s || 'unknown');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (window.innerWidth <= 768) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return d.toLocaleDateString('en-MV', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderRequestsTable() {
  const q = reqSearch.toLowerCase();
  const filtered = allRequests.filter(r => {
    const matchesFilter = reqFilter === 'all' || statusClass(r.status) === reqFilter;
    const matchesSearch = !q || (r.details || '').toLowerCase().includes(q)
                               || (r.institution?.name || '').toLowerCase().includes(q);
    return matchesFilter && matchesSearch;
  });

  const tbody = $('req-tbody');
  tbody.innerHTML = '';

  if (!filtered.length) {
    $('req-state').textContent   = q ? `no results for "${reqSearch}".` : 'no requests found.';
    $('req-state').style.display = 'block';
    $('req-table').style.display = 'none';
    return;
  }

  $('req-state').style.display = 'none';
  $('req-table').style.display = 'table';

  filtered.forEach((r, idx) => {
    const seqNum   = allRequests.indexOf(r) === -1 ? '—' : allRequests.length - allRequests.indexOf(r);
    const instName = r.institution?.name || r.institutionName || '—';
    const sc       = statusClass(r.status);
    // profileLabel is stored at submit time (RTI Dhonbe only); fall back to ICOM form name
    const alias = r.profileLabel || r.name || '—';
    const detailId = `detail-${idx}`;
    const btnId    = `chevron-${idx}`;

    const dataRow = document.createElement('tr');
    dataRow.className = 'data-row';
    dataRow.innerHTML = `
      <td style="color:var(--text-dim);font-size:11px;text-align:right;padding-right:6px">${seqNum}</td>
      <td><button class="expand-chevron" id="${btnId}" aria-label="Toggle details">▾</button></td>
      <td>${escHtml(instName)}</td>
      <td>${formatDate(r.createdDate)}</td>
      <td style="color:var(--text-muted);font-size:11px">${escHtml(alias)}</td>
      <td><span class="req-status ${sc}">${escHtml(statusLabel(r.status))}</span></td>
    `;

    const detailRow = document.createElement('tr');
    detailRow.className = 'detail-row';
    detailRow.id = detailId;
    const msg      = r.details || '';
    const seqId    = r.sequenceId;
    const portalUrl = seqId ? `https://icom.mv/portal/requests/${seqId}` : null;
    const docFiles = (r.ioFiles || r.userFiles || r.files || [])
      .filter(f => f && (f.url || f.fileUrl || f.link));

    let metaHtml = '';
    if (seqId || portalUrl) {
      metaHtml += `<div class="detail-meta">`;
      if (seqId) metaHtml += `<span class="detail-meta-id">req #${escHtml(String(seqId))}</span>`;
      if (portalUrl) metaHtml += `<a href="${escHtml(portalUrl)}" target="_blank" rel="noopener noreferrer">&#8599; view on mahoali</a>`;
      metaHtml += `</div>`;
    }

    let docsHtml = '';
    if (docFiles.length) {
      docsHtml = `<div class="doc-links">
        <div class="doc-link-label">documents</div>
        ${docFiles.map(f => {
          const url  = f.url || f.fileUrl || f.link;
          if (!/^https?:\/\//i.test(url)) return '';
          const name = f.name || f.fileName || f.title || url.split('/').pop() || 'document';
          return `<a class="doc-link-item" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">&#128196; ${escHtml(name)}</a>`;
        }).join('')}
      </div>`;
    }

    detailRow.innerHTML = `
      <td colspan="6">
        <div class="detail-inner">
          ${metaHtml}
          <div class="detail-label">rti_message</div>
          ${msg
            ? `<div class="detail-text">${escHtml(msg)}</div>`
            : `<div class="detail-no-msg">no message content available.</div>`}
          ${docsHtml}
        </div>
      </td>
    `;

    dataRow.addEventListener('click', () => {
      const isOpen = detailRow.classList.contains('show');
      detailRow.classList.toggle('show', !isOpen);
      dataRow.classList.toggle('expanded', !isOpen);
      document.getElementById(btnId).classList.toggle('open', !isOpen);
    });

    tbody.appendChild(dataRow);
    tbody.appendChild(detailRow);
  });
}

async function loadRequests() {
  $('req-state').textContent   = 'loading...';
  $('req-state').style.display = 'block';
  $('req-table').style.display = 'none';
  try {
    const res  = await fetch('/api/my-requests');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'failed to load');
    const raw = Array.isArray(data) ? data : (data.data ?? []);
    allRequests = raw.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate));
    renderRequestsTable();
  } catch (e) {
    $('req-state').textContent = `error: ${e.message}`;
  }
}

$('req-filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  $('req-filters').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  reqFilter = btn.dataset.filter;
  renderRequestsTable();
});

$('req-search').addEventListener('input', function() {
  reqSearch = this.value.trim();
  renderRequestsTable();
});

// ── Profile modal ─────────────────────────────────────────────────────────────
function openProfileModal() {
  renderPmPresets();
  $('pm-f-label').value   = '';
  $('pm-f-name').value    = '';
  $('pm-f-phone').value   = '';
  $('pm-f-address').value = '';
  $('pm-err-label').textContent   = '';
  $('pm-err-name').textContent    = '';
  $('pm-err-phone').textContent   = '';
  $('pm-err-address').textContent = '';
  $('pm-save-btn').disabled = true;
  $('profile-modal-overlay').classList.add('show');
}

function closeProfileModal() {
  $('profile-modal-overlay').classList.remove('show');
}

function renderPmPresets() {
  const { presets, active } = profileData;
  const list = $('pm-preset-list');
  $('pm-done-btn').style.display = presets.length ? 'block' : 'none';
  if (!presets.length) {
    list.innerHTML = '<div class="pm-empty">no profiles yet</div>';
    return;
  }
  list.innerHTML = '';
  presets.forEach(p => {
    const item = document.createElement('div');
    item.className = 'pm-preset-item' + (p.label === active ? ' active' : '');
    item.innerHTML = `
      <span class="pm-preset-name">${escHtml(p.label)}</span>
      <span class="pm-preset-detail">${escHtml(p.name)} · ${escHtml(p.phone)}</span>
      ${p.label === active ? '<span class="pm-active-badge">active</span>' : ''}
      <button class="pm-del" data-label="${escHtml(p.label)}">×</button>
    `;
    item.addEventListener('click', e => {
      if (e.target.classList.contains('pm-del')) return;
      profileData.active = p.label;
      saveProfiles().then(() => { renderPresetBar(); closeProfileModal(); });
    });
    item.querySelector('.pm-del').addEventListener('click', async e => {
      e.stopPropagation();
      profileData.presets = profileData.presets.filter(x => x.label !== p.label);
      if (profileData.active === p.label) profileData.active = profileData.presets[0]?.label || null;
      await saveProfiles();
      renderPresetBar();
      renderPmPresets();
    });
    list.appendChild(item);
  });
}

function pmUpdateButtonState() {
  const filled = $('pm-f-label').value.trim() && $('pm-f-name').value.trim()
              && $('pm-f-phone').value.trim() && $('pm-f-address').value.trim();
  $('pm-save-btn').disabled = !filled;
}

$('pm-f-phone').addEventListener('input', function() {
  const cleaned = this.value.replace(/[^0-9]/g, '').slice(0, 7);
  if (this.value !== cleaned) this.value = cleaned;
  $('pm-err-phone').textContent = '';
  pmUpdateButtonState();
});
[['pm-f-label','pm-err-label'],['pm-f-name','pm-err-name'],['pm-f-address','pm-err-address']].forEach(([fid, eid]) => {
  $(fid).addEventListener('input', () => { $(eid).textContent = ''; pmUpdateButtonState(); });
});

$('pm-save-btn').addEventListener('click', async () => {
  const label   = $('pm-f-label').value.trim().toLowerCase();
  const name    = $('pm-f-name').value.trim();
  const phone   = $('pm-f-phone').value.trim();
  const address = $('pm-f-address').value.trim();
  let valid = true;

  let labelErr = '';
  if (!label)                              labelErr = 'required';
  else if (label.length > 10)              labelErr = 'max 10 characters';
  else if (!/^[a-z0-9_-]+$/.test(label))  labelErr = 'letters, numbers, - and _ only';
  $('pm-err-label').textContent = labelErr;
  if (labelErr) valid = false;

  let nameErr = '';
  if (!name)                                        nameErr = 'required';
  else if (name.replace(/\s/g,'').length > 40)      nameErr = 'max 40 characters';
  else if (!/^[a-zA-Z\s'\-.,]+$/.test(name))        nameErr = "letters and ' - . , only";
  $('pm-err-name').textContent = nameErr;
  if (nameErr) valid = false;

  let phoneErr = '';
  if (!phone)                         phoneErr = 'required';
  else if (!/^[0-9]{7}$/.test(phone)) phoneErr = 'must be exactly 7 digits';
  $('pm-err-phone').textContent = phoneErr;
  if (phoneErr) valid = false;

  let addressErr = '';
  if (!address)               addressErr = 'required';
  else if (address.length > 40) addressErr = 'max 40 characters';
  $('pm-err-address').textContent = addressErr;
  if (addressErr) valid = false;

  if (!valid) return;

  profileData.presets = profileData.presets.filter(p => p.label !== label);
  profileData.presets.push({ label, name, phone, currentAddress: address });
  profileData.active = label;
  await saveProfiles();
  renderPresetBar();
  closeProfileModal();
});

$('pm-done-btn').addEventListener('click', closeProfileModal);
$('pm-close').addEventListener('click', closeProfileModal);
$('profile-modal-overlay').addEventListener('click', e => {
  if (e.target === $('profile-modal-overlay')) closeProfileModal();
});

boot();

// ── Modal close button ────────────────────────────────────────────────────────
$('btn-close').addEventListener('click', closeModal);

// ── Logout overlay ────────────────────────────────────────────────────────────
const overlay = document.getElementById('logout-overlay');
document.getElementById('logout-btn').addEventListener('click', () => {
  overlay.style.display = 'flex';
});
document.getElementById('logout-cancel').addEventListener('click', () => {
  overlay.style.display = 'none';
});
document.getElementById('logout-confirm').addEventListener('click', async () => {
  overlay.style.display = 'none';
  await fetch('/api/auth/logout', { method: 'POST' });
  navigate('/login');
});
overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
