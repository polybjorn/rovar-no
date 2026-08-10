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
  document.addEventListener('click', (e) => {
    if (langMenu.open && !langMenu.contains(e.target)) langMenu.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && langMenu.open) {
      langMenu.open = false;
      langMenu.querySelector('summary').focus();
    }
  });
}
