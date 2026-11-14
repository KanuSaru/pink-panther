// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Guided tour: a small card that walks through the tool one step at a time.
// Each step does something in the real interface and points at where to look;
// nothing is blocked, so every control stays usable while the tour is open.
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

// steps: [{ key, run({ alive }), focus }] where `key` names the texts key+'T' and key+'B',
// `run` performs the step in the app and `focus` is the id of the element to point at.
export function createTour(steps) {
  let index = -1, token = 0, marked = null, opener = null;

  const unmark = () => { marked?.classList.remove('tour-focus'); marked = null; };

  // Point at the step's element once it is on screen (its data may still be loading)
  function mark(id, mine) {
    const started = Date.now();
    const tick = () => {
      if (mine !== token) return;
      const el = $(id);
      if (el && !el.hidden && el.offsetParent !== null) {
        unmark();
        marked = el;
        el.classList.add('tour-focus');
        const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
      } else if (Date.now() - started < 60000) setTimeout(tick, 300);
    };
    tick();
  }

  function render() {
    const open = index >= 0;
    $('tour').hidden = !open;
    document.body.classList.toggle('touring', open);
    if (!open) return;
    const s = steps[index];
    $('tourCount').textContent = t('tourCount', { a: index + 1, b: steps.length });
    $('tourTitle').textContent = t(s.key + 'T');
    $('tourBody').textContent = t(s.key + 'B');
    $('tourBack').disabled = index === 0;
    $('tourNext').textContent = t(index === steps.length - 1 ? 'tourDone' : 'tourNext');
  }

  function go(i) {
    if (i < 0) return;
    if (i >= steps.length) return end();
    index = i;
    const mine = ++token;
    unmark();
    render();
    $('tourTitle').focus({ preventScroll: true });
    const s = steps[i];
    Promise.resolve(s.run?.({ alive: () => mine === token })).then(() => { if (mine === token && s.focus) mark(s.focus, mine); });
  }

  function end() {
    if (index < 0) return;
    index = -1; token++;
    unmark();
    render();
    opener?.focus();
  }

  $('tourNext').addEventListener('click', () => go(index + 1));
  $('tourBack').addEventListener('click', () => go(index - 1));
  $('tourEnd').addEventListener('click', end);
  $('tour').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); end(); } });

  return {
    start(from) { opener = from || null; go(0); },
    end,
    render, // call again after a language change
    get active() { return index >= 0; },
  };
}
