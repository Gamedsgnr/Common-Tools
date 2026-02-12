(function () {
  const root = document.getElementById('wikiScrollRoot');
  const links = Array.from(document.querySelectorAll('.wiki-link[href^="#"]'));
  const sections = links
    .map((link) => {
      const id = link.getAttribute('href').slice(1);
      const section = document.getElementById(id);
      if (!section) return null;
      return { id, link, section };
    })
    .filter(Boolean);

  function setActive(id) {
    links.forEach((link) => {
      const isActive = link.getAttribute('href') === '#' + id;
      link.classList.toggle('active', isActive);
    });
  }

  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(targetId);
    });
  });

  if (sections.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        let topCandidate = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!topCandidate || entry.boundingClientRect.top < topCandidate.boundingClientRect.top) {
            topCandidate = entry;
          }
        }
        if (!topCandidate) return;
        const found = sections.find((x) => x.section === topCandidate.target);
        if (found) setActive(found.id);
      },
      {
        root,
        threshold: [0.2, 0.45, 0.7],
        rootMargin: '-15% 0px -60% 0px'
      }
    );
    sections.forEach((x) => observer.observe(x.section));
  }

  if (window.location.hash) {
    const id = window.location.hash.slice(1);
    const target = document.getElementById(id);
    if (target) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        setActive(id);
      }, 0);
    }
  }
})();
