document.getElementById('beta-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code  = document.getElementById('code').value;
  const errEl = document.getElementById('error');
  const btn   = document.querySelector('.btn');
  if (!code) return;
  btn.disabled = true;
  btn.textContent = 'VERIFYING...';
  errEl.style.display = 'none';
  try {
    const res  = await fetch('/beta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'incorrect access code');
    document.body.classList.add('fading-out');
    setTimeout(() => { window.location.href = '/login'; }, 250);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'ENTER';
  }
});
