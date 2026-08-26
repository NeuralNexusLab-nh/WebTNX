const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const LANGUAGE_STORAGE_KEY = 'webtnx-language';

const normalizeLanguage = language => {
  const value = String(language || '').trim().replaceAll('_', '-').toLowerCase();
  if (value === 'zh-tw' || value === 'zh-hk' || value === 'zh-mo' || value.startsWith('zh-hant')) return 'zh-TW';
  if (value === 'en' || value.startsWith('en-')) return 'en';
  return null;
};

const storedLanguage = () => {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
};

const saveLanguage = language => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The UI still changes when storage is unavailable (private mode, policy, or sandboxing).
  }
};

const accountLanguage = () => normalizeLanguage(
  document.documentElement.dataset.accountLanguage || window.WEBTNX_ACCOUNT_LANGUAGE
);

const browserLanguage = () => {
  const preferences = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const preference of preferences) {
    const supported = normalizeLanguage(preference);
    if (supported) return supported;
  }
  return 'en';
};

document.addEventListener('DOMContentLoaded', () => {
  const languageSelects = $$('.language-select');
  const applyLanguage = (language, { persist = false } = {}) => {
    const lang = language === 'zh-TW' ? 'zh-TW' : 'en';
    document.documentElement.lang = lang;
    if (persist) saveLanguage(lang);
    languageSelects.forEach(select => { select.value = lang; });
    $$('[data-en][data-zh]').forEach(node => {
      if (node.hasAttribute('data-dynamic')) return;
      node.textContent = lang === 'zh-TW' ? node.dataset.zh : node.dataset.en;
    });
    $$('[data-en-html][data-zh-html]').forEach(node => {
      node.innerHTML = lang === 'zh-TW' ? node.dataset.zhHtml : node.dataset.enHtml;
    });
    $$('[data-en-placeholder][data-zh-placeholder]').forEach(node => {
      node.placeholder = lang === 'zh-TW' ? node.dataset.zhPlaceholder : node.dataset.enPlaceholder;
    });
    document.dispatchEvent(new CustomEvent('webtnx:languagechange', { detail: { lang } }));
  };
  languageSelects.forEach(select => select.addEventListener('change', () => applyLanguage(select.value, { persist: true })));
  applyLanguage(accountLanguage() || storedLanguage() || browserLanguage());

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting && entry.target.classList.add('visible'));
  }, { threshold: .13 });
  $$('.reveal,.stagger').forEach(node => observer.observe(node));

  if (!matchMedia('(pointer: coarse)').matches) {
    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    document.body.appendChild(glow);
    addEventListener('pointermove', event => {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    }, { passive: true });
    $$('[data-tilt]').forEach(card => {
      card.addEventListener('pointermove', event => {
        const rect = card.getBoundingClientRect();
        const rx = ((event.clientY - rect.top) / rect.height - .5) * -6;
        const ry = ((event.clientX - rect.left) / rect.width - .5) * 6;
        card.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px)`;
      });
      card.addEventListener('pointerleave', () => card.style.transform = '');
    });
  }

  $$('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => button.textContent = old, 1400);
  }));

  $$('.faq-item > button').forEach(button => button.addEventListener('click', () => {
    const item = button.closest('.faq-item');
    const open = item.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
  }));
});
