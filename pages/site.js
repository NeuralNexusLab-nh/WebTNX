const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

document.addEventListener('DOMContentLoaded', () => {
  const menu = $('.menu');
  const links = $('.nav-links');
  menu?.addEventListener('click', () => links?.classList.toggle('open'));

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
});
