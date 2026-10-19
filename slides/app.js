/* Privacy For Sale · local, dependency-free presentation player. */
(() => {
  'use strict';
  const deck = window.DECK;
  const $ = id => document.getElementById(id);
  const icons = {
    'arrow-left':'<path d="M19 12H5m7-7-7 7 7 7"/>',
    'arrow-right':'<path d="M5 12h14m-7-7 7 7-7 7"/>',
    'chevron-down':'<path d="m6 9 6 6 6-6"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 0 1 4.8 1c0 1.6-2.4 2-2.4 3.5M12 17h.01"/>',
    expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    minimize:'<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
  const frames = deck.frames;
  const frameFor = n => frames.find(f => n >= f.firstPage && n <= f.lastPage) || frames[0];
  // Tie every rendered page to the exact PDF revision, including file:// use.
  const assetRevision = encodeURIComponent(deck.contentRevision || deck.pdfMtime || '');
  const path = n => `assets/slides/page-${String(n).padStart(3, '0')}.svg?v=${assetRevision}`;
  const thumb = n => `assets/thumbs/page-${String(n).padStart(3, '0')}.webp?v=${assetRevision}`;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let page = 1, requestedPage = 1, generation = 0, animation = null;
  let activeSection = 'All slides', touchStart = null, suppressClick = false;
  let idleTimeout, toastTimeout, searchTimeout;
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
    const hash = `#slide=${f.index}&step=${page - f.firstPage + 1}`;
    if (location.hash !== hash) {
      try { history.replaceState(null, '', hash); } catch (_) { location.hash = hash; }
    }
  }
  function hashPage() {
    const query = new URLSearchParams(location.hash.slice(1));
    const index = Math.max(1, Math.min(frames.length, Number(query.get('slide')) || 1));
    const f = frames[index - 1];
    const step = Math.max(1, Math.min(f.steps, Number(query.get('step')) || 1));
    return f.firstPage + step - 1;
  }
  function updateUI() {
    const f = frameFor(page), step = page - f.firstPage + 1;
    $('frameNumber').textContent = String(f.index).padStart(2, '0');
    $('slideTitle').textContent = f.label || f.title;
    $('chapterLabel').textContent = f.section;
    $('slideImage').alt = `${f.title}. Slide ${f.index} of ${frames.length}, reveal ${step} of ${f.steps}.`;
    $('prevButton').disabled = page === 1;
    $('nextButton').disabled = page === deck.totalPages;
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
        b.addEventListener('click', () => go(f.firstPage + i - 1));
        steps.append(b);
      }
    }
    [...steps.children].forEach((b, i) => {
      b.classList.toggle('is-active', i + 1 === step);
      b.classList.toggle('is-complete', i + 1 < step);
      if (i + 1 === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    $('timeline').querySelectorAll('button').forEach((b, i) => {
      b.classList.toggle('is-active', i === f.index - 1);
      b.classList.toggle('is-complete', i < f.index - 1);
      if (i === f.index - 1) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    $('chapterList').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.section === f.section));
    $('slideGrid').querySelectorAll('button').forEach(b => b.classList.toggle('current', Number(b.dataset.frame) === f.index));
    $('announcement').textContent = `${f.title}. Slide ${f.index} of ${frames.length}. Reveal ${step} of ${f.steps}.`;
    document.title = `${f.label || f.title} · Privacy For Sale`;
    setHash();
  }
  async function go(next, opts = {}) {
    hideLaser();
    next = Math.max(1, Math.min(deck.totalPages, next));
    const myGeneration = ++generation;
    requestedPage = next;
    try { await load(next); }
    catch (_) { notify('Unable to load this slide. Keep the assets folder beside index.html.'); return; }
    if (myGeneration !== generation) return;
    const previous = page;
    if (animation) { animation.cancel(); animation = null; }
    window.SlideMotion.cancel();
    $('transitionImage').style.visibility = 'hidden';
    $('slideImage').src = path(previous);
    page = next;
    const sameFrame = frameFor(previous).index === frameFor(next).index;
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
    for (const n of [next - 1, next + 1, next + 2]) if (n >= 1 && n <= deck.totalPages) load(n).catch(() => {});
  }
  function advance(direction, skip = false) {
    if (document.body.classList.contains('is-blank')) { toggleBlank(false); return; }
    if (skip) {
      const f = frameFor(requestedPage), index = f.index - 1;
      const target = frames[index + direction];
      if (target) go(target.firstPage);
    } else {
      if (direction > 0 && requestedPage === deck.totalPages) { notify('You’ve reached the end of the deck'); return; }
      go(requestedPage + direction);
    }
  }
  function toggleBlank(value) {
    hideLaser();
    const on = value ?? !document.body.classList.contains('is-blank');
    document.body.classList.toggle('is-blank', on);
    $('blackout').setAttribute('aria-hidden', String(!on));
  }
  function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
  function showDialog(id) {
    hideLaser();
    closeDialogs();
    if (document.body.classList.contains('is-blank')) toggleBlank(false);
    $(id).showModal();
  }
  function renderGrid() {
    const query = $('slideSearch').value.toLocaleLowerCase().trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const shown = frames.filter(f => (activeSection === 'All slides' || f.section === activeSection)
      && terms.every(t => `${f.title} ${f.label} ${f.section} ${f.searchText}`.toLocaleLowerCase().includes(t)));
    const current = frameFor(page);
    const fragment = document.createDocumentFragment();
    for (const f of shown) {
      const card = document.createElement('button');
      card.className = `slide-card${f.index === current.index ? ' current' : ''}`;
      card.dataset.frame = f.index;
      card.setAttribute('aria-label', `Slide ${f.index}: ${f.title}, ${f.steps} reveal${f.steps > 1 ? 's' : ''}`);
      const img = document.createElement('img');
      img.className = 'thumbnail'; img.src = thumb(f.lastPage); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      card.append(img);
      if (f.steps > 1) { const tag = document.createElement('span'); tag.className = 'card-steps'; tag.textContent = `${f.steps} reveals`; card.append(tag); }
      const meta = document.createElement('span'); meta.className = 'card-meta';
      const number = document.createElement('span'); number.className = 'card-number'; number.textContent = String(f.index).padStart(2, '0');
      const label = document.createElement('span'); label.className = 'card-label'; label.textContent = f.label || f.title;
      meta.append(number, label); card.append(meta);
      card.addEventListener('click', () => { closeDialogs(); go(f.firstPage); $('stage').focus({ preventScroll: true }); });
      fragment.append(card);
    }
    $('slideGrid').replaceChildren(fragment);
    $('resultsCount').textContent = `${shown.length} slide${shown.length === 1 ? '' : 's'}${activeSection !== 'All slides' ? ' · ' + activeSection : ''}`;
    $('noResults').hidden = shown.length !== 0;
    $('sectionFilters').querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.section === activeSection);
      b.setAttribute('aria-pressed', String(b.dataset.section === activeSection));
    });
  }
  function overview(search = false) {
    activeSection = 'All slides'; $('slideSearch').value = ''; renderGrid(); showDialog('overview');
    if (search) $('slideSearch').focus();
    else {
      const current = $('slideGrid').querySelector('.current');
      if (current) { current.focus({ preventScroll: true }); current.scrollIntoView({ block: 'center' }); }
    }
  }
  function makeNavigation() {
    frames.forEach((f, i) => {
      const b = document.createElement('button');
      b.title = `${f.index}. ${f.label || f.title}`; b.setAttribute('aria-label', b.title);
      if (f.isDivider) b.classList.add('is-divider');
      if (i && f.section !== frames[i - 1].section) b.dataset.sectionStart = 'true';
      b.addEventListener('click', () => go(f.firstPage)); $('timeline').append(b);
    });
    ['All slides', ...deck.sections.map(s => s.label)].forEach(s => {
      const b = document.createElement('button'); b.dataset.section = s;
      const label = document.createTextNode(s); const count = document.createElement('span');
      count.textContent = s === 'All slides' ? frames.length : frames.filter(f => f.section === s).length;
      b.append(label, count);
      b.addEventListener('click', () => { activeSection = s; renderGrid(); }); $('sectionFilters').append(b);
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
    closeDialogs(); document.body.classList.add('presenting');
    $('stage').focus({ preventScroll: true });
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); }
    catch (_) { /* The distraction-free layout also works without the Fullscreen API. */ }
    wake(); notify('Clicker or arrow keys to advance · Esc to exit');
  }
  function exitPresentation() {
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
  $('overviewButton').onclick = () => overview();
  $('slideInfo').onclick = () => overview();
  $('chaptersButton').onclick = () => showDialog('chapters');
  $('helpButton').onclick = () => showDialog('help');
  $('fullscreenButton').onclick = toggleFullscreen;
  $('exitPresent').onclick = exitPresentation;
  $('slideSearch').addEventListener('input', () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(renderGrid, 80); });
  $('slideGrid').addEventListener('keydown', e => {
    const cards = [...$('slideGrid').querySelectorAll('.slide-card')];
    const index = cards.indexOf(e.target.closest('.slide-card'));
    if (index < 0) return;
    const cols = getComputedStyle($('slideGrid')).gridTemplateColumns.split(' ').length;
    let next = index;
    if (e.key === 'ArrowRight') next++;
    else if (e.key === 'ArrowLeft') next--;
    else if (e.key === 'ArrowDown') next += cols;
    else if (e.key === 'ArrowUp') next -= cols;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cards.length - 1;
    else return;
    e.preventDefault();
    cards[Math.max(0, Math.min(cards.length - 1, next))].focus();
  });
  document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } }));
  $('stage').addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    if (e.target.closest('a')) return;
    advance(e.shiftKey ? -1 : 1);
  });
  $('stage').addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || document.body.classList.contains('is-blank') || document.querySelector('dialog[open]')) { hideLaser(); return; }
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
  window.addEventListener('blur', hideLaser);
  document.addEventListener('visibilitychange', hideLaser);
  document.addEventListener('pointermove', wake, { passive: true });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) exitPresentation(); });
  window.addEventListener('hashchange', () => go(hashPage(), { instant: true }));
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    if (animation) { animation.cancel(); animation = null; }
    $('slideImage').src = path(page);
    $('transitionImage').style.visibility = 'hidden';
    window.SlideMotion.cancel();
  });
  document.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if (key === 'escape' && document.querySelector('dialog[open]')) { e.preventDefault(); closeDialogs(); return; }
    if ((e.metaKey || e.ctrlKey) && key === 'k') { e.preventDefault(); if (!e.repeat) overview(true); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    // Preserve normal activation of controls outside presentation mode. Clicker
    // navigation keys still work when a toolbar control happens to have focus.
    if ([' ', 'enter'].includes(key) && e.target.closest('button,a') && !document.body.classList.contains('presenting')) return;
    const handled = ['arrowright','arrowleft','arrowdown','arrowup','pagedown','pageup',' ','enter','home','end','o','f','b','.','?','escape'];
    if (!handled.includes(key)) return;
    e.preventDefault();
    // Most clickers emit keyboard events. A held button should reveal one step,
    // rather than race through the deck via the operating system's key repeat.
    if (e.repeat) return;
    hideLaser();
    if (['arrowright','arrowdown','pagedown',' ','enter'].includes(key)) advance(e.shiftKey && key === ' ' ? -1 : 1, e.shiftKey && ![' ', 'enter'].includes(key));
    else if (['arrowleft','arrowup','pageup'].includes(key)) advance(-1, e.shiftKey);
    else if (key === 'home') go(1);
    else if (key === 'end') go(deck.totalPages);
    else if (key === 'o') overview();
    else if (key === 'f') toggleFullscreen();
    else if (key === 'b' || key === '.') toggleBlank();
    else if (key === '?') showDialog('help');
    else if (key === 'escape') { exitPresentation(); toggleBlank(false); }
  });
  makeNavigation();
  go(hashPage(), { instant: true });
})();
