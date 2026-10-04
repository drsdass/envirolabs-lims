import React, { useReducer, useState, useEffect, useMemo, useCallback } from 'react';
import { buildInitial, reducer, STAGES, ROLES, USERS, DEMO_PIN, can, syncRoles } from './store.js';
import { METHODS, QUALIFIERS } from './config.js';
import { cx, Icon, TestChips, Modal, Field, ESign, fmtDate, daysSince, Empty, nowIso, useSearchIndex } from './ui.jsx';
import { Dashboard, SampleDrawer, Samples } from './pages1.jsx';
import { Intake } from './intake.jsx';
import { Runs, Reports, ReportView } from './pages2.jsx';
import { History, Users, Settings } from './pages3.jsx';
import { LOGO_MARK, LOGO_FULL, LOGO_FULLW } from './logo.js';
import { Shipments, Inventory, Billing, Analytics, Bell } from './pages4.jsx';
import { ControlCharts, Uncertainty, MethodStudies, Records, Validation } from './quality2.jsx';
import { ClientPortal } from './portal.jsx';
import { Verify } from './pages2.jsx';
import { ScanMode, MyWork, HelpModal } from './prod.jsx';
import { useFilters, FilterBar, usePaged } from './filters.jsx';

// ---------- Storage ----------
function Storage({ state, dispatch, toast, openSample }) {
  const live = state.samples.filter((s) => !s.disposed && s.bin);
  const bins = [...new Set(live.map((s) => s.bin))].sort();
  const due = state.samples.filter((s) => s.stage === 'reported' && !s.disposed && !s.legacy).map((s) => {
    const r = state.reports[s.id]; const last = r?.[r.length - 1];
    const dueAt = last ? new Date(new Date(last.at).getTime() + state.settings.disposal * 864e5) : null;
    return { s, dueAt, days: dueAt ? Math.ceil((dueAt - Date.now()) / 864e5) : null };
  }).sort((a, b) => a.days - b.days);
  const ready = due.filter((d) => d.days <= 0);
  const [sq, setSq] = useState('');
  const dueShown = due.filter((d) => !sq || `${d.s.id} ${d.s.name} ${d.s.bin}`.toLowerCase().includes(sq.toLowerCase()));
  return (
    <div className="page">
      <div className="panel">
        <h4>Storage bins</h4>
        <div className="bins">
          {bins.map((b) => {
            const items = live.filter((s) => s.bin === b);
            return (
              <div key={b} className="bin">
                <div className="row between"><b>{b}</b><span className="muted small">{items.length}</span></div>
                <div className="bin-dots">{items.map((s) => <button key={s.id} className={cx('bdot', 'st-' + s.stage)} title={`${s.id} · ${STAGES.find((x) => x.key === s.stage).label}`} onClick={() => openSample(s.id)} />)}</div>
              </div>
            );
          })}
        </div>
        <div className="legend">{STAGES.map((s) => <span key={s.key}><i className={'bdot st-' + s.key} />{s.label}</span>)}</div>
      </div>
      <div className="panel">
        <div className="row between"><h4>Retention and disposal</h4>{ready.length > 0 && <button className="btn warn" onClick={() => { dispatch({ type: 'DISPOSE', ids: ready.map((d) => d.s.id) }); toast(`${ready.length} samples recorded as disposed`); }}>Record disposal of {ready.length}</button>}</div>
        <div className="search-in mt-s"><Icon n="search" /><input placeholder="Find a sample, product or bin" value={sq} onChange={(e) => setSq(e.target.value)} /></div>
        <p className="muted small">Samples are retained {state.settings.disposal} days after the final report (EL-SOP-002), then disposed and logged.</p>
        <table className="tbl compact">
          <thead><tr><th>Lab ID</th><th>Bin</th><th>Reported</th><th>Dispose after</th><th /></tr></thead>
          <tbody>{dueShown.slice(0, 200).map((d) => <tr key={d.s.id} className="click" onClick={() => openSample(d.s.id)}><td className="lid">{d.s.id}</td><td>{d.s.bin}</td><td className="muted">{fmtDate(state.reports[d.s.id]?.slice(-1)[0].at, false)}</td><td>{fmtDate(d.dueAt?.toISOString(), false)}</td><td className="muted small">{d.days <= 0 ? 'Ready' : `in ${d.days} days`}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Quality (ISO/IEC 17025) ----------
const CLAUSES = [
  ['6.2', 'Personnel', 'Training and authorization matrix; gates block unauthorized analysts from running a method.', 'training'],
  ['6.4 / 6.5', 'Equipment and traceability', 'Calibration register with due dates; overdue equipment raises a warning at the gate that uses it.', 'equipment'],
  ['7.2', 'Method selection and validation', 'Versioned methods with limits; every change needs a reason and bumps the revision.', 'methods'],
  ['7.4', 'Handling of test items', 'Unique lab IDs, barcoded labels, condition on receipt, storage bins, holds, retention and disposal.', 'storage'],
  ['7.5', 'Technical records', 'Who did what and when at each stage, prep batch, subsample mass and instrument file are kept per sample.', 'audit'],
  ['7.7', 'Ensuring validity of results', 'Automatic calibration, CCV, blank, spike, RPD and surrogate evaluation; PT results tracked.', 'pt'],
  ['7.8', 'Reporting results', 'Certificate includes method, dates, MRLs, QC, qualifiers and authorized signatory; amendments are versioned with reasons.', 'reports'],
  ['7.9', 'Complaints', 'Complaint log with response and status.', 'complaints'],
  ['7.10', 'Nonconforming work', 'NCR and corrective action log linked to batches and samples.', 'ncr'],
  ['7.11', 'Control of data and information management', 'Role-based access, e-signatures, immutable audit trail, locked reports.', 'audit'],
  ['7.6', 'Measurement uncertainty', 'Top-down uncertainty per analyte from blank spike history, recalculated as batches arrive.', 'uncert'],
  ['7.11.2', 'LIMS validation', 'Repeatable validation suite with signed records after every update.', 'validation'],
  ['8.3', 'Control of documents', 'SOP register with revision, effective date and review date.', 'documents'],
  ['8.5 / 8.8 / 8.9', 'Risks, internal audits, management review', 'Risk register with scoring, audit programme and review minutes with actions.', 'records'],
];

function Quality({ state, dispatch, toast, go }) {
  const [tab, setTab] = useState('overview');
  const [eq, setEq] = useState(null);
  const [ncr, setNcr] = useState(null);
  const today = new Date(new Date().toDateString());
  const eqOver = state.equipment.filter((e) => new Date(e.nextCal) < today);
  const docDue = state.documents.filter((d) => new Date(d.review) < new Date(Date.now() + 30 * 864e5));
  const openN = state.ncrs.filter((n) => n.status === 'Open');
  const tabs = [['overview', 'Overview'], ['charts', 'Control charts'], ['uncert', 'Uncertainty'], ['studies', 'Method studies'], ['equipment', 'Equipment'], ['training', 'Training'], ['documents', 'Documents'], ['ncr', 'Nonconformance'], ['complaints', 'Complaints'], ['pt', 'Proficiency testing'], ['records', 'Audits, reviews, risks'], ['validation', 'Software validation']];
  return (
    <div className="page">
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={cx('tab', tab === k && 'on')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'overview' && (
        <>
          <div className="tiles three">
            <div className={cx('tile', eqOver.length && 'fail')}><span className="tile-ic"><Icon n="scale" /></span><div><div className="tile-label">Equipment out of calibration</div><div className="tile-n">{eqOver.length}</div><div className="tile-sub">{eqOver.map((e) => e.id).join(', ') || 'All current'}</div></div></div>
            <div className={cx('tile', openN.length && 'warn')}><span className="tile-ic"><Icon n="alert" /></span><div><div className="tile-label">Open nonconformances</div><div className="tile-n">{openN.length}</div><div className="tile-sub">{openN.map((n) => n.id).join(', ') || 'None'}</div></div></div>
            <div className={cx('tile', docDue.length && 'warn')}><span className="tile-ic"><Icon n="doc" /></span><div><div className="tile-label">Documents due for review</div><div className="tile-n">{docDue.length}</div><div className="tile-sub">within 30 days</div></div></div>
          </div>
          <div className="panel">
            <h4>How the LIMS covers ISO/IEC 17025:2017</h4>
            <table className="tbl"><thead><tr><th>Clause</th><th>Requirement</th><th>Where it lives in the LIMS</th></tr></thead>
              <tbody>{CLAUSES.map(([c, r, w, t]) => <tr key={c} className="click" onClick={() => (['equipment', 'training', 'documents', 'ncr', 'complaints', 'pt', 'uncert', 'validation', 'records'].includes(t) ? setTab(t) : go(t))}><td><b>{c}</b></td><td>{r}</td><td>{w}</td></tr>)}</tbody></table>
          </div>
        </>
      )}
      {tab === 'charts' && <ControlCharts state={state} />}
      {tab === 'uncert' && <Uncertainty state={state} />}
      {tab === 'studies' && <MethodStudies state={state} dispatch={dispatch} toast={toast} />}
      {tab === 'records' && <Records state={state} dispatch={dispatch} toast={toast} />}
      {tab === 'validation' && <Validation state={state} dispatch={dispatch} toast={toast} />}
      {tab === 'equipment' && <div className="panel flush"><table className="tbl"><thead><tr><th>ID</th><th>Equipment</th><th>Location</th><th>Last calibrated</th><th>Next due</th><th>Status</th></tr></thead><tbody>{state.equipment.map((e) => { const over = new Date(e.nextCal) < today; return <tr key={e.id} className="click" onClick={() => setEq(e.id)}><td className="lid">{e.id}</td><td>{e.name}<div className="muted small">{e.notes}</div></td><td>{e.location}</td><td>{fmtDate(e.lastCal, false)}</td><td className={over ? 'bad' : ''}>{fmtDate(e.nextCal, false)}</td><td>{e.status === 'Out of service' ? <span className="pill fail">Out of service</span> : over ? <span className="pill fail">Overdue</span> : <span className="pill ok">In service</span>}</td></tr>; })}</tbody></table></div>}
      {eq && <EquipmentLog state={state} id={eq} dispatch={dispatch} toast={toast} onClose={() => setEq(null)} />}
      {tab === 'training' && (
        <div className="panel flush">
          <table className="tbl"><thead><tr><th>Analyst</th>{['BPS', 'PFAS', 'OTA', 'PEP'].map((m) => <th key={m}>{m}</th>)}</tr></thead>
            <tbody>{state.users.filter((u) => !u.client).map((u) => <tr key={u.id}><td>{u.name} <span className="muted small">{u.title}</span></td>{['BPS', 'PFAS', 'OTA', 'PEP'].map((m) => { const t = state.training.find((x) => x.user === u.name && x.method === m); const ok = (u.methods || []).includes(m); return <td key={m}>{ok ? <span className="pill ok">Authorized{t?.date ? ' ' + fmtDate(t.date, false) : ''}</span> : <span className="pill">Not trained</span>}</td>; })}</tr>)}</tbody></table>
        </div>
      )}
      {tab === 'documents' && <div className="panel flush"><table className="tbl"><thead><tr><th>Document</th><th>Title</th><th>Rev</th><th>Effective</th><th>Owner</th><th>Next review</th></tr></thead><tbody>{state.documents.map((d) => <tr key={d.id}><td className="lid">{d.id}</td><td>{d.title}</td><td>{d.rev}</td><td>{fmtDate(d.effective, false)}</td><td>{d.owner}</td><td className={new Date(d.review) < new Date(Date.now() + 30 * 864e5) ? 'bad' : ''}>{fmtDate(d.review, false)}</td></tr>)}</tbody></table></div>}
      {tab === 'ncr' && (
        <div className="panel flush">
          <div className="row between pad"><span className="muted small">Nonconforming work and corrective actions</span><button className="btn primary sm" onClick={() => setNcr({ source: 'QC failure', text: '', cause: '', action: '', due: '' })}><Icon n="plus" size={13} />Open NCR</button></div>
          <table className="tbl"><thead><tr><th>NCR</th><th>Opened</th><th>Source</th><th>Description</th><th>Corrective action</th><th>Status</th></tr></thead>
            <tbody>{state.ncrs.map((n) => <tr key={n.id}><td className="lid">{n.id}</td><td className="muted">{fmtDate(n.opened, false)}<div className="small">{n.by}</div></td><td>{n.source}</td><td>{n.text}<div className="muted small">Cause: {n.cause || '—'}</div></td><td>{n.action}<div className="muted small">Due {fmtDate(n.due, false)}</div></td><td>{n.status === 'Open' ? <button className="pill warn as-btn" onClick={() => { dispatch({ type: 'CLOSE_NCR', id: n.id }); toast(n.id + ' closed'); }}>Open · close</button> : <span className="pill ok">Closed</span>}</td></tr>)}</tbody></table>
        </div>
      )}
      {tab === 'complaints' && <div className="panel flush"><table className="tbl"><thead><tr><th>ID</th><th>Received</th><th>Client</th><th>Complaint</th><th>Response</th><th>Status</th></tr></thead><tbody>{state.complaints.map((c) => <tr key={c.id}><td className="lid">{c.id}</td><td>{fmtDate(c.received, false)}</td><td>{c.client}</td><td>{c.text}</td><td>{c.response}</td><td><span className="pill ok">{c.status}</span></td></tr>)}</tbody></table></div>}
      {tab === 'pt' && <div className="panel flush"><table className="tbl"><thead><tr><th>Round</th><th>Scheme</th><th>Analyte</th><th className="num">Assigned</th><th className="num">Reported</th><th className="num">z-score</th><th>Result</th></tr></thead><tbody>{state.pt.map((p) => <tr key={p.id}><td className="lid">{p.id}<div className="muted small">{fmtDate(p.date, false)}</div></td><td>{p.scheme}</td><td>{p.analyte}</td><td className="num">{p.assigned}</td><td className="num">{p.reported}</td><td className="num">{p.z.toFixed(1)}</td><td><span className={cx('pill', Math.abs(p.z) <= 2 ? 'ok' : 'fail')}>{p.result}</span></td></tr>)}</tbody></table></div>}
      {ncr && (
        <Modal title="Open nonconformance" onClose={() => setNcr(null)} footer={<><button className="btn ghost" onClick={() => setNcr(null)}>Cancel</button><button className="btn primary" disabled={!ncr.text.trim()} onClick={() => { const id = `NCR-${new Date().getFullYear()}-0${15 + state.ncrs.length - 3}`; dispatch({ type: 'ADD_NCR', ncr: { ...ncr, id, opened: nowIso().slice(0, 10), by: state.session.name, status: 'Open' } }); setNcr(null); toast(id + ' opened'); }}>Open NCR</button></>}>
          <Field label="Source"><select value={ncr.source} onChange={(e) => setNcr({ ...ncr, source: e.target.value })}>{['QC failure', 'Sample receipt', 'Equipment', 'Client complaint', 'Internal audit', 'Report error'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="What happened"><input value={ncr.text} onChange={(e) => setNcr({ ...ncr, text: e.target.value })} /></Field>
          <Field label="Root cause"><input value={ncr.cause} onChange={(e) => setNcr({ ...ncr, cause: e.target.value })} /></Field>
          <Field label="Corrective action"><input value={ncr.action} onChange={(e) => setNcr({ ...ncr, action: e.target.value })} /></Field>
          <Field label="Due"><input type="date" value={ncr.due} onChange={(e) => setNcr({ ...ncr, due: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

function EquipmentLog({ state, id, dispatch, toast, onClose }) {
  const e = state.equipment.find((x) => x.id === id);
  const [f, setF] = useState({ kind: 'Maintenance', text: '', date: new Date().toISOString().slice(0, 10) });
  const add = () => {
    const entry = { ...f, by: state.session.name, at: new Date().toISOString().slice(0, 16) };
    const patch = { log: [entry, ...(e.log || [])] };
    if (f.kind === 'Calibration') { patch.lastCal = f.date; const n = new Date(f.date); n.setFullYear(n.getFullYear() + 1); patch.nextCal = n.toISOString().slice(0, 10); patch.status = 'In service'; }
    dispatch({ type: 'PATCH_ROW', coll: 'equipment', id, patch, action: `Equipment ${f.kind.toLowerCase()} logged`, detail: f.text });
    setF({ ...f, text: '' }); toast('Logbook entry added');
  };
  const toggle = () => { const out = e.status !== 'Out of service'; const why = window.prompt(out ? 'Reason for taking it out of service:' : 'What was done to return it to service?'); if (!why) return; dispatch({ type: 'PATCH_ROW', coll: 'equipment', id, patch: { status: out ? 'Out of service' : 'In service', log: [{ kind: out ? 'Out of service' : 'Returned to service', text: why, date: new Date().toISOString().slice(0, 10), by: state.session.name, at: new Date().toISOString().slice(0, 16) }, ...(e.log || [])] }, action: out ? 'Equipment taken out of service' : 'Equipment returned to service', detail: why }); };
  return (
    <Modal wide title={`${e.id} · ${e.name}`} sub={`${e.location} · serial ${e.serial} · calibrated ${fmtDate(e.lastCal, false)}, due ${fmtDate(e.nextCal, false)}`} onClose={onClose}
      footer={<button className={cx('btn', e.status === 'Out of service' ? 'primary' : 'warn')} onClick={toggle}>{e.status === 'Out of service' ? 'Return to service' : 'Take out of service'}</button>}>
      {e.status === 'Out of service' && <div className="callout fail"><Icon n="lock" />Out of service. Samples for methods that use {e.id} can't be queued for the instrument.</div>}
      <div className="row gap wrap"><select value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })} aria-label="Entry type">{['Maintenance', 'Calibration', 'Repair', 'Performance check', 'Note'].map((k) => <option key={k}>{k}</option>)}</select><input type="date" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} aria-label="Date" /><input className="grow" value={f.text} onChange={(x) => setF({ ...f, text: x.target.value })} placeholder="What was done, by whom, any parts replaced" /><button className="btn primary sm" disabled={!f.text.trim()} onClick={add}>Add</button></div>
      <ol className="timeline">{(e.log || []).map((l, k) => <li key={k}><span className="dot" /><div><b>{l.kind}</b> <span className="muted small">{fmtDate(l.date, false)} · {l.by}</span><div className="small">{l.text}</div></div></li>)}{!(e.log || []).length && <li><span className="dot" /><div className="muted small">No entries yet. {e.notes}</div></li>}</ol>
    </Modal>
  );
}

// ---------- Methods ----------
function Methods({ state, dispatch, toast }) {
  const [code, setCode] = useState('BPS');
  const [edit, setEdit] = useState(null);
  const m = state.methods[code];
  const canEdit = can(state, 'methods');
  return (
    <div className="page">
      <div className="tabs">{Object.values(state.methods).map((x) => <button key={x.code} className={cx('tab', code === x.code && 'on')} onClick={() => setCode(x.code)}><TestChips tests={[x.code]} small /> {x.name}</button>)}</div>
      <div className="panel">
        <div className="row between wrap"><div><h3>{m.name}</h3><p className="muted small">{m.sop} rev {m.rev} · {m.technique} · {m.instrument} · acquisition method {m.acqMethod} · units {m.units}</p></div>{m.confirm?.length > 0 && <span className="pill warn">Confirm before go-live: {m.confirm.join(', ')}</span>}</div>
        <table className="tbl">
          <thead><tr><th>Analyte</th><th>CAS</th><th className="num">MRL</th><th className="num">Spike level</th><th>Spike %REC</th><th>RPD limit</th><th /></tr></thead>
          <tbody>{m.analytes.map((a) => <tr key={a.name}><td>{a.name}</td><td className="muted">{a.cas}</td><td className="num">{a.mrl}</td><td className="num">{a.spike} {m.units}</td><td>{a.rec.join('–')}%</td><td>≤ {a.rpd}%</td><td>{canEdit && <button className="link small" onClick={() => setEdit({ analyte: a.name, mrl: a.mrl, spike: a.spike, reason: '' })}>Revise</button>}</td></tr>)}</tbody>
        </table>
        <div className="grid2 mt">
          <div><h5>Surrogates</h5>{m.surrogates.map((s) => <p key={s.name} className="small">{s.name}: nominal {s.nominal} ppb, recovery {s.rec.join('–')}%</p>)}<h5>Internal standards</h5><p className="small">{m.istd.join(', ') || '—'}</p></div>
          <div><h5>Calibration acceptance</h5><p className="small">Initial calibration ≥ 5 levels, each within {m.calAccuracy.join('–')}% ({m.calLowAccuracy.join('–')}% at the lowest level). CCV every 10 injections within {m.ccvLimits.join('–')}%. Results above the top standard are accepted only up to the linear range verified by an LDR check in the same run.</p></div>
        </div>
      </div>
      <div className="panel">
        <h4>Qualifiers</h4>
        <dl className="defs-list">{Object.entries(QUALIFIERS).map(([k, v]) => <React.Fragment key={k}><dt><span className={'q q-' + k}>{k}</span></dt><dd>{v}{['LR', 'E'].includes(k) && <span className="muted"> (new, proposed)</span>}</dd></React.Fragment>)}</dl>
      </div>
      <div className="panel">
        <h4>Revision history</h4>
        {state.methodHistory.filter((h) => h.code === code).map((h, k) => <div key={k} className="note"><b>Rev {h.rev}</b> <span className="muted small">{fmtDate(h.at)} · {h.by}</span><p>{h.change}</p></div>)}
      </div>
      {edit && (
        <Modal title={`Revise ${edit.analyte}`} sub={`Saving creates ${m.sop} rev ${m.rev + 1}. Samples already reported keep the limits they were reported with.`} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={!edit.reason.trim()} onClick={() => { const a = m.analytes.find((x) => x.name === edit.analyte); const patch = {}; if (+edit.mrl !== a.mrl) patch.mrl = +edit.mrl; if (+edit.spike !== a.spike) patch.spike = +edit.spike; if (!Object.keys(patch).length) return setEdit(null); dispatch({ type: 'UPDATE_ANALYTE', code, analyte: edit.analyte, patch, reason: edit.reason }); setEdit(null); toast(`${m.sop} revised`); }}>Save revision</button></>}>
          <Field label={`MRL (${m.units})`}><input type="number" step="0.01" value={edit.mrl} onChange={(e) => setEdit({ ...edit, mrl: e.target.value })} /></Field>
          <Field label={`Spike level (${m.units})`}><input type="number" step="0.1" value={edit.spike} onChange={(e) => setEdit({ ...edit, spike: e.target.value })} /></Field>
          <Field label="Reason and supporting evidence"><input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. MDL study 2026-09, n=7" /></Field>
        </Modal>
      )}
    </div>
  );
}

// ---------- Audit ----------
function Audit({ state, dispatch, toast }) {
  const cfg = useMemo(() => ({ text: (a) => `${a.user} ${a.action} ${a.entity} ${a.detail} ${a.esig || ''}`, facets: [{ key: 'user', label: 'User', get: (a) => a.user }, { key: 'action', label: 'Action', get: (a) => a.action.replace(/ \(v\d+\)/, '').replace(/^Moved to .*/, 'Moved stage') }, { key: 'role', label: 'Role', get: (a) => a.role || '—' }], flags: [{ key: 'esig', label: 'E-signed', test: (a) => !!a.esig }, { key: 'changes', label: 'Record edits', test: (a) => /edited|changed|revised|amended|undone|deleted|removed/i.test(a.action) }], date: { label: 'When', get: (a) => a.ts } }), []);
  const ctl = useFilters('audit', state.audit, cfg);
  const rows = ctl.filtered;
  const { rows: shown, more } = usePaged(rows, 300, rows);
  const exportAudit = () => { const csv = [['When', 'User', 'Role', 'Action', 'Record', 'Detail', 'E-signature'], ...rows.map((a) => [a.ts, a.user, a.role, a.action, a.entity, a.detail, a.esig])].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); el.download = 'audit_trail.csv'; el.click(); };
  return (
    <div className="page">
      <FilterBar ctl={ctl} state={state} dispatch={dispatch} toast={toast} placeholder="Search user, action, lab ID, detail, signature ID" right={<button className="btn ghost" onClick={exportAudit}><Icon n="download" size={14} />Export</button>} />
      <p className="muted small m0"><Icon n="lock" size={12} /> Append-only. Entries can't be edited or deleted.</p>
      <div className="panel flush">
        <table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Detail</th></tr></thead>
          <tbody>{shown.map((a) => <tr key={a.id}><td className="muted nowrap">{fmtDate(a.ts)}</td><td>{a.user}{a.role && <div className="muted small">{a.role}</div>}</td><td>{a.action}{a.esig && <div className="muted small">e-signature {a.esig}</div>}</td><td className="lid">{a.entity}</td><td className="small">{a.detail}</td></tr>)}</tbody></table>
        {more}
      </div>
    </div>
  );
}

// ---------- Admin ----------
function Admin({ state, dispatch, toast }) {
  const s = state.settings;
  return (
    <div className="page">
      <div className="grid2">
        <div className="panel">
          <h4>Users and roles</h4>
          <table className="tbl compact"><thead><tr><th>User</th><th>Roles</th></tr></thead><tbody>{state.users.map((u) => <tr key={u.id}><td>{u.name}<div className="muted small">{u.title} · {u.initials}</div></td><td className="small">{u.roles.map((r) => ROLES[r].label).join(', ')}</td></tr>)}</tbody></table>
          <button className="btn ghost sm mt" onClick={() => toast('Invites are sent by email in the production build')}><Icon n="plus" size={13} />Invite user</button>
        </div>
        <div className="panel">
          <h4>Clients</h4>
          {state.clients.map((c) => <div key={c.id} className="note"><b>{c.name}</b><p className="small">{c.lead} · {c.email}<br />{c.address}</p></div>)}
          <h4 className="mt">Lab settings</h4>
          <dl className="kv"><dt>Lab</dt><dd>{s.labName}</dd><dt>Address</dt><dd>{s.address}</dd><dt>Turnaround target</dt><dd>{s.tat} days</dd><dt>Retention after report</dt><dd>{s.disposal} days</dd><dt>Lab ID format</dt><dd>YYMMDD-code## (B, P, BP, A)</dd></dl>
          <button className="btn ghost sm mt" onClick={() => { dispatch({ type: 'RESET' }); toast('Demo data reset'); }}>Reset demo data</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Login / role picker ----------
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  return (
    <div className="auth">
      <div className="auth-card">
        <picture className="auth-logo"><source srcSet={LOGO_FULLW} media="(prefers-color-scheme: dark)" /><img src={LOGO_FULL} alt="Enviro Labs" /></picture>
        <h1>Sign in to the LIMS</h1>
        <form onSubmit={(e) => { e.preventDefault(); onLogin(email || 'demo@envirolabsusa.com'); }}>
          <Field label="Work email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@envirolabsusa.com" autoComplete="username" /></Field>
          <Field label="Password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></Field>
          <button className="btn primary block">Sign in</button>
        </form>
        <button className="btn ghost block mt-s" onClick={() => onLogin('testing@artemisresearch.io')}>Open the client portal demo (Artemis)</button>
        <p className="muted small">Prototype: any email and password work. Production uses per-user accounts with password policy, lockout and session timeout.</p>
      </div>
    </div>
  );
}

function RolePicker({ session, onPick }) {
  const roles = session.roles.filter((r) => ROLES[r] && !ROLES[r].perms.portal);
  const [r, setR] = useState(roles.includes('manager') ? 'manager' : roles[0]);
  if (!roles.length) return <div className="auth"><div className="auth-card"><h1>No lab role assigned</h1><p className="muted">Ask a Lab Admin to give you a role on the Users page.</p></div></div>;
  return (
    <div className="auth">
      <div className="auth-card">
        <img className="auth-mark" src={LOGO_MARK} alt="" />
        <h1>Choose your role for this session</h1>
        <p className="muted">Every action is recorded under this role. You can switch any time from the sidebar.</p>
        <div className="roles">
          {roles.map((k) => (
            <button key={k} className={cx('role', r === k && 'on')} onClick={() => setR(k)} onDoubleClick={() => onPick(k)}>
              <b>{ROLES[k].label}</b><span>{ROLES[k].desc}</span>
            </button>
          ))}
        </div>
        <button className="btn primary block" onClick={() => onPick(r)}>Continue as {ROLES[r].label}</button>
      </div>
    </div>
  );
}

// ---------- Shell ----------
const NAV = [
  ['mywork', 'My work', 'check'], ['dashboard', 'Lab board', 'board'], ['scan', 'Scan mode', 'tag'], ['samples', 'Samples', 'flask'], ['shipments', 'Expected shipments', 'box'], ['intake', 'New intake', 'plus'], ['runs', 'Instrument runs', 'run'], ['history', 'History', 'clock'], ['reports', 'Reports', 'doc'], ['storage', 'Storage', 'box'], ['inventory', 'Standards & reagents', 'scale'],
  'Business', ['billing', 'Billing', 'list'], ['analytics', 'Analytics', 'board'],
  'Quality and admin', ['quality', 'Quality (ISO 17025)', 'shield'], ['methods', 'Methods & analytes', 'sliders'], ['users', 'Users', 'users'], ['audit', 'Audit trail', 'list'], ['settings', 'Lab settings', 'gear'],
];
const SUBS = { mywork: 'Assigned to you and ready for your role, most urgent first', scan: 'Scan a label, press Enter to move it on', shipments: 'Order lists from clients, matched to arrivals', inventory: 'Lots, expiry and where each lot was used', billing: 'Price list, invoices and QuickBooks export', analytics: 'Your history and current pipeline', verify: 'Check that a certificate is authentic and unaltered', samples: 'Read-only · every sample across the lab', intake: 'Lab-side receipt confirmation', runs: 'Upload runs, view recent ingests', history: 'Every ticket by ID: each stage it passed through and the certificates it produced', users: 'Multi-role assignment with optional expiry' };
const TITLES = { dashboard: 'Lab board', samples: 'All samples', intake: 'New intake', runs: 'Instrument runs', reports: 'Reports', report: 'Certificate of analysis', storage: 'Storage and retention', quality: 'Quality system', methods: 'Methods and analytes', audit: 'Audit trail', admin: 'Users and settings', history: 'History', users: 'Lab users', settings: 'Lab settings', shipments: 'Expected shipments', inventory: 'Standards and reagents', billing: 'Billing', analytics: 'Analytics', verify: 'Verify a certificate', mywork: 'My work', scan: 'Scan mode' };

export default function App({ initial, onState, onReady, onLogout } = {}) {
  const [state, dispatch] = useReducer(reducer, null, () => initial || buildInitial());
  useEffect(() => { onReady?.(dispatch); }, []);
  useEffect(() => { onState?.(state); }, [state]);
  useEffect(() => { if (!state.session && onLogout) onLogout(); }, [state.session]);
  const [route, setRoute] = useState({ page: 'dashboard', arg: null });
  const [drawer, setDrawer] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [palette, setPalette] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const toast = useCallback((t, action) => { const id = Math.random(); setToasts((x) => [...x, { id, t, action }]); setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), action ? 9000 : 3200); }, []);
  const [help, setHelp] = useState(false);
  const go = (page, arg = null) => { if (page === 'sample') { setDrawer(arg); return; } setRoute({ page, arg }); setDrawer(null); setNavOpen(false); window.scrollTo(0, 0); };
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.metaKey || e.ctrlKey || e.altKey || ['input', 'textarea', 'select'].includes(tag) || document.querySelector('.modal, .palette')) return;
      const map = { n: 'intake', s: 'scan', b: 'dashboard', w: 'mywork' };
      if (map[e.key.toLowerCase()]) { e.preventDefault(); setRoute({ page: map[e.key.toLowerCase()], arg: null }); setDrawer(null); }
      if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  syncRoles(state.roles);
  if (!state.session) {
    return <Login onLogin={(email) => {
      const local = email.split('@')[0].toLowerCase();
      const cu = state.users.find((x) => x.client && x.email === email.toLowerCase());
      if (cu) { dispatch({ type: 'LOGIN', session: { ...cu, role: 'client' } }); return; }
      const u = USERS.find((x) => !x.client && (local.includes(x.name.split(' ')[0].toLowerCase()) || local === x.initials.toLowerCase()));
      const pretty = local.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const name = u ? u.name : /^raffi?kaul/.test(local) ? 'Raffi Kaul' : pretty;
      const today = new Date().toISOString().slice(0, 10);
      const granted = u ? state.grants.filter((g) => g.userId === u.id && g.expires >= today && g.from <= today).map((g) => g.role) : [];
      const session = u ? { ...u, email, roles: [...new Set([...u.roles, ...granted])] } : { name, initials: name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(), title: 'Lab Director', email, roles: Object.keys(ROLES).filter((r) => r !== 'client'), methods: ['BPS', 'PFAS', 'OTA'] };
      dispatch({ type: 'LOGIN', session: { ...session, role: null } });
    }} />;
  }
  if (state.roles[state.session.role]?.perms.portal) return <><ClientPortal state={state} dispatch={dispatch} toast={toast} /><div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast"><Icon n="check" size={14} />{t.t}{t.action && <button className="toast-act" onClick={() => { t.action.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}</div>)}</div></>;
  if (!state.session.role) return <RolePicker session={state.session} onPick={(r) => dispatch({ type: 'SET_ROLE', role: r })} />;

  const openSample = (id) => setDrawer(id);
  const p = route.page;
  const counts = { samples: state.samples.filter((s) => !s.disposed).length, runs: state.batches.filter((b) => !b.approved).length, reports: state.samples.filter((s) => s.stage === 'manager').length };
  return (
    <div className={cx('shell', drawer && 'has-drawer')}>
      <nav className={cx('side', navOpen && 'open')} aria-label="Main">
        <div className="brand"><img className="brand-mark" src={LOGO_MARK} alt="" /><div><b>Enviro Labs</b><span>LIMS · Irvine, CA</span></div></div>
        <button className="search-btn" onClick={() => setPalette(true)}><Icon n="search" size={14} />Find a sample<kbd>⌘K</kbd></button>
        {NAV.map((n, i) => Array.isArray(n) ? (
          <button key={n[0]} className={cx('nav', (p === n[0] || (p === 'report' && n[0] === 'reports')) && 'on')} onClick={() => go(n[0])}>
            <Icon n={n[2]} />{n[1]}{counts[n[0]] ? <span className="nav-n">{counts[n[0]]}</span> : null}
          </button>
        ) : <div key={i} className="nav-sep">{n}</div>)}
        <div className="me">
          <span className="avatar">{state.session.initials}</span>
          <div className="me-txt"><b>{state.session.name}</b>
            <select value={state.session.role} onChange={(e) => { dispatch({ type: 'SET_ROLE', role: e.target.value }); toast(`Now working as ${ROLES[e.target.value].label}`); }} aria-label="Session role">
              {state.session.roles.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
            </select>
          </div>
          <button className="icon-btn" onClick={() => dispatch({ type: 'LOGOUT' })} aria-label="Sign out" title="Sign out"><Icon n="out" /></button>
        </div>
      </nav>
      {navOpen && <div className="scrim nav-scrim" onClick={() => setNavOpen(false)} />}
      <main className="main">
        <header className="top">
          <button className="icon-btn menu" onClick={() => setNavOpen(true)} aria-label="Menu"><Icon n="list" /></button>
          <div><div className="crumb">Enviro Labs · {ROLES[state.session.role].label}</div><h1>{TITLES[p]}{p === 'report' && <span className="lid"> {route.arg}</span>}{SUBS[p] && <span className="h1-sub">{SUBS[p]}</span>}</h1></div>
          <div className="top-actions">
            <button className="icon-btn" onClick={() => setHelp(true)} aria-label="Help and shortcuts" title="Help (?)"><span className="qmark">?</span></button>
            <Bell state={state} dispatch={dispatch} go={go} openSample={openSample} />
            {p !== 'intake' && p !== 'users' && <button className="btn primary" onClick={() => go('intake')}><Icon n="plus" size={14} />New intake</button>}
          </div>
        </header>
        {p === 'dashboard' && <Dashboard state={state} dispatch={dispatch} openSample={openSample} toast={toast} go={go} />}
        {p === 'samples' && <Samples state={state} dispatch={dispatch} toast={toast} openSample={openSample} />}
        {p === 'intake' && <Intake key={route.arg || 'new'} state={state} dispatch={dispatch} toast={toast} openSample={openSample} prefill={route.arg && state.expected.find((x) => x.id === route.arg)} />}
        {p === 'mywork' && <MyWork state={state} openSample={openSample} go={go} />}
        {p === 'scan' && <ScanMode state={state} dispatch={dispatch} toast={toast} openSample={openSample} go={go} />}
        {p === 'shipments' && <Shipments state={state} dispatch={dispatch} toast={toast} go={go} />}
        {p === 'inventory' && <Inventory state={state} dispatch={dispatch} toast={toast} />}
        {p === 'billing' && <Billing state={state} dispatch={dispatch} toast={toast} />}
        {p === 'analytics' && <Analytics state={state} />}
        {p === 'verify' && <Verify state={state} go={go} />}
        {p === 'runs' && <Runs state={state} dispatch={dispatch} toast={toast} openSample={openSample} focus={route.arg} go={go} />}
        {p === 'reports' && <Reports state={state} dispatch={dispatch} toast={toast} go={go} />}
        {p === 'report' && <ReportView key={route.arg} state={state} id={route.arg} dispatch={dispatch} toast={toast} go={go} />}
        {p === 'storage' && <Storage state={state} dispatch={dispatch} toast={toast} openSample={openSample} />}
        {p === 'quality' && <Quality state={state} dispatch={dispatch} toast={toast} go={go} />}
        {p === 'methods' && <Methods state={state} dispatch={dispatch} toast={toast} />}
        {p === 'audit' && <Audit state={state} dispatch={dispatch} toast={toast} />}
        {p === 'history' && <History state={state} dispatch={dispatch} toast={toast} openSample={openSample} go={go} />}
        {p === 'users' && <Users state={state} dispatch={dispatch} toast={toast} />}
        {(p === 'settings' || p === 'admin') && <Settings state={state} dispatch={dispatch} toast={toast} />}
      </main>
      {drawer && <SampleDrawer state={state} id={drawer} dispatch={dispatch} onClose={() => setDrawer(null)} toast={toast} go={go} />}
      {palette && <Palette state={state} onPick={(id) => { setPalette(false); setDrawer(id); }} onGo={(pg, arg) => { setPalette(false); go(pg, arg); }} onClose={() => setPalette(false)} />}
      {help && <HelpModal onClose={() => setHelp(false)} />}
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast"><Icon n="check" size={14} />{t.t}{t.action && <button className="toast-act" onClick={() => { t.action.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}</div>)}</div>
    </div>
  );
}

function Palette({ state, onPick, onGo, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const idx = useSearchIndex(state.samples);
  const ACTIONS = [['New intake', 'intake', 'plus', 'N'], ['Scan mode', 'scan', 'tag', 'S'], ['My work', 'mywork', 'check', 'W'], ['Lab board', 'dashboard', 'board', 'B'], ['Import an instrument run', 'runs', 'upload'], ['Build an instrument sequence', 'runs', 'run'], ['Expected shipments', 'shipments', 'box'], ['Reports and certificates', 'reports', 'doc'], ['Verify a certificate', 'verify', 'shield'], ['History', 'history', 'clock'], ['Standards and reagents', 'inventory', 'scale'], ['Billing and invoices', 'billing', 'list'], ['Analytics', 'analytics', 'board'], ['Quality (ISO 17025)', 'quality', 'shield'], ['Users, roles and permissions', 'users', 'users'], ['Audit trail', 'audit', 'list'], ['Lab settings', 'settings', 'gear']];
  const ql = q.toLowerCase();
  const acts = ACTIONS.filter((a) => !q || a[0].toLowerCase().includes(ql)).slice(0, q ? 5 : 6);
  const hits = q ? idx.filter((x) => x.k.includes(ql)).slice(0, 7).map((x) => x.s) : [];
  const items = [...hits.map((s) => ({ type: 's', s })), ...acts.map((a) => ({ type: 'a', a }))];
  const run = (it) => (it.type === 's' ? onPick(it.s.id) : onGo(it.a[1]));
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="search-in big"><Icon n="search" /><input autoFocus placeholder="Search samples or type a command" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(items.length - 1, sel + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(0, sel - 1)); } if (e.key === 'Enter' && items[sel]) run(items[sel]); }} /></div>
        {hits.length > 0 && <div className="pal-h">Samples</div>}
        {items.map((it, k) => it.type === 's'
          ? <button key={it.s.id} className={cx('rowbtn', sel === k && 'sel')} onMouseEnter={() => setSel(k)} onClick={() => run(it)}><span className="lid">{it.s.id}</span><TestChips tests={it.s.tests} small /><span className="ellip">{it.s.name}</span><span className="muted small">{STAGES.find((x) => x.key === it.s.stage).label}</span></button>
          : <React.Fragment key={'a' + k}>{k === hits.length && <div className="pal-h">{q ? 'Commands' : 'Jump to'}</div>}<button className={cx('rowbtn', sel === k && 'sel')} onMouseEnter={() => setSel(k)} onClick={() => run(it)}><Icon n={it.a[2]} size={14} /><span className="ellip">{it.a[0]}</span>{it.a[3] && <kbd>{it.a[3]}</kbd>}</button></React.Fragment>)}
        {q && !items.length && <p className="muted pad">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}
