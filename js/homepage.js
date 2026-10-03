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
  const abstractControllers = Array.from(document.querySelectorAll('.paper-abstract'), abstract => {
    const card = abstract.closest('.paper-card');
    const toggle = card.querySelector('.abstract-toggle');
    const line = abstract.closest('.paper-abstract-line');
    const title = card.querySelector('.paper-heading').textContent.trim().replace(/\s+/g, ' ');
    const source = abstract.cloneNode(true);
    const fullHTML = abstract.innerHTML;
    const fullText = source.textContent;
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    let expanded = false;
    let hasOverflow = false;
    let previewEnd = 0;
    let previewFragment = null;
    let previewHeight = 0;
    let measuredWidth = 0;
    let measuredLineHeight = 0;
    let remainder = null;
    let heightAnimation = null;
    let fadeAnimation = null;

    const positionAt = index => {
      for (const node of textNodes) {
        if (index <= node.length) return [node, index];
        index -= node.length;
      }
      const last = textNodes[textNodes.length - 1];
      return [last, last.length];
    };
    const slice = (start, end) => {
      const range = document.createRange();
      range.selectNodeContents(source);
      range.setStart(...positionAt(start));
      range.setEnd(...positionAt(end));
      return range.cloneContents();
    };
    const updateToggle = () => {
      toggle.hidden = !hasOverflow;
      toggle.textContent = expanded ? 'See less' : 'See more';
      toggle.setAttribute('aria-expanded', String(expanded || !hasOverflow));
      toggle.setAttribute('aria-label', `${expanded ? 'See less of' : 'See more of'} abstract: ${title}`);
    };
    const renderPreview = () => {
      abstract.replaceChildren(previewFragment.cloneNode(true), document.createTextNode('...'));
    };
    const renderState = () => {
      if (expanded || !hasOverflow) abstract.innerHTML = fullHTML;
      else renderPreview();
      remainder = null;
      updateToggle();
    };
    const finishTransition = (refresh = true) => {
      heightAnimation?.cancel();
      fadeAnimation?.cancel();
      heightAnimation = null;
      fadeAnimation = null;
      renderState();
      line.classList.remove('is-animating');
      if (refresh) refreshScrollSpy();
    };
    const reflow = (force = false) => {
      const width = line.getBoundingClientRect().width;
      const lineHeight = Number.parseFloat(getComputedStyle(line).lineHeight);
      const wasAnimating = Boolean(heightAnimation);
      if (wasAnimating) finishTransition(false);
      if (!force && Math.abs(width - measuredWidth) < .5 && lineHeight === measuredLineHeight) {
        return wasAnimating;
      }
      measuredWidth = width;
      measuredLineHeight = lineHeight;
      const limit = lineHeight * 3;
      abstract.innerHTML = fullHTML;
      toggle.hidden = true;
      hasOverflow = line.getBoundingClientRect().height > limit + 1;
      if (hasOverflow) {
        // Measure actual wrapping, including the label, ellipsis, and inline button.
        toggle.hidden = false;
        toggle.textContent = 'See more';
        let low = 0;
        let high = fullText.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          abstract.replaceChildren(slice(0, middle), document.createTextNode('...'));
          if (line.getBoundingClientRect().height <= limit + 1) low = middle;
          else high = middle - 1;
        }
        previewEnd = low;
        // Prefer a whole word rather than leaving half a word before the ellipsis.
        if (/\S/.test(fullText[previewEnd] || '') && /\S/.test(fullText[previewEnd - 1] || '')) {
          while (previewEnd > 0 && /\S/.test(fullText[previewEnd - 1])) previewEnd--;
        }
        while (previewEnd > 0 && /[\s,;:.]/.test(fullText[previewEnd - 1])) previewEnd--;
        previewFragment = slice(0, previewEnd);
        renderPreview();
        previewHeight = line.getBoundingClientRect().height;
      }
      renderState();
      return true;
    };

    reflow(true);
    toggle.addEventListener('click', () => {
      if (!hasOverflow) return;
      // Start from the current frame so repeated clicks reverse without a jump.
      const startHeight = line.getBoundingClientRect().height;
      const startOpacity = remainder ? Number.parseFloat(getComputedStyle(remainder).opacity) : (expanded ? 1 : 0);
      heightAnimation?.cancel();
      fadeAnimation?.cancel();
      expanded = !expanded;
      updateToggle();
      if (reduceMotion.matches || !line.animate) {
        finishTransition();
        return;
      }

      // Keep the preview text readable while only the newly revealed prose fades.
      remainder = document.createElement('span');
      remainder.className = 'abstract-remainder';
      remainder.append(slice(previewEnd, fullText.length));
      abstract.replaceChildren(slice(0, previewEnd), remainder);
      const expandedHeight = line.getBoundingClientRect().height;
      const duration = expanded ? 260 : 220;
      line.classList.add('is-animating');
      const animation = line.animate([
        { height: `${startHeight}px` },
        { height: `${expanded ? expandedHeight : previewHeight}px` }
      ], { duration, easing: 'cubic-bezier(.25, .1, .25, 1)', fill: 'both' });
      heightAnimation = animation;
      fadeAnimation = remainder.animate([
        { opacity: startOpacity },
        { opacity: expanded ? 1 : 0 }
      ], { duration, easing: 'ease-out', fill: 'both' });
      animation.finished.then(() => {
        if (heightAnimation === animation) finishTransition();
      }).catch(() => { /* Cancellation is expected when reversing the animation. */ });
    });
    return { reflow, finishIfAnimating: () => { if (heightAnimation) finishTransition(); } };
  });
  const reflowAbstracts = (force = false) => {
    let changed = false;
    abstractControllers.forEach(controller => { changed = controller.reflow(force) || changed; });
    if (changed) refreshScrollSpy();
  };
  let resizeFrame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => reflowAbstracts());
  });
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) abstractControllers.forEach(controller => controller.finishIfAnimating());
  });
  window.addEventListener('load', () => reflowAbstracts(true));
  if (document.fonts) document.fonts.ready.then(() => reflowAbstracts(true));

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
