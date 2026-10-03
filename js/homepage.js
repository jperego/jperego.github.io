/* Homepage navigation and abstract controls. No jQuery dependency. */
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
    const line = abstract.closest('.paper-abstract-line');
    const title = card.querySelector('.paper-heading').textContent.trim().replace(/\s+/g, ' ');
    let expanded = !abstract.hidden;
    let heightAnimation = null;
    let fadeAnimation = null;
    const updateToggle = () => {
      const label = expanded ? 'Hide Abstract:' : 'See Abstract';
      toggle.textContent = label;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', `${expanded ? 'Hide Abstract' : 'See Abstract'}: ${title}`);
    };
    const finishTransition = () => {
      abstract.hidden = !expanded;
      heightAnimation?.cancel();
      fadeAnimation?.cancel();
      heightAnimation = null;
      fadeAnimation = null;
      line.classList.remove('is-animating');
      refreshScrollSpy();
    };
    updateToggle();
    toggle.addEventListener('click', () => {
      // Start from the current frame so repeated clicks reverse without a jump.
      const startHeight = line.getBoundingClientRect().height;
      const startOpacity = abstract.hidden ? 0 : Number.parseFloat(getComputedStyle(abstract).opacity);
      heightAnimation?.cancel();
      fadeAnimation?.cancel();
      expanded = !expanded;
      updateToggle();
      if (reduceMotion.matches || !line.animate) {
        finishTransition();
        return;
      }

      // Animate the paragraph so the control and prose keep their inline layout.
      abstract.hidden = true;
      const collapsedHeight = line.getBoundingClientRect().height;
      abstract.hidden = false;
      const expandedHeight = line.getBoundingClientRect().height;
      const duration = expanded ? 260 : 220;
      line.classList.add('is-animating');
      const animation = line.animate([
        { height: `${startHeight}px` },
        { height: `${expanded ? expandedHeight : collapsedHeight}px` }
      ], { duration, easing: 'cubic-bezier(.25, .1, .25, 1)', fill: 'both' });
      heightAnimation = animation;
      fadeAnimation = abstract.animate([
        { opacity: startOpacity },
        { opacity: expanded ? 1 : 0 }
      ], { duration, easing: 'ease-out', fill: 'both' });
      animation.finished.then(() => {
        if (heightAnimation === animation) finishTransition();
      }).catch(() => { /* Cancellation is expected when reversing the animation. */ });
    });
    const finishIfAnimating = () => {
      if (heightAnimation) finishTransition();
    };
    window.addEventListener('resize', finishIfAnimating);
    reduceMotion.addEventListener('change', () => {
      if (reduceMotion.matches) finishIfAnimating();
    });
  });
  window.addEventListener('load', refreshScrollSpy);
  if (document.fonts) document.fonts.ready.then(refreshScrollSpy);

  // Upward navigation from a gap between sections can leave ScrollSpy inactive.
  // Rebuild it once the requested scroll settles, using the final layout.
  let navigationRefreshTimer;
  const refreshAfterNavigation = () => {
    window.clearTimeout(navigationRefreshTimer);
    navigationRefreshTimer = window.setTimeout(() => {
      window.removeEventListener('scroll', refreshAfterNavigation);
      refreshScrollSpy();
    }, 100);
  };
  const scrollToSection = (target, smooth = true) => {
    // Use the closed, compact navbar height, including when the mobile menu is open.
    const brandHeight = navbar.querySelector('.navbar-brand').getBoundingClientRect().height;
    const offset = target.id === 'page-top' ? 0 : brandHeight + 10;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
    window.addEventListener('scroll', refreshAfterNavigation, { passive: true });
    window.scrollTo({ top, behavior: smooth && !reduceMotion.matches ? 'smooth' : 'instant' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    refreshAfterNavigation();
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
