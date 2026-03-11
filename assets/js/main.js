// Code block copy button
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.post-content .highlight, .post-content pre').forEach(el => {
    // Avoid duplicates: if this pre is inside a .highlight we already processed, skip
    if (el.tagName === 'PRE' && el.closest('.highlight')) return;

    const container = el;
    container.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');

    btn.addEventListener('click', async () => {
      const code = container.querySelector('code');
      const text = code ? code.textContent : container.textContent;

      try {
        await navigator.clipboard.writeText(text.trim());
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 1500);
      } catch {
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }
    });

    container.appendChild(btn);
  });

  // Back to top button
  const topBtn = document.createElement('a');
  topBtn.href = '#';
  topBtn.className = 'back-to-top';
  topBtn.setAttribute('aria-label', 'Back to top');
  topBtn.textContent = '↑';
  document.body.appendChild(topBtn);

  const toggleTopBtn = () => {
    if (window.scrollY > 400) {
      topBtn.classList.add('visible');
    } else {
      topBtn.classList.remove('visible');
    }
  };

  window.addEventListener('scroll', toggleTopBtn, { passive: true });
  toggleTopBtn();

  topBtn.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
