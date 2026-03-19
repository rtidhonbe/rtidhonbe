  function navigate(url) {
    document.body.classList.add('fading-out');
    setTimeout(() => { window.location.href = url; }, 250);
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn      = document.getElementById('btn');
    const errEl    = document.getElementById('error');
    if (!email || !password) return;
    btn.disabled = true; btn.textContent = 'CONNECTING...';
    errEl.style.display = 'none';
    try {
      const rememberMe = document.getElementById('remember').checked;
      const res  = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'login failed');
      const profiles = await fetch('/api/profiles').then(r => r.json());
      const hasProfile = profiles.presets && profiles.presets.length > 0 && profiles.active;
      navigate(hasProfile ? '/home' : '/profiles');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = 'SIGN IN';
    }
  });
