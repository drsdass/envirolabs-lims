// QC engine: parses Agilent MassHunter Quant "Generic LIMS" exports and evaluates batch QC.

export function classify(raw) {
  const n = String(raw || '').trim();
  let m;
  if (/^solvent blank/i.test(n)) return { kind: 'solvent' };
  if (/^calibration blank/i.test(n)) return { kind: 'calblank' };
  if ((m = n.match(/^ccv\b.*?([\d.]+)\s*ppb/i))) return { kind: 'ccv', level: +m[1] };
  if ((m = n.match(/^ldr\s*([\d.]+)/i))) return { kind: 'ldr', level: +m[1] };
  if ((m = n.match(/^method blank\s*(\d+)/i))) return { kind: 'mb', prep: m[1] };
  if ((m = n.match(/^blank spike duplicate:?\s*(\d+)/i))) return { kind: 'lcsd', prep: m[1] };
  if ((m = n.match(/^blank spike(?:\s*1)?:?\s*(\d+)/i))) return { kind: 'lcs', prep: m[1] };
  if ((m = n.match(/^matrix spike duplicate:?\s*([\w-]+)/i))) return { kind: 'msd', parent: m[1].toUpperCase() };
  if ((m = n.match(/^matrix spike(?:\s*1)?:?\s*([\w-]+)/i))) return { kind: 'ms', parent: m[1].toUpperCase() };
  if ((m = n.match(/^([\d.]+)\s*ppb/i))) return { kind: 'cal', level: +m[1] };
  if ((m = n.match(/^(\d{6}-[A-Z]+\d+)(L?)(?:\s*(?:[x×]|D)\s*(\d+))?$/i))) return { kind: 'sample', id: m[1].toUpperCase(), sub: m[2] ? 'L' : '', rerunDil: m[3] ? +m[3] : null };
  return { kind: 'other' };
}

// rows: [sampleName, compound, sampleType, compoundType, finalConc, calcConc, expConc, dil, acqDateTime, dataFile]
export function rowsFromSheet(aoa) {
  const meta = {};
  let h = -1;
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const r = aoa[i] || [];
    if (String(r[0]).trim() === 'Sample ID' && r.some((c) => String(c).trim() === 'Compound ID')) { h = i; break; }
    if (r[0] != null && r[1] != null) meta[String(r[0]).trim()] = String(r[1]);
  }
  if (h < 0) throw new Error('This file does not look like a MassHunter Quant LIMS export: no "Sample ID / Compound ID" header row was found.');
  const hdr = aoa[h].map((x) => (x == null ? '' : String(x).trim()));
  const pos = {};
  hdr.forEach((name, j) => {
    if (!name) return;
    let k = name, n = 1;
    while (pos[k] != null) { n++; k = name + '#' + n; }
    pos[k] = j;
  });
  const need = ['Name', 'Name#2', 'Type#2', 'Final Conc.'];
  for (const k of need) if (pos[k] == null) throw new Error('Column "' + k.replace('#2', '') + '" is missing from the export.');
  const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
  const rows = [];
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || r[pos['Name']] == null || String(r[pos['Name']]).trim() === '') continue;
    let dt = r[pos['Acq. Date-Time']];
    if (dt instanceof Date) dt = dt.toISOString().slice(0, 16);
    rows.push([
      String(r[pos['Name']]).trim(), String(r[pos['Name#2']]).trim(), r[pos['Type']], r[pos['Type#2']],
      num(r[pos['Final Conc.']]), num(r[pos['Calc. Conc.']]), num(r[pos['Exp. Conc.']]), num(r[pos['Dil.']]) || 1,
      dt ? String(dt) : null, r[pos['Data File']] || null,
    ]);
  }
  return { meta, rows };
}

export function detectMethod(rows, methods) {
  const comps = new Set(rows.map((r) => r[1]));
  let best = null, score = 0;
  for (const m of Object.values(methods)) {
    const s = m.analytes.filter((a) => comps.has(a.name)).length;
    if (s > score) { best = m; score = s; }
  }
  return best;
}

const pct = (a, b) => (b ? (a / b) * 100 : null);
const inLim = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

export function evaluateBatch(raw, method) {
  // group rows into injections in acquisition order
  const map = new Map();
  raw.rows.forEach((r, i) => {
    const key = r[0] + '|' + (r[9] || '');
    if (!map.has(key)) map.set(key, { name: r[0], file: r[9], dt: r[8], order: i, ...classify(r[0]), comps: {} });
    map.get(key).comps[r[1]] = { type: r[3], fc: r[4], cc: r[5], exp: r[6], dil: r[7] };
  });
  const inj = [...map.values()].sort((a, b) => (a.file && b.file ? String(a.file).localeCompare(String(b.file), undefined, { numeric: true }) : a.order - b.order));
  const presentTargets = method.analytes.filter((a) => inj.some((x) => x.comps[a.name] && x.comps[a.name].type === 'Target'));
  const surr = method.surrogates.filter((s) => inj.some((x) => x.comps[s.name]));
  const A = (n) => method.analytes.find((a) => a.name === n);

  // calibration
  const cals = inj.filter((x) => x.kind === 'cal');
  const calLevels = [...new Set(cals.map((c) => c.level))].sort((a, b) => a - b);
  const topCal = calLevels[calLevels.length - 1] || 0;
  const lowCal = calLevels[0] || 0;
  const calibration = presentTargets.map((a) => ({
    analyte: a.name,
    points: cals.map((c) => {
      const v = c.comps[a.name]?.cc;
      const acc = pct(v, c.level);
      const lim = c.level === lowCal ? method.calLowAccuracy : method.calAccuracy;
      return { level: c.level, value: v, acc, ok: inLim(acc, lim), lim };
    }),
  }));
  calibration.forEach((c) => (c.ok = c.points.length >= 5 && c.points.every((p) => p.ok)));

  // LDR verification
  const ldrs = inj.filter((x) => x.kind === 'ldr');
  const ldr = presentTargets.map((a) => {
    const pts = ldrs.map((l) => { const v = l.comps[a.name]?.cc; const acc = pct(v, l.level); return { level: l.level, value: v, acc, ok: inLim(acc, method.ccvLimits) }; });
    const verified = Math.max(topCal, ...pts.filter((p) => p.ok).map((p) => p.level));
    return { analyte: a.name, points: pts, verified };
  });
  const verifiedMax = (n) => ldr.find((l) => l.analyte === n)?.verified || topCal;

  // CCVs
  const ccv = inj.filter((x) => x.kind === 'ccv').map((c) => ({
    name: c.name, dt: c.dt, file: c.file,
    analytes: presentTargets.map((a) => { const v = c.comps[a.name]?.cc; const r = pct(v, c.level); return { analyte: a.name, value: v, rec: r, ok: inLim(r, method.ccvLimits) }; }),
  }));
  ccv.forEach((c) => (c.ok = c.analytes.every((a) => a.ok)));

  const calBlanks = inj.filter((x) => x.kind === 'calblank').map((c) => ({
    dt: c.dt, file: c.file,
    analytes: presentTargets.map((a) => { const v = c.comps[a.name]?.fc; return { analyte: a.name, value: v, ok: !(v > 0) || v < a.mrl }; }),
  }));
  calBlanks.forEach((c) => (c.ok = c.analytes.every((a) => a.ok)));

  const surrNominal = (s) => s.nominal || inj.find((x) => x.comps[s.name]?.exp)?.comps[s.name]?.exp;
  const surrRec = (x) => surr.map((s) => { const v = x.comps[s.name]?.fc; const r = pct(v, surrNominal(s)); return { name: s.name, value: v, rec: r, ok: inLim(r, s.rec) }; });

  // prep batches (method blank + LCS/LCSD or MS/MSD)
  const preps = {};
  const P = (id) => (preps[id] = preps[id] || { id, mb: null, lcs: null, lcsd: null, samples: [] });
  inj.forEach((x) => { if (x.kind === 'mb') P(x.prep).mb = x; if (x.kind === 'lcs') P(x.prep).lcs = x; if (x.kind === 'lcsd') P(x.prep).lcsd = x; });
  const prepIds = Object.keys(preps);

  // assign samples to preps: most recent preceding method blank in injection order, else the only prep
  let current = prepIds.length === 1 ? prepIds[0] : null;
  const samples = [];
  const ms = {}, msd = {};
  inj.forEach((x) => {
    if (x.kind === 'mb') current = x.prep;
    if (x.kind === 'sample') samples.push({ ...x, prep: current || prepIds[0] || '—' });
    if (x.kind === 'ms') ms[x.parent] = x;
    if (x.kind === 'msd') msd[x.parent] = x;
  });

  const prepEval = Object.values(preps).map((p) => {
    const mb = p.mb && {
      dt: p.mb.dt,
      analytes: presentTargets.map((a) => { const v = p.mb.comps[a.name]?.fc; return { analyte: a.name, value: v > 0 ? v : null, mrl: a.mrl, ok: !(v > 0) || v < a.mrl }; }),
      surrogates: surrRec(p.mb),
    };
    if (mb) mb.ok = mb.analytes.every((a) => a.ok);
    const lcs = p.lcs && presentTargets.map((a) => {
      const v1 = p.lcs.comps[a.name]?.fc, v2 = p.lcsd?.comps[a.name]?.fc;
      const r1 = pct(v1, a.spike), r2 = pct(v2, a.spike);
      const rpd = v1 != null && v2 != null ? (Math.abs(v1 - v2) / ((v1 + v2) / 2)) * 100 : null;
      return { analyte: a.name, spike: a.spike, v1, v2, r1, r2, rpd, ok1: inLim(r1, a.rec), ok2: p.lcsd ? inLim(r2, a.rec) : true, okRpd: rpd == null || rpd <= a.rpd, lim: a.rec, rpdLim: a.rpd, dt: p.lcs.dt };
    });
    return { id: p.id, mb, lcs, ok: (!mb || mb.ok) && (!lcs || lcs.every((l) => l.ok1 && l.ok2)) };
  });

  // matrix spikes
  const msEval = Object.keys(ms).map((parent) => {
    const src = samples.find((s) => s.id === parent);
    return {
      parent,
      analytes: presentTargets.map((a) => {
        const base = src?.comps[a.name]?.fc || 0;
        const v1 = ms[parent].comps[a.name]?.fc, v2 = msd[parent]?.comps[a.name]?.fc;
        const r1 = v1 != null ? ((v1 - base) / a.spike) * 100 : null;
        const r2 = v2 != null ? ((v2 - base) / a.spike) * 100 : null;
        const rpd = r1 != null && r2 != null && r1 + r2 !== 0 ? (Math.abs(r1 - r2) / ((r1 + r2) / 2)) * 100 : null;
        const ok = inLim(r1, a.rec) && (r2 == null || inLim(r2, a.rec));
        return { analyte: a.name, base, v1, v2, r1, r2, rpd, ok, okRpd: rpd == null || rpd <= a.rpd, code: ok ? null : base > 4 * a.spike ? 'MS1' : 'MS2', lim: a.rec, rpdLim: a.rpd };
      }),
    };
  });

  // sample results
  const results = samples.map((s) => {
    const prep = prepEval.find((p) => p.id === s.prep);
    const surrogates = surrRec(s);
    const analytes = presentTargets.map((a) => {
      const c = s.comps[a.name] || {};
      const v = c.fc;
      const q = [];
      const detected = v != null && v > 0 && v >= a.mrl;
      if (detected && c.cc > verifiedMax(a.name)) q.push('E');
      else if (detected && c.cc > topCal) q.push('LR');
      if (surrogates.some((x) => !x.ok)) q.push('IS1');
      const l = prep?.lcs?.find((x) => x.analyte === a.name);
      if (l && !l.okRpd) q.push('RPD1');
      const m = msEval.find((x) => x.parent === s.id)?.analytes.find((x) => x.analyte === a.name);
      if (m && m.code) q.push(m.code);
      return { name: a.name, value: detected ? v : null, raw: v, cc: c.cc, mrl: a.mrl, units: method.units, dil: c.dil || 1, qualifiers: q };
    });
    return { id: s.id, sub: s.sub, name: s.name, prep: s.prep, acq: s.dt, file: s.file, rerunDil: s.rerunDil || null, analytes, surrogates };
  });

  const issues = [];
  calibration.forEach((c) => !c.ok && issues.push({ level: 'fail', text: `Initial calibration for ${c.analyte} has a point outside accuracy limits or fewer than 5 levels.` }));
  ccv.forEach((c) => !c.ok && issues.push({ level: 'fail', text: `CCV ${c.file || ''} recovery outside ${method.ccvLimits.join('–')}% for ${c.analytes.filter((a) => !a.ok).map((a) => a.analyte).join(', ')}.` }));
  calBlanks.forEach((c) => !c.ok && issues.push({ level: 'warn', text: `Calibration blank ${c.file || ''} shows target at or above MRL (possible carryover).` }));
  prepEval.forEach((p) => {
    if (!p.mb) issues.push({ level: 'fail', text: `Prep batch ${p.id} has no method blank.` });
    else if (!p.mb.ok) issues.push({ level: 'fail', text: `Method blank ${p.id} has target at or above MRL.` });
    if (!p.lcs) issues.push({ level: 'warn', text: `Prep batch ${p.id} has no blank spike; matrix spike used for accuracy.` });
    p.lcs?.forEach((l) => {
      if (!l.ok1 || !l.ok2) issues.push({ level: 'fail', text: `Blank spike recovery for ${l.analyte} in ${p.id} is outside ${l.lim.join('–')}%.` });
      if (!l.okRpd) issues.push({ level: 'warn', text: `Blank spike RPD for ${l.analyte} in ${p.id} is ${l.rpd.toFixed(1)}% (limit ${l.rpdLim}%). RPD1 applied.` });
    });
  });
  const eCount = results.filter((r) => r.analytes.some((a) => a.qualifiers.includes('E'))).length;
  if (eCount) issues.push({ level: 'fail', text: `${eCount} sample${eCount > 1 ? 's' : ''} exceed the verified linear range (E). Dilute and re-analyze before reporting.` });
  const isCount = results.filter((r) => r.surrogates.some((s) => !s.ok)).length;
  if (isCount) issues.push({ level: 'warn', text: `${isCount} sample${isCount > 1 ? 's have' : ' has'} surrogate recovery outside limits. IS1 applied.` });

  return {
    method: method.code, injections: inj.length, calLevels, topCal, lowCal, calibration, ldr, ccv, calBlanks, preps: prepEval, ms: msEval, results, issues,
    acqStart: inj.map((x) => x.dt).filter(Boolean).sort()[0], acqEnd: inj.map((x) => x.dt).filter(Boolean).sort().slice(-1)[0],
    ok: !issues.some((i) => i.level === 'fail' && !/exceed the verified/.test(i.text)),
  };
}
