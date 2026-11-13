// NextPluggable documentation site. Everything here is an enhancement: the pages read fine without it.
(() => {
  const served = location.protocol === 'http:' || location.protocol === 'https:';

  // Show and copy the agent addresses as this site is actually served (a custom domain, a local preview).
  if (served) {
    for (const el of document.querySelectorAll('[data-agent-url]')) el.textContent = new URL(el.dataset.agentUrl, location.href).href;
    for (const el of document.querySelectorAll('[data-copy-url]')) {
      const url = new URL(el.dataset.copyUrl, location.href).href;
      el.dataset.copy = el.dataset.copyPrompt ? el.dataset.copyPrompt.replace('{url}', url) : url;
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {}
      area.remove();
      return ok;
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-copy]') : null;
    if (!button) return;
    const label = button.querySelector('span') ?? button;
    const original = button.dataset.label ?? label.textContent;
    button.dataset.label = original;
    label.textContent = (await copy(button.dataset.copy)) ? 'Copied' : 'Press Ctrl+C';
    button.setAttribute('data-copied', '');
    clearTimeout(button._reset);
    button._reset = setTimeout(() => {
      label.textContent = original;
      button.removeAttribute('data-copied');
    }, 1600);
  });

  // Light or dark, remembered on this device.
  const toggle = document.querySelector('[data-theme-toggle]');
  toggle?.addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try {
      localStorage.setItem('np-theme', root.dataset.theme);
    } catch {}
  });

  // Guides: the contents list starts closed on small screens and follows the section being read.
  const toc = document.querySelector('.toc');
  if (toc) {
    if (matchMedia('(max-width: 900px)').matches) toc.removeAttribute('open');
    const links = new Map([...toc.querySelectorAll('a')].map((a) => [a.getAttribute('href').slice(1), a]));
    const headings = [...document.querySelectorAll('.article h2[id], .article h3[id]')];
    const mark = () => {
      let current = headings[0];
      for (const h of headings) if (h.getBoundingClientRect().top <= 120) current = h;
      for (const [id, a] of links) a.toggleAttribute('data-current', id === current?.id);
    };
    let queued = false;
    addEventListener(
      'scroll',
      () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          mark();
        });
      },
      { passive: true },
    );
    mark();
  }
})();
