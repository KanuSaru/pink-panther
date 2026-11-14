// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Small interface pieces with no dependencies: term explanations, a toast and a number count-up.
import { t } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function infoIcon() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '8'); ring.setAttribute('cy', '8'); ring.setAttribute('r', '6.5');
  const mark = document.createElementNS(NS, 'path');
  mark.setAttribute('d', 'M8 7.3v3.9M8 4.7v.1');
  svg.append(ring, mark);
  return svg;
}

// Place an open explanation under its button, kept inside the viewport
function place(tip, btn) {
  const b = btn.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight, gap = 6, edge = 8;
  const left = Math.max(edge, Math.min(b.left, innerWidth - w - edge));
  const below = b.bottom + gap + h <= innerHeight - edge;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? b.bottom + gap : Math.max(edge, b.top - gap - h)}px`;
}

// An explanation is a native popover opened by its own button: the browser handles
// toggling, Escape, clicking away and returning focus.
function tipFor(key) {
  const id = `tip-${key}`;
  let tip = document.getElementById(id);
  if (tip) return tip;
  tip = document.createElement('div');
  tip.id = id; tip.className = 'tip'; tip.popover = 'auto';
  tip.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    tip.textContent = t(key);
    const btn = document.querySelector(`[popovertarget="${id}"]`);
    if (btn) place(tip, btn);
  });
  document.body.append(tip);
  return tip;
}

// Turn every <button class="info" data-tip="key" data-tip-for="labelKey"> into a working explanation button.
// Safe to call again after a re-render or a language change.
export function hydrateTips(root = document) {
  const native = 'popover' in HTMLElement.prototype;
  root.querySelectorAll('button.info[data-tip]').forEach((btn) => {
    const key = btn.dataset.tip;
    if (!btn.firstChild) btn.append(infoIcon());
    btn.type = 'button';
    btn.setAttribute('aria-label', t('explain', { x: t(btn.dataset.tipFor || key) }));
    if (native) btn.setAttribute('popovertarget', tipFor(key).id);
    else btn.title = t(key); // older browsers: the explanation is the native tooltip
  });
}

export function infoButton(key, labelKey) {
  const btn = document.createElement('button');
  btn.className = 'info';
  btn.dataset.tip = key;
  btn.dataset.tipFor = labelKey;
  return btn;
}

// The one entrance in the interface: a result settling in when a new answer arrives
export function arrive(el) {
  if (reducedMotion() || !el.animate) return;
  el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
}

let toastTimer = null;
export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Write `text` into `el`, counting the number at the start of `token` up from zero.
// `token` is the formatted value as it appears in the text (for example "1.47 °C").
const running = new WeakMap();
export function countUp(el, text, token) {
  cancelAnimationFrame(running.get(el));
  const at = token ? text.indexOf(token) : -1;
  const m = at >= 0 ? token.match(/^\d+(?:([.,])(\d+))?/) : null;
  if (!m || reducedMotion()) { el.textContent = text; return; }
  const sep = m[1] || '', decimals = m[2] ? m[2].length : 0;
  const target = parseFloat(m[0].replace(',', '.'));
  const before = text.slice(0, at), after = text.slice(at + m[0].length);
  const start = performance.now(), duration = 650;
  const frame = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - 2 ** (-10 * p); // exponential ease-out
    const v = p === 1 ? target : target * eased;
    el.textContent = before + v.toFixed(decimals).replace('.', sep || '.') + after;
    if (p < 1) running.set(el, requestAnimationFrame(frame));
  };
  running.set(el, requestAnimationFrame(frame));
}
