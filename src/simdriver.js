// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Drives the GPU solver through time. The renderer supplies a small backend
// (load / init / steps); this module decides how many steps to take each frame
// so the globe visibly evolves towards the year selected on the timeline.
import { forcingAt } from './ebm.js';

export function createSimDriver(backend) {
  let cfg = null, year = 0, target = 0, stepsPerYear = 1;
  return {
    get year() { return year; },
    get ready() { return !!cfg; },
    // cfg: { t0, F0, f2100, dt, lam, T0, Td0, pi (Float32Array, one value per row), oceanBytes (RGBA) }
    configure(c) {
      cfg = c;
      stepsPerYear = Math.ceil(1 / c.dt);
      backend.load(c);
      backend.init();
      year = c.t0;
    },
    setTarget(y) { if (cfg) target = Math.max(cfg.t0, Math.min(2100, Math.round(y))); },
    // Advance at most `maxYears` model years; returns true when the state changed.
    tick(maxYears = 2) {
      if (!cfg) return false;
      let changed = false;
      if (target < year) { backend.init(); year = cfg.t0; changed = true; }
      for (let n = 0; year < target && n < maxYears; n++) {
        backend.steps(stepsPerYear, 1 / stepsPerYear, forcingAt(year + 0.5, cfg, cfg.f2100));
        year += 1;
        changed = true;
      }
      return changed;
    },
  };
}

// The solver's parameters as the shader expects them
export function physUniforms(EBM) {
  return { uPhys: [EBM.D, EBM.CAP, EBM.C_LAND, EBM.C_MIX], uDeep: [EBM.C_DEEP, EBM.GAMMA] };
}

// Eases displayed values towards their targets so the globe does not jump when the year
// changes (the timeline moves about nine years per second while playing).
// `tau` is the time constant in milliseconds.
export function createSmoother(tau = 140) {
  const items = new Map();
  let last = null;
  return {
    // the first value of a name, or any value with `instant`, is applied at once
    set(name, value, instant = false) {
      const scalar = typeof value === 'number';
      const target = scalar ? [value] : Array.from(value);
      const it = items.get(name);
      if (!it || instant || it.cur.length !== target.length) items.set(name, { cur: target.slice(), target, scalar, dirty: true });
      else it.target = target;
    },
    // call once per frame; `apply(name, value)` receives every value that moved
    tick(now, apply) {
      const dt = last == null ? 16 : Math.max(0, Math.min(100, now - last));
      last = now;
      const k = 1 - Math.exp(-dt / tau);
      for (const [name, it] of items) {
        let moved = it.dirty;
        it.dirty = false;
        for (let i = 0; i < it.cur.length; i++) {
          const d = it.target[i] - it.cur[i];
          if (d === 0) continue;
          it.cur[i] = Math.abs(d) < 1e-4 ? it.target[i] : it.cur[i] + d * k;
          moved = true;
        }
        if (moved) apply(name, it.scalar ? it.cur[0] : Float32Array.from(it.cur));
      }
    },
  };
}
