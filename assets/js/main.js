// Code block copy button
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.post-content pre').forEach(pre => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');

    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')
        ? pre.querySelector('code').textContent
        : pre.textContent;

      try {
        await navigator.clipboard.writeText(code);
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

    // Wrap pre in a container for positioning
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.appendChild(btn);
  });

  // Back to top button
  const topBtn = document.createElement('a');
  topBtn.href = '#';
  topBtn.className = 'back-to-top';
  topBtn.setAttribute('aria-label', 'Back to top');
  topBtn.textContent = '↑';
  document.body.appendChild(topBtn);

  const toggleTopBtn = () => {
    topBtn.classList.toggle('visible', window.scrollY > 600);
  };

  window.addEventListener('scroll', toggleTopBtn, { passive: true });
  toggleTopBtn();

  topBtn.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
