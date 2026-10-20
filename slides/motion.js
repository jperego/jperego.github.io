/* Draw the original vector paths; canonical slide images remain the fallback. */
(() => {
  'use strict';
  const entries = window.DECK_MOTION || {};
  const surface = document.getElementById('motionSlide');
  let raf = null, tasks = [];
  const smooth = t => t * t * (3 - 2 * t);

  function cancel() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    tasks = [];
    surface.hidden = true;
    surface.replaceChildren();
    delete surface.dataset.kind;
  }
  function plan(next, previous) {
    const entry = entries[next], prior = entries[previous];
    if (!entry) return null;
    if (entry.kind === 'border') return prior?.key === entry.key ? null : entry;
    const oldArrows = new Set(prior?.key === entry.key ? prior.arrows : []);
    const activeArrows = entry.arrows.filter(key => !oldArrows.has(key));
    return activeArrows.length ? { ...entry, activeArrows } : null;
  }
  function draw(el, start, duration, reverse = false) {
    const length = el.getTotalLength();
    const offset = reverse ? -length : length;
    el.style.strokeDasharray = `${length} ${length}`;
    el.style.strokeDashoffset = String(offset);
    el.style.opacity = '0';
    tasks.push({ start, duration, apply: t => {
      el.style.opacity = t > 0 ? '1' : '0';
      el.style.strokeDashoffset = String(offset * (1 - smooth(t)));
    }});
  }
  function fade(el, start, duration) {
    el.style.opacity = '0';
    tasks.push({ start, duration, apply: t => { el.style.opacity = String(smooth(t)); } });
  }
  function prepare(entry) {
    cancel();
    // This markup is generated locally from the same PDF as the static slides.
    surface.innerHTML = entry.svg;
    surface.hidden = false;
    surface.dataset.kind = entry.kind;
    if (entry.kind === 'border') {
      // Start at the faded bottom-right edge, climb the left side, and finish
      // around the heading with the dot. Arrow paths keep their own direction.
      const rect = surface.querySelector('[data-motion="tail"]');
      const width = Number(rect.dataset.fullWidth);
      const x = Number(rect.getAttribute('x'));
      rect.setAttribute('x', String(x + width));
      rect.setAttribute('width', '0');
      tasks.push({ start: 0, duration: 260, apply: t => {
        const shown = width * smooth(t);
        rect.setAttribute('x', String(x + width - shown));
        rect.setAttribute('width', String(shown));
      }});
      draw(surface.querySelector('[data-motion="border"]'), 260, 600, true);
      fade(surface.querySelector('[data-motion="dot"]'), 860, 120);
    } else {
      entry.activeArrows.forEach((key, i) => {
        const start = 100 + i * 70;
        draw(surface.querySelector(`[data-motion="arrow"][data-arrow="${key}"]`), start, 600);
        surface.querySelectorAll(`[data-motion="head"][data-arrow="${key}"]`).forEach(el => fade(el, start + 575, 90));
      });
    }
    return surface;
  }
  function play(onfinish) {
    const started = performance.now();
    const duration = Math.max(...tasks.map(t => t.start + t.duration));
    function tick(now) {
      const elapsed = now - started;
      tasks.forEach(task => task.apply(Math.max(0, Math.min(1, (elapsed - task.start) / task.duration))));
      if (elapsed < duration) raf = requestAnimationFrame(tick);
      else { raf = null; onfinish(); }
    }
    raf = requestAnimationFrame(tick);
  }
  window.SlideMotion = { plan, prepare, play, cancel };
})();
