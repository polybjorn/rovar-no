const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');
if (toggle && links) {
  const close = () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!links.classList.contains('open')) return;
    if (links.contains(e.target) || toggle.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && links.classList.contains('open')) {
      close();
      toggle.focus();
    }
  });
}

const langMenu = document.querySelector('.lang-menu');
if (langMenu) {
  // The browser hides a closed <details> outright, so its own open/close gives
  // nothing to transition. Drive it here instead: the attribute opens a frame
  // ahead of the .is-open class, and outlives its removal by the same 250ms
  // the collapse takes.
  const summary = langMenu.querySelector('summary');
  let closeTimer;

  const openLang = () => {
    clearTimeout(closeTimer);
    langMenu.open = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      langMenu.classList.add('is-open');
    }));
  };

  const closeLang = () => {
    if (!langMenu.open) return;
    langMenu.classList.remove('is-open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { langMenu.open = false; }, 250);
  };

  summary.addEventListener('click', (e) => {
    e.preventDefault();
    langMenu.classList.contains('is-open') ? closeLang() : openLang();
  });
  document.addEventListener('click', (e) => {
    if (!langMenu.contains(e.target)) closeLang();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && langMenu.open) {
      closeLang();
      summary.focus();
    }
  });
}
