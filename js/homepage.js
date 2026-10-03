/* Homepage navigation for Bootstrap 5. No jQuery dependency. */
(() => {
  'use strict';

  const navbar = document.getElementById('site-navigation');
  const menu = document.getElementById('navbar-menu');
  const menuButton = navbar.querySelector('.navbar-toggler');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const updateNavbar = () => {
    navbar.classList.toggle('top-nav-collapse', window.scrollY > 50);
  };

  updateNavbar();
  window.addEventListener('scroll', updateNavbar, { passive: true });

  // Recreate ScrollSpy after layout changes to reset its cached scroll direction.
  // refresh() alone can leave stale highlighting after several abstract toggles.
  let scrollSpy = bootstrap.ScrollSpy.getOrCreateInstance(document.body);
  const refreshScrollSpy = () => {
    scrollSpy.dispose();
    scrollSpy = new bootstrap.ScrollSpy(document.body);
  };
  document.querySelectorAll('.paper-abstract').forEach(abstract => {
    const card = abstract.closest('.paper-card');
    const toggle = card.querySelector('.abstract-toggle');
    const title = card.querySelector('.paper-heading').textContent.trim().replace(/\s+/g, ' ');
    const updateAbstract = expanded => {
      const label = expanded ? 'Hide Abstract:' : 'See Abstract';
      abstract.hidden = !expanded;
      toggle.textContent = label;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', `${expanded ? 'Hide Abstract' : 'See Abstract'}: ${title}`);
    };
    // Native visibility keeps the control and revealed prose in the same paragraph.
    updateAbstract(!abstract.hidden);
    toggle.addEventListener('click', () => {
      updateAbstract(abstract.hidden);
      refreshScrollSpy();
    });
  });
  window.addEventListener('load', refreshScrollSpy);
  if (document.fonts) document.fonts.ready.then(refreshScrollSpy);

  const scrollToSection = (target, smooth = true) => {
    // Use the closed, compact navbar height, including when the mobile menu is open.
    const brandHeight = navbar.querySelector('.navbar-brand').getBoundingClientRect().height;
    const offset = target.id === 'page-top' ? 0 : brandHeight + 10;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo({ top, behavior: smooth && !reduceMotion.matches ? 'smooth' : 'instant' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  const withClosedMenu = action => {
    if (getComputedStyle(menuButton).display !== 'none' && menu.classList.contains('show')) {
      menu.addEventListener('hidden.bs.collapse', action, { once: true });
      bootstrap.Collapse.getOrCreateInstance(menu, { toggle: false }).hide();
    } else {
      action();
    }
  };

  // Save reading positions before creating section entries. Only restore entries
  // managed here, after the browser processes its own history restoration.
  window.addEventListener('popstate', event => {
    const navigation = event.state && event.state.homepageNavigation;
    if (!navigation) return;
    requestAnimationFrame(() => withClosedMenu(() => {
      if (Number.isFinite(navigation.scrollY)) {
        window.scrollTo({ top: navigation.scrollY, behavior: 'instant' });
      } else {
        const target = document.getElementById(navigation.section);
        if (target) scrollToSection(target, false);
      }
    }));
  });

  navbar.querySelectorAll('a.page-scroll').forEach(link => {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      event.preventDefault();
      const hash = link.getAttribute('href');
      if (window.location.hash !== hash) {
        history.replaceState({
          ...history.state,
          homepageNavigation: { scrollY: window.scrollY }
        }, '');
        history.pushState({ homepageNavigation: { section: target.id } }, '', hash);
      }
      withClosedMenu(() => scrollToSection(target));
    });
  });
})();
