/* Homepage navigation, abstract controls, and paper outlines. No jQuery dependency. */
(() => {
  'use strict';

  const navbar = document.getElementById('site-navigation');
  const menu = document.getElementById('navbar-menu');
  const menuButton = navbar.querySelector('.navbar-toggler');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const abstractTransitionDuration = expanded => expanded ? 260 : 220;
  const navigationSections = Array.from(navbar.querySelectorAll('.nav-link.page-scroll'), link => ({
    link,
    section: document.getElementById(link.getAttribute('href').slice(1))
  }));

  // Section starts keep highlighting predictable across long sections and gaps.
  const refreshSectionHighlight = () => {
    const offset = navbar.querySelector('.navbar-brand').getBoundingClientRect().height + 10;
    let activeLink = null;
    navigationSections.forEach(({ link, section }) => {
      if (section.getBoundingClientRect().top <= offset + 1) activeLink = link;
    });
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
      activeLink = navigationSections[navigationSections.length - 1].link;
    }
    navigationSections.forEach(({ link }) => {
      const active = link === activeLink;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  const updateNavbar = () => {
    navbar.classList.toggle('top-nav-collapse', window.scrollY > 50);
    refreshSectionHighlight();
  };

  updateNavbar();
  window.addEventListener('scroll', updateNavbar, { passive: true });

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
      if (refresh) refreshSectionHighlight();
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
      const duration = abstractTransitionDuration(expanded);
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
    if (changed) refreshSectionHighlight();
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

  // Keep the first half of each outline opaque, then fade by distance along it.
  // ResizeObserver also follows the card height during abstract animations.
  if ('ResizeObserver' in window) {
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svgElement = (name, attributes = {}) => {
      const element = document.createElementNS(svgNamespace, name);
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
      return element;
    };
    const straightSegment = (from, to) => ({
      from, to,
      d: `M${from} L${to}`,
      length: Math.hypot(to[0] - from[0], to[1] - from[1]),
      pointAt: fraction => from.map((value, axis) => value + (to[axis] - value) * fraction)
    });
    const curvedSegment = (cx, cy, radius, start, end) => {
      const pointAt = fraction => {
        const angle = start + (end - start) * fraction;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
      };
      const from = pointAt(0);
      const to = pointAt(1);
      return {
        from, to, pointAt, curved: true,
        d: `M${from} A${radius},${radius} 0 0 0 ${to}`,
        length: radius * Math.abs(end - start)
      };
    };
    const outlines = new Map();
    const outlineObserver = new ResizeObserver(entries => {
      entries.forEach(({ target }) => outlines.get(target)());
    });
    document.querySelectorAll('.paper-card').forEach((card, cardIndex) => {
      const cardStyle = getComputedStyle(card);
      const topStyle = getComputedStyle(card, '::after');
      const radius = Number.parseFloat(cardStyle.borderTopLeftRadius);
      const extension = Number.parseFloat(topStyle.width);
      const svg = svgElement('svg', {
        class: 'paper-outline', 'aria-hidden': 'true', focusable: 'false',
        fill: 'none', 'stroke-width': '1'
      });
      card.append(svg);
      let lastWidth = 0;
      let lastHeight = 0;
      const draw = () => {
        const { width, height } = card.getBoundingClientRect();
        if (!width || !height || (width === lastWidth && height === lastHeight)) return;
        lastWidth = width;
        lastHeight = height;
        svg.setAttribute('viewBox', `0 0 ${width + 1} ${height + 1}`);
        const left = .5;
        const top = .5;
        const right = width + .5;
        const bottom = height + .5;
        const r = Math.min(radius, width / 2, height / 2);
        const segments = [
          straightSegment([Math.min(extension, right - r), top], [left + r, top]),
          curvedSegment(left + r, top + r, r, -Math.PI / 2, -Math.PI),
          straightSegment([left, top + r], [left, bottom - r]),
          curvedSegment(left + r, bottom - r, r, Math.PI, Math.PI / 2),
          straightSegment([left + r, bottom], [right - r, bottom]),
          curvedSegment(right - r, bottom - r, r, Math.PI / 2, Math.PI / 4)
        ].filter(segment => segment.length > 0);
        const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
        const opacityAt = distance => Math.min(1, Math.max(0, 2 * (1 - distance / totalLength)));
        const definitions = svgElement('defs');
        let distance = 0;
        const paths = segments.map((segment, segmentIndex) => {
          const path = svgElement('path', { d: segment.d, stroke: 'currentColor' });
          if (opacityAt(distance + segment.length) < 1) {
            const id = `paper-outline-gradient-${cardIndex}-${segmentIndex}`;
            const gradient = svgElement('linearGradient', {
              id, gradientUnits: 'userSpaceOnUse',
              x1: segment.from[0], y1: segment.from[1], x2: segment.to[0], y2: segment.to[1]
            });
            const fractions = [0, 1];
            if (segment.curved) {
              // Map stops to distance around the curve rather than its chord.
              for (let sample = 1; sample < 16; sample++) fractions.push(sample / 16);
            }
            const halfway = (totalLength / 2 - distance) / segment.length;
            if (halfway > 0 && halfway < 1) fractions.push(halfway);
            const dx = segment.to[0] - segment.from[0];
            const dy = segment.to[1] - segment.from[1];
            [...new Set(fractions)].sort((a, b) => a - b).forEach(fraction => {
              const point = segment.pointAt(fraction);
              const offset = ((point[0] - segment.from[0]) * dx + (point[1] - segment.from[1]) * dy) / (dx * dx + dy * dy);
              gradient.append(svgElement('stop', {
                offset: Math.min(1, Math.max(0, offset)),
                'stop-color': 'currentColor',
                'stop-opacity': opacityAt(distance + fraction * segment.length)
              }));
            });
            definitions.append(gradient);
            path.setAttribute('stroke', `url(#${id})`);
          }
          distance += segment.length;
          return path;
        });
        svg.replaceChildren(definitions, ...paths);
        card.classList.add('has-faded-outline');
      };
      outlines.set(card, draw);
      draw();
      outlineObserver.observe(card);
    });
  }

  // Recheck the final section once navigation settles.
  let navigationRefreshTimer;
  const refreshAfterNavigation = () => {
    window.clearTimeout(navigationRefreshTimer);
    navigationRefreshTimer = window.setTimeout(() => {
      window.removeEventListener('scroll', refreshAfterNavigation);
      refreshSectionHighlight();
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
    target.classList.add('navigation-target');
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

  document.querySelectorAll('a.page-scroll').forEach(link => {
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
