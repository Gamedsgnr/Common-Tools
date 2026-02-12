(() => {
  const sidebar = document.getElementById("wikiSidebar");
  const nav = document.getElementById("wikiNav");
  const searchInput = document.getElementById("wikiSearch");
  const searchMeta = document.getElementById("searchMeta");
  const openBtn = document.getElementById("sidebarOpenBtn");
  const closeBtn = document.getElementById("sidebarCloseBtn");
  const sections = Array.from(document.querySelectorAll(".wiki-section"));

  const navIndex = [];

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function buildNav() {
    nav.innerHTML = "";
    sections.forEach((section) => {
      const id = section.id;
      const title = section.dataset.title || section.querySelector("h2")?.textContent?.trim() || id;
      const item = document.createElement("a");
      item.href = `#${id}`;
      item.className = "nav-link";
      item.dataset.target = id;
      item.dataset.title = title.toLowerCase();
      item.innerHTML = `<span>${escapeHtml(title)}</span>`;
      nav.appendChild(item);
      navIndex.push(item);
    });
    updateMeta(sections.length, sections.length);
  }

  function updateMeta(visible, total) {
    searchMeta.textContent = `Разделов: ${visible}/${total}`;
  }

  function filterSections(query) {
    const q = query.trim().toLowerCase();
    let visibleCount = 0;
    sections.forEach((section) => {
      const title = (section.dataset.title || "").toLowerCase();
      const keywords = (section.dataset.keywords || "").toLowerCase();
      const body = (section.textContent || "").toLowerCase();
      const visible = !q || title.includes(q) || keywords.includes(q) || body.includes(q);
      section.style.display = visible ? "" : "none";
      if (visible) {
        visibleCount += 1;
      }
    });

    navIndex.forEach((link) => {
      const target = link.dataset.target;
      const section = document.getElementById(target);
      link.style.display = section && section.style.display !== "none" ? "" : "none";
    });

    updateMeta(visibleCount, sections.length);
  }

  function initSearch() {
    searchInput?.addEventListener("input", (event) => {
      filterSections(event.target.value || "");
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement !== searchInput) {
        event.preventDefault();
        searchInput?.focus();
      }
    });
  }

  function initMobileSidebar() {
    openBtn?.addEventListener("click", () => sidebar?.classList.add("open"));
    closeBtn?.addEventListener("click", () => sidebar?.classList.remove("open"));

    nav?.addEventListener("click", (event) => {
      const target = event.target.closest("a.nav-link");
      if (!target) {
        return;
      }
      sidebar?.classList.remove("open");
    });
  }

  function initScrollSpy() {
    if (!("IntersectionObserver" in window)) {
      return;
    }

    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.id;
          if (entry.isIntersecting) {
            visible.add(id);
          } else {
            visible.delete(id);
          }
        });

        let topSectionId = "";
        let topOffset = Number.POSITIVE_INFINITY;
        visible.forEach((id) => {
          const section = document.getElementById(id);
          if (!section || section.style.display === "none") {
            return;
          }
          const rect = section.getBoundingClientRect();
          const distance = Math.abs(rect.top);
          if (distance < topOffset) {
            topOffset = distance;
            topSectionId = id;
          }
        });

        navIndex.forEach((link) => {
          const active = link.dataset.target === topSectionId;
          link.classList.toggle("active", active);
        });
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.2, 0.5, 1] }
    );

    sections.forEach((section) => observer.observe(section));
  }

  function restoreFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const sectionId = params.get("section");
    const q = params.get("q");

    if (q && searchInput) {
      searchInput.value = q;
      filterSections(q);
    }

    if (sectionId) {
      const target = document.getElementById(sectionId);
      if (target) {
        setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
      }
    }
  }

  buildNav();
  initSearch();
  initMobileSidebar();
  initScrollSpy();
  restoreFromQuery();
})();
