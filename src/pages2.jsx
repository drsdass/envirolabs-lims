import React, { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { SEED } from './seed.js';
import { LOGO_FULL } from './logo.js';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import { sha256 } from 'js-sha256';
import { reportHash, can } from './store.js';
import { useFilters, FilterBar, usePaged } from './filters.jsx';

const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
export const SITE = { url: 'https://lims.envirolabsusa.com' };
export const verifyUrl = (id, v) => `${SITE.url}/verify/${id}-R${v.version}?c=${v.hash.slice(0, 12)}`;

async function buildEvidence(state, id, v) {
  const zip = new JSZip();
  const sample = v.snapshot.sample, res = v.snapshot.results;
  const files = {};
  const add = (name, content) => { zip.file(name, content); files[name] = typeof content === 'string' ? sha256(content) : 'binary'; };
  const coa = document.querySelector('.coa');
  const css = [...document.querySelectorAll('style')].map((x) => x.textContent).join('\n');
  add(`01_certificate_${id}-R${v.version}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>${id}-R${v.version}</title><style>${css}</style></head><body style="background:#fff;padding:24px">${coa ? coa.outerHTML : ''}</body></html>`);
  add('02_chain_of_custody.csv', csv([['When', 'Who', 'Role', 'Action', 'Detail', 'E-signature'], ...state.audit.filter((a) => a.entity === id).slice().reverse().map((a) => [a.ts, a.user, a.role, a.action, a.detail, a.esig])]));
  add('03_results.csv', csv([['Test', 'Analyte', 'Result', 'Units', 'MRL', 'Dilution', 'Qualifiers', 'Prep batch', 'Analyzed'], ...Object.entries(res).flatMap(([t, r]) => r.analytes.map((a) => [t, a.name, a.text ?? (a.value == null ? 'ND' : a.value), a.units, a.mrl, a.dil, a.qualifiers.join(' '), r.prep, r.acq]))]));
  const qc = [['Test', 'Section', 'Item', 'Analyte', 'Value', 'Limit', 'Pass']];
  const raw = [['Test', 'Sample name', 'Compound', 'Sample type', 'Compound type', 'Final conc.', 'Calc. conc.', 'Exp. conc.', 'Dil.', 'Acquired', 'Data file']];
  Object.entries(res).forEach(([t, r]) => {
    const b = state.batches.find((x) => x.key === r.batchKey); if (!b) return;
    const e = b.eval, prep = e.preps.find((p) => p.id === r.prep);
    e.calibration.forEach((c) => c.points.forEach((p) => qc.push([t, 'Initial calibration', p.level + ' ppb', c.analyte, p.acc?.toFixed(1) + '%', p.lim.join('-') + '%', p.ok])));
    e.ccv.forEach((c) => c.analytes.forEach((a) => qc.push([t, 'CCV', c.file, a.analyte, a.rec?.toFixed(1) + '%', b && state.methods[t].ccvLimits.join('-') + '%', a.ok])));
    prep?.mb?.analytes.forEach((a) => qc.push([t, 'Method blank', prep.id, a.analyte, a.value ?? 'ND', '< ' + a.mrl, a.ok]));
    prep?.lcs?.forEach((l) => { qc.push([t, 'Blank spike', prep.id, l.analyte, l.r1?.toFixed(1) + '%', l.lim.join('-') + '%', l.ok1]); qc.push([t, 'Blank spike duplicate', prep.id, l.analyte, l.r2?.toFixed(1) + '%', l.lim.join('-') + '%', l.ok2]); qc.push([t, 'RPD', prep.id, l.analyte, l.rpd?.toFixed(1) + '%', '<= ' + l.rpdLim + '%', l.okRpd]); });
    r.surrogates.forEach((x) => qc.push([t, 'Surrogate', id, x.name, x.rec?.toFixed(1) + '%', '50-150%', x.ok]));
    (b.rows || []).filter((row) => !/^\d{6}-/.test(row[0]) || row[0].startsWith(id)).forEach((row) => raw.push([t, ...row]));
  });
  add('04_qc_summary.csv', csv(qc));
  add('05_instrument_data.csv', csv(raw));
  add('06_standards_and_reagents.csv', csv([['ID', 'Name', 'Lot', 'Expires', 'Location'], ...(sample.stdLots || []).map((i) => state.inventory.find((x) => x.id === i)).filter(Boolean).map((x) => [x.id, x.name, x.lot, x.expires, x.location])]));
  const people = [...new Set(state.audit.filter((a) => a.entity === id).map((a) => a.user))];
  add('07_training_records.csv', csv([['Analyst', 'Method', 'Status', 'Date', 'Authorized by'], ...state.training.filter((t) => people.includes(t.user) || people.includes(t.initials)).map((t) => [t.user, t.method, t.status, t.date, t.by])]));
  const livePhotos = state.samples.find((x) => x.id === id)?.photos || [];
  for (const [k, p] of livePhotos.entries()) {
    if (!p.src) continue;
    const name = `08_photos/${String(k + 1).padStart(2, '0')}_${p.stage}_${String(p.at).replace(/[:T]/g, '-')}.jpg`;
    if (p.src.startsWith('data:')) zip.file(name, p.src.split(',')[1], { base64: true }); else zip.file(name, await (await fetch(p.src)).blob());
    files[name] = 'image';
  }
  zip.file('manifest.json', JSON.stringify({ report: `${id}-R${v.version}`, signedBy: v.by, signedAt: v.at, esignature: v.esig, reportHash: v.hash, verify: verifyUrl(id, v), generated: new Date().toISOString(), generatedBy: state.session.name, files, note: 'Chromatogram images attach automatically once the instrument PC agent is installed (production).' }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `evidence_${id}-R${v.version}.zip`; a.click();
}

function QR({ text, size = 92 }) {
  const [src, setSrc] = useState('');
  React.useEffect(() => { QRCode.toDataURL(text, { margin: 0, width: size * 2, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => {}); }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="Verification QR code" /> : null;
}

export function Verify({ state, go, initial }) {
  const [rid, setRid] = useState(initial || '');
  const [code, setCode] = useState('');
  const [res, setRes] = useState(null);
  const check = () => {
    const m = rid.trim().toUpperCase().match(/^(\d{6}-[A-Z]+\d+)-R(\d+)$/);
    if (!m) return setRes({ ok: false, msg: 'Enter the report number exactly as printed, e.g. 260922-B13-R1.' });
    const v = state.reports[m[1]]?.find((x) => x.version === +m[2]);
    if (!v) return setRes({ ok: false, msg: 'No report with that number exists in this laboratory\'s records.' });
    const intact = reportHash(v.snapshot) === v.hash;
    const codeOk = !code.trim() || v.hash.startsWith(code.trim().toLowerCase());
    const latest = state.reports[m[1]].length === v.version;
    setRes({ ok: intact && codeOk, v, id: m[1], latest, msg: !intact ? 'The stored record fails its integrity check.' : !codeOk ? 'The verification code does not match this report. The document may have been altered.' : null });
  };
  return (
    <div className="page narrow">
      <div className="panel">
        <h4>Verify a certificate</h4>
        <p className="muted small">Anyone holding a certificate can scan its QR code or enter the report number and code printed under it. In production this page is public at lims.envirolabsusa.com/verify.</p>
        <div className="fg2"><Field label="Report number"><input value={rid} onChange={(e) => setRid(e.target.value)} placeholder="260922-B13-R1" /></Field><Field label="Verification code (optional)"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="12 characters under the QR code" /></Field></div>
        <button className="btn primary" onClick={check}>Verify</button>
        {res && (res.ok ? (
          <div className="callout ok mt"><Icon n="check" /><div><b>Authentic.</b> {res.id}-R{res.v.version} was signed by {res.v.by} on {fmtDate(res.v.at)} (e-signature {res.v.esig}). Fingerprint {res.v.hash.slice(0, 16)}…{!res.latest && <><br /><b>Note:</b> this version has been superseded by an amended report.</>} <button className="link" onClick={() => go('report', res.id)}>Open</button></div></div>
        ) : <div className="callout fail mt"><Icon n="x" /><div><b>Not verified.</b> {res.msg}</div></div>)}
      </div>
    </div>
  );
}
import { STAGES, ROLES, DEMO_PIN } from './store.js';
import { QUALIFIERS } from './config.js';
import { rowsFromSheet, detectMethod, evaluateBatch } from './qc.js';
import { cx, Icon, TestChips, Modal, Field, ESign, fmtDate, sig, pctf, Empty, nowIso, GateModal, ago, ESIG, PROD } from './ui.jsx';

const OK = ({ ok }) => <span className={cx('okmark', ok === true ? 'y' : ok === 'warn' ? 'w' : 'n')} aria-label={ok === true ? 'pass' : 'fail'}><Icon n={ok === true ? 'check' : ok === 'warn' ? 'alert' : 'x'} size={13} /></span>;

// ---------- Instrument runs ----------
export function Runs({ state, dispatch, toast, openSample, focus, go }) {
  const [preview, setPreview] = useState(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const runCfg = useMemo(() => ({ text: (b) => `${b.name} ${b.file} ${b.eval.preps.map((p) => p.id).join(' ')} ${b.eval.results.map((r) => r.id).join(' ')}`, facets: [{ key: 'test', label: 'Test', get: (b) => b.method }, { key: 'status', label: 'Status', get: (b) => (b.approved ? 'Approved' : 'Awaiting review') }, { key: 'analyst', label: 'Imported by', get: (b) => b.importedBy }, { key: 'kind', label: 'Source', get: (b) => (b.manual ? 'Manual entry' : 'Instrument') }], flags: [{ key: 'fail', label: 'QC failures', test: (b) => b.eval.issues.some((i) => i.level === 'fail') }, { key: 'open', label: 'Awaiting review', test: (b) => !b.approved }], date: { label: 'Imported', get: (b) => b.importedAt } }), []);
  const runCtl = useFilters('runs', state.batches, runCfg);
  if (focus) return <RunDetail state={state} dispatch={dispatch} toast={toast} openSample={openSample} batchKey={focus} back={() => go('runs')} />;

  const stage = (raw, fileName, key) => {
    const method = detectMethod(raw.rows, state.methods);
    if (!method) throw new Error('No configured method matches the compounds in this export.');
    const ev = evaluateBatch(raw, method);
    const name = (raw.meta?.['Batch Name'] || raw.batchName || fileName).replace('.batch.bin', '');
    return { key: key || 'B' + Date.now() + Math.random().toString(36).slice(2, 6), rows: raw.rows, name, method: method.code, file: fileName, path: raw.meta?.['Batch Data Path File Name'] || raw.path, quant: raw.meta?.['Report Quant Version'] || raw.quantVersion, instrument: 'LCMS1', importedAt: nowIso(), importedBy: state.session.name, eval: ev, approved: null };
  };
  const readFile = async (f) => {
    setErr('');
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const found = [];
      wb.SheetNames.forEach((sn) => {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
        try { const raw = rowsFromSheet(aoa); if (raw.rows.length) found.push(stage(raw, wb.SheetNames.length > 1 ? `${f.name} › ${sn}` : f.name)); } catch (e) { /* not an export sheet */ }
      });
      if (!found.length) throw new Error('No MassHunter Quant LIMS export was found in this file. Export from Quant with the Generic LIMS report and try again.');
      setPreview(found);
    } catch (e) { setErr(e.message); }
  };
  const demo = (key) => setPreview([stage(SEED.batches[key], key + '.xlsx', key)]);
  return (
    <div className="page">
      <div className="panel">
        <h4>Upload instrument run <span className="muted small">MassHunter Quant LIMS export (.xlsx / .csv) from BPS-LCMS, PFAS-LCMS or OTA-LCMS</span></h4>
        <div className={cx('drop big', drag && 'on')} role="button" tabIndex={0} onClick={() => fileRef.current.click()} onKeyDown={(e) => e.key === 'Enter' && fileRef.current.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]); }}>
          <span className="drop-ic"><Icon n="upload" size={20} /></span>
          <b>Drop run output here</b>
          <span className="muted small">or click to choose a file. Samples are matched by lab ID and every QC check runs automatically.</span>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { e.target.files[0] && readFile(e.target.files[0]); e.target.value = ''; }} />
        {err && <p className="err">{err}</p>}
        {state.pendingImports.length > 0 && <div className="row gap wrap mt-s"><span className="muted small">No file handy?</span>{state.pendingImports.map((k) => <button key={k} className="btn ghost sm" onClick={() => demo(k)}>Try sample export {SEED.batches[k].batchName}</button>)}</div>}
      </div>
      <SequenceBuilder state={state} toast={toast} openSample={openSample} />
      <div className="panel flush">
        <div className="pad"><FilterBar ctl={runCtl} state={state} dispatch={dispatch} toast={toast} placeholder="Search run name, file, prep batch, lab ID" compact /></div>
        <div className="row between pad"><h4 className="m0">Recent uploads <span className="muted small">{state.batches.length} run{state.batches.length !== 1 ? 's' : ''}</span></h4><span className="muted small">Click a run to review its results</span></div>
        <table className="tbl">
          <thead><tr><th>When</th><th>Batch file</th><th>Panel</th><th className="num">Samples</th><th>QC</th><th>Analyst</th><th>Status</th></tr></thead>
          <tbody>
            {runCtl.filtered.map((b) => {
              const fails = b.eval.issues.filter((i) => i.level === 'fail').length, warns = b.eval.issues.filter((i) => i.level === 'warn').length;
              return (
                <tr key={b.key} className="click" onClick={() => go('runs', b.key)}>
                  <td>{ago(b.importedAt)}<div className="muted small">{fmtDate(b.importedAt)}</div></td>
                  <td><b className="lid">{b.manual ? b.name : `${b.method} ${b.name.replace(/^(BPS|PFAS|OTA)\s*/, '')}.batch.bin`}</b><div className="muted small">{b.file}</div></td>
                  <td><span className={cx('pletter', 't-' + state.methods[b.method].color)}>{state.methods[b.method].letter}</span></td>
                  <td className="num">{b.eval.results.length}</td>
                  <td>{fails ? <span className="pill fail">{fails} fail</span> : <span className="pill ok">Pass</span>} {warns > 0 && <span className="pill warn">{warns} note{warns > 1 ? 's' : ''}</span>}</td>
                  <td>{b.importedBy}</td>
                  <td>{b.approved ? <span className="pill ok"><Icon n="sign" size={11} />Approved by {b.approved.by.split(' ')[0]}</span> : <span className="pill warn">Done · awaiting review</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {preview && (
        <Modal wide title={preview.length > 1 ? `${preview.length} instrument exports found` : `Import ${preview[0].name}`} sub="Check the match before attaching results to samples." onClose={() => setPreview(null)}
          footer={<><button className="btn ghost" onClick={() => setPreview(null)}>Cancel</button><button className="btn primary" onClick={() => { preview.forEach((b) => dispatch({ type: 'IMPORT_BATCH', batch: b })); toast(`Imported ${preview.length} run${preview.length > 1 ? 's' : ''}. Results attached to matching samples.`); const k = preview[0].key; setPreview(null); preview.length === 1 && go('runs', k); }}>Import and attach results</button></>}>
          {preview.map((b) => {
            const matched = b.eval.results.filter((r) => state.samples.find((s) => s.id === r.id));
            return (
              <div key={b.key} className="imp">
                <div className="row gap wrap"><TestChips tests={[b.method]} small /><b>{b.name}</b><span className="muted small">{b.eval.injections} injections · {b.eval.calLevels.length}-point calibration {b.eval.lowCal}–{b.eval.topCal} ppb · prep batch {b.eval.preps.map((p) => p.id).join(', ')}</span></div>
                <p className="small">{matched.length} of {b.eval.results.length} samples match lab IDs in the LIMS.{matched.length < b.eval.results.length && ` Unmatched: ${b.eval.results.filter((r) => !matched.includes(r)).map((r) => r.id).slice(0, 8).join(', ')}${b.eval.results.length - matched.length > 8 ? '…' : ''}`}</p>
                <Issues list={b.eval.issues} />
              </div>
            );
          })}
        </Modal>
      )}
    </div>
  );
}

function Issues({ list }) {
  if (!list.length) return <div className="callout ok"><Icon n="check" /> All QC checks pass.</div>;
  return <ul className="issues">{list.map((i, k) => <li key={k} className={i.level}><Icon n={i.level === 'fail' ? 'x' : 'alert'} size={14} />{i.text}</li>)}</ul>;
}

function RunDetail({ state, dispatch, toast, openSample, batchKey, back }) {
  const b = state.batches.find((x) => x.key === batchKey);
  const [sign, setSign] = useState(false);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [perr, setPerr] = useState('');
  if (!b) return <Empty title="Run not found" />;
  const e = b.eval;
  const m = state.methods[b.method];
  const canSign = can(state, 'approve');
  const approve = async () => {
    if (!(await ESIG.verify(pin))) { setPerr(`${ESIG.label} does not match.`); return; }
    dispatch({ type: 'APPROVE_BATCH', key: b.key, esig: 'ES-' + Math.floor(40000 + Math.random() * 59999), note });
    setSign(false); toast(`${b.name} approved`);
  };
  return (
    <div className="page">
      <button className="link" onClick={back}><Icon n="right" size={13} className="flip" /> Instrument runs</button>
      <div className="run-head">
        <div>
          <div className="row gap"><TestChips tests={[b.method]} /><h2>{b.name}</h2></div>
          <p className="muted small">{m.name} · {m.sop} rev {m.rev} · {b.instrument} · Quant {b.quant} · acquired {fmtDate(e.acqStart)} to {fmtDate(e.acqEnd)}</p>
          <p className="muted small">{b.path}</p>
        </div>
        <div className="run-actions">
          {b.approved ? <span className="pill ok big"><Icon n="sign" size={13} />Approved by {b.approved.by}, {fmtDate(b.approved.at)}</span>
            : <button className="btn primary" disabled={!canSign} title={canSign ? '' : 'Your role cannot approve batch QC'} onClick={() => setSign(true)}><Icon n="sign" size={14} />Approve batch QC</button>}
        </div>
      </div>
      <Issues list={e.issues} />
      <div className="qc-grid">
        <div className="panel">
          <h4>Initial calibration</h4>
          {e.calibration.map((c) => (
            <div key={c.analyte}>
              <div className="row between"><span>{c.analyte}</span><OK ok={c.ok} /></div>
              <div className="calbars" role="img" aria-label={`Calibration accuracy for ${c.analyte}`}>
                {c.points.map((p, k) => {
                  const off = Math.max(-50, Math.min(50, (p.acc || 0) - 100));
                  return <div key={k} className={cx('cb', !p.ok && 'bad')} title={`${p.level} ppb → ${sig(p.value)} (${pctf(p.acc)})`}><span style={{ height: Math.abs(off) * 0.9 + 2 + 'px', [off >= 0 ? 'bottom' : 'top']: '50%' }} /><em>{p.level}</em></div>;
                })}
              </div>
            </div>
          ))}
          <p className="muted small">Bars show deviation from nominal at each level (limits {m.calAccuracy.join('–')}%, lowest level {m.calLowAccuracy.join('–')}%).{e.ldr.some((l) => l.points.length) && ` Linear range verified to ${e.ldr[0].verified} ppb by LDR check.`}</p>
        </div>
        <div className="panel">
          <h4>Continuing calibration ({e.ccv.length})</h4>
          <table className="tbl compact"><thead><tr><th>File</th>{e.ccv[0]?.analytes.map((a) => <th key={a.analyte} className="num">{a.analyte}</th>)}<th /></tr></thead>
            <tbody>{e.ccv.map((c, k) => <tr key={k}><td className="muted small">{c.file || fmtDate(c.dt)}</td>{c.analytes.map((a) => <td key={a.analyte} className={cx('num', !a.ok && 'bad')}>{pctf(a.rec)}</td>)}<td><OK ok={c.ok} /></td></tr>)}</tbody></table>
          <p className="muted small">Recovery limits {m.ccvLimits.join('–')}%. Calibration blanks: {e.calBlanks.filter((c) => c.ok).length} of {e.calBlanks.length} clean.</p>
        </div>
        {e.preps.map((p) => (
          <div className="panel" key={p.id}>
            <h4>Prep batch {p.id}</h4>
            <table className="tbl compact">
              <thead><tr><th>Analyte</th><th className="num">Method blank</th><th className="num">Spike</th><th className="num">BS %REC</th><th className="num">BSD %REC</th><th className="num">RPD</th></tr></thead>
              <tbody>{e.calibration.map((c, k) => {
                const mb = p.mb?.analytes[k], l = p.lcs?.[k];
                return <tr key={c.analyte}><td>{c.analyte}</td><td className={cx('num', mb && !mb.ok && 'bad')}>{mb ? (mb.value == null ? 'ND' : sig(mb.value)) : '—'}</td><td className="num">{l ? l.spike : '—'}</td><td className={cx('num', l && !l.ok1 && 'bad')}>{l ? pctf(l.r1) : '—'}</td><td className={cx('num', l && !l.ok2 && 'bad')}>{l ? pctf(l.r2) : '—'}</td><td className={cx('num', l && !l.okRpd && 'bad')}>{l?.rpd != null ? l.rpd.toFixed(1) + '%' : '—'}</td></tr>;
              })}</tbody>
            </table>
            <p className="muted small">Spike recovery limits {m.analytes[0].rec.join('–')}%, RPD ≤ {m.analytes[0].rpd}%. Method blank surrogates: {p.mb?.surrogates.map((s) => `${s.name} ${pctf(s.rec)}`).join(', ')}</p>
          </div>
        ))}
        {e.ms.map((x) => (
          <div className="panel" key={x.parent}>
            <h4>Matrix spike on {x.parent}</h4>
            <table className="tbl compact"><thead><tr><th>Analyte</th><th className="num">Source</th><th className="num">MS %REC</th><th className="num">MSD %REC</th><th className="num">RPD</th></tr></thead>
              <tbody>{x.analytes.map((a) => <tr key={a.analyte}><td>{a.analyte}</td><td className="num">{sig(a.base)}</td><td className={cx('num', !a.ok && 'bad')}>{pctf(a.r1)}</td><td className="num">{pctf(a.r2)}</td><td className="num">{a.rpd != null ? a.rpd.toFixed(1) + '%' : '—'}</td></tr>)}</tbody></table>
          </div>
        ))}
      </div>
      <div className="panel flush">
        <table className="tbl">
          <thead><tr><th>Lab ID</th><th>Stage</th>{e.calibration.map((c) => <th key={c.analyte} className="num">{c.analyte} ({m.units})</th>)}{m.surrogates.map((s) => <th key={s.name} className="num">{s.name}</th>)}<th>Qualifiers</th></tr></thead>
          <tbody>{e.results.map((r) => {
            const s = state.samples.find((x) => x.id === r.id);
            const qs = [...new Set(r.analytes.flatMap((a) => a.qualifiers))];
            return (
              <tr key={r.id + r.sub} className={s ? 'click' : ''} onClick={() => s && openSample(s.id)}>
                <td className="lid">{r.id}{r.sub}</td><td className="muted small">{s ? STAGES.find((x) => x.key === s.stage).label : 'Not in LIMS'}</td>
                {r.analytes.map((a) => <td key={a.name} className={cx('num', a.qualifiers.includes('E') && 'bad', a.value != null && 'det')}>{a.value == null ? 'ND' : sig(a.value)}</td>)}
                {r.surrogates.map((x) => <td key={x.name} className={cx('num', !x.ok && 'bad')}>{pctf(x.rec)}</td>)}
                <td>{qs.map((q) => <span key={q} className={'q q-' + q} title={QUALIFIERS[q]}>{q}</span>)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {sign && (
        <Modal title={`Approve ${b.name}`} sub="Confirms calibration, CCVs, blanks, spikes and surrogates were reviewed." onClose={() => setSign(false)} footer={<><button className="btn ghost" onClick={() => setSign(false)}>Cancel</button><button className="btn primary" disabled={!pin} onClick={approve}>Sign and approve</button></>}>
          <Issues list={e.issues} />
          {e.issues.some((i) => i.level === 'fail') && <Field label="Review comment (required when QC has failures)"><input value={note} onChange={(x) => setNote(x.target.value)} placeholder="e.g. E-flagged samples sent back for dilution; NCR-2026-015" /></Field>}
          <ESign session={state.session} meaning="Reviewed and approved" pin={pin} setPin={(v) => { setPin(v); setPerr(''); }} error={perr} />
        </Modal>
      )}
    </div>
  );
}

// ---------- Reports ----------
export function Reports({ state, dispatch, toast, go }) {
  const all = useMemo(() => Object.entries(state.reports).map(([id, v]) => ({ id, v: v[v.length - 1], n: v.length, s: state.samples.find((x) => x.id === id) })).filter((r) => r.s).sort((a, b) => (a.v.at < b.v.at ? 1 : -1)), [state.reports, state.samples]);
  const cfg = useMemo(() => ({ text: (r) => `${r.id} ${r.s.name} ${r.s.asin || ''} ${r.v.esig}`, facets: [{ key: 'client', label: 'Client', get: (r) => state.clients.find((c) => c.id === r.s.clientId)?.name }, { key: 'test', label: 'Test', get: (r) => r.s.tests }, { key: 'signed', label: 'Signed by', get: (r) => r.v.by }, { key: 'matrix', label: 'Matrix', get: (r) => r.s.matrix }], flags: [{ key: 'amended', label: 'Amended', test: (r) => r.n > 1 }, { key: 'flags', label: 'With qualifiers', test: (r) => Object.values(r.v.snapshot.results || {}).some((x) => x.analytes.some((a) => a.qualifiers.length)) }, { key: 'detect', label: 'Detections', test: (r) => Object.values(r.v.snapshot.results || {}).some((x) => x.analytes.some((a) => a.value != null)) }], date: { label: 'Signed', get: (r) => r.v.at } }), [state.clients]);
  const ctl = useFilters('reports', all, cfg);
  const signed = ctl.filtered;
  const { rows: shownR, more: moreR } = usePaged(signed, 200, signed);
  const pending = state.samples.filter((s) => s.stage === 'manager');

  return (
    <div className="page">
      <FilterBar ctl={ctl} state={state} dispatch={dispatch} toast={toast} placeholder="Search report ID, product, ASIN, signature ID" right={<button className="btn ghost" onClick={() => go('verify')}><Icon n="shield" size={14} />Verify a certificate</button>} />
      {pending.length > 0 && <div className="panel"><h4>Ready for signature ({pending.length})</h4><div className="pending-list">{pending.map((s) => <button key={s.id} className="rowbtn" onClick={() => go('report', s.id)}><span className="lid">{s.id}</span><TestChips tests={s.tests} small /><span className="ellip">{s.name}</span><Icon n="right" /></button>)}</div></div>}
      <div className="panel flush">
        <table className="tbl">
          <thead><tr><th>Lab ID</th><th>Product</th><th>Tests</th><th>Version</th><th>Signed by</th><th>Signed</th></tr></thead>
          <tbody>{shownR.map((r) => <tr key={r.id} className="click" onClick={() => go('report', r.id)}><td className="lid">{r.id}</td><td className="ellip-cell">{r.s.name}</td><td><TestChips tests={r.s.tests} small /></td><td>v{r.v.version}{r.n > 1 && <span className="pill warn sm">Amended</span>}</td><td>{r.v.by}</td><td className="muted">{fmtDate(r.v.at)}</td></tr>)}</tbody>
        </table>
        {moreR}
      </div>
    </div>
  );
}

export function ReportView({ state, id, dispatch, toast, go }) {
  const versions = state.reports[id] || [];
  const [vi, setVi] = useState(versions.length - 1);
  const [amend, setAmend] = useState(false);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [perr, setPerr] = useState('');
  const [gate, setGate] = useState(false);
  const live = state.samples.find((s) => s.id === id);
  if (!live) return <Empty title="Sample not found" />;
  const vIdx = vi >= 0 && vi < versions.length ? vi : versions.length - 1;
  const v = versions[vIdx];
  const sample = v ? v.snapshot.sample : live;
  const results = v ? v.snapshot.results : state.results[id] || {};
  const client = state.clients.find((c) => c.id === sample.clientId);
  const set = state.settings;
  const doAmend = async () => {
    if (!(await ESIG.verify(pin))) { setPerr(`${ESIG.label} does not match.`); return; }
    dispatch({ type: 'AMEND_REPORT', id, reason, esig: 'ES-' + Math.floor(40000 + Math.random() * 59999) });
    setAmend(false); setVi(versions.length); toast(`Amended report v${versions.length + 1} issued`);
  };
  const allQ = [...new Set(Object.values(results).flatMap((r) => r.analytes.flatMap((a) => a.qualifiers)))];
  return (
    <div className="page">
      <div className="toolbar noprint">
        <button className="link" onClick={() => go('reports')}><Icon n="right" size={13} className="flip" /> Reports</button>
        {versions.length > 0 && <select value={vIdx} onChange={(e) => setVi(+e.target.value)} aria-label="Version">{versions.map((x, k) => <option key={k} value={k}>Version {x.version}{x.reason ? ' (amended)' : ''} · {fmtDate(x.at)}</option>)}</select>}
        <span className="push" />
        {v && can(state, 'amend') && <button className="btn ghost" onClick={() => setAmend(true)}>Issue amended report</button>}
        {!v && live.stage === 'manager' && <button className="btn primary" onClick={() => setGate(true)}><Icon n="sign" size={14} />Sign and release</button>}
        {v && <button className="btn ghost" onClick={async () => { toast('Building evidence package…'); await buildEvidence(state, id, v); }}><Icon n="download" size={14} />Evidence package</button>}
        <button className="btn primary" onClick={() => window.print()}><Icon n="print" size={14} />Print / save PDF</button>
      </div>
      {!v && <div className="callout warn noprint"><Icon n="alert" /> Draft preview. The certificate is locked and versioned when a Lab Manager signs it from the board.</div>}
      <article className={cx('coa', !v && 'draft')}>
        <header className="coa-head">
          <div className="coa-brand"><img src={LOGO_FULL} alt="Enviro Labs" /><div><div className="coa-lab">{set.labName}</div><div className="small">{set.address}</div><div className="small">{set.phone} · {set.email}</div></div></div>
          <div className="coa-id"><div className="small muted">Lab ID</div><div className="lid big">{sample.id}</div>{v && <div className="small">Report {sample.id}-R{v.version}</div>}</div>
        </header>
        <h1 className="coa-title">Certificate of Analysis{v?.reason ? ' — Amended' : ''}</h1>
        {v?.reason && <p className="small"><b>Amendment:</b> {v.reason}. This report supersedes version {v.version - 1}.</p>}
        <section className="coa-grid">
          <div><h5>Client</h5><p>{client.name}<br />{client.lead}<br />{client.address}<br />{client.email}</p></div>
          <div><h5>Sample</h5><p>{sample.name}</p><p className="small">ASIN {sample.asin || '—'} · {sample.matrix} · product weight {sample.weight ?? '—'} g</p></div>
          <div><h5>Dates</h5><p className="small">Received {fmtDate(sample.receivedAt)} by {sample.receivedBy}<br />Condition: {sample.condition || '—'}<br />Reported {v ? fmtDate(v.at) : 'not yet'}</p></div>
        </section>
        {Object.entries(results).map(([t, r]) => {
          const m = state.methods[t];
          const b = state.batches.find((x) => x.key === r.batchKey);
          const prep = b?.eval.preps.find((p) => p.id === r.prep);
          return (
            <section key={t} className="coa-sec">
              <h3>{m.name}</h3>
              <p className="small muted">Method {m.sop} rev {m.rev} ({m.technique}) · prep batch {r.prep} · analyzed {fmtDate(r.acq)} · instrument {b?.instrument}</p>
              <table className="tbl compact coa-t">
                <thead><tr><th>Analyte</th><th>CAS</th><th className="num">Result</th><th className="num">MRL</th><th>Units</th><th className="num">Dilution</th><th>Qualifier</th></tr></thead>
                <tbody>{r.analytes.map((a) => <tr key={a.name}><td>{a.name}</td><td className="muted">{m.analytes.find((x) => x.name === a.name)?.cas}</td><td className="num"><b>{a.value == null ? 'ND' : sig(a.value)}</b></td><td className="num">{a.mrl}</td><td>{a.units}</td><td className="num">{a.dil}</td><td>{a.qualifiers.join(', ')}</td></tr>)}</tbody>
              </table>
              <h5>Quality control</h5>
              <table className="tbl compact coa-t">
                <thead><tr><th>Analyte</th><th className="num">Method blank</th><th className="num">Fortified</th><th className="num">BS %REC</th><th className="num">BSD %REC</th><th>Limits</th><th className="num">RPD</th><th>RPD limit</th></tr></thead>
                <tbody>{r.analytes.map((a, k) => {
                  const mb = prep?.mb?.analytes.find((x) => x.analyte === a.name), l = prep?.lcs?.find((x) => x.analyte === a.name);
                  return <tr key={a.name}><td>{a.name}</td><td className="num">{mb ? (mb.value == null ? 'ND' : sig(mb.value)) : '—'}</td><td className="num">{l ? `${l.spike} ${m.units}` : '—'}</td><td className="num">{l ? pctf(l.r1) : '—'}</td><td className="num">{l ? pctf(l.r2) : '—'}</td><td>{l ? l.lim.join('–') + '%' : '—'}</td><td className="num">{l?.rpd != null ? l.rpd.toFixed(1) + '%' : '—'}</td><td>{l ? `≤ ${l.rpdLim}%` : '—'}</td></tr>;
                })}</tbody>
              </table>
              <p className="small">Surrogate recovery: {r.surrogates.map((x) => `${x.name} ${pctf(x.rec)}`).join(', ')} (limits {m.surrogates[0].rec.join('–')}%).</p>
            </section>
          );
        })}
        {!Object.keys(results).length && <p className="muted">No results attached yet.</p>}
        <section className="coa-sec defs">
          <h5>Definitions and remarks</h5>
          <dl>
            <dt>MRL</dt><dd>Method Reporting Limit: the lowest concentration that can be reported with a specified degree of confidence. Also known as the Limit of Quantitation (LOQ).</dd>
            <dt>ND</dt><dd>{QUALIFIERS.ND}</dd>
            <dt>%REC / RPD</dt><dd>Percent recovery / relative percent difference.</dd>
            {allQ.map((q) => <React.Fragment key={q}><dt>{q}</dt><dd>{QUALIFIERS[q]}</dd></React.Fragment>)}
          </dl>
          <p className="small">This is a complete report. Results relate only to the item tested as received. This report must be reproduced in its entirety. Any remaining sample will be disposed of {set.disposal} days from the final report date unless other arrangements are made in advance.</p>
          <p className="small muted">The results in this report are provided for informational purposes related to consumer products analysis of BPS, PFAS and related compounds, solely for the client's use as requested. The laboratory assumes no responsibility for the interpretation or use of these results beyond their analytical scope. It is the client's responsibility to ensure compliance with applicable regulatory standards.</p>
        </section>
        <footer className="coa-sign">
          <div className="sign-row">
            <div>{v ? (<><div className="sigline">{v.by}</div><div className="small">{v.title} · electronically signed {fmtDate(v.at)} · signature ID {v.esig}</div></>) : <div className="sigline muted">Awaiting authorized signatory</div>}</div>
            {v && <div className="verify-box"><QR text={verifyUrl(id, v)} /><div className="small"><b>Verify this report</b><br />Scan, or enter report {id}-R{v.version} and code <span className="mono-code">{v.hash.slice(0, 12)}</span> at {SITE.url.replace(/^https?:\/\//, '')}/verify</div></div>}
          </div>
        </footer>
      </article>
      {gate && <GateModal state={state} ids={[id]} to="reported" dispatch={dispatch} onClose={() => setGate(false)} toast={toast} />}
      {amend && (
        <Modal title="Issue amended report" sub="The original version stays on record. The new version is built from the current data and states the reason." onClose={() => setAmend(false)} footer={<><button className="btn ghost" onClick={() => setAmend(false)}>Cancel</button><button className="btn primary" disabled={!reason.trim() || !pin} onClick={doAmend}>Sign amended report</button></>}>
          <Field label="Reason for amendment (printed on the report)"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Corrected product name at client request" /></Field>
          <ESign session={state.session} meaning="Amended report approved and released" pin={pin} setPin={(x) => { setPin(x); setPerr(''); }} error={perr} />
        </Modal>
      )}
    </div>
  );
}

// ---------- Sequence builder and rerun queue ----------
const DILS = [2, 5, 10, 20, 50, 100, 200, 500, 1000];
export function rerunQueue(state) {
  const out = [];
  state.samples.forEach((s) => {
    if (s.legacy || s.stage === 'reported') return;
    Object.entries(state.results[s.id] || {}).forEach(([t, r]) => {
      const b = state.batches.find((x) => x.key === r.batchKey);
      const over = r.analytes.filter((a) => a.qualifiers.includes('E'));
      if (!over.length || !b) return;
      const top = b.eval.topCal || state.methods[t].calLevels.slice(-1)[0];
      const cc = Math.max(...over.map((a) => a.cc || a.value || 0));
      const dil = DILS.find((d) => cc / d <= top * 0.8) || 1000;
      out.push({ s, t, cc, dil, top, analytes: over.map((a) => a.name) });
    });
  });
  return out;
}
function SequenceBuilder({ state, toast, openSample }) {
  const [test, setTest] = useState('BPS');
  const [sel, setSel] = useState({});
  const [dils, setDils] = useState({});
  const [open, setOpen] = useState(false);
  const m = state.methods[test];
  const preps = {};
  state.samples.filter((s) => !s.legacy && s.stage === 'analysis' && s.prepBatch && s.tests.includes(test) && !state.results[s.id]?.[test]).forEach((s) => (preps[s.prepBatch] = preps[s.prepBatch] || []).push(s));
  const reruns = rerunQueue(state).filter((r) => r.t === test);
  const allReruns = rerunQueue(state);
  const chosenPreps = Object.keys(preps).filter((p) => sel['p' + p]);
  const chosenReruns = reruns.filter((r) => sel['r' + r.s.id]);
  const build = () => {
    const rows = [];
    let n = 0;
    const d = new Date(); const day = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const push = (name, type, dil = 1, comment = '') => { n++; rows.push([n, name, type, m.acqMethod, `${day} - D${String(n).padStart(3, '0')}.d`, dil, comment]); };
    let since = 0;
    const ccv = () => { push('CCV 1 ppb', 'CC'); push('Calibration Blank', 'Blank'); since = 0; };
    const samp = (name, dil, c) => { if (since >= 10) ccv(); push(name, 'Sample', dil, c); since++; };
    push('Solvent Blank', 'Blank');
    m.calLevels.forEach((l) => push(`${l} ppb`, 'Cal'));
    push('Calibration Blank', 'Blank');
    m.ldrLevels.forEach((l) => push(`LDR ${l} ppb`, 'CC'));
    ccv();
    chosenPreps.forEach((p) => {
      push(`Method Blank ${p}`, 'Blank'); push(`Blank Spike 1:${p}`, 'QC'); push(`Blank Spike Duplicate:${p}`, 'QC');
      preps[p].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((s) => samp(s.id, 1));
    });
    chosenReruns.forEach((r) => { const dl = dils[r.s.id] || r.dil; samp(`${r.s.id} x${dl}`, dl, `Rerun: over range ${Math.round(r.cc)} vs top std ${r.top}`); });
    ccv();
    return rows;
  };
  const rows = chosenPreps.length || chosenReruns.length ? build() : [];
  const download = () => {
    const head = ['Position', 'Sample Name', 'Sample Type', 'Acq Method', 'Data File', 'Dilution', 'Comment'];
    const blob = new Blob([[head, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sequence_${test}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast(`Sequence exported (${rows.length} injections). Import it into the MassHunter worklist.`);
  };
  return (
    <div className="panel">
      <div className="row between wrap gap">
        <h4 className="m0">Build instrument sequence <span className="muted small">{Object.keys(preps).length} prep batch{Object.keys(preps).length !== 1 ? 'es' : ''} ready · {allReruns.length} rerun{allReruns.length !== 1 ? 's' : ''} queued</span></h4>
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Open sequence builder'}</button>
      </div>
      {open && (
        <div className="seq">
          <div className="seg">{['BPS', 'PFAS', 'OTA'].map((t) => <button key={t} className={cx(test === t && 'on', 't-' + state.methods[t].color)} onClick={() => { setTest(t); setSel({}); }}>{t}</button>)}</div>
          <div className="grid2">
            <div>
              <h5>Prep batches waiting for the instrument</h5>
              {Object.keys(preps).length ? Object.entries(preps).map(([p, list]) => <label key={p} className="check row-check"><input type="checkbox" checked={!!sel['p' + p]} onChange={(e) => setSel({ ...sel, ['p' + p]: e.target.checked })} /><b>{p}</b><span className="muted small">{list.length} samples</span></label>) : <p className="muted small">None. Samples arrive here when they move to the Instrument stage with a prep batch ID.</p>}
            </div>
            <div>
              <h5>Rerun queue (over the verified range)</h5>
              {reruns.length ? reruns.map((r) => (
                <div key={r.s.id} className="row gap row-check">
                  <input type="checkbox" checked={!!sel['r' + r.s.id]} onChange={(e) => setSel({ ...sel, ['r' + r.s.id]: e.target.checked })} aria-label={'Include ' + r.s.id} />
                  <button className="link" onClick={() => openSample(r.s.id)}>{r.s.id}</button>
                  <span className="muted small">{Math.round(r.cc).toLocaleString()} vs top {r.top} ppb</span>
                  <select value={dils[r.s.id] || r.dil} onChange={(e) => setDils({ ...dils, [r.s.id]: +e.target.value })} aria-label="Dilution">{DILS.map((x) => <option key={x} value={x}>×{x}</option>)}</select>
                </div>
              )) : <p className="muted small">No {test} samples need dilution.</p>}
            </div>
          </div>
          {rows.length > 0 && (
            <>
              <div className="seq-prev">
                <table className="tbl compact"><thead><tr><th>#</th><th>Sample name</th><th>Type</th><th>Data file</th><th className="num">Dil.</th><th>Comment</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r[0]} className={r[2] === 'Sample' ? '' : 'qcrow'}><td>{r[0]}</td><td className={r[2] === 'Sample' ? 'lid' : ''}>{r[1]}</td><td>{r[2]}</td><td className="muted">{r[4]}</td><td className="num">{r[5]}</td><td className="muted small">{r[6]}</td></tr>)}</tbody></table>
              </div>
              <div className="row gap"><button className="btn primary" onClick={download}><Icon n="download" size={14} />Export worklist ({rows.length} injections)</button><span className="muted small">Names match what the importer expects, so results attach without retyping. Reruns are named "lab ID x10" and replace the over-range result on import.</span></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
