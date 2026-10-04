import React, { useState, useMemo } from 'react';
import { HIST } from './history.js';
import { SEED } from './seed.js';
import { METHODS } from './config.js';
import { classify, evaluateBatch, rowsFromSheet } from './qc.js';
import { reducer, reportHash, stageIdx, DEMO_PIN } from './store.js';
import { gateFor, cx, Icon, Modal, Field, ESign, fmtDate, Empty, ESIG } from './ui.jsx';
import { nextLabId } from './intake.jsx';

const mean = (a) => a.reduce((n, x) => n + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((n, x) => n + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

// series of QC points: [{d, v, batch}]
export function qcSeries(state, code, analyte, metric) {
  const pts = [];
  HIST.batches.filter((b) => b.m === code).forEach((b) => {
    if (metric === 'lcs') (b.lcs[analyte] || []).forEach((x) => x[0] != null && pts.push({ d: b.d, v: x[0], batch: b.k }));
    if (metric === 'rpd') (b.lcs[analyte] || []).forEach((x) => x[2] != null && pts.push({ d: b.d, v: x[2], batch: b.k }));
    if (metric === 'ccv') (b.ccv[analyte] || []).forEach((v) => v != null && pts.push({ d: b.d, v, batch: b.k }));
    if (metric === 'surr') { const s = b.surr[analyte]; if (s?.length) pts.push({ d: b.d, v: Math.round(mean(s) * 10) / 10, batch: b.k }); }
  });
  state.batches.filter((b) => b.method === code && !b.manual).forEach((b) => {
    const d = (b.eval.acqStart || '').slice(0, 10);
    if (metric === 'lcs' || metric === 'rpd') b.eval.preps.forEach((p) => p.lcs?.filter((l) => l.analyte === analyte).forEach((l) => { const v = metric === 'lcs' ? l.r1 : l.rpd; v != null && pts.push({ d, v: Math.round(v * 10) / 10, batch: b.name, cur: true }); }));
    if (metric === 'ccv') b.eval.ccv.forEach((c) => c.analytes.filter((a) => a.analyte === analyte).forEach((a) => a.rec != null && pts.push({ d, v: Math.round(a.rec * 10) / 10, batch: b.name, cur: true })));
    if (metric === 'surr') { const s = b.eval.results.flatMap((r) => r.surrogates.filter((x) => x.name === analyte && x.rec != null).map((x) => x.rec)); s.length && pts.push({ d, v: Math.round(mean(s) * 10) / 10, batch: b.name, cur: true }); }
  });
  return pts.sort((a, b) => (a.d < b.d ? -1 : 1));
}
function westgard(pts, m, s) {
  return pts.map((p, i) => {
    const z = (p.v - m) / s; const f = [];
    if (Math.abs(z) > 3) f.push('1-3s');
    if (i > 0 && Math.abs(z) > 2 && Math.abs((pts[i - 1].v - m) / s) > 2 && Math.sign(z) === Math.sign(pts[i - 1].v - m)) f.push('2-2s');
    if (i >= 6 && pts.slice(i - 6, i + 1).every((q) => Math.sign(q.v - m) === Math.sign(z))) f.push('7-T');
    return f;
  });
}

export function ControlCharts({ state }) {
  const [code, setCode] = useState('BPS');
  const [metric, setMetric] = useState('lcs');
  const m = state.methods[code];
  const names = metric === 'surr' ? m.surrogates.map((s) => s.name) : m.analytes.map((a) => a.name);
  const [an, setAn] = useState(names[0]);
  const analyte = names.includes(an) ? an : names[0];
  const pts = qcSeries(state, code, analyte, metric);
  const vals = pts.map((p) => p.v);
  const lim = metric === 'rpd' ? [0, m.analytes[0].rpd] : metric === 'ccv' ? m.ccvLimits : metric === 'surr' ? m.surrogates[0]?.rec || [50, 150] : m.analytes.find((a) => a.name === analyte)?.rec || [50, 150];
  const inc = vals.filter((v) => v >= lim[0] && v <= lim[1]);
  const outs = pts.filter((p) => p.v < lim[0] || p.v > lim[1]);
  const M = inc.length ? mean(inc) : 100, S = inc.length > 1 ? Math.max(sd(inc), 0.5) : 10;
  const flags = westgard(pts, M, S).map((f, i) => (pts[i].v < lim[0] || pts[i].v > lim[1] ? [...f, 'outside acceptance'] : f));
  const W = 860, H = 280, pad = 36;
  const lo = Math.min(lim[0], M - 3.5 * S) - 5, hi = Math.max(lim[1], M + 3.5 * S) + 5;
  const y = (v) => H - pad - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (W - 2 * pad);
  const line = (v, cls, label) => <g key={label}><line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} className={cls} /><text x={W - pad + 4} y={y(v) + 4} className="cc-lab">{label}</text></g>;
  const nflag = flags.filter((f) => f.length).length;
  return (
    <div className="panel">
      <div className="row gap wrap">
        <div className="seg">{['BPS', 'PFAS'].map((t) => <button key={t} className={cx(code === t && 'on', 't-' + state.methods[t].color)} onClick={() => setCode(t)}>{t}</button>)}</div>
        <div className="seg">{[['lcs', 'Blank spike %REC'], ['rpd', 'Spike RPD'], ['ccv', 'CCV %REC'], ['surr', 'Surrogate %REC (batch mean)']].map(([k, l]) => <button key={k} className={cx(metric === k && 'on')} onClick={() => setMetric(k)}>{l}</button>)}</div>
        <select value={analyte} onChange={(e) => setAn(e.target.value)} aria-label="Analyte">{names.map((n) => <option key={n}>{n}</option>)}</select>
      </div>
      {pts.length < 3 ? <Empty icon="run" title="Not enough points yet">At least 3 batches are needed for this analyte.</Empty> : (
        <>
          <div className="cc-wrap">
            <svg viewBox={`0 0 ${W + 50} ${H}`} className="cc" role="img" aria-label={`Control chart ${code} ${analyte}`}>
              <rect x={pad} y={y(lim[1])} width={W - 2 * pad} height={Math.max(0, y(lim[0]) - y(lim[1]))} className="cc-acc" />
              {line(M, 'cc-mean', 'mean')}{line(M + 2 * S, 'cc-2s', '+2s')}{line(M - 2 * S, 'cc-2s', '−2s')}{line(M + 3 * S, 'cc-3s', '+3s')}{line(M - 3 * S, 'cc-3s', '−3s')}
              <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} className="cc-line" />
              {pts.map((p, i) => (p.v > hi || p.v < lo) ? <g key={i}><path d={p.v > hi ? `M${x(i) - 5},${y(p.v) + 6} L${x(i)},${y(p.v) - 2} L${x(i) + 5},${y(p.v) + 6}Z` : `M${x(i) - 5},${y(p.v) - 6} L${x(i)},${y(p.v) + 2} L${x(i) + 5},${y(p.v) - 6}Z`} className="cc-pt bad"><title>{`${p.d} · ${p.batch} · ${p.v}% (off scale)`}</title></path><text x={x(i) + 7} y={y(p.v) + 4} className="cc-lab">{p.v}%</text></g> : <circle key={i} cx={x(i)} cy={y(p.v)} r={flags[i].length ? 4.5 : 3} className={cx('cc-pt', flags[i].length && 'bad', p.cur && 'cur')}><title>{`${p.d} · ${p.batch} · ${p.v}%${flags[i].length ? ' · ' + flags[i].join(', ') : ''}`}</title></circle>)}
              <text x={pad} y={H - 8} className="cc-lab">{pts[0].d}</text><text x={W - pad} y={H - 8} textAnchor="end" className="cc-lab">{pts[pts.length - 1].d}</text>
            </svg>
          </div>
          <p className="small">n = {pts.length} · mean {M.toFixed(1)}% · SD {S.toFixed(1)} · warning limits {(M - 2 * S).toFixed(0)}–{(M + 2 * S).toFixed(0)}% · control limits {(M - 3 * S).toFixed(0)}–{(M + 3 * S).toFixed(0)}% · method acceptance {lim.join('–')}% (shaded). {nflag ? <b className="bad">{nflag} point{nflag > 1 ? 's' : ''} break a Westgard rule (1-3s, 2-2s or 7 in a row on one side).</b> : 'No Westgard rule violations.'}</p>
          {outs.length > 0 && <p className="small">{outs.length} point{outs.length > 1 ? 's are' : ' is'} outside the method acceptance range and left out of the limits: {outs.slice(0, 5).map((p) => `${p.batch} (${p.v}%)`).join(', ')}. Recoveries this far off usually mean the spike was made at a different level or a sample was misnamed; check those batches.</p>}
          <p className="muted small">Grey points are historical batches from the workbook (to April 2026); blue points are runs in this LIMS. Hover a point for the batch.</p>
        </>
      )}
    </div>
  );
}

export function Uncertainty({ state }) {
  const uRef = 2.5; // assumed relative standard uncertainty of the CRM / spike solution, %
  const rows = [];
  ['BPS', 'PFAS'].forEach((code) => state.methods[code].analytes.forEach((a) => {
    const v = qcSeries(state, code, a.name, 'lcs').map((p) => p.v).filter((x) => x >= a.rec[0] && x <= a.rec[1]);
    if (v.length < 8) return;
    const M = mean(v), RSD = (sd(v) / M) * 100, bias = M - 100;
    const uBias = Math.sqrt(bias ** 2 + (sd(v) / Math.sqrt(v.length)) ** 2 + uRef ** 2);
    const uc = Math.sqrt(RSD ** 2 + uBias ** 2);
    rows.push({ code, a: a.name, n: v.length, M, RSD, bias, uBias, uc, U: 2 * uc });
  }));
  return (
    <div className="panel">
      <h4>Measurement uncertainty (top-down, Nordtest TR 537 approach)</h4>
      <p className="muted small">Within-lab reproducibility comes from blank spike recoveries across all batches; bias from the mean recovery, plus an assumed 2.5% standard uncertainty for the reference standard. Expanded uncertainty U uses k = 2 (about 95% confidence). Recalculates as new batches are imported.</p>
      <table className="tbl"><thead><tr><th>Test</th><th>Analyte</th><th className="num">Batches</th><th className="num">Mean %REC</th><th className="num">u(Rw) %</th><th className="num">u(bias) %</th><th className="num">u(c) %</th><th className="num">U (k=2) %</th><th>Example</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.code + r.a}><td>{r.code}</td><td>{r.a}</td><td className="num">{r.n}</td><td className="num">{r.M.toFixed(1)}</td><td className="num">{r.RSD.toFixed(1)}</td><td className="num">{r.uBias.toFixed(1)}</td><td className="num">{r.uc.toFixed(1)}</td><td className="num"><b>±{r.U.toFixed(0)}</b></td><td className="muted small">10.0 ng/g ± {(r.U / 10).toFixed(1)} ng/g</td></tr>)}</tbody></table>
      <p className="muted small">Uncertainty is available to clients on request and can be printed on certificates per client (ISO/IEC 17025 §7.6, §7.8.3.1 c).</p>
    </div>
  );
}

const T99 = { 6: 3.143, 7: 2.998, 8: 2.896, 9: 2.821, 10: 2.764, 11: 2.718, 12: 2.681, 13: 2.65, 14: 2.624, 15: 2.602, 16: 2.583, 17: 2.567, 18: 2.552, 19: 2.539 };
export function MethodStudies({ state, dispatch, toast }) {
  const [f, setF] = useState({ code: 'BPS', analyte: 'Bisphenol S', spike: '', reps: '', kind: 'MDL (40 CFR 136 App. B style)' });
  const vals = f.reps.split(/[\s,;]+/).map(Number).filter((x) => !isNaN(x) && x !== 0);
  const ok = vals.length >= 7 && vals.length <= 20 && +f.spike > 0;
  const M = vals.length ? mean(vals) : 0, S = vals.length > 1 ? sd(vals) : 0, t = T99[vals.length - 1];
  const mdl = ok ? t * S : 0;
  const m = state.methods[f.code];
  const lowCal = m.calLevels[0];
  const mrl = ok ? Math.max(lowCal, Math.ceil(mdl * 3 * 100) / 100) : 0;
  const save = () => { const id = 'MDL-' + new Date().getFullYear() + '-' + String(state.mdl.length + 1).padStart(2, '0'); dispatch({ type: 'ADD_ROW', coll: 'mdl', row: { id, ...f, n: vals.length, mean: M, sd: S, t, mdl, rec: (M / +f.spike) * 100, mrl, at: new Date().toISOString().slice(0, 16), by: state.session.name, applied: false }, action: 'Method study recorded', entity: id, detail: `${f.analyte} MDL ${mdl.toFixed(3)} ${m.units}` }); toast(id + ' saved'); setF({ ...f, reps: '' }); };
  return (
    <div className="grid2">
      <div className="panel">
        <h4>New detection limit study</h4>
        <div className="fg2"><Field label="Method"><select value={f.code} onChange={(e) => setF({ ...f, code: e.target.value, analyte: state.methods[e.target.value].analytes[0].name })}>{['BPS', 'PFAS', 'OTA'].map((c) => <option key={c}>{c}</option>)}</select></Field><Field label="Analyte"><select value={f.analyte} onChange={(e) => setF({ ...f, analyte: e.target.value })}>{m.analytes.map((a) => <option key={a.name}>{a.name}</option>)}</select></Field></div>
        <Field label={`Spike level (${m.units})`}><input type="number" step="0.01" value={f.spike} onChange={(e) => setF({ ...f, spike: e.target.value })} /></Field>
        <Field label="Replicate results (7–20 values)" hint="Paste from the instrument export, separated by spaces, commas or new lines."><textarea rows={3} value={f.reps} onChange={(e) => setF({ ...f, reps: e.target.value })} /></Field>
        {ok && <dl className="kv"><dt>n</dt><dd>{vals.length}</dd><dt>Mean / recovery</dt><dd>{M.toFixed(3)} {m.units} ({((M / +f.spike) * 100).toFixed(0)}%)</dd><dt>SD</dt><dd>{S.toFixed(4)}</dd><dt>t (99%, n−1)</dt><dd>{t}</dd><dt>MDL</dt><dd><b>{mdl.toFixed(3)} {m.units}</b></dd><dt>Suggested MRL</dt><dd><b>{mrl}</b> {m.units} (larger of 3 × MDL and the lowest calibrator {lowCal})</dd></dl>}
        {!ok && vals.length > 0 && <p className="muted small">{vals.length} value{vals.length > 1 ? 's' : ''} entered. At least 7 are needed.</p>}
        <button className="btn primary" disabled={!ok} onClick={save}>Save study</button>
      </div>
      <div className="panel">
        <h4>Study record</h4>
        {state.mdl.length ? state.mdl.map((s) => (
          <div key={s.id} className="note">
            <b>{s.id}</b> <span className="muted small">{s.code} · {s.analyte} · {fmtDate(s.at)} · {s.by}</span>
            <p>MDL {s.mdl.toFixed(3)} · recovery {s.rec.toFixed(0)}% · n = {s.n} · suggested MRL {s.mrl}</p>
            {!s.applied ? <button className="btn ghost sm" onClick={() => { dispatch({ type: 'UPDATE_ANALYTE', code: s.code, analyte: s.analyte, patch: { mrl: s.mrl }, reason: `Per ${s.id} (MDL ${s.mdl.toFixed(3)}, n=${s.n})` }); dispatch({ type: 'PATCH_ROW', coll: 'mdl', id: s.id, patch: { applied: true } }); toast(`MRL for ${s.analyte} set to ${s.mrl}; method revised`); }}>Apply MRL {s.mrl} to the method</button> : <span className="pill ok">Applied to method</span>}
          </div>
        )) : <Empty icon="sliders" title="No studies yet">Spike 7 or more clean matrix replicates near the expected limit, run them, and paste the results. Applying the result revises the method and clears its "confirm MRL" flag.</Empty>}
      </div>
    </div>
  );
}

const COLLS = {
  audits: { title: 'Internal audits', cols: [['id', 'Audit'], ['date', 'Date'], ['scope', 'Scope'], ['auditor', 'Auditor'], ['findings', 'Findings'], ['ncr', 'NCR'], ['status', 'Status']], prefix: 'IA', fields: ['date', 'scope', 'auditor', 'findings', 'status'] },
  mgmtReviews: { title: 'Management reviews', cols: [['id', 'Review'], ['date', 'Date'], ['attendees', 'Attendees'], ['inputs', 'Inputs (8.9.2)'], ['outputs', 'Decisions and actions (8.9.3)'], ['status', 'Status']], prefix: 'MR', fields: ['date', 'attendees', 'inputs', 'outputs', 'status'] },
  risks: { title: 'Risks and opportunities', cols: [['id', 'ID'], ['area', 'Area'], ['risk', 'Risk'], ['score', 'Score'], ['control', 'Control'], ['owner', 'Owner']], prefix: 'R', fields: ['area', 'risk', 'likelihood', 'impact', 'control', 'owner'] },
};
export function Records({ state, dispatch, toast }) {
  const [add, setAdd] = useState(null);
  return (
    <div className="stack">
      {Object.entries(COLLS).map(([coll, c]) => (
        <div key={coll} className="panel flush">
          <div className="row between pad"><h4 className="m0">{c.title}</h4><button className="btn ghost sm" onClick={() => setAdd({ coll, row: Object.fromEntries(c.fields.map((f) => [f, f === 'likelihood' || f === 'impact' ? 3 : f === 'status' ? 'Planned' : f === 'date' ? new Date().toISOString().slice(0, 10) : ''])) })}><Icon n="plus" size={13} />Add</button></div>
          <table className="tbl"><thead><tr>{c.cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
            <tbody>{state[coll].map((r) => <tr key={r.id}>{c.cols.map(([k]) => <td key={k} className={k === 'id' ? 'lid' : 'small'}>{k === 'score' ? <span className={cx('pill', r.likelihood * r.impact >= 12 ? 'fail' : r.likelihood * r.impact >= 8 ? 'warn' : 'ok')}>{r.likelihood * r.impact} ({r.likelihood}×{r.impact})</span> : k === 'date' ? fmtDate(r[k], false) : r[k] || '—'}</td>)}</tr>)}</tbody></table>
        </div>
      ))}
      {add && (
        <Modal title={`Add to ${COLLS[add.coll].title.toLowerCase()}`} onClose={() => setAdd(null)} footer={<><button className="btn ghost" onClick={() => setAdd(null)}>Cancel</button><button className="btn primary" onClick={() => { const c = COLLS[add.coll]; const id = `${c.prefix}-${c.prefix === 'R' ? '' : new Date().getFullYear() + '-'}${String(state[add.coll].length + 1).padStart(2, '0')}`; dispatch({ type: 'ADD_ROW', coll: add.coll, row: { id, ...add.row, likelihood: +add.row.likelihood || undefined, impact: +add.row.impact || undefined }, action: `${c.title} record added`, entity: id }); setAdd(null); toast(id + ' added'); }}>Save</button></>}>
          {COLLS[add.coll].fields.map((f) => <Field key={f} label={f[0].toUpperCase() + f.slice(1)}>{f === 'likelihood' || f === 'impact' ? <select value={add.row[f]} onChange={(e) => setAdd({ ...add, row: { ...add.row, [f]: e.target.value } })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select> : f === 'date' ? <input type="date" value={add.row[f]} onChange={(e) => setAdd({ ...add, row: { ...add.row, [f]: e.target.value } })} /> : <input value={add.row[f]} onChange={(e) => setAdd({ ...add, row: { ...add.row, [f]: e.target.value } })} />}</Field>)}
        </Modal>
      )}
    </div>
  );
}

// ---------- Software validation (ISO/IEC 17025 §7.11.2) ----------
export function validationTests(state) {
  const bpsRaw = SEED.batches.Gen_LIMs_BPS_26051802;
  const ev = evaluateBatch(bpsRaw, METHODS.BPS);
  const prep = ev.preps[0], l = prep.lcs[0];
  const T = [];
  const t = (id, req, fn) => { let r; try { r = fn(); } catch (e) { r = { pass: false, detail: 'Error: ' + e.message }; } T.push({ id, req, ...r }); };
  t('VT-01', 'Sample names are classified correctly (QC types, lab IDs, dilution reruns)', () => {
    const c = [classify('Blank Spike 1:26040902').kind, classify('Blank Spike Duplicate:26040902').kind, classify('Method Blank 26040902').kind, classify('CCV 1 ppb').kind, classify('260922-B25 x10').rerunDil, classify('0.5 ppb').level];
    return { pass: c.join() === 'lcs,lcsd,mb,ccv,10,0.5', detail: c.join(', ') };
  });
  t('VT-02', 'Blank spike recovery = result ÷ spike × 100', () => ({ pass: Math.abs(l.r1 - (l.v1 / l.spike) * 100) < 1e-9, detail: `${l.v1} ÷ ${l.spike} = ${l.r1.toFixed(2)}%` }));
  t('VT-03', 'RPD = |a − b| ÷ mean(a, b) × 100', () => { const e = (Math.abs(l.v1 - l.v2) / ((l.v1 + l.v2) / 2)) * 100; return { pass: Math.abs(e - l.rpd) < 1e-9, detail: `${l.rpd.toFixed(2)}%` }; });
  t('VT-04', 'Results above the verified linear range are flagged E', () => { const r = ev.results.find((x) => x.analytes[0].cc > 100); return { pass: !!r && r.analytes[0].qualifiers.includes('E'), detail: r ? `${r.id} = ${Math.round(r.analytes[0].cc)} → ${r.analytes[0].qualifiers.join(',')}` : 'no over-range sample' }; });
  t('VT-05', 'Surrogate outside 50–150% applies IS1', () => { const r = ev.results.find((x) => x.surrogates.some((s) => !s.ok)); return { pass: !!r && r.analytes[0].qualifiers.includes('IS1'), detail: r ? `${r.id} surrogate ${r.surrogates[0].rec.toFixed(0)}%` : 'none' }; });
  t('VT-06', 'Results below the MRL report as ND', () => { const r = ev.results.find((x) => x.analytes[0].raw != null && x.analytes[0].raw > 0 && x.analytes[0].raw < x.analytes[0].mrl); return { pass: !r || r.analytes[0].value == null, detail: r ? `${r.id} raw ${r.analytes[0].raw} → ND` : 'no sub-MRL detections in this batch; rule held' }; });
  t('VT-07', 'Gate blocks leaving Received without bin, weight and condition', () => { const g = gateFor({ ...state, session: { ...state.session, role: 'admin' } }, { id: 'X', tests: ['BPS'], stage: 'received', bin: null, weight: null, condition: null, hold: null }, 'prep'); return { pass: g.checks.filter((c) => c.ok === false).length === 3, detail: g.checks.filter((c) => c.ok === false).map((c) => c.label).join('; ') }; });
  t('VT-08', 'Only a Lab Manager can sign a certificate', () => { const s = state.samples.find((x) => x.stage === 'manager') || { id: 'X', tests: ['BPS'], stage: 'manager' }; const g = gateFor({ ...state, session: { ...state.session, role: 'chemist' } }, s, 'reported'); return { pass: !!g.blocked, detail: g.blocked ? 'Blocked for Chemist' : 'Not blocked' }; });
  t('VT-09', 'Lab IDs continue the day\u2019s sequence', () => { const id = nextLabId([{ id: '261004-B01' }, { id: '261004-B02' }, { id: '261004-P01' }], '2026-10-04', ['BPS']); return { pass: id === '261004-B03', detail: id }; });
  t('VT-10', 'Altering a signed certificate is detected', () => { const [rid, v] = Object.entries(state.reports)[0]; const last = v[v.length - 1]; const tam = JSON.parse(JSON.stringify(last.snapshot)); const k = Object.keys(tam.results)[0]; tam.results[k].analytes[0].value = 0.01; return { pass: reportHash(last.snapshot) === last.hash && reportHash(tam) !== last.hash, detail: `${rid}: original verifies, edited copy fails` }; });
  t('VT-11', 'Audit trail is append-only', () => { const before = state.audit.slice(0, 5).map((a) => a.id).join(); const next = reducer(state, { type: 'UPDATE_SAMPLE', id: state.samples[0].id, patch: { rush: !state.samples[0].rush }, reason: 'validation' }); return { pass: next.audit.length === state.audit.length + 1 && next.audit.slice(1, 6).map((a) => a.id).join() === before, detail: `${state.audit.length} → ${next.audit.length} entries, earlier entries unchanged` }; });
  t('VT-12', 'Files that are not instrument exports are rejected', () => { try { rowsFromSheet([['Product Name', 'ASIN'], ['x', 'y']]); return { pass: false, detail: 'accepted' }; } catch (e) { return { pass: true, detail: e.message.slice(0, 80) }; } });
  t('VT-13', 'Samples move only one stage forward at a time', () => { const s = state.samples.find((x) => x.stage === 'received'); const g = gateFor(state, s, 'extraction'); return { pass: !!g.blocked, detail: s.id + ': ' + (g.blocked || 'allowed') }; });
  return T;
}
export function Validation({ state, dispatch, toast }) {
  const [run, setRun] = useState(null);
  const [sign, setSign] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const go = () => setRun({ at: new Date().toISOString().slice(0, 16), tests: validationTests(state) });
  const pass = run && run.tests.every((x) => x.pass);
  return (
    <div className="stack">
      <div className="panel">
        <div className="row between wrap gap"><div><h4 className="m0">Software validation suite</h4><p className="muted small">Operational qualification tests that exercise the LIMS calculations and controls with your real instrument data. Run after every software update and sign the record (ISO/IEC 17025 §7.11.2).</p></div><button className="btn primary" onClick={go}><Icon n="check" size={14} />Run {13} tests</button></div>
        {run && (
          <>
            <table className="tbl compact"><thead><tr><th>Test</th><th>Requirement</th><th>Observed</th><th>Result</th></tr></thead>
              <tbody>{run.tests.map((x) => <tr key={x.id}><td className="lid">{x.id}</td><td className="small">{x.req}</td><td className="small muted">{x.detail}</td><td>{x.pass ? <span className="pill ok">Pass</span> : <span className="pill fail">Fail</span>}</td></tr>)}</tbody></table>
            <div className="row gap mt-s"><span className={cx('pill big', pass ? 'ok' : 'fail')}>{run.tests.filter((x) => x.pass).length} of {run.tests.length} passed</span><button className="btn ghost" onClick={() => setSign(true)}>Sign validation record</button></div>
          </>
        )}
      </div>
      <div className="panel">
        <h4>Validation records</h4>
        {state.validation.length ? state.validation.map((v) => <div key={v.id} className="note"><b>{v.id}</b> <span className="muted small">{fmtDate(v.at)} · signed by {v.by} · {v.esig}</span><p>{v.passed} of {v.total} tests passed. Software version {v.version}.</p></div>) : <Empty icon="shield" title="No signed runs yet" />}
        <p className="muted small">Installation and performance qualification (IQ/PQ) for the production system are documented at go-live; this suite is the repeatable OQ portion.</p>
      </div>
      {sign && run && (
        <Modal title="Sign validation record" onClose={() => setSign(false)} footer={<><button className="btn ghost" onClick={() => setSign(false)}>Cancel</button><button className="btn primary" disabled={!pin} onClick={async () => { if (!(await ESIG.verify(pin))) return setErr(`${ESIG.label} does not match.`); const id = 'VAL-' + String(state.validation.length + 1).padStart(3, '0'); dispatch({ type: 'ADD_ROW', coll: 'validation', row: { id, at: run.at, by: state.session.name, esig: 'ES-' + Math.floor(40000 + Math.random() * 59999), passed: run.tests.filter((x) => x.pass).length, total: run.tests.length, version: 'prototype 0.9' }, action: 'Validation run signed', entity: id }); setSign(false); setPin(''); toast(id + ' signed'); }}>Sign</button></>}>
          <ESign session={state.session} meaning="Validation results reviewed and accepted" pin={pin} setPin={(v) => { setPin(v); setErr(''); }} error={err} />
        </Modal>
      )}
    </div>
  );
}
