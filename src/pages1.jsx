import React, { useState, useMemo, useEffect } from 'react';
import { STAGES, stageIdx, ROLES, labCode, TAT_DAYS, can } from './store.js';
import { METHODS, TEST_ORDER } from './config.js';
import { cx, Icon, TestChips, Modal, Field, GateModal, gateFor, fmtDate, daysSince, sig, nowIso, Barcode, Empty, pctf } from './ui.jsx';
import { PhotoInput, PhotoGrid, filesToPhotos } from './photos.jsx';
import { PrepBatchModal, LabelsModal, Comments } from './prod.jsx';
import { useFilters, FilterBar, usePaged } from './filters.jsx';

export function sampleCfg(state, opts = {}) {
  const uname = (id) => state.users.find((u) => u.id === id)?.name || 'Unassigned';
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || id;
  const tat = state.settings.tat;
  return {
    text: (s) => `${s.id} ${s.name} ${s.asin || ''} ${s.tracking || ''} ${s.prepBatch || ''} ${cname(s.clientId)} ${s.matrix}`,
    facets: [
      { key: 'stage', label: 'Stage', get: (s) => STAGES.find((x) => x.key === s.stage).label },
      { key: 'test', label: 'Test', get: (s) => s.tests },
      { key: 'client', label: 'Client', get: (s) => cname(s.clientId) },
      { key: 'matrix', label: 'Matrix', get: (s) => s.matrix },
      { key: 'analyst', label: 'Assigned to', get: (s) => uname(s.assignee) },
      { key: 'by', label: 'Received by', get: (s) => String(s.receivedBy || '').trim().toUpperCase() },
      { key: 'batch', label: 'Prep batch', get: (s) => s.prepBatch || 'None' },
      ...(opts.record ? [{ key: 'record', label: 'Record', get: (s) => (s.legacy ? 'Legacy (workbook)' : 'Current') }] : []),
    ],
    flags: [
      { key: 'rush', label: 'Rush', test: (s) => s.rush },
      { key: 'overdue', label: 'Overdue', test: (s) => s.stage !== 'reported' && daysSince(s.receivedAt) > tat },
      { key: 'hold', label: 'On hold', test: (s) => !!s.hold },
      { key: 'flag', label: 'Has flag', test: (s) => flagsFor(state, s) > 0 },
      ...(opts.mine ? [{ key: 'mine', label: 'Mine', test: (s) => s.assignee && state.users.find((u) => u.id === s.assignee)?.name === state.session.name }] : []),
    ],
    date: { label: 'Received', get: (s) => s.receivedAt },
  };
}

// ---------- Board ----------
const BOARD = {};
function Card({ s, state, onOpen, onDragStart, flagCount, density = 'standard' }) {
  const age = daysSince(s.receivedAt);
  const tat = state.settings.tat;
  const late = s.stage !== 'reported' && age > tat;
  const near = s.stage !== 'reported' && !late && age >= tat - 2;
  const client = state.clients.find((c) => c.id === s.clientId);
  return (
    <article className={cx('card', s.hold && 'held')} draggable onDragStart={(e) => onDragStart(e, s.id)} onClick={() => onOpen(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(s.id)} aria-label={`${s.id}, ${s.name}`}>
      <div className="stripe">{s.tests.map((t) => <i key={t} className={'t-' + METHODS[t].color} />)}</div>
      <div className="card-top">
        <span className="lid">{s.id}</span>
        {s.rush && <span className="pill rush"><Icon n="bolt" size={12} />Rush</span>}
      </div>
      {density !== 'compact' && <div className="pname">{s.name}</div>}
      {density === 'rich' && s.photos?.[0] && <img className="card-photo" src={s.photos[0].src} alt="" />}
      {density === 'rich' && <div className="card-rich small muted">{s.assignee ? (state.users.find((u) => u.id === s.assignee)?.name || '') : 'Unassigned'} · bin {s.bin || '—'}{s.comments?.length ? ` · ${s.comments.length} note${s.comments.length > 1 ? 's' : ''}` : ''}</div>}
      {density !== 'compact' && <div className="card-meta">
        <TestChips tests={s.tests} small />
        <span className="muted">{s.matrix}</span>
      </div>}
      <div className="card-foot">
        <span className={cx('age', late && 'late', near && 'near')} title={`Received ${fmtDate(s.receivedAt)}`}><Icon n="clock" size={12} />{age}d</span>
        <span className="muted small">{client?.name.replace(' LLC', '')}</span>
        {s.hold && <span className="pill hold"><Icon n="pause" size={11} />Hold</span>}
        {flagCount > 0 && !s.hold && <span className="pill flag" title="Results carry qualifiers">{flagCount} flag{flagCount > 1 ? 's' : ''}</span>}
        {s.prepBatch && stageIdx(s.stage) >= 3 && <span className="muted small mono-ish">{s.prepBatch}</span>}
      </div>
    </article>
  );
}

export function flagsFor(state, s) {
  const r = state.results[s.id];
  if (!r) return 0;
  return Object.values(r).reduce((n, t) => n + t.analytes.reduce((m, a) => m + a.qualifiers.length, 0), 0);
}

export function Dashboard({ state, dispatch, openSample, toast, go }) {
  const [tab, setTab] = useState('board');
  const [over, setOver] = useState(null);
  const [group, setGroup] = useState(() => BOARD.group || 'stage');
  const [density, setDensity] = useState(() => BOARD.density || 'standard');
  const [window_, setWindow] = useState(() => BOARD.window || 7);
  const [closed, setClosed] = useState({});
  BOARD.group = group; BOARD.density = density; BOARD.window = window_;
  const [gate, setGate] = useState(null);
  const [prepOpen, setPrepOpen] = useState(false);
  const role = state.session.role;
  const active = useMemo(() => state.samples.filter((s) => !s.disposed && !s.legacy), [state.samples]);
  const cfg = useMemo(() => sampleCfg(state, { mine: true }), [state.users, state.clients, state.results, state.settings]);
  const repAt = (s) => { const r = state.reports[s.id]; return r ? r[r.length - 1].at : s.receivedAt; };
  const windowed = useMemo(() => active.filter((s) => s.stage !== 'reported' || !window_ || daysSince(repAt(s)) <= window_), [active, window_, state.reports]);
  const ctl = useFilters('board', windowed, cfg, { get: () => ({ group, density, window: window_ }), set: (x) => { setGroup(x.group); setDensity(x.density); setWindow(x.window); } });
  const filtered = ctl.filtered;
  const today = new Date().toDateString();
  const signedToday = Object.values(state.reports).filter((v) => new Date(v[v.length - 1].at).toDateString() === today).length;
  const overdue = active.filter((s) => s.stage !== 'reported' && daysSince(s.receivedAt) > state.settings.tat);
  const myStages = STAGES.filter((st) => st.key !== 'reported' && (st.key === 'manager' ? can(state, 'sign') : can(state, 'adv_' + st.key))).map((s) => s.key);
  const myQueue = active.filter((s) => myStages.includes(s.stage));
  const held = active.filter((s) => s.hold);
  const unapproved = state.batches.filter((b) => !b.approved);
  const onDragStart = (e, id) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; };
  const onDrop = (e, to) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const s = state.samples.find((x) => x.id === id);
    if (s && s.stage !== to) setGate({ ids: [id], to });
  };
  const advanceReady = (st) => {
    const next = STAGES[stageIdx(st) + 1]?.key;
    const ready = filtered.filter((s) => s.stage === st).filter((s) => { const g = gateFor(state, s, next); return g && !g.blocked && g.checks.every((c) => c.ok !== false); });
    return { next, ready };
  };
  const tiles = [
    { label: 'Overdue', n: overdue.length, sub: `over ${state.settings.tat}-day turnaround`, icon: 'alert', tone: overdue.length ? 'fail' : '' },
    { label: 'On hold', n: held.length, sub: 'awaiting client or lab decision', icon: 'pause', tone: held.length ? 'warn' : '' },
    { label: 'My queue', n: myQueue.length, sub: ROLES[role].label, icon: 'list', tone: 'accent' },
    { label: 'Batches to review', n: unapproved.length, sub: 'instrument runs pending QC approval', icon: 'run', tone: unapproved.length ? 'warn' : '' },
    { label: 'Signed today', n: signedToday, sub: 'certificates released', icon: 'sign', tone: 'ok' },
  ];
  return (
    <div className="page board-page">
      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className={cx('tile', t.tone)}>
            <span className="tile-ic"><Icon n={t.icon} /></span>
            <div><div className="tile-label">{t.label}</div><div className="tile-n">{t.n}</div><div className="tile-sub">{t.sub}</div></div>
          </div>
        ))}
      </div>
      <div className="tabs">
        {[['board', 'Lab board'], ['reviews', 'Reviews', state.samples.filter((s) => ['review', 'manager'].includes(s.stage)).length + unapproved.length], ['flags', 'Flags', active.filter((s) => s.hold || flagsFor(state, s)).length]].map(([k, l, n]) => (
          <button key={k} className={cx('tab', tab === k && 'on')} onClick={() => setTab(k)}>{l}{n != null && <span className="count">{n}</span>}</button>
        ))}
      </div>
      {tab === 'board' && (
        <>
          <FilterBar ctl={ctl} state={state} dispatch={dispatch} toast={toast} placeholder="Search ID, product, ASIN, batch… or client:artemis test:pfas" />
          <div className="toolbar board-tools">
            <span className="seg-label">Group</span>
            <div className="seg">{[['stage', 'Stages'], ['analyst', 'By analyst'], ['matrix', 'By matrix'], ['client', 'By client'], ['test', 'By test']].map(([k, l]) => <button key={k} className={cx(group === k && 'on')} onClick={() => setGroup(k)}>{l}</button>)}</div>
            <span className="seg-label">View</span>
            <div className="seg">{[['compact', 'Compact'], ['standard', 'Standard'], ['rich', 'Rich']].map(([k, l]) => <button key={k} className={cx(density === k && 'on')} onClick={() => setDensity(k)}>{l}</button>)}</div>
            <span className="seg-label">Reported</span>
            <select value={window_} onChange={(e) => setWindow(+e.target.value)} aria-label="Reported window"><option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={0}>All</option></select>
            <span className="muted small hide-sm push">Drag a card to the next column to move it.</span>
          </div>
          {(() => {
            const lanes = group === 'stage' ? [['All samples', filtered]] : (() => {
              const g = {};
              const key = (s) => group === 'analyst' ? (state.users.find((u) => u.id === s.assignee)?.name || 'Unassigned') : group === 'matrix' ? s.matrix : group === 'client' ? (state.clients.find((c) => c.id === s.clientId)?.name || s.clientId) : s.tests.join(' + ');
              filtered.forEach((s) => { const k = key(s); (g[k] = g[k] || []).push(s); });
              return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
            })();
            return lanes.map(([lane, list]) => (
              <div key={lane} className={cx('lane', group !== 'stage' && 'swim')}>
                {group !== 'stage' && <button className="lane-head" onClick={() => setClosed({ ...closed, [lane]: !closed[lane] })}><Icon n="right" size={13} className={cx('chev', !closed[lane] && 'rot')} /><b>{lane}</b><span className="muted small">{list.length} sample{list.length !== 1 ? 's' : ''}</span><span className="lane-mini">{STAGES.map((st) => { const n = list.filter((s) => s.stage === st.key).length; return <i key={st.key} title={`${st.label}: ${n}`} style={{ flex: n || 0.0001 }} className={'lm-' + st.key} />; })}</span></button>}
                {!closed[lane] && (
                  <div className={cx('board', 'd-' + density, group !== 'stage' && 'short')}>
                    {STAGES.map((st, i) => {
                      const items = list.filter((s) => s.stage === st.key).sort((a, b) => (b.rush - a.rush) || (a.receivedAt < b.receivedAt ? -1 : 1));
                      const { next, ready } = st.key !== 'reported' && group === 'stage' ? advanceReady(st.key) : { ready: [] };
                      const mine = myStages.includes(st.key);
                      const okey = lane + '|' + st.key;
                      const cap = group === 'stage' ? 150 : 40;
                      return (
                        <section key={st.key} className={cx('col', over === okey && 'over', mine && 'mine')} onDragOver={(e) => { e.preventDefault(); setOver(okey); }} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(e, st.key)} aria-label={st.label}>
                          <header>
                            <span className="col-step">{i + 1}</span>
                            <span className="col-name">{st.label}</span>
                            <span className="col-n">{items.length}</span>
                          </header>
                          {group === 'stage' && st.key === 'extraction' && items.length > 0 && can(state, 'adv_extraction') && <button className="advance alt" onClick={() => setPrepOpen(true)}><Icon n="flask" size={13} /> Build prep batch</button>}
                          {next && ready.length > 0 && st.key !== 'extraction' && (
                            <button className="advance" onClick={() => setGate({ ids: ready.map((r) => r.id), to: next })} title={`Move every sample that passes the gate to ${STAGES[i + 1].label}`}>
                              <Icon n="right" size={13} /> Advance {ready.length} ready
                            </button>
                          )}
                          <div className="col-body">
                            {items.slice(0, cap).map((s) => <Card key={s.id} s={s} state={state} onOpen={openSample} onDragStart={onDragStart} flagCount={flagsFor(state, s)} density={density} />)}
                            {!items.length && <div className="col-empty">{group === 'stage' ? 'Drop samples here' : '—'}</div>}
                            {items.length > cap && <button className="link small" onClick={() => go('samples')}>+{items.length - cap} more · open in Samples</button>}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            ));
          })()}
        </>
      )}
      {tab === 'reviews' && <Reviews state={state} openSample={openSample} go={go} />}
      {tab === 'flags' && <Flags state={state} openSample={openSample} />}
      {gate && <GateModal state={state} ids={gate.ids} to={gate.to} dispatch={dispatch} onClose={() => setGate(null)} toast={toast} />}
      {prepOpen && <PrepBatchModal state={state} dispatch={dispatch} toast={toast} onClose={() => setPrepOpen(false)} />}
    </div>
  );
}

function Reviews({ state, openSample, go }) {
  const unapproved = state.batches.filter((b) => !b.approved);
  const rev = state.samples.filter((s) => s.stage === 'review');
  const mgr = state.samples.filter((s) => s.stage === 'manager');
  return (
    <div className="grid2">
      <div className="panel">
        <h4>Instrument batches awaiting QC approval</h4>
        {unapproved.length ? unapproved.map((b) => (
          <button key={b.key} className="rowbtn" onClick={() => go('runs', b.key)}>
            <TestChips tests={[b.method]} small /> <b>{b.name}</b><span className="muted small">{b.eval.results.length} samples · {b.eval.issues.filter((i) => i.level === 'fail').length} QC fails</span><Icon n="right" />
          </button>
        )) : <Empty icon="check" title="All batches reviewed" />}
        <h4 className="mt">Data review ({rev.length})</h4>
        {rev.slice(0, 12).map((s) => <SampleRow key={s.id} s={s} state={state} onClick={() => openSample(s.id)} />)}
      </div>
      <div className="panel">
        <h4>Waiting for manager sign-off ({mgr.length})</h4>
        {mgr.length ? mgr.map((s) => <SampleRow key={s.id} s={s} state={state} onClick={() => openSample(s.id)} />) : <Empty icon="sign" title="Nothing waiting for signature" />}
      </div>
    </div>
  );
}

function Flags({ state, openSample }) {
  const rows = [];
  state.samples.forEach((s) => {
    if (s.legacy) return;
    if (s.hold) rows.push({ s, kind: 'Hold', text: s.hold.reason });
    const r = state.results[s.id];
    r && Object.entries(r).forEach(([t, x]) => x.analytes.forEach((a) => a.qualifiers.forEach((q) => rows.push({ s, kind: q, text: `${t} · ${a.name} = ${a.value == null ? 'ND' : sig(a.value)} ${a.units}` }))));
  });
  return (
    <div className="panel">
      <table className="tbl">
        <thead><tr><th>Lab ID</th><th>Flag</th><th>Detail</th><th>Stage</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={() => openSample(r.s.id)} className="click">
              <td className="lid">{r.s.id}</td><td><span className={cx('q', 'q-' + r.kind)}>{r.kind}</span></td><td>{r.text}</td><td className="muted">{STAGES.find((x) => x.key === r.s.stage).label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SampleRow({ s, state, onClick }) {
  return (
    <button className="rowbtn" onClick={onClick}>
      <span className="lid">{s.id}</span><TestChips tests={s.tests} small /><span className="ellip">{s.name}</span><span className="muted small">{daysSince(s.receivedAt)}d</span><Icon n="right" />
    </button>
  );
}

// ---------- Sample drawer ----------
export function SampleDrawer({ state, id, dispatch, onClose, toast, go }) {
  const s = state.samples.find((x) => x.id === id);
  const [tab, setTab] = useState('details');
  const [gate, setGate] = useState(null);
  const [edit, setEdit] = useState(null);
  useEffect(() => { setTab('details'); setEdit(null); }, [id]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !gate && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [gate, onClose]);
  if (!s) return null;
  const client = state.clients.find((c) => c.id === s.clientId);
  const i = stageIdx(s.stage);
  const next = STAGES[i + 1];
  const history = state.audit.filter((a) => a.entity === s.id);
  const res = state.results[s.id] || {};
  const locked = s.stage === 'reported';
  const save = () => {
    const patch = { bin: edit.bin || null, weight: edit.weight === '' ? null : +edit.weight, condition: edit.condition || null, rush: edit.rush };
    dispatch({ type: 'UPDATE_SAMPLE', id: s.id, patch, reason: edit.reason });
    setEdit(null); toast('Sample record updated');
  };
  const setHold = (on) => {
    const reason = on ? window.prompt('Reason for hold (recorded in the audit trail):') : window.prompt('Resolution (e.g. client approved testing):');
    if (!reason) return;
    dispatch({ type: 'UPDATE_SAMPLE', id: s.id, action: on ? 'Placed on hold' : 'Hold released', patch: on ? { hold: { reason, by: state.session.initials, at: nowIso() } } : { hold: null, prop65: s.prop65 ? { ...s.prop65, status: 'approved', note: reason } : null }, reason });
  };
  return (
    <aside className="drawer" aria-label={`Sample ${s.id}`}>
      <header className="drawer-head">
        <div>
          <div className="lid big">{s.id}</div>
          <div className="pname2">{s.name}</div>
          <div className="row gap"><TestChips tests={s.tests} /><span className="muted">{s.matrix}</span><span className="muted">· {client?.name}</span></div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close sample"><Icon n="x" /></button>
      </header>
      <ol className="stepper" aria-label="Workflow progress">
        {STAGES.map((st, k) => <li key={st.key} className={cx(k < i && 'done', k === i && 'now')} title={st.label}><span />{k === i && <em>{st.label}</em>}</li>)}
      </ol>
      {s.hold && <div className="callout warn"><Icon n="pause" /> <div><b>On hold.</b> {s.hold.reason}</div></div>}
      <div className="drawer-actions">
        {next && !s.legacy && <button className="btn primary" onClick={() => setGate({ ids: [s.id], to: next.key })}>{STAGES[i].next}</button>}
        {i > 0 && !locked && <button className="btn ghost" onClick={() => setGate({ ids: [s.id], to: STAGES[Math.max(0, i - (s.stage === 'review' ? 2 : 1))].key })}><Icon n="undo" size={14} />{s.stage === 'review' ? 'Re-extract / dilute' : 'Send back'}</button>}
        {!locked && can(state, 'edit') && <button className="btn ghost" onClick={() => setHold(!s.hold)}>{s.hold ? 'Release hold' : 'Place on hold'}</button>}
        {s.legacy && <span className="muted small">Legacy record imported from the tracking workbook. Certificates were issued outside the LIMS.</span>}
        {!s.legacy && (locked || s.stage === 'manager') && <button className="btn ghost" onClick={() => go('report', s.id)}><Icon n="doc" size={14} />{locked ? 'Certificate' : 'Preview certificate'}</button>}
      </div>
      <div className="tabs sm">
        {['details', 'photos', 'results', 'custody'].map((t) => <button key={t} className={cx('tab', tab === t && 'on')} onClick={() => setTab(t)}>{t === 'custody' ? 'Chain of custody' : t[0].toUpperCase() + t.slice(1)}{t === 'photos' && s.photos?.length ? <span className="count">{s.photos.length}</span> : null}</button>)}
      </div>
      <div className="drawer-body">
        {tab === 'details' && !edit && (
          <>
            <dl className="kv">
              <dt>Received</dt><dd>{fmtDate(s.receivedAt)} by {s.receivedBy}</dd>
              <dt>Carrier</dt><dd>{s.carrier || '—'} {s.tracking && <span className="muted">{s.tracking}</span>}</dd>
              <dt>ASIN</dt><dd>{s.asin || '—'}</dd>
              <dt>Product weight</dt><dd>{s.weight != null ? s.weight + ' g' : <span className="miss">Not recorded</span>}</dd>
              <dt>Condition</dt><dd>{s.condition || <span className="miss">Not recorded</span>}</dd>
              <dt>Storage bin</dt><dd>{s.bin || <span className="miss">Not assigned</span>}</dd>
              <dt>Subsample mass</dt><dd>{s.subsampleMass != null ? s.subsampleMass + ' g' : '—'}</dd>
              <dt>Prep batch</dt><dd>{s.prepBatch || '—'}</dd>
              {s.stdLots?.length > 0 && <><dt>Standard lots</dt><dd className="small">{s.stdLots.map((id) => { const x = state.inventory.find((i) => i.id === id); return x ? `${x.name} (lot ${x.lot})` : id; }).join('; ')}</dd></>}
              {s.expectedId && <><dt>Order</dt><dd>{state.expected.find((x) => x.id === s.expectedId)?.orderRef}</dd></>}
              <dt>Prop 65 review</dt><dd>{s.prop65 ? (s.prop65.status === 'approved' ? 'Client approved testing' : 'Awaiting client') : 'No warning label'}</dd>
              <dt>Turnaround</dt><dd>{daysSince(s.receivedAt)} of {state.settings.tat} days</dd>
              <dt>Assigned to</dt><dd>{can(state, 'edit') && !s.legacy ? <select className="inline-sel" value={s.assignee || ''} onChange={(e) => dispatch({ type: 'UPDATE_SAMPLE', id: s.id, patch: { assignee: e.target.value || null }, action: 'Assignment changed' })} aria-label="Assign to">{[<option key="" value="">Unassigned</option>, ...state.users.filter((u) => !u.client && u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)]}</select> : state.users.find((u) => u.id === s.assignee)?.name || '—'}</dd>
            </dl>
            {s.link && <p className="small"><a href={'https://' + s.link.replace(/^https?:\/\//, '')} target="_blank" rel="noreferrer">Product listing</a></p>}
            <Comments state={state} s={s} dispatch={dispatch} />
            {!locked && can(state, 'edit') && <button className="btn ghost sm" onClick={() => setEdit({ bin: s.bin || '', weight: s.weight ?? '', condition: s.condition || '', rush: s.rush, reason: '' })}>Edit record</button>}
            <div className="labelprev"><Barcode value={s.id} /><span className="lid">{s.id}</span></div>
          </>
        )}
        {tab === 'details' && edit && (
          <div className="form">
            <Field label="Storage bin"><input value={edit.bin} onChange={(e) => setEdit({ ...edit, bin: e.target.value })} placeholder="Bin-B01" /></Field>
            <Field label="Product weight (g)"><input type="number" value={edit.weight} onChange={(e) => setEdit({ ...edit, weight: e.target.value })} /></Field>
            <Field label="Condition on receipt">
              <select value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value })}><option value="">Select</option><option>Good</option><option>Damaged packaging</option><option>Opened</option><option>Wrong item</option></select>
            </Field>
            <label className="check"><input type="checkbox" checked={edit.rush} onChange={(e) => setEdit({ ...edit, rush: e.target.checked })} /> Rush</label>
            <Field label="Reason for change" hint="Required once a record exists. Old and new values are kept in the audit trail."><input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></Field>
            <div className="row gap"><button className="btn primary" disabled={!edit.reason.trim()} onClick={save}>Save changes</button><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
        )}
        {tab === 'photos' && (
          <div className="drawer-photos">
            <PhotoGrid photos={s.photos || []} onCaption={(pid, caption) => dispatch({ type: 'CAPTION_PHOTO', id: s.id, photoId: pid, caption })} />
            {!(s.photos || []).length && <Empty icon="camera" title="No photos filed">Add photos of the package, label, damage or the subsample. Each photo is stamped with who took it, when and at which stage.</Empty>}
            {!s.disposed && <PhotoInput compact onAdd={async (files) => { try { const ph = await filesToPhotos(files, state.session.initials, STAGES[i].label); if (ph.length) { dispatch({ type: 'ADD_PHOTOS', id: s.id, photos: ph }); toast(`${ph.length} photo${ph.length > 1 ? 's' : ''} filed to ${s.id}`); } } catch (e) { toast(e.message); } }} />}
          </div>
        )}
        {tab === 'results' && (
          <>
            {Object.entries(res).map(([t, r]) => {
              const b = state.batches.find((x) => x.key === r.batchKey);
              const m = state.methods[t];
              return (
                <div key={t} className="res-block">
                  <div className="row gap wrap"><TestChips tests={[t]} small /><span className="muted small">{r.legacyBatch ? `Historical run ${r.legacyBatch}` : `Run ${b?.name}`} · prep {r.prep} · {fmtDate(r.acq)}</span>{r.legacyBatch ? <span className="pill">From workbook</span> : b?.approved ? <span className="pill ok">QC approved</span> : <span className="pill warn">QC pending</span>}{r.rerunDil && <span className="pill flag">Rerun ×{r.rerunDil}</span>}</div>
                  <table className="tbl compact">
                    <thead><tr><th>Analyte</th><th className="num">Result</th><th className="num">{m.manual ? 'Spec' : 'MRL'}</th><th>Qual.</th></tr></thead>
                    <tbody>{r.analytes.map((a) => <tr key={a.name}><td>{a.name}</td><td className="num">{a.text != null ? a.text : a.value == null ? 'ND' : sig(a.value)} {a.text == null && <span className="muted">{a.units}</span>}</td><td className="num">{m.manual ? m.analytes.find((x) => x.name === a.name)?.spec : a.mrl}</td><td>{a.qualifiers.map((q) => <span key={q} className={'q q-' + q}>{q}</span>)}</td></tr>)}</tbody>
                  </table>
                  {r.surrogates.length > 0 && <div className="muted small">Surrogates: {r.surrogates.map((x) => <span key={x.name} className={x.ok ? '' : 'bad'}>{x.name} {pctf(x.rec)} </span>)}</div>}
                  {r.prior?.length > 0 && <div className="muted small">Supersedes {r.prior.length} earlier result{r.prior.length > 1 ? 's' : ''}: {r.prior.map((p) => p.analytes.map((a) => `${a.name} ${a.value == null ? 'ND' : sig(a.value)}${a.qualifiers.length ? ' (' + a.qualifiers.join(',') + ')' : ''}`).join(', ') + ' on ' + fmtDate(p.acq)).join('; ')}</div>}
                </div>
              );
            })}
            {!s.legacy && s.tests.filter((t) => !res[t]).map((t) => <ManualEntry key={t} state={state} s={s} test={t} dispatch={dispatch} toast={toast} />)}
            {!Object.keys(res).length && s.legacy && <Empty icon="run" title="No instrument results on file">This legacy record came from the tracking workbook without a matching instrument export.</Empty>}
          </>
        )}
        {tab === 'custody' && (
          <ol className="timeline">
            {history.map((h) => <li key={h.id}><span className="dot" /><div><b>{h.action}</b> <span className="muted small">{fmtDate(h.ts)}</span><div className="small">{h.user}{h.role ? ` (${h.role})` : ''}{h.detail ? ' — ' + h.detail : ''}{h.esig ? ` · e-signature ${h.esig}` : ''}</div></div></li>)}
          </ol>
        )}
      </div>
      {gate && <GateModal state={state} ids={gate.ids} to={gate.to} dispatch={dispatch} onClose={() => setGate(null)} toast={toast} />}
    </aside>
  );
}

// ---------- Samples list ----------
const MATRIX_GROUPS = [['Fabrics', /fabric/i], ['Paper', /paper/i], ['Cosmetics', /mascara|foundation|lipstick|powder cosm/i], ['Food', /coffee|cocoa|cereal/i], ['Liquids', /liquid/i]];
const dueIn = (s, tat) => tat - daysSince(s.receivedAt);

export function Samples({ state, dispatch, toast, openSample }) {
  const [picked, setPicked] = useState({});
  const [bulk, setBulk] = useState(null);
  const [assignTo, setAssignTo] = useState('');
  const [density, setDensity] = useState('comfortable');
  const [layout, setLayout] = useState('table');
  const [sort, setSort] = useState({ k: 'received', dir: -1 });
  const [showDisposed, setShowDisposed] = useState(false);
  const tat = state.settings.tat;
  const analystOf = useMemo(() => {
    const m = {};
    for (const a of state.audit) if (!m[a.entity] && a.action !== 'Signed in') m[a.entity] = a.user;
    return m;
  }, [state.audit]);
  const initials = (n) => (n ? (/^[A-Z]{1,3}$/.test(n) ? n : state.users.find((u) => u.name === n)?.initials || n.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()) : '—');
  const base = useMemo(() => state.samples.filter((s) => showDisposed || !s.disposed), [state.samples, showDisposed]);
  const cfg = useMemo(() => sampleCfg(state, { record: true, mine: true }), [state.users, state.clients, state.results, state.settings]);
  const ctl = useFilters('samples', base, cfg, { get: () => ({ density, layout, sort }), set: (x) => { setDensity(x.density); setLayout(x.layout); setSort(x.sort); } });
  const rows = ctl.filtered;
  const key = {
    id: (s) => s.id, client: (s) => s.clientId, matrix: (s) => s.matrix, status: (s) => stageIdx(s.stage),
    due: (s) => (s.stage === 'reported' ? 999 : dueIn(s, tat)), received: (s) => s.receivedAt, analyst: (s) => analystOf[s.id] || '',
  };
  const sorted = useMemo(() => [...rows].sort((a, b) => { const x = key[sort.k](a), y = key[sort.k](b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; }), [rows, sort, analystOf]);
  const [limit, setLimit] = useState(200);

  const active = base.filter((s) => s.stage !== 'reported');
  const legacyN = base.filter((s) => s.legacy).length;
  const tiles = [
    ['In the lab', active.length, 'received, not yet reported'],
    ['Due in 3 days', active.filter((s) => dueIn(s, tat) >= 0 && dueIn(s, tat) <= 3).length, `of ${tat}-day turnaround`],
    ['Overdue', active.filter((s) => dueIn(s, tat) < 0).length, 'past turnaround'],
    ['On hold', base.filter((s) => s.hold).length, 'client or lab decision'],
    ['Legacy history', legacyN, 'imported from the tracking workbook'],
    ['Reported, 30 days', base.filter((s) => { const r = state.reports[s.id]; return r && daysSince(r[r.length - 1].at) <= 30; }).length, 'certificates released'],
  ];
  const exportCsv = (subset) => {
    const rowsOut = Array.isArray(subset) ? subset : sorted;
    const head = ['Lab ID', 'Product', 'ASIN', 'Client', 'Matrix', 'Tests', 'Status', 'Received', 'Received by', 'Due (days)', 'Last action by', 'Bin', 'Weight g', 'Photos'];
    const lines = rowsOut.map((s) => [s.id, s.name, s.asin, state.clients.find((c) => c.id === s.clientId)?.name, s.matrix, s.tests.join('+'), STAGES.find((x) => x.key === s.stage).label, s.receivedAt, s.receivedBy, s.stage === 'reported' ? '' : dueIn(s, tat), analystOf[s.id], s.bin, s.weight, (s.photos || []).length].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })); a.download = `samples-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  const Th = ({ k, children, className }) => (
    <th className={cx(className, k && 'sortable')} onClick={() => k && setSort({ k, dir: sort.k === k ? -sort.dir : 1 })} aria-sort={sort.k === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
      {children}{sort.k === k && <span className="sort-ar">{sort.dir > 0 ? '▲' : '▼'}</span>}
    </th>
  );
  const Due = ({ s }) => {
    if (s.stage === 'reported') return <span className="muted">Done</span>;
    const d = dueIn(s, tat);
    return <span className={cx('due', d < 0 && 'late', d >= 0 && d <= 3 && 'near')}>{d < 0 ? `${-d}d late` : d === 0 ? 'Today' : `${d}d`}</span>;
  };
  const Progress = ({ s }) => {
    const i = stageIdx(s.stage), n = STAGES.length - 1;
    return <div className="prog" title={`${i + 1} of ${n + 1}: ${STAGES[i].label}`}><span style={{ width: `${(i / n) * 100}%` }} className={cx(s.hold && 'held', s.stage === 'reported' && 'done')} /></div>;
  };

  // priority stream groups
  const groups = [
    ['Overdue', (s) => s.stage !== 'reported' && dueIn(s, tat) < 0, 'fail'],
    ['On hold', (s) => !!s.hold, 'warn'],
    ['Rush', (s) => s.rush && s.stage !== 'reported', 'fail'],
    ['Due within 3 days', (s) => s.stage !== 'reported' && dueIn(s, tat) <= 3, 'warn'],
    ['On track', (s) => s.stage !== 'reported', ''],
    ['Reported', () => true, 'ok'],
  ];
  const placed = new Set();
  const stream = groups.map(([label, fn, tone]) => {
    const items = rows.filter((s) => !placed.has(s.id) && fn(s)).sort((a, b) => dueIn(a, tat) - dueIn(b, tat));
    items.forEach((s) => placed.add(s.id));
    return { label, tone, items };
  }).filter((g) => g.items.length);

  return (
    <div className="page">
      <div className="mini-tiles">{tiles.map(([l, n, sub]) => <div key={l} className="mini-tile"><span>{l}</span><b>{n}</b><small>{sub}</small></div>)}</div>
      <FilterBar ctl={ctl} state={state} dispatch={dispatch} toast={toast} placeholder="Search ID, product, ASIN, tracking, batch… or stage:review client:artemis" />
      <div className="toolbar">
        <button className="btn ghost sm" onClick={exportCsv}><Icon n="download" size={14} />Export {sorted.length.toLocaleString()}</button>
        <label className="check small"><input type="checkbox" checked={showDisposed} onChange={(e) => setShowDisposed(e.target.checked)} /> Include disposed</label>
        <div className="seg-label push">Density</div>
        <div className="seg">{[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([k, l]) => <button key={k} className={cx(density === k && 'on')} onClick={() => setDensity(k)}>{l}</button>)}</div>
        <div className="seg-label">Layout</div>
        <div className="seg">{[['table', 'Table'], ['stream', 'Priority stream']].map(([k, l]) => <button key={k} className={cx(layout === k && 'on')} onClick={() => setLayout(k)}>{l}</button>)}</div>
      </div>
      {Object.values(picked).some(Boolean) && (() => {
        const ids = Object.keys(picked).filter((k) => picked[k]);
        const sel = ids.map((id) => state.samples.find((s) => s.id === id)).filter(Boolean);
        const stages = [...new Set(sel.map((s) => s.stage))];
        const nextSt = stages.length === 1 ? STAGES[stageIdx(stages[0]) + 1] : null;
        return (
          <div className="bulkbar">
            <b>{ids.length} selected</b>
            <button className="btn primary sm" disabled={!nextSt} title={nextSt ? '' : 'Select samples at the same stage to move them together'} onClick={() => setBulk({ kind: 'move', ids, to: nextSt.key })}>{nextSt ? `Move to ${nextSt.label}` : 'Move (same stage only)'}</button>
            {can(state, 'edit') && <span className="row gap"><select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Assign to"><option value="">Assign to…</option>{state.users.filter((u) => !u.client && u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select><button className="btn ghost sm" disabled={!assignTo} onClick={() => { ids.forEach((id) => dispatch({ type: 'UPDATE_SAMPLE', id, patch: { assignee: assignTo }, action: 'Assignment changed' })); toast(`${ids.length} samples assigned`); }}>Assign</button></span>}
            <button className="btn ghost sm" onClick={() => setBulk({ kind: 'labels', ids })}><Icon n="tag" size={13} />Labels</button>
            {can(state, 'edit') && <button className="btn ghost sm" onClick={() => { const r = window.prompt('Reason for hold:'); if (r) { ids.forEach((id) => dispatch({ type: 'UPDATE_SAMPLE', id, action: 'Placed on hold', patch: { hold: { reason: r, by: state.session.initials, at: new Date().toISOString().slice(0, 16) } }, reason: r })); toast(`${ids.length} samples on hold`); } }}><Icon n="pause" size={13} />Hold</button>}
            <button className="btn ghost sm" onClick={() => exportCsv(sel)}><Icon n="download" size={13} />Export</button>
            <button className="link small push" onClick={() => setPicked({})}>Clear</button>
          </div>
        );
      })()}
      {layout === 'table' ? (
        <div className="panel flush tall">
          <table className={cx('tbl samples-tbl', density === 'compact' && 'compact')}>
            <thead><tr>
              <th className="ck"><input type="checkbox" aria-label="Select all shown" checked={sorted.slice(0, limit).length > 0 && sorted.slice(0, limit).every((s) => picked[s.id])} onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(sorted.slice(0, limit).filter((s) => !s.legacy).map((s) => [s.id, true])) : {})} /></th>
              <Th k="id">Sample</Th><Th k="client">Client</Th><Th k="matrix">Matrix</Th><th>Methods</th><Th k="status">Status</Th><th>Progress</th><Th k="due" className="num">Due</Th><Th k="analyst">Analyst</Th>
            </tr></thead>
            <tbody>
              {sorted.slice(0, limit).map((s) => (
                <tr key={s.id} className={cx('click', picked[s.id] && 'picked')} onClick={() => openSample(s.id)}>
                  <td className="ck" onClick={(e) => e.stopPropagation()}>{!s.legacy && <input type="checkbox" checked={!!picked[s.id]} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.checked })} aria-label={'Select ' + s.id} />}</td>
                  <td><div className="lid">{s.id}{s.legacy && <span className="pill sm">Legacy</span>}{s.rush && <span className="pill rush sm">Rush</span>}{s.hold && <span className="pill hold sm">Hold</span>}{(s.photos || []).length > 0 && <span className="ph-ic" title={`${s.photos.length} photo${s.photos.length > 1 ? 's' : ''}`}><Icon n="camera" size={11} />{s.photos.length}</span>}</div>{density === 'comfortable' && <div className="sub ellip-cell">{s.name}</div>}</td>
                  <td>{state.clients.find((c) => c.id === s.clientId)?.name}</td>
                  <td><span className="mx"><Icon n="flask" size={12} />{s.matrix}</span></td>
                  <td><TestChips tests={s.tests} small /></td>
                  <td><span className={'stage st-' + s.stage}>{STAGES.find((x) => x.key === s.stage).label}</span>{s.disposed && <span className="muted small"> · disposed</span>}</td>
                  <td><Progress s={s} /></td>
                  <td className="num"><Due s={s} /></td>
                  <td><span className="ana" title={analystOf[s.id] || ''}>{initials(analystOf[s.id])}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sorted.length && <Empty icon="search" title="No samples match">Clear the quick filter or the Filter panel to see more.</Empty>}
          {sorted.length > limit && <div className="pad center"><button className="btn ghost sm" onClick={() => setLimit(limit + 300)}>Show more ({sorted.length - limit} remaining)</button></div>}
        </div>
      ) : (
        <div className="stream">
          {stream.map((g) => (
            <section key={g.label} className="panel">
              <h4 className={'grp ' + g.tone}>{g.label} <span className="muted small">{g.items.length}</span></h4>
              {g.items.slice(0, g.label === 'Reported' ? 20 : 200).map((s) => (
                <button key={s.id} className={cx('srow', density === 'compact' && 'compact')} onClick={() => openSample(s.id)}>
                  <span className="lid">{s.id}</span><TestChips tests={s.tests} small /><span className="ellip">{s.name}</span>
                  <span className={'stage st-' + s.stage}>{STAGES.find((x) => x.key === s.stage).label}</span><Progress s={s} /><Due s={s} />
                </button>
              ))}
              {g.label === 'Reported' && g.items.length > 20 && <p className="muted small">+{g.items.length - 20} more. Switch to Table to see all.</p>}
            </section>
          ))}
        </div>
      )}
      {bulk?.kind === 'move' && <GateModal state={state} ids={bulk.ids} to={bulk.to} dispatch={dispatch} onClose={() => { setBulk(null); setPicked({}); }} toast={toast} />}
      {bulk?.kind === 'labels' && <LabelsModal state={state} ids={bulk.ids} onClose={() => setBulk(null)} />}
      <p className="muted small"><Icon n="alert" size={12} /> {sorted.length} sample{sorted.length !== 1 ? 's' : ''} matching current filter. Click a row to open the sample; edits happen there and are audited.</p>
    </div>
  );
}


function ManualEntry({ state, s, test, dispatch, toast }) {
  const m = state.methods[test];
  const [vals, setVals] = useState({});
  const canEnter = can(state, 'results') && ['analysis', 'review'].includes(s.stage);
  if (!m.manual && !canEnter) return null;
  const ready = m.analytes.every((a) => String(vals[a.name] ?? '').trim());
  const save = () => {
    const analytes = m.analytes.map((a) => {
      const raw = String(vals[a.name]).trim();
      if (a.text) return { name: a.name, value: null, text: raw, units: '', mrl: null, dil: 1, qualifiers: /conform/i.test(raw) ? [] : ['OOS'] };
      const v = +raw;
      return { name: a.name, value: v, units: m.units, mrl: a.mrl, dil: 1, qualifiers: a.specMin != null && v < a.specMin ? ['OOS'] : [] };
    });
    dispatch({ type: 'MANUAL_RESULTS', id: s.id, test, analytes });
    toast(`${test} results entered for ${s.id}. Approve the entry on Instrument runs before sign-off.`);
  };
  return (
    <div className="res-block manual">
      <div className="row gap"><TestChips tests={[test]} small /><b className="small">{m.manual ? 'Enter results' : 'No instrument results yet'}</b></div>
      {!canEnter ? <p className="muted small">Results can be entered by a Chemist once the sample is at the Instrument or Data review stage.</p> : (
        <>
          {m.analytes.map((a) => (
            <Field key={a.name} label={`${a.name}${a.spec ? ` (spec ${a.spec})` : ''}`}>
              {a.text ? <select value={vals[a.name] || ''} onChange={(e) => setVals({ ...vals, [a.name]: e.target.value })}><option value="">Select</option><option>Conforms</option><option>Does not conform</option></select>
                : <input type="number" step="0.01" value={vals[a.name] || ''} onChange={(e) => setVals({ ...vals, [a.name]: e.target.value })} />}
            </Field>
          ))}
          <button className="btn primary sm" disabled={!ready} onClick={save}>Save results</button>
          <p className="muted small">Manual entries create a review record that needs a second-person QC approval, same as an instrument run.</p>
        </>
      )}
    </div>
  );
}
