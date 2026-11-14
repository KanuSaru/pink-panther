// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// Plain-language findings and the downloadable report.
import { t, num, pText, getLang } from './i18n.js';

// Spanish writes month names in lower case; English keeps the capital
const inParens = (s) => (getLang() === 'es' ? s.toLowerCase() : s);
import { formatLatLon } from './geo.js';

const withUnit = (v, ctx, sign = true) => `${num(v, ctx.decimals, { sign })} ${ctx.unit}`;

// ctx: { name, unit, decimals, wherePhrase, whereLabel, seasonLabel }
export function describeSeries(a, ctx) {
  const x = withUnit(Math.abs(a.perDecade), ctx, false);
  const verdict = a.significant
    ? t('vSig', { v: ctx.name, dir: t(a.direction > 0 ? 'up' : 'down'), x, p: ctx.wherePhrase })
    : t('vNo', { v: ctx.name, p: ctx.wherePhrase });
  const verdict2 = a.significant
    ? t('vSig2', { p: pText(a.mk.p) })
    : t('vNo2', { x: withUnit(a.perDecade, ctx), p: pText(a.mk.p) });
  const conf = Math.round((1 - a.alpha) * 100);
  const how = [
    `${withUnit(a.perDecade, ctx)} ${t('perDecade')} (${t('ci', { c: conf, a: num(a.perDecadeLo, ctx.decimals, { sign: true }), b: num(a.perDecadeHi, ctx.decimals, { sign: true }) })})`,
    t('total', { x: withUnit(a.change, ctx), a: a.period[0], b: a.period[1] }),
  ];
  const facts = [
    [t('qWhat'), ctx.seasonLabel ? `${ctx.name} (${inParens(ctx.seasonLabel)})` : ctx.name],
    [t('qWhere'), ctx.whereLabel],
    [t('qHow'), how.join('; ')],
    [t('qSig'), `${t(a.significant ? 'yes' : 'no')}. ${t('mkLine', { p: pText(a.mk.p), op: a.significant ? '<' : '≥', a: num(a.alpha, 2) })}`],
  ];
  const details = [
    [t('dN'), `${a.n} (${a.period[0]}–${a.period[1]})`],
    [t('dBase'), `${withUnit(a.base, ctx, false)} (${a.baselineUsed[0]}–${a.baselineUsed[1]})`],
    [t('dSen'), `${withUnit(a.perDecade, ctx)} ${t('perDecade')}`],
    [t('dMk'), `S = ${a.mk.S}, z = ${num(a.mk.z, 2, { sign: true })}, τ = ${num(a.mk.tau, 2, { sign: true })}, p ${pText(a.mk.p)}`],
    [t('dAuto'), `r₁ = ${num(a.mk.r1, 2, { sign: true })}, ${a.mk.corrected ? t('dAutoYes', { n: num(a.mk.nEff, 0) }) : t('dAutoNo')}`],
    [t('dOls'), `${withUnit(a.fit.slope * 10, ctx)} ${t('perDecade')}, R² = ${num(a.fit.r2, 2)}, p ${pText(a.fit.p)}`],
  ];
  if (a.compare) {
    details.push([t('dCompare'), t('compareLine', {
      a: `${a.compare.a[0]}–${a.compare.a[1]}`, ma: withUnit(a.compare.meanA, ctx, false),
      b: `${a.compare.b[0]}–${a.compare.b[1]}`, mb: withUnit(a.compare.meanB, ctx, false),
      d: withUnit(a.compare.diff, ctx), p: pText(a.compare.p),
    })]);
  }
  details.push([t('dUnusual'), a.unusual.length ? a.unusual.map((u) => `${u.year} (${num(u.z, 1, { sign: true })}σ)`).join(', ') : t('none')]);
  return { verdict, verdict2, facts, details };
}

export function describeRegion(r, ctx) {
  const verdict = r.nUp + r.nDown === 0
    ? t('vRegionNone', { n: r.nCells })
    : t('vRegion', { up: r.nUp, down: r.nDown, n: r.nCells });
  const verdict2 = r.opposing ? t('vRegionOpp') : '';
  const b = r.bounds;
  const deg = (v) => `${num(v, 1)}°`;
  const k = r.nUp + r.nDown;
  const facts = [
    [t('qWhat'), ctx.seasonLabel ? `${ctx.name} (${inParens(ctx.seasonLabel)})` : ctx.name],
    [t('qWhere'), t('regionBox', { a: deg(b.latMin), b: deg(b.latMax), c: deg(b.lonMin), d: deg(b.lonMax) })],
    [t('qHow'), `${t('regionMean', { x: withUnit(r.meanSlope, ctx) })}. ${t('regionRange', {
      a: withUnit(r.min.slope, ctx), pa: formatLatLon(r.min.lat, r.min.lon, getLang()), b: withUnit(r.max.slope, ctx), pb: formatLatLon(r.max.lat, r.max.lon, getLang()),
    })}`],
    [t('qSig'), `${t('regionSig', { k, n: r.nCells, pc: num((k / r.nCells) * 100, 0), a: num(r.alpha, 2) })}. ${t('regionFdr', { k: r.nFdr })}`],
  ];
  return { verdict, verdict2, facts };
}

// Markdown report. sections: [{ heading, described, analysis?, ctx, source }]
export function buildReport({ sections, projectionYear, factor }) {
  const out = [];
  const now = new Date().toLocaleString(getLang(), { dateStyle: 'long', timeStyle: 'short' });
  out.push(`# ${t('title')}: ${t('rTitle').toLowerCase()}`, '', t('rGenerated', { d: now }), '');
  for (const s of sections) {
    out.push(`## ${s.heading}`, '', `**${s.described.verdict}** ${s.described.verdict2}`.trim(), '');
    out.push(`| ${t('rQuestion')} | ${t('rAnswer')} |`, '|---|---|');
    for (const [q, a] of s.described.facts) out.push(`| ${q} | ${a} |`);
    out.push('');
    if (s.analysis && projectionYear > s.analysis.period[1]) {
      const p = s.analysis.project(projectionYear, factor);
      const f = (v) => `${num(v, s.ctx.decimals, { sign: true })} ${s.ctx.unit}`;
      out.push(`**${t('rProj', { y: projectionYear })}:** ${t('rProjLine', { v: f(p.value), a: f(p.lo), b: f(p.hi), f: num(factor, 1) })}`, '');
    }
    if (s.described.details) {
      out.push(`### ${t('details')}`, '');
      for (const [k, v] of s.described.details) out.push(`- ${k}: ${v}`);
      out.push('');
    }
    if (s.source) out.push(`${t('source')}: ${s.source.name}. ${s.source.url}`, '');
  }
  out.push(`## ${t('rMethod')}`, '', t('rMethodBody'), '', `## ${t('rCaveat')}`, '', t('rCaveatBody'), '');
  return out.join('\n');
}
