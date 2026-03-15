  let profileData = { presets: [], active: null };

  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  async function saveProfiles() {
    await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData),
    });
  }

  function render() {
    const { presets, active } = profileData;
    const list    = document.getElementById('preset-list');
    const skipBtn = document.getElementById('skip-btn');
    const backBtn = document.getElementById('btn-back');

    const guestBtn = document.getElementById('guest-btn');
    if (!presets.length) {
      list.innerHTML = '<div class="empty-msg">no profiles yet</div>';
      skipBtn.style.display = 'none';
      backBtn.style.display = 'none';
      guestBtn.style.display = 'block';
      return;
    }
    skipBtn.style.display = 'block';
    backBtn.style.display = 'block';
    guestBtn.style.display = 'none';
    list.innerHTML = '';
    presets.forEach(p => {
      const item = document.createElement('div');
      item.className = 'preset-item' + (p.label === active ? ' active' : '');
      item.innerHTML = `
        <span class="preset-name">${escHtml(p.label)}</span>
        <span class="preset-detail">${escHtml(p.name)} · ${escHtml(p.phone)}</span>
        ${p.label === active ? '<span class="active-badge">active</span>' : ''}
        <button class="preset-del" data-label="${escHtml(p.label)}">×</button>
      `;
      item.addEventListener('click', e => {
        if (e.target.classList.contains('preset-del')) return;
        profileData.active = p.label;
        saveProfiles().then(() => { window.location.href = '/home'; });
      });
      item.querySelector('.preset-del').addEventListener('click', async e => {
        e.stopPropagation();
        profileData.presets = profileData.presets.filter(x => x.label !== p.label);
        if (profileData.active === p.label) profileData.active = profileData.presets[0]?.label || null;
        await saveProfiles();
        render();
      });
      list.appendChild(item);
    });
  }

  // ── Button state ─────────────────────────────────────────────────────────────
  function updateButtonState() {
    const label   = document.getElementById('f-label').value.trim();
    const name    = document.getElementById('f-name').value.trim();
    const phone   = document.getElementById('f-phone').value.trim();
    const address = document.getElementById('f-address').value.trim();
    document.getElementById('save-btn').disabled = !(label && name && phone && address);
  }

  // ── Phone: digits only, max 7 ─────────────────────────────────────────────
  document.getElementById('f-phone').addEventListener('input', function() {
    const cleaned = this.value.replace(/[^0-9]/g, '').slice(0, 7);
    if (this.value !== cleaned) this.value = cleaned;
    document.getElementById('err-phone').textContent = '';
    updateButtonState();
  });

  // ── Clear inline error on typing, update button state ─────────────────────
  document.getElementById('f-label').addEventListener('input', () => {
    document.getElementById('err-label').textContent = '';
    updateButtonState();
  });
  document.getElementById('f-name').addEventListener('input', () => {
    document.getElementById('err-name').textContent = '';
    updateButtonState();
  });
  document.getElementById('f-address').addEventListener('input', () => {
    document.getElementById('err-address').textContent = '';
    updateButtonState();
  });

  // ── Save ─────────────────────────────────────────────────────────────────────
  document.getElementById('save-btn').addEventListener('click', async () => {
    const label   = document.getElementById('f-label').value.trim().toLowerCase();
    const name    = document.getElementById('f-name').value.trim();
    const phone   = document.getElementById('f-phone').value.trim();
    const address = document.getElementById('f-address').value.trim();

    let valid = true;

    let labelErr = '';
    if (!label)                              labelErr = 'required';
    else if (label.length > 10)              labelErr = 'max 10 characters';
    else if (!/^[a-z0-9_-]+$/.test(label))  labelErr = 'letters, numbers, - and _ only';
    document.getElementById('err-label').textContent = labelErr;
    if (labelErr) valid = false;

    let nameErr = '';
    if (!name)                                           nameErr = 'required';
    else if (name.replace(/\s/g, '').length > 40)        nameErr = 'max 40 characters';
    else if (!/^[a-zA-Z\s'\-.,]+$/.test(name))           nameErr = "letters and ' - . , only";
    document.getElementById('err-name').textContent = nameErr;
    if (nameErr) valid = false;

    let phoneErr = '';
    if (!phone)                        phoneErr = 'required';
    else if (!/^[0-9]{7}$/.test(phone)) phoneErr = 'must be exactly 7 digits';
    document.getElementById('err-phone').textContent = phoneErr;
    if (phoneErr) valid = false;

    let addressErr = '';
    if (!address)              addressErr = 'required';
    else if (address.length > 40) addressErr = 'max 40 characters';
    document.getElementById('err-address').textContent = addressErr;
    if (addressErr) valid = false;

    if (!valid) return;

    profileData.presets = profileData.presets.filter(p => p.label !== label);
    profileData.presets.push({ label, name, phone, currentAddress: address });
    profileData.active = label;
    await saveProfiles();
    window.location.href = '/home';
  });

  document.getElementById('skip-btn').addEventListener('click', () => { window.location.href = '/home'; });
  document.getElementById('btn-back').addEventListener('click', () => { window.location.href = '/home'; });
  document.getElementById('guest-btn').addEventListener('click', () => {
    sessionStorage.setItem('guestMode', '1');
    window.location.href = '/home';
  });

  fetch('/api/auth/me').then(r => r.json())
    .then(async me => {
      if (me.error) { window.location.href = '/login'; return; }
      profileData = await fetch('/api/profiles').then(r => r.json());
      document.body.style.visibility = 'visible';
      render();
    })
    .catch(() => { window.location.href = '/login'; });
