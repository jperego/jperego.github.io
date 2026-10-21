/* Privacy For Sale · local, dependency-free presentation player. */
(() => {
  'use strict';
  const deck = window.DECK;
  const $ = id => document.getElementById(id);
  const icons = {
    'arrow-left':'<path d="M19 12H5m7-7-7 7 7 7"/>',
    'arrow-right':'<path d="M5 12h14m-7-7 7 7-7 7"/>',
    'chevron-down':'<path d="m6 9 6 6 6-6"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 0 1 4.8 1c0 1.6-2.4 2-2.4 3.5M12 17h.01"/>',
    expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    minimize:'<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  const frames = deck.frames;
  frames.forEach(f => {
    f.pages = f.pages || Array.from({ length: f.lastPage - f.firstPage + 1 }, (_, i) => f.firstPage + i);
    f.steps = f.pages.length;
  });
  const revealPages = frames.flatMap(f => f.pages);
  const revealIndex = new Map(revealPages.map((n, i) => [n, i]));
  const frameFor = n => frames.find(f => n >= f.firstPage && n <= f.lastPage) || frames[0];
  // Tie every rendered page to the exact PDF revision, including file:// use.
  const assetRevision = encodeURIComponent(deck.contentRevision || deck.pdfMtime || '');
  const path = n => `assets/slides/page-${String(n).padStart(3, '0')}.svg?v=${assetRevision}`;
  const thumb = n => `assets/thumbs/page-${String(n).padStart(3, '0')}.webp?v=${assetRevision}`;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clockFormat = new Intl.DateTimeFormat('en-US', {hour: '2-digit', minute: '2-digit', hour12: true});
  let clockVisible = false, clockTimer;
  let page = 1, requestedPage = 1, generation = 0, animation = null;
  let touchStart = null, suppressClick = false;
  let idleTimeout, toastTimeout;
  let heldKey = null, holdTimer, browseRaf, browseCleanup, browsing = false;
  let browseEpoch = 0, browseIndex = 0, browsePosition = 0, browseSpacing = 0;
  const browseCards = new Map();
  // Old cadence: one slide per 620ms. Start 1.5x faster, reach 2x in 4s.
  const HOLD_DELAY = 700, BROWSE_BASE_INTERVAL = 620, BROWSE_ACCELERATION_MS = 2000;
  document.body.classList.add('laser-active');
  const loaded = new Map();
  function load(n) {
    if (loaded.has(n)) return loaded.get(n);
    const promise = new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => { loaded.delete(n); reject(new Error(`Slide ${n} could not be loaded`)); };
      im.src = path(n);
    });
    loaded.set(n, promise);
    return promise;
  }
  function notify(text) {
    $('toast').textContent = text;
    $('toast').classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 2600);
  }
  function setHash() {
    const f = frameFor(page);
    const hash = `#slide=${f.index}&step=${f.pages.indexOf(page) + 1}`;
    if (location.hash !== hash) {
      try { history.replaceState(null, '', hash); } catch (_) { location.hash = hash; }
    }
  }
  function hashPage() {
    const query = new URLSearchParams(location.hash.slice(1));
    const index = Math.max(1, Math.min(frames.length, Number(query.get('slide')) || 1));
    const f = frames[index - 1];
    const step = Math.max(1, Math.min(f.steps, Number(query.get('step')) || 1));
    return f.pages[step - 1];
  }
  function updateClock() {
    clearTimeout(clockTimer);
    const now = new Date();
    const parts = clockFormat.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const period = parts.find(p => p.type === 'dayPeriod').value;
    $('hudTime').textContent = `${hour}:${minute}`;
    $('hudPeriod').textContent = period;
    $('hudClock').dateTime = `${String(now.getHours()).padStart(2, '0')}:${minute}`;
    $('hudClock').setAttribute('aria-label', `Local time ${hour}:${minute} ${period}`);
    // Update on the minute, without blinking seconds or continuous animation.
    clockTimer = setTimeout(updateClock, 60000 - now.getTime() % 60000 + 30);
  }
  function updateClockVisibility(frame) {
    // Keep one persistent clock throughout the content, including reveal clicks.
    // Section dividers and the opening/closing paper-title cards stay clear.
    const visible = !frame.isDivider && frame.index !== 1 && frame.title !== deck.title;
    if (visible === clockVisible) return;
    clockVisible = visible;
    $('slideHud').classList.toggle('is-visible', visible);
    $('slideHud').setAttribute('aria-hidden', String(!visible));
  }
  function updateUI() {
    const f = frameFor(page), step = f.pages.indexOf(page) + 1;
    updateClockVisibility(f);
    $('frameNumber').textContent = String(f.index).padStart(2, '0');
    $('slideTitle').textContent = f.label || f.title;
    $('chapterLabel').textContent = f.section;
    $('slideImage').alt = `${f.title}. Slide ${f.index} of ${frames.length}, reveal ${step} of ${f.steps}.`;
    $('prevButton').disabled = page === revealPages[0];
    $('nextButton').disabled = page === revealPages[revealPages.length - 1];
    const steps = $('steps');
    // Keep the same buttons during reveals so the active marker can glide
    // between them instead of being destroyed and recreated at every click.
    if (steps.dataset.frame !== String(f.index)) {
      steps.replaceChildren();
      steps.dataset.frame = String(f.index);
      for (let i = 1; i <= f.steps; i++) {
        const b = document.createElement('button');
        b.className = 'step-dot';
        b.title = `Reveal ${i} of ${f.steps}`;
        b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => go(f.pages[i - 1]));
        steps.append(b);
      }
    }
    [...steps.children].forEach((b, i) => {
      b.classList.toggle('is-active', i + 1 === step);
      b.classList.toggle('is-complete', i + 1 < step);
      if (i + 1 === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    const rail = $('filmstrip');
    rail.querySelectorAll('button').forEach((b, i) => {
      const current = i === f.index - 1;
      b.classList.toggle('is-active', current);
      b.tabIndex = current ? 0 : -1;
      if (current) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (rail.dataset.frame !== String(f.index)) {
      rail.dataset.frame = String(f.index);
      const selected = rail.children[f.index - 1];
      // Move only this rail, never the document or presentation area.
      if (selected && !browsing) rail.scrollTo({left: selected.offsetLeft - rail.clientWidth / 2 + selected.offsetWidth / 2,
        behavior: reducedMotion.matches || browsing ? 'instant' : 'smooth'});
    }
    $('chapterList').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.section === f.section));
    $('announcement').textContent = `${f.title}. Slide ${f.index} of ${frames.length}. Reveal ${step} of ${f.steps}.`;
    document.title = `${f.label || f.title} · ${deck.title}`;
    setHash();
  }
  function updateProgress(n, instant = false) {
    const bar = $('slideProgress'), fill = $('slideProgressFill');
    const target = deck.progress?.[n];
    if (!target) { bar.hidden = true; return; }
    bar.style.top = `${target.top}%`;
    bar.style.height = `${target.height}%`;
    fill.style.backgroundColor = target.color;
    const wasHidden = bar.hidden;
    bar.hidden = false;
    if (instant || reducedMotion.matches) fill.style.transition = 'none';
    // Establish the retained width when returning from a section/title slide.
    if (wasHidden) void fill.offsetWidth;
    fill.style.transform = `scaleX(${target.fraction})`;
    if (instant || reducedMotion.matches) {
      void fill.offsetWidth;
      fill.style.transition = '';
    }
  }
  async function go(next, opts = {}) {
    if (!opts.browse) stopHold();
    hideLaser();
    next = Math.max(1, Math.min(deck.totalPages, next));
    // Internal PDF links may target a duplicate; use its identical visible reveal.
    next = frameFor(next).pages.reduce((kept, n) => n <= next ? n : kept);
    const myGeneration = ++generation;
    requestedPage = next;
    try { await load(next); }
    catch (_) { if (myGeneration === generation) requestedPage = page; notify('Unable to load this slide. Keep the assets folder beside index.html.'); return; }
    if (myGeneration !== generation) return;
    const previous = page;
    if (animation) { animation.cancel(); animation = null; }
    window.SlideMotion.cancel();
    $('transitionImage').style.visibility = 'hidden';
    $('slideImage').src = path(previous);
    page = next;
    const sameFrame = frameFor(previous).index === frameFor(next).index;
    updateProgress(next, opts.instant);
    const isSectionOpening = !sameFrame && frameFor(next).isDivider;
    const motionPlan = !opts.instant && !reducedMotion.matches && next > previous
      ? window.SlideMotion.plan(next, previous) : null;
    const incoming = motionPlan ? window.SlideMotion.prepare(motionPlan) : $('transitionImage');
    if (!motionPlan) incoming.src = path(next);
    if (previous !== next && !opts.instant && !reducedMotion.matches) {
      incoming.style.visibility = 'visible';
      animation = incoming.animate([{ opacity: 0 }, { opacity: 1 }], {
        // A gentler reveal keeps shared content stationary while additions fade in.
        duration: isSectionOpening ? 520 : sameFrame ? 320 : 240,
        easing: sameFrame || isSectionOpening ? 'cubic-bezier(.25,.1,.25,1)' : 'cubic-bezier(.22,1,.36,1)',
        fill: 'both'
      });
      const thisAnimation = animation;
      thisAnimation.onfinish = () => {
        if (myGeneration !== generation) return;
        if (!motionPlan) {
          $('slideImage').src = path(next);
          incoming.style.visibility = 'hidden';
        }
        thisAnimation.cancel(); animation = null;
      };
      if (motionPlan) window.SlideMotion.play(() => {
        if (myGeneration !== generation) return;
        $('slideImage').src = path(next);
        window.SlideMotion.cancel();
      });
    } else {
      $('slideImage').src = path(next); incoming.style.visibility = 'hidden';
    }
    updateUI();
    const position = revealIndex.get(next);
    for (const i of [position - 1, position + 1, position + 2]) {
      if (revealPages[i]) load(revealPages[i]).catch(() => {});
    }
  }
  function advance(direction, skip = false, fromHold = false) {
    if (!fromHold) stopHold();
    if (document.body.classList.contains('is-blank')) { toggleBlank(false); return; }
    if (skip) {
      const f = frameFor(requestedPage), index = f.index - 1;
      const target = frames[index + direction];
      if (target) go(target.firstPage, { browse: true });
    } else {
      const position = revealIndex.get(requestedPage);
      if (direction > 0 && position === revealPages.length - 1) { notify('You’ve reached the end of the deck'); return; }
      go(revealPages[Math.max(0, Math.min(revealPages.length - 1, position + direction))], { browse: true });
    }
  }
  function layoutStage() {
    const column = document.querySelector('.slide-column');
    const ratio = deck.pdfDimensionsPt[0] / deck.pdfDimensionsPt[1];
    const width = Math.max(1, Math.min(column.clientWidth, column.clientHeight * ratio));
    $('stage').style.width = `${width}px`;
    column.style.setProperty('--slide-width', `${width}px`);
    if (browsing) { refreshBrowseRail(); renderBrowseCards(); }
  }
  new ResizeObserver(layoutStage).observe(document.querySelector('.slide-column'));

  function renderBrowseCards() {
    const container = $('browseCards'), width = $('stage').offsetWidth;
    browseSpacing = width * .80 + 28;
    for (const [i, card] of browseCards) {
      if (Math.abs(i - browseIndex) > 3) { card.remove(); browseCards.delete(i); }
    }
    for (let i = Math.max(0, browseIndex - 3); i <= Math.min(frames.length - 1, browseIndex + 3); i++) {
      if (browseCards.has(i)) continue;
      const card = document.createElement('div'); card.className = 'browse-card'; card.dataset.index = i;
      const image = document.createElement('img'); image.src = path(frames[i].lastPage); image.alt = '';
      image.draggable = false; card.append(image);
      const progress = deck.progress?.[frames[i].lastPage];
      if (progress) {
        const bar = document.createElement('span'); bar.className = 'browse-progress';
        Object.assign(bar.style, {top: `${progress.top}%`, height: `${progress.height}%`,
          width: `${progress.fraction * 100}%`, background: progress.color});
        card.append(bar);
      }
      browseCards.set(i, card); container.append(card);
    }
    paintBrowseCards();
  }
  function paintBrowseCards() {
    // Continuous position: no per-slide ease/restart, layout reads, or DOM creation.
    for (const [i, card] of browseCards) {
      const offset = i - browsePosition, distance = Math.abs(offset);
      const focus = (1 + Math.cos(Math.PI * Math.min(1, distance))) / 2;
      const scale = .73 + .07 * focus;
      card.style.transform = `translate3d(${offset * browseSpacing}px,${(1 - focus) * 8}px,0) scale(${scale})`;
      card.style.opacity = Math.pow(Math.max(0, 1 - distance / 2.2), 1.3);
      card.classList.toggle('is-selected', i === browseIndex);
    }
    // The thumbnail rail follows the same continuous position, without jumping.
    if (browseRailMetrics && !document.body.classList.contains('presenting')) {
      const {start, stride} = browseRailMetrics;
      $('filmstrip').scrollLeft = start + (reducedMotion.matches ? browseIndex : browsePosition) * stride;
    }
  }
  let browseRailMetrics = null;
  function refreshBrowseRail() {
    const rail = $('filmstrip'), first = rail.children[0], second = rail.children[1];
    browseRailMetrics = first && second ? {
      start: first.offsetLeft - rail.clientWidth / 2 + first.offsetWidth / 2,
      stride: second.offsetLeft - first.offsetLeft
    } : null;
  }
  function selectBrowseSlide() {
    const index = Math.round(browsePosition);
    if (index === browseIndex) return;
    browseIndex = index;
    renderBrowseCards();
    go(frames[index].lastPage, {instant: true, browse: true});
    // Preload ahead of the moving camera, rather than waiting between slides.
    const direction = heldKey?.direction || 1;
    for (let ahead = 1; ahead <= 5; ahead++) {
      const frame = frames[index + direction * ahead];
      if (frame) load(frame.lastPage).catch(() => {});
    }
  }
  function startHold(key, direction, skip) {
    stopHold();
    const hold = {key, direction}; heldKey = hold;
    const wasBlank = document.body.classList.contains('is-blank');
    advance(direction, skip, true);
    if (wasBlank) { heldKey = null; return; }
    holdTimer = setTimeout(() => {
      if (heldKey !== hold) return;
      browseIndex = frameFor(requestedPage).index - 1;
      if (!frames[browseIndex + direction]) return;
      browsing = true; const epoch = ++browseEpoch;
      browsePosition = browseIndex;
      clearTimeout(browseCleanup);
      browseCards.clear(); $('browseCards').replaceChildren();
      refreshBrowseRail(); renderBrowseCards();
      document.body.classList.add('is-browsing');
      hideLaser();
      go(frames[browseIndex].lastPage, {instant: true, browse: true});
      for (let i = -3; i <= 5; i++) {
        const frame = frames[browseIndex + direction * i];
        if (frame) load(frame.lastPage).catch(() => {});
      }
      const started = performance.now(), origin = browsePosition;
      function tick(now) {
        if (!browsing || heldKey !== hold || epoch !== browseEpoch) return;
        // Integrate the speed curve against elapsed time, so dropped frames
        // cannot slow the journey. Reach 2x after two seconds of browsing.
        const elapsed = Math.max(0, now - started);
        const ramp = Math.min(1, elapsed / BROWSE_ACCELERATION_MS);
        const distance = (BROWSE_ACCELERATION_MS *
          (1.5 * ramp + .5 * ramp ** 3 - .25 * ramp ** 4) +
          2 * Math.max(0, elapsed - BROWSE_ACCELERATION_MS)) / BROWSE_BASE_INTERVAL;
        browsePosition = Math.max(0, Math.min(frames.length - 1, origin + direction * distance));
        selectBrowseSlide(); paintBrowseCards();
        if (browsePosition > 0 && browsePosition < frames.length - 1) browseRaf = requestAnimationFrame(tick);
      }
      browseRaf = requestAnimationFrame(tick);
    }, HOLD_DELAY);
  }
  function closeBrowse() {
    browsing = false;
    document.body.classList.remove('is-browsing');
    browseCleanup = setTimeout(() => {
      if (!browsing) { browseCards.clear(); $('browseCards').replaceChildren(); }
    }, reducedMotion.matches ? 0 : 360);
  }
  function stopHold(settle = false) {
    clearTimeout(holdTimer); cancelAnimationFrame(browseRaf); heldKey = null;
    const epoch = ++browseEpoch;
    if (!browsing) return;
    const origin = browsePosition, target = Math.round(origin);
    if (!settle || reducedMotion.matches || Math.abs(origin - target) < .015) { closeBrowse(); return; }
    const started = performance.now();
    // Finish the fractional travel, then smoothly return the selected slide to full size.
    function finish(now) {
      if (epoch !== browseEpoch) return;
      const t = Math.min(1, (now - started) / 180);
      browsePosition = origin + (target - origin) * (1 - Math.pow(1 - t, 3));
      paintBrowseCards();
      if (t < 1) browseRaf = requestAnimationFrame(finish);
      else closeBrowse();
    }
    browseRaf = requestAnimationFrame(finish);
  }
  function toggleBlank(value) {
    stopHold();
    hideLaser();
    const on = value ?? !document.body.classList.contains('is-blank');
    document.body.classList.toggle('is-blank', on);
    $('blackout').setAttribute('aria-hidden', String(!on));
  }
  function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
  function showDialog(id) {
    stopHold();
    hideLaser();
    closeDialogs();
    if (document.body.classList.contains('is-blank')) toggleBlank(false);
    $(id).showModal();
  }
  function makeNavigation() {
    frames.forEach(f => {
      const button = document.createElement('button');
      button.className = 'filmstrip-slide'; button.dataset.frame = f.index;
      button.title = `${f.index}. ${f.label || f.title}`;
      button.setAttribute('aria-label', `Slide ${f.index}: ${f.title}`);
      const image = document.createElement('img');
      image.src = thumb(f.lastPage); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      image.draggable = false;
      const label = document.createElement('span'); label.className = 'filmstrip-label';
      const number = document.createElement('span'); number.textContent = String(f.index).padStart(2, '0');
      const title = document.createElement('span'); title.textContent = f.label || f.title;
      label.append(number, title); button.append(image, label);
      button.addEventListener('click', () => { go(f.firstPage); $('stage').focus({preventScroll: true}); });
      $('filmstrip').append(button);
    });
    deck.sections.forEach((s, i) => {
      const b = document.createElement('button'); b.dataset.section = s.label;
      const num = document.createElement('span'); num.textContent = String(i + 1).padStart(2, '0');
      const label = document.createElement('span'); label.textContent = s.label;
      const arrow = document.createElement('span'); arrow.innerHTML = icon('arrow-right');
      b.append(num, label, arrow); b.addEventListener('click', () => { closeDialogs(); go(s.firstPage); }); $('chapterList').append(b);
    });
  }
  async function toggleFullscreen() {
    if (document.body.classList.contains('presenting')) { exitPresentation(); return; }
    stopHold(); closeDialogs(); document.body.classList.add('presenting');
    $('stage').focus({ preventScroll: true });
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); }
    catch (_) { /* The distraction-free layout also works without the Fullscreen API. */ }
    wake(); notify('Clicker or arrow keys to advance · Esc to exit');
  }
  function exitPresentation() {
    stopHold();
    document.body.classList.remove('presenting', 'pointer-idle');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function wake() {
    document.body.classList.remove('pointer-idle'); clearTimeout(idleTimeout);
    if (document.body.classList.contains('presenting')) idleTimeout = setTimeout(() => document.body.classList.add('pointer-idle'), 2200);
  }
  function hideLaser() { $('laser').style.display = 'none'; }
  $('home').onclick = () => go(1);
  $('prevButton').onclick = () => advance(-1);
  $('nextButton').onclick = () => advance(1);
  $('chaptersButton').onclick = () => showDialog('chapters');
  $('helpButton').onclick = () => showDialog('help');
  $('fullscreenButton').onclick = toggleFullscreen;
  $('exitPresent').onclick = exitPresentation;
  $('filmstrip').addEventListener('wheel', e => {
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const rail = $('filmstrip');
    if (rail.scrollWidth <= rail.clientWidth) return;
    e.preventDefault();
    rail.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? rail.clientWidth : 1);
  }, {passive: false});
  document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } }));
  $('stage').addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    if (e.target.closest('a')) return;
    advance(e.shiftKey ? -1 : 1);
  });
  $('stage').addEventListener('pointermove', e => {
    if (browsing || e.pointerType === 'touch' || document.body.classList.contains('is-blank') || document.querySelector('dialog[open]')) { hideLaser(); return; }
    const r = $('stage').getBoundingClientRect();
    $('laser').style.left = `${e.clientX - r.left}px`; $('laser').style.top = `${e.clientY - r.top}px`; $('laser').style.display = 'block';
  });
  $('stage').addEventListener('pointerleave', hideLaser);
  $('stage').addEventListener('pointercancel', hideLaser);
  $('stage').addEventListener('pointerdown', e => { if (e.pointerType === 'touch') hideLaser(); });
  $('stage').addEventListener('touchstart', e => {
    hideLaser();
    touchStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  $('stage').addEventListener('touchend', e => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x, dy = e.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { advance(dx < 0 ? 1 : -1); suppressClick = true; setTimeout(() => suppressClick = false, 450); }
    touchStart = null;
  }, { passive: true });
  $('stage').addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
  window.addEventListener('blur', () => { stopHold(); hideLaser(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopHold(); clearTimeout(clockTimer); }
    else updateClock();
    hideLaser();
  });
  document.addEventListener('pointermove', wake, { passive: true });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) exitPresentation(); });
  window.addEventListener('hashchange', () => go(hashPage(), { instant: true }));
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    stopHold();
    updateProgress(page, true);
    if (animation) { animation.cancel(); animation = null; }
    $('slideImage').src = path(page);
    $('transitionImage').style.visibility = 'hidden';
    window.SlideMotion.cancel();
  });
  document.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if (key === 'escape' && document.querySelector('dialog[open]')) { e.preventDefault(); closeDialogs(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    // Preserve normal activation of controls outside presentation mode. Clicker
    // navigation keys still work when a toolbar control happens to have focus.
    if ([' ', 'enter'].includes(key) && e.target.closest('button,a') && !document.body.classList.contains('presenting')) return;
    const handled = ['arrowright','arrowleft','arrowdown','arrowup','pagedown','pageup',' ','enter','home','end','f','b','.','?','escape'];
    if (!handled.includes(key)) return;
    e.preventDefault();
    // Own the hold cadence; OS key repeats must not race through reveals.
    if (e.repeat) return;
    hideLaser();
    if (['arrowright','arrowdown','pagedown','arrowleft','arrowup','pageup'].includes(key)) {
      const direction = ['arrowright','arrowdown','pagedown'].includes(key) ? 1 : -1;
      startHold(key, direction, e.shiftKey);
    }
    else if ([' ', 'enter'].includes(key)) { stopHold(); advance(e.shiftKey && key === ' ' ? -1 : 1); }
    else if (key === 'home') go(1);
    else if (key === 'end') go(deck.totalPages);
    else if (key === 'f') toggleFullscreen();
    else if (key === 'b' || key === '.') toggleBlank();
    else if (key === '?') showDialog('help');
    else if (key === 'escape') { exitPresentation(); toggleBlank(false); }
  });
  document.addEventListener('keyup', e => {
    if (heldKey?.key === e.key.toLowerCase()) stopHold(true);
  });
  makeNavigation();
  updateClock();
  go(hashPage(), { instant: true });
})();
