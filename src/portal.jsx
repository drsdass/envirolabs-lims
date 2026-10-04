import React, { useState } from 'react';
import { STAGES, stageIdx } from './store.js';
import { cx, Icon, TestChips, Modal, Field, fmtDate, daysSince, Empty } from './ui.jsx';
import { Shipments } from './pages4.jsx';
import { ReportView, Verify } from './pages2.jsx';
import { LOGO_MARK } from './logo.js';

const simple = (s) => (s.stage === 'reported' ? ['Reported', 'ok'] : s.hold ? ['Needs your decision', 'warn'] : stageIdx(s.stage) <= 0 ? ['Received', ''] : ['In testing', 'flag']);

export function ClientPortal({ state, dispatch, toast }) {
  const [page, setPage] = useState('samples');
  const [arg, setArg] = useState(null);
  const [q, setQ] = useState('');
  const [decide, setDecide] = useState(null);
  const cid = state.session.clientId;
  const client = state.clients.find((c) => c.id === cid);
  const mine = state.samples.filter((s) => s.clientId === cid && !s.legacy);
  const holds = mine.filter((s) => s.hold);
  const certs = mine.filter((s) => state.reports[s.id]);
  const go = (p, a = null) => { setPage(p === 'reports' ? 'certs' : p); setArg(a); };
  const nav = [['samples', 'My samples', 'flask', mine.filter((s) => s.stage !== 'reported').length], ['orders', 'Order lists', 'box'], ['approvals', 'Approvals', 'pause', holds.length], ['certs', 'Certificates', 'doc', certs.length], ['verify', 'Verify a certificate', 'shield']];
  const rows = mine.filter((s) => !q || `${s.id} ${s.name} ${s.asin}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="shell portal">
      <nav className="side">
        <div className="brand"><img className="brand-mark" src={LOGO_MARK} alt="" /><div><b>Enviro Labs</b><span>Client portal</span></div></div>
        <div className="portal-client"><span className="muted small">Signed in for</span><b>{client.name}</b></div>
        {nav.map(([k, l, ic, n]) => <button key={k} className={cx('nav', page === k && 'on')} onClick={() => go(k)}><Icon n={ic} />{l}{n ? <span className="nav-n">{n}</span> : null}</button>)}
        <div className="me"><span className="avatar">{state.session.initials}</span><div className="me-txt"><b>{state.session.name}</b><span className="small">{state.session.email}</span></div><button className="icon-btn" onClick={() => dispatch({ type: 'LOGOUT' })} aria-label="Sign out"><Icon n="out" /></button></div>
      </nav>
      <main className="main">
        <header className="top"><div><div className="crumb">{client.name}</div><h1>{{ samples: 'My samples', orders: 'Order lists', approvals: 'Approvals', certs: arg ? 'Certificate of analysis' : 'Certificates', verify: 'Verify a certificate' }[page]}</h1></div></header>
        {page === 'samples' && (
          <div className="page">
            <div className="mini-tiles four">
              <div className="mini-tile"><span>In testing</span><b>{mine.filter((s) => s.stage !== 'reported').length}</b><small>received, not yet reported</small></div>
              <div className={cx('mini-tile', holds.length && 'bad-tile')}><span>Need your decision</span><b>{holds.length}</b><small>see Approvals</small></div>
              <div className="mini-tile"><span>Certificates</span><b>{certs.length}</b><small>available to download</small></div>
              <div className="mini-tile"><span>Typical turnaround</span><b>{state.settings.tat} d</b><small>from receipt</small></div>
            </div>
            <div className="toolbar"><div className="search-in"><Icon n="search" /><input placeholder="Search lab ID, product, ASIN" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
            <div className="panel flush">
              <table className="tbl"><thead><tr><th>Lab ID</th><th>Product</th><th>Tests</th><th>Received</th><th>Status</th><th>Progress</th><th /></tr></thead>
                <tbody>{rows.map((s) => { const [l, t] = simple(s); const i = stageIdx(s.stage); return <tr key={s.id}><td className="lid">{s.id}</td><td className="ellip-cell">{s.name}</td><td><TestChips tests={s.tests} small /></td><td className="muted">{fmtDate(s.receivedAt, false)}</td><td><span className={'pill ' + t}>{l}</span></td><td><div className="prog"><span style={{ width: `${(i / 6) * 100}%` }} className={cx(s.hold && 'held', s.stage === 'reported' && 'done')} /></div></td><td>{state.reports[s.id] ? <button className="link small" onClick={() => go('certs', s.id)}>Certificate</button> : s.hold ? <button className="link small" onClick={() => setDecide(s)}>Decide</button> : null}</td></tr>; })}</tbody></table>
            </div>
          </div>
        )}
        {page === 'orders' && <Shipments state={state} dispatch={dispatch} toast={toast} go={() => {}} clientOnly={cid} />}
        {page === 'approvals' && (
          <div className="page">
            {holds.length ? holds.map((s) => (
              <div key={s.id} className="panel row gap wrap">
                <div className="grow"><b className="lid">{s.id}</b> <TestChips tests={s.tests} small /><p className="m0">{s.name}</p><p className="muted small">{s.hold.reason}</p></div>
                {s.photos?.[0] && <img className="appr-photo" src={s.photos[0].src} alt="Receipt photo" />}
                <button className="btn ghost" onClick={() => setDecide({ ...s, mode: 'decline' })}>Don't test</button>
                <button className="btn primary" onClick={() => setDecide({ ...s, mode: 'approve' })}>Approve testing</button>
              </div>
            )) : <div className="panel"><Empty icon="check" title="Nothing needs your decision" /></div>}
          </div>
        )}
        {page === 'certs' && !arg && (
          <div className="page"><div className="panel flush"><table className="tbl"><thead><tr><th>Report</th><th>Product</th><th>Tests</th><th>Released</th><th /></tr></thead>
            <tbody>{certs.map((s) => { const v = state.reports[s.id].slice(-1)[0]; return <tr key={s.id} className="click" onClick={() => setArg(s.id)}><td className="lid">{s.id}-R{v.version}{v.reason && <span className="pill warn sm">Amended</span>}</td><td className="ellip-cell">{s.name}</td><td><TestChips tests={s.tests} small /></td><td>{fmtDate(v.at)}</td><td><span className="link small">Open</span></td></tr>; })}</tbody></table>
            {!certs.length && <Empty icon="doc" title="No certificates yet" />}</div></div>
        )}
        {page === 'certs' && arg && <ReportView key={arg} state={state} id={arg} dispatch={dispatch} toast={toast} go={go} />}
        {page === 'verify' && <Verify state={state} go={go} />}
      </main>
      {decide && (
        <Modal title={decide.mode === 'decline' ? `Don't test ${decide.id}` : `Approve testing for ${decide.id}`} sub={decide.name} onClose={() => setDecide(null)} footer={<><button className="btn ghost" onClick={() => setDecide(null)}>Cancel</button><button className={cx('btn', decide.mode === 'decline' ? 'warn' : 'primary')} onClick={() => { dispatch({ type: 'CLIENT_DECISION', id: decide.id, approve: decide.mode !== 'decline', note: decide.note || '' }); toast(decide.mode === 'decline' ? 'The lab will return or dispose of the item' : 'Approved. The lab will proceed.'); setDecide(null); }}>{decide.mode === 'decline' ? "Don't test" : 'Approve'}</button></>}>
          <p className="small">{decide.hold?.reason}</p>
          {!decide.mode && <div className="row gap"><button className="btn primary" onClick={() => setDecide({ ...decide, mode: 'approve' })}>Approve testing</button><button className="btn ghost" onClick={() => setDecide({ ...decide, mode: 'decline' })}>Don't test</button></div>}
          <Field label="Note to the lab (optional)"><input value={decide.note || ''} onChange={(e) => setDecide({ ...decide, note: e.target.value })} /></Field>
          <p className="muted small">Your decision is recorded with your name and time on the sample's chain of custody.</p>
        </Modal>
      )}
    </div>
  );
}
