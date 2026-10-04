import React, { useState, useEffect, useRef, useMemo } from 'react';
import { STAGES, stageIdx, ROLES, DEMO_PIN, missingStandards, can } from './store.js';
// E-signature check. Demo: fixed PIN. Production (set in main.jsx): re-enter your password.
export const PROD = { on: false };
export const ESIG = { label: 'Signature PIN', hint: `Demo PIN is ${DEMO_PIN}.`, verify: async (pin) => pin === DEMO_PIN };
export const rolesWith = (state, perm) => Object.values(state.roles).filter((r) => r.perms[perm]).map((r) => r.label).join(', ') || 'none';
import { METHODS } from './config.js';

export const cx = (...a) => a.filter(Boolean).join(' ');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (s, time = true) => {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T00:00' : s);
  if (isNaN(d)) return String(s);
  const t = `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return time && s.length > 10 ? `${t} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : t;
};
export const daysSince = (s) => (s ? Math.floor((Date.now() - new Date(s).getTime()) / 864e5) : 0);
export const sig = (v) => (v == null ? '—' : v >= 100 ? Math.round(v).toLocaleString() : Number(v.toPrecision(3)).toString());
export const pctf = (v) => (v == null ? '—' : v.toFixed(0) + '%');
export const nowIso = () => new Date().toISOString().slice(0, 16);

const P = {
  board: 'M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z',
  flask: 'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10',
  plus: 'M12 5v14M5 12h14',
  run: 'M3 12h3l3-8 4 16 3-8h5',
  doc: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  right: 'M9 18l6-6-6-6',
  down: 'M6 9l6 6 6-6',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  pause: 'M10 4H6v16h4zM18 4h-4v16h4z',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
  sign: 'M3 17c3-1 4-6 6-6s1 6 3 6 3-3 4-3 2 2 5 2M3 21h18',
  scale: 'M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};
export function Icon({ n, size = 16, className }) {
  return (
    <svg className={cx('ic', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[n]} />
    </svg>
  );
}

export function TestChips({ tests, small }) {
  return (
    <span className="chips">
      {tests.map((t) => (
        <span key={t} className={cx('chip', 't-' + METHODS[t].color, small && 'sm')}>{t}</span>
      ))}
    </span>
  );
}

export function Modal({ title, sub, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <h3>{title}</h3>
            {sub && <p className="muted">{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon n="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function ESign({ session, meaning, pin, setPin, error }) {
  return (
    <div className="esign">
      <div className="esign-head"><Icon n="sign" /> Electronic signature</div>
      <p>Signing as <b>{session.name}</b> ({ROLES[session.role].label}). Meaning of signature: <b>{meaning}</b>.</p>
      <Field label={ESIG.label} hint={ESIG.hint}>
        <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
      </Field>
      {error && <p className="err">{error}</p>}
    </div>
  );
}

// ---------- Gates ----------
export function gateFor(state, s, to) {
  const session = state.session;
  const role = session.role;
  const fromI = stageIdx(s.stage), toI = stageIdx(to);
  const g = { to, checks: [], fields: [], esign: null, back: toI < fromI, blocked: null };
  if (toI === fromI) return null;
  if (s.stage === 'reported') { g.blocked = 'This sample has a signed certificate and is locked. Issue an amended report from the report page instead.'; return g; }
  const R = state.roles[role]?.perms || {};
  if (g.back) {
    if (!R.sendback) g.blocked = `${ROLES[role].label} can't send samples back. Roles that can: ${rolesWith(state, 'sendback')}.`;
    g.fields.push({ key: 'reason', label: 'Reason for sending back', type: 'text', required: true, placeholder: 'e.g. Dilute 10× and re-analyze' });
    return g;
  }
  if (toI > fromI + 1) { g.blocked = `Samples move one stage at a time. The next stage for ${s.id} is ${STAGES[fromI + 1].label}.`; return g; }
  const from = STAGES[fromI];
  if (to === 'reported' && !R.sign) g.blocked = `${ROLES[role].label} can't sign certificates. Roles that can: ${rolesWith(state, 'sign')}. Switch your session role in the sidebar.`;
  else if (to !== 'reported' && !R['adv_' + from.key]) g.blocked = `${ROLES[role].label} can't move samples out of ${from.label}. Roles that can: ${rolesWith(state, 'adv_' + from.key)}.`;

  g.checks.push({ label: 'Sample is not on hold', ok: !s.hold, hint: s.hold?.reason });
  const res = state.results[s.id] || {};
  if (to === 'prep') {
    g.checks.push({ label: 'Storage bin assigned', ok: !!s.bin, hint: 'Set the bin in the sample record.' });
    g.checks.push({ label: 'Product weight recorded', ok: s.weight != null, hint: 'Weigh the item on BAL-02 and record grams.' });
    g.checks.push({ label: 'Condition on receipt recorded', ok: !!s.condition });
    if (s.prop65) g.checks.push({ label: 'Prop 65 label reviewed with client', ok: s.prop65.status === 'approved', hint: s.prop65.note });
  }
  if (to === 'extraction') {
    g.fields.push({ key: 'subsampleMass', label: 'Subsample mass (g)', type: 'number', required: true, placeholder: '1.000' });
    const bal = state.equipment.find((e) => e.id === 'BAL-01');
    const balOk = bal && new Date(bal.nextCal) >= new Date(new Date().toDateString());
    g.checks.push({ label: `Analytical balance ${bal?.id} calibration current`, ok: balOk ? true : 'warn', hint: balOk ? null : `Due ${fmtDate(bal?.nextCal, false)}. Allowed with a warning; open an NCR if results are affected.` });
  }
  if (to === 'analysis') {
    const d = new Date();
    const def = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}01`;
    g.fields.push({ key: 'prepBatch', label: 'Prep batch ID', type: 'text', required: true, placeholder: def, def });
    const authorized = s.tests.every((t) => (session.methods || []).includes(t));
    g.checks.push({ label: `${session.name} is authorized for ${s.tests.join(' + ')}`, ok: authorized || !R.training, hint: authorized ? null : 'See Quality › Training. Only authorized analysts can perform this method (ISO/IEC 17025 §6.2).' });
    g.checks.push({ label: 'Prep batch includes method blank and blank spike / duplicate', ok: true, hint: 'Verified at import against the instrument sequence.' });
    const inst = [...new Set(s.tests.map((t) => state.methods[t].instrument))].map((id) => state.equipment.find((e) => e.id === id)).filter(Boolean);
    inst.forEach((e) => g.checks.push({ label: `Instrument ${e.id} in service`, ok: e.status !== 'Out of service', hint: e.status === 'Out of service' ? 'Taken out of service in the equipment logbook (Quality › Equipment).' : null }));
    const miss = missingStandards(state.inventory, s.tests);
    g.checks.push({ label: 'Standards and surrogates in date (lots recorded on the sample)', ok: !miss.length, hint: miss.length ? `No in-date lot for: ${miss.join(', ')}. See Inventory.` : null });
  }
  if (to === 'review') {
    s.tests.forEach((t) => g.checks.push({ label: `${t} results imported from the instrument`, ok: !!res[t], hint: res[t] ? null : 'Import the MassHunter export on the Instrument runs page.' }));
  }
  if (to === 'manager' || to === 'reported') {
    s.tests.forEach((t) => {
      const b = res[t] && state.batches.find((x) => x.key === res[t].batchKey);
      g.checks.push({ label: `${t} batch QC reviewed and approved`, ok: !!b?.approved, hint: b ? (b.approved ? null : `Approve ${b.name} on the Instrument runs page.`) : 'No results yet.' });
      const e = res[t]?.analytes.filter((a) => a.qualifiers.includes('E'));
      g.checks.push({ label: `${t} results within verified linear range`, ok: !e?.length, hint: e?.length ? 'Over range. Send back to extraction to dilute and re-analyze.' : null });
    });
    g.esign = to === 'manager' ? 'Data reviewed and complete' : 'Reviewed, approved and released';
  }
  return g;
}

export function GateModal({ state, ids, to, dispatch, onClose, toast }) {
  const samples = ids.map((id) => state.samples.find((s) => s.id === id));
  const gates = samples.map((s) => gateFor(state, s, to));
  const first = gates[0];
  const [vals, setVals] = useState(() => Object.fromEntries((first?.fields || []).map((f) => [f.key, f.def || ''])));
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  if (!first) return null;
  const target = STAGES.find((x) => x.key === to);
  const blocked = gates.find((g) => g.blocked)?.blocked;
  const failing = gates.map((g, i) => ({ id: ids[i], fails: g.checks.filter((c) => c.ok === false) })).filter((x) => x.fails.length);
  const fieldsOk = first.fields.every((f) => !f.required || String(vals[f.key] || '').trim());
  const can = !blocked && !failing.length && fieldsOk && (!first.esign || pin);
  const go = async () => {
    if (first.esign && !(await ESIG.verify(pin))) { setErr(`${ESIG.label} does not match. The attempt was logged.`); return; }
    const fields = {};
    first.fields.forEach((f) => { if (f.key !== 'reason') fields[f.key] = f.type === 'number' ? +vals[f.key] : vals[f.key].trim(); });
    const esig = first.esign ? 'ES-' + Math.floor(40000 + Math.random() * 59999) : null;
    const prev = samples.map((s) => ({ id: s.id, fields: { stage: s.stage, prepBatch: s.prepBatch ?? null, subsampleMass: s.subsampleMass ?? null, stdLots: s.stdLots ?? null } }));
    dispatch({ type: 'MOVE', ids, to, fields, reason: vals.reason, esig });
    toast(`${ids.length > 1 ? ids.length + ' samples' : ids[0]} ${first.back ? 'sent back to' : 'moved to'} ${target.label}${to === 'reported' ? '. Certificate locked.' : ''}`, to === 'reported' ? null : { label: 'Undo', run: () => dispatch({ type: 'UNDO_MOVE', prev }) });
    onClose();
  };
  return (
    <Modal
      title={first.back ? `Send back to ${target.label}` : to === 'reported' ? 'Sign and release report' : `Move to ${target.label}`}
      sub={ids.length > 1 ? `${ids.length} samples` : `${samples[0].id} · ${samples[0].name?.slice(0, 70)}`}
      onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={cx('btn', first.back ? 'warn' : 'primary')} disabled={!can} onClick={go}>
          {first.back ? 'Send back' : to === 'reported' ? 'Sign and release' : first.esign ? 'Sign and move' : 'Move'}
        </button>
      </>}
    >
      {blocked && <div className="callout fail"><Icon n="lock" /> {blocked}</div>}
      {!blocked && first.checks.length > 0 && (
        <div className="gate">
          <div className="gate-title">Gate checks</div>
          {ids.length === 1 ? (
            <ul className="checks">
              {first.checks.map((c, i) => (
                <li key={i} className={c.ok === true ? 'ok' : c.ok === 'warn' ? 'warn' : 'no'}>
                  <Icon n={c.ok === true ? 'check' : c.ok === 'warn' ? 'alert' : 'x'} />
                  <div><div>{c.label}</div>{c.hint && c.ok !== true && <small>{c.hint}</small>}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div>
              <p className="muted">{ids.length - failing.length} of {ids.length} samples pass every check.</p>
              {failing.length > 0 && <ul className="checks">{failing.map((f) => <li key={f.id} className="no"><Icon n="x" /><div><div>{f.id}</div><small>{f.fails.map((c) => c.label).join('; ')}</small></div></li>)}</ul>}
            </div>
          )}
        </div>
      )}
      {!blocked && first.fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <input type={f.type === 'number' ? 'number' : 'text'} step="0.001" value={vals[f.key] || ''} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
        </Field>
      ))}
      {!blocked && !failing.length && first.esign && <ESign session={state.session} meaning={first.esign} pin={pin} setPin={(v) => { setPin(v); setErr(''); }} error={err} />}
      {!blocked && !first.back && <p className="muted small">The move, your name, role and time are written to the audit trail.</p>}
    </Modal>
  );
}

export function Barcode({ value, height = 38 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.__JsBarcode) {
      try { window.__JsBarcode(ref.current, value, { format: 'CODE128', height, displayValue: false, margin: 0, width: 1.4, background: 'transparent', lineColor: '#111' }); } catch (e) { /* ignore */ }
    }
  }, [value, height]);
  return <svg ref={ref} className="barcode" aria-label={'Barcode ' + value} />;
}

export function Empty({ icon = 'flask', title, children }) {
  return (
    <div className="empty">
      <Icon n={icon} size={22} />
      <b>{title}</b>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function useSearchIndex(samples) {
  return useMemo(() => samples.map((s) => ({ s, k: `${s.id} ${s.name} ${s.asin || ''} ${s.tracking || ''} ${s.matrix}`.toLowerCase() })), [samples]);
}

export function ago(ts) {
  if (!ts) return '—';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 0) return 'just now';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) { const h = Math.floor(s / 3600); return `${h} hour${h > 1 ? 's' : ''} ago`; }
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  const m = Math.round(d / 30);
  return m <= 1 ? 'about 1 month ago' : `${m} months ago`;
}
