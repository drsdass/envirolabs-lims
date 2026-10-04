import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { HIST } from './history.js';
import { STAGES, stageIdx, ROLES, labCode, can, PERMS } from './store.js';
import { cx, Icon, TestChips, Modal, Field, fmtDate, daysSince, Empty, ago, PROD } from './ui.jsx';
import { RolesManager } from './roles.jsx';
import { useFilters, FilterBar, usePaged } from './filters.jsx';

// ---------- History ----------
export function History({ state, dispatch, toast, openSample, go }) {
  const [open, setOpen] = useState({});
  const tickets = useMemo(() => {
    const t = state.samples.map((s) => {
      const r = state.reports[s.id];
      return { kind: 'sample', id: s.id, s, product: s.name, panel: labCode(s.tests), stage: s.stage, received: s.receivedAt, signedBy: r ? r[r.length - 1].by : null, coa: r ? r.length : 0, search: `${s.id} ${s.name} ${s.asin || ''} ${s.prepBatch || ''}` };
    });
    const preps = {};
    state.samples.forEach((s) => { if (s.prepBatch) (preps[s.prepBatch] = preps[s.prepBatch] || []).push(s); });
    Object.entries(preps).forEach(([id, members]) => {
      const run = state.batches.find((b) => b.eval.preps.some((p) => p.id === id));
      const minStage = members.reduce((m, s) => Math.min(m, stageIdx(s.stage)), 99);
      const coa = members.reduce((n, s) => n + (state.reports[s.id] ? 1 : 0), 0);
      t.push({ kind: 'batch', id, members, run, product: `Batch — ${members.length} sample${members.length > 1 ? 's' : ''}`, panel: [...new Set(members.map((s) => labCode(s.tests)))].join(', '), stage: STAGES[minStage].key, received: members.map((s) => s.receivedAt).sort()[0], signedBy: run?.approved?.by || null, coa, search: `${id} ${run?.name || ''} ${members.map((s) => s.id).join(' ')}` });
    });
    return t.sort((a, b) => (a.received < b.received ? 1 : -1));
  }, [state.samples, state.reports, state.batches]);
  const cname = (id) => state.clients.find((c) => c.id === id)?.name || id;
  const cfg = useMemo(() => ({
    text: (t) => `${t.search} ${t.product}`,
    facets: [
      { key: 'type', label: 'Ticket type', get: (t) => (t.kind === 'batch' ? 'Prep batch' : t.s.legacy ? 'Legacy sample' : 'Sample') },
      { key: 'stage', label: 'Status', get: (t) => STAGES.find((x) => x.key === t.stage).label },
      { key: 'panel', label: 'Panel', get: (t) => t.panel },
      { key: 'client', label: 'Client', get: (t) => (t.s ? cname(t.s.clientId) : [...new Set(t.members.map((m) => cname(m.clientId)))]) },
      { key: 'signed', label: 'Signed by', get: (t) => t.signedBy || 'Not signed' },
    ],
    flags: [
      { key: 'cert', label: 'Certified', test: (t) => t.kind === 'sample' && t.coa > 0 },
      { key: 'prog', label: 'In progress', test: (t) => t.stage !== 'reported' },
      { key: 'hold', label: 'On hold', test: (t) => !!t.s?.hold },
      { key: 'amended', label: 'Amended', test: (t) => t.coa > 1 },
    ],
    date: { label: 'Received', get: (t) => t.received },
  }), [state.clients]);
  const ctl = useFilters('history', tickets, cfg);
  const rows = ctl.filtered;
  const { rows: shown, more } = usePaged(rows, 200, rows);
  const stepsFor = (id) => {
    const ev = state.audit.filter((a) => a.entity === id).slice().reverse();
    return STAGES.map((st, k) => {
      const e = k === 0 ? ev.find((a) => a.action === 'Sample received') : ev.filter((a) => a.action === `Moved to ${st.label}`).slice(-1)[0] || (st.key === 'reported' ? ev.find((a) => /Certificate of analysis signed/.test(a.action)) : null);
      return { st, e };
    });
  };
  return (
    <div className="page">
      <FilterBar ctl={ctl} state={state} dispatch={dispatch} toast={toast} placeholder="Search ticket ID, batch number, product, ASIN… or client:artemis panel:BP" />
      <div className="panel flush tall">
        <table className="tbl hist">
          <thead><tr><th style={{ width: 28 }} /><th>Ticket ID</th><th>Product</th><th>Panel</th><th>Status</th><th>Received</th><th>Signed by</th><th className="num">COA</th><th /></tr></thead>
          <tbody>
            {shown.map((t) => {
              const isOpen = open[t.kind + t.id];
              return (
                <React.Fragment key={t.kind + t.id}>
                  <tr className={cx('click', isOpen && 'open')} onClick={() => setOpen({ ...open, [t.kind + t.id]: !isOpen })}>
                    <td><Icon n="right" size={13} className={cx('chev', isOpen && 'rot')} /></td>
                    <td className="lid">{t.id}{t.kind === 'batch' && <span className="pill flag sm">Batch</span>}</td>
                    <td className="ellip-cell wide">{t.product}</td>
                    <td><span className="tag">{t.panel}</span></td>
                    <td><span className={'stage st-' + t.stage}>{t.kind === 'batch' && t.stage !== 'reported' ? 'At ' : ''}{STAGES.find((x) => x.key === t.stage).label}</span>{t.s?.hold && <span className="pill hold sm">Hold</span>}</td>
                    <td className="muted nowrap">{fmtDate(t.received, false)}</td>
                    <td>{t.signedBy ? <span className="ana" title={t.signedBy}>{t.signedBy.split(' ').map((p) => p[0]).join('')}</span> : '—'}</td>
                    <td className="num">{t.coa || '—'}</td>
                    <td><button className="link small" onClick={(e) => { e.stopPropagation(); t.kind === 'sample' ? openSample(t.id) : t.run ? go('runs', t.run.key) : setOpen({ ...open, [t.kind + t.id]: true }); }}>Open ticket <Icon n="right" size={12} /></button></td>
                  </tr>
                  {isOpen && (
                    <tr className="expand"><td /><td colSpan={8}>
                      {t.kind === 'sample' ? (
                        <div className="hist-x">
                          <ol className="hsteps">
                            {stepsFor(t.id).map(({ st, e }) => <li key={st.key} className={cx(e && 'done', st.key === t.stage && 'now')}><span className="hdot" /><b>{st.label}</b><small>{e ? `${fmtDate(e.ts)} · ${e.user}` : stageIdx(st.key) <= stageIdx(t.stage) ? 'Recorded' : 'Pending'}</small></li>)}
                          </ol>
                          <div className="row gap wrap">
                            <TestChips tests={t.s.tests} small /><span className="muted small">{t.s.matrix} · prep batch {t.s.prepBatch || '—'} · {(t.s.photos || []).length} photos</span>
                            {(state.reports[t.id] || []).map((r) => <button key={r.version} className="pill ok as-btn" onClick={() => go('report', t.id)}><Icon n="doc" size={11} />COA v{r.version}{r.reason ? ' (amended)' : ''} · {fmtDate(r.at, false)}</button>)}
                          </div>
                        </div>
                      ) : (
                        <div className="hist-x">
                          <p className="small muted">{t.run ? <>Instrument run <button className="link small" onClick={() => go('runs', t.run.key)}>{t.run.name}</button> · {t.run.approved ? `QC approved by ${t.run.approved.by}` : 'QC awaiting review'}</> : 'Not yet run on the instrument.'}</p>
                          <div className="batch-members">{t.members.map((s) => <button key={s.id} className="rowbtn" onClick={() => openSample(s.id)}><span className="lid">{s.id}</span><span className="ellip">{s.name}</span><span className={'stage st-' + s.stage}>{STAGES.find((x) => x.key === s.stage).label}</span></button>)}</div>
                        </div>
                      )}
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <Empty icon="search" title="No tickets match" />}
        {more}
      </div>
    </div>
  );
}

// ---------- Users ----------

export function Users({ state, dispatch, toast }) {
  const LAB_ROLES = Object.keys(state.roles).filter((k) => !state.roles[k].perms.portal);
  const CLIENT_ROLE = Object.keys(state.roles).find((k) => state.roles[k].perms.portal) || 'client';
  const [tab, setTab] = useState('users');
  const [invite, setInvite] = useState(null);
  const [edit, setEdit] = useState(null);
  const [grant, setGrant] = useState(null);
  const [menu, setMenu] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const lastActive = useMemo(() => { const m = {}; state.audit.forEach((a) => { if (!m[a.user]) m[a.user] = a.ts; }); return m; }, [state.audit]);
  const activeGrants = state.grants.filter((g) => g.expires >= today);
  const ucfg = useMemo(() => ({ text: (u) => `${u.name} ${u.email} ${u.title}`, facets: [{ key: 'role', label: 'Role', get: (u) => u.roles.map((r) => state.roles[r]?.label || r) }, { key: 'status', label: 'Status', get: (u) => (u.status === 'active' ? 'Active' : 'Deactivated') }, { key: 'kind', label: 'Type', get: (u) => (u.client ? 'Client contact' : 'Lab staff') }], flags: [{ key: 'nomfa', label: 'No 2-step', test: (u) => !u.mfa }] }), [state.roles]);
  const uctl = useFilters('users', state.users, ucfg);
  const isAdmin = can(state, 'users');
  const saveInvite = () => {
    const inv = { id: 'I' + Date.now(), email: invite.email.trim().toLowerCase(), name: invite.name.trim(), roles: invite.roles, clientId: invite.roles.includes('client') ? invite.clientId : null, expires: invite.expires || null, at: new Date().toISOString().slice(0, 16), by: state.session.name };
    dispatch({ type: 'INVITE', invite: inv }); setInvite(null); setTab('invites'); toast(`Invite sent to ${inv.email}`);
  };
  const RoleChips = ({ u }) => (
    <div className="rchips">
      {u.roles.map((r) => <span key={r} className="rchip2" style={{ '--rc': state.roles[r]?.color || '#888' }}><i />{state.roles[r]?.label || r}</span>)}
      {activeGrants.filter((g) => g.userId === u.id).map((g) => <span key={g.id} className="rchip ttl" title={g.reason}>{ROLES[g.role].label}<em>until {fmtDate(g.expires, false)}</em></span>)}
    </div>
  );
  return (
    <div className="page">
      <div className="row between wrap">
        <div className="tabs flat">
          {[['users', 'Users', state.users.length], ['roles', 'Roles & permissions', Object.keys(state.roles).length], ['grants', 'Temporary grants', activeGrants.length], ['invites', 'Invites', state.invites.length]].map(([k, l, n]) => <button key={k} className={cx('tab', tab === k && 'on')} onClick={() => setTab(k)}>{l}<span className="count">{n}</span></button>)}
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setInvite({ email: '', name: '', roles: ['intake'], clientId: 'artemis', expires: '' })}><Icon n="plus" size={14} />Invite user</button>}
      </div>
      {tab === 'users' && <FilterBar ctl={uctl} state={state} dispatch={dispatch} toast={toast} placeholder="Search name, email, title… or role:chemist" />}
      {tab === 'users' && (
        <div className="panel flush">
          <table className="tbl users-tbl">
            <thead><tr><th>User</th><th>Roles</th><th>2-step sign-in</th><th>Last active</th><th>Status</th><th /></tr></thead>
            <tbody>{uctl.filtered.map((u) => (
              <tr key={u.id}>
                <td><div className="urow"><span className={cx('avatar sm', u.client && 'client')}>{u.initials}</span><div><b>{u.name}</b><div className="muted small">{u.email}</div></div></div></td>
                <td><RoleChips u={u} /></td>
                <td>{u.mfa ? <span className="pill ok">On</span> : u.roles.some((r) => ['manager', 'admin'].includes(r)) ? <span className="pill warn">Required at next sign-in</span> : <span className="pill">Optional</span>}</td>
                <td className="muted">{ago(lastActive[u.name] || lastActive[u.initials])}</td>
                <td><span className={cx('pill', u.status === 'active' ? 'ok' : '')}>{u.status === 'active' ? 'Active' : 'Deactivated'}</span></td>
                <td className="menu-cell">
                  {isAdmin && <button className="icon-btn" aria-label={`Actions for ${u.name}`} onClick={() => setMenu(menu === u.id ? null : u.id)}>⋯</button>}
                  {menu === u.id && (
                    <div className="menu-pop" onMouseLeave={() => setMenu(null)}>
                      <button onClick={() => { setEdit({ ...u, roles: [...u.roles] }); setMenu(null); }}>Edit roles</button>
                      {!u.client && <button onClick={() => { setGrant({ userId: u.id, role: 'chemist', from: today, expires: '', reason: '' }); setMenu(null); }}>Grant a temporary role</button>}
                      <button className={u.status === 'active' ? 'danger' : ''} onClick={() => { dispatch({ type: 'UPDATE_USER', id: u.id, patch: { status: u.status === 'active' ? 'inactive' : 'active' }, action: u.status === 'active' ? 'User deactivated' : 'User reactivated' }); setMenu(null); toast(`${u.name} ${u.status === 'active' ? 'deactivated' : 'reactivated'}`); }}>{u.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {tab === 'roles' && (isAdmin ? <RolesManager state={state} dispatch={dispatch} toast={toast} /> : <div className="panel"><Empty icon="lock" title="Your role can't manage roles">Ask someone with "Manage users and roles".</Empty></div>)}
      {tab === 'grants' && (
        <div className="panel flush">
          <table className="tbl"><thead><tr><th>User</th><th>Role</th><th>From</th><th>Expires</th><th>Reason</th><th>Granted by</th><th /></tr></thead>
            <tbody>{state.grants.map((g) => { const u = state.users.find((x) => x.id === g.userId); const live = g.expires >= today; return <tr key={g.id}><td>{u?.name}</td><td><span className="rchip ttl">{ROLES[g.role].label}</span></td><td>{fmtDate(g.from, false)}</td><td className={live ? '' : 'muted'}>{fmtDate(g.expires, false)}{!live && ' (expired)'}</td><td className="small">{g.reason}</td><td className="muted">{g.by}</td><td>{isAdmin && live && <button className="link small" onClick={() => { dispatch({ type: 'REVOKE_GRANT', id: g.id }); toast('Grant revoked'); }}>Revoke</button>}</td></tr>; })}</tbody></table>
          {!state.grants.length && <Empty icon="users" title="No temporary grants">Use ⋯ › Grant a temporary role to cover leave or training. The role is removed automatically on the expiry date.</Empty>}
        </div>
      )}
      {tab === 'invites' && (
        <div className="panel flush">
          <table className="tbl"><thead><tr><th>Email</th><th>Roles</th><th>Access until</th><th>Sent</th><th /></tr></thead>
            <tbody>{state.invites.map((i) => <tr key={i.id}><td><b>{i.email}</b>{i.name && <div className="muted small">{i.name}</div>}</td><td><div className="rchips">{i.roles.map((r) => <span key={r} className={cx('rchip', r === 'client' && 'client')}>{ROLES[r].label}</span>)}</div></td><td>{i.expires ? fmtDate(i.expires, false) : 'No expiry'}</td><td className="muted">{ago(i.at)} by {i.by}</td><td className="nowrap">{!PROD.on && <><button className="link small" onClick={() => { dispatch({ type: 'ACCEPT_INVITE', id: i.id }); toast(`${i.email} accepted (simulated)`); }}>Simulate accept</button> · </>}<button className="link small" onClick={() => toast('Invite resent')}>Resend</button> · <button className="link small danger" onClick={() => dispatch({ type: 'REVOKE_INVITE', id: i.id })}>Revoke</button></td></tr>)}</tbody></table>
          {!state.invites.length && <Empty icon="users" title="No pending invites">Invite lab staff or client contacts. They set their own password from the email link.</Empty>}
        </div>
      )}
      {invite && (
        <Modal title="Invite user" sub="They receive an email link to set a password. Access can be time-limited." onClose={() => setInvite(null)}
          footer={<><button className="btn ghost" onClick={() => setInvite(null)}>Cancel</button><button className="btn primary" disabled={!/^\S+@\S+\.\S+$/.test(invite.email) || !invite.roles.length} onClick={saveInvite}>Send invite</button></>}>
          <div className="fg2"><Field label="Email"><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field><Field label="Name"><input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field></div>
          <Field label="Roles">
            <div className="role-grid">{[...LAB_ROLES, CLIENT_ROLE].map((r) => <label key={r} className={cx('rolebox', invite.roles.includes(r) && 'on')}><input type="checkbox" checked={invite.roles.includes(r)} onChange={() => { const has = invite.roles.includes(r); let roles = has ? invite.roles.filter((x) => x !== r) : [...invite.roles, r]; if (!has && r === 'client') roles = ['client']; else if (!has) roles = roles.filter((x) => x !== 'client'); setInvite({ ...invite, roles }); }} /><div><b>{ROLES[r].label}</b><span>{ROLES[r].desc}</span></div></label>)}</div>
          </Field>
          {invite.roles.includes('client') && <Field label="Client account"><select value={invite.clientId} onChange={(e) => setInvite({ ...invite, clientId: e.target.value })}>{state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <Field label="Access expires (optional)" hint="Leave blank for permanent staff. Use for temps, auditors or trial clients."><input type="date" value={invite.expires} onChange={(e) => setInvite({ ...invite, expires: e.target.value })} /></Field>
        </Modal>
      )}
      {edit && (
        <Modal title={`Edit roles · ${edit.name}`} sub="Changes take effect at the user's next sign-in and are recorded in the audit trail." onClose={() => setEdit(null)}
          footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={!edit.roles.length} onClick={() => { const u0 = state.users.find((x) => x.id === edit.id); dispatch({ type: 'UPDATE_USER', id: edit.id, patch: { roles: edit.roles, methods: edit.methods || [] }, action: 'Roles and authorizations changed', detail: `${u0.roles.map((r) => ROLES[r].label).join(', ')} → ${edit.roles.map((r) => ROLES[r].label).join(', ')}` }); setEdit(null); toast('Roles updated'); }}>Save roles</button></>}>
          {!edit.client && <Field label="Authorized to perform (training record)"><div className="seg">{Object.keys(state.methods).map((m) => <button key={m} type="button" className={cx((edit.methods || []).includes(m) && 'on')} onClick={() => setEdit({ ...edit, methods: (edit.methods || []).includes(m) ? edit.methods.filter((x) => x !== m) : [...(edit.methods || []), m] })}>{m}</button>)}</div></Field>}
          <div className="role-grid">{(edit.client ? ['client'] : LAB_ROLES).map((r) => <label key={r} className={cx('rolebox', edit.roles.includes(r) && 'on')}><input type="checkbox" checked={edit.roles.includes(r)} onChange={() => setEdit({ ...edit, roles: edit.roles.includes(r) ? edit.roles.filter((x) => x !== r) : [...edit.roles, r] })} /><div><b>{ROLES[r].label}</b><span>{ROLES[r].desc}</span></div></label>)}</div>
        </Modal>
      )}
      {grant && (
        <Modal title="Grant a temporary role" sub={state.users.find((u) => u.id === grant.userId).name} onClose={() => setGrant(null)}
          footer={<><button className="btn ghost" onClick={() => setGrant(null)}>Cancel</button><button className="btn primary" disabled={!grant.expires || !grant.reason.trim()} onClick={() => { dispatch({ type: 'ADD_GRANT', grant: { ...grant, id: 'G' + Date.now(), by: state.session.name } }); setGrant(null); setTab('grants'); toast('Temporary role granted'); }}>Grant role</button></>}>
          <Field label="Role"><select value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value })}>{LAB_ROLES.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}</select></Field>
          <div className="fg2"><Field label="From"><input type="date" value={grant.from} onChange={(e) => setGrant({ ...grant, from: e.target.value })} /></Field><Field label="Expires"><input type="date" value={grant.expires} onChange={(e) => setGrant({ ...grant, expires: e.target.value })} /></Field></div>
          <Field label="Reason"><input value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} placeholder="e.g. Covering data review during leave" /></Field>
          <p className="muted small">Method authorization still comes from the training record. A temporary Chemist can't run PFAS unless they're authorized for PFAS.</p>
        </Modal>
      )}
    </div>
  );
}

// ---------- Lab settings ----------
function Migration({ state, dispatch, toast }) {
  const ref = useRef(null);
  const [msg, setMsg] = useState('');
  const run = async (file) => {
    setMsg('Reading workbook…');
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sh = wb.Sheets['TotalProducts'];
      if (!sh) throw new Error('No TotalProducts sheet found. Instrument exports (Gen_LIMs sheets) are imported on the Instrument runs page.');
      const rows = XLSX.utils.sheet_to_json(sh, { defval: '' });
      const have = new Set(state.samples.map((x) => x.id));
      const g = (r, k) => { const key = Object.keys(r).find((x) => x.replace(/\s+/g, ' ').trim().toLowerCase() === k); return key ? r[key] : ''; };
      const add = [];
      rows.forEach((r) => {
        const id = String(g(r, 'laboratory id')).trim();
        if (!/^\d{6}-[A-Z]+\d+L?$/.test(id) || have.has(id)) return;
        const recv = g(r, 'received on');
        add.push({ id, name: String(g(r, 'product name')).slice(0, 200), link: String(g(r, 'link to product')) || null, asin: String(g(r, 'asin (identifier)')).startsWith('#') ? null : String(g(r, 'asin (identifier)')) || null, matrix: String(g(r, 'matrix')) || 'Fabrics', tests: /PFAS/i.test(g(r, 'anticipated chemical')) && /BPS/i.test(g(r, 'anticipated chemical')) ? ['BPS', 'PFAS'] : /PFAS/i.test(g(r, 'anticipated chemical')) ? ['PFAS'] : ['BPS'], clientId: /consumer safety/i.test(g(r, 'client')) ? 'ccs' : 'artemis', receivedAt: (recv instanceof Date ? recv.toISOString().slice(0, 10) : '2025-08-01') + 'T09:00', receivedBy: String(g(r, 'received by')).toUpperCase() || '—', stage: 'reported', legacy: true, rush: false, comments: [], photos: [], hold: null, prop65: null, bin: null, weight: null, condition: null, prepBatch: null, subsampleMass: null, disposed: null });
        have.add(id);
      });
      dispatch({ type: 'SET', key: 'samples', value: [...state.samples, ...add], action: 'Legacy samples imported', entity: file.name, detail: `${add.length} new of ${rows.length} rows` });
      setMsg(`${rows.length} rows read. ${add.length} new legacy samples added; ${rows.length - add.length} were already on file or had no valid lab ID.`);
    } catch (e) { setMsg(e.message); }
  };
  return (
    <div className="panel">
      <h4>Data migration</h4>
      <p className="small">Already loaded from your tracking workbook: <b>{state.samples.filter((x) => x.legacy).length.toLocaleString()}</b> legacy samples received before May 2026 and <b>{HIST.batches.length}</b> historical instrument runs with their QC, which feed the control charts, uncertainty and analytics.</p>
      <p className="muted small">To bring in newer rows, drop the latest workbook here. Existing lab IDs are skipped, so it is safe to re-run.</p>
      <button className="btn ghost sm" onClick={() => ref.current.click()}><Icon n="upload" size={13} />Import tracking workbook</button>
      <input ref={ref} type="file" accept=".xlsx" hidden onChange={(e) => { e.target.files[0] && run(e.target.files[0]); e.target.value = ''; }} />
      {msg && <p className="small mt-s">{msg}</p>}
      <div className="row gap wrap mt-s">
        <button className="btn ghost sm" onClick={() => {
          const base = state.samples.filter((x) => x.legacy && !x.synthetic);
          const add = []; const t0 = Date.now();
          for (let i = 0; i < 7500; i++) { const b = base[i % base.length]; const d = new Date(Date.parse('2024-01-01') + (i / 7500) * (Date.parse('2025-07-31') - Date.parse('2024-01-01'))); const pre = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; add.push({ ...b, id: `${pre}-${b.tests.map((t) => state.methods[t].letter).join('')}${String(80 + (i % 900)).padStart(3, '0')}S`, receivedAt: d.toISOString().slice(0, 10) + 'T09:00', synthetic: true }); }
          dispatch({ type: 'SET', key: 'samples', value: [...state.samples, ...add], action: 'Performance test data added', detail: '7,500 synthetic completed samples' });
          toast(`7,500 synthetic samples added in ${Date.now() - t0} ms. Try searching and filtering now.`);
        }}>Performance test: add 7,500 synthetic completed samples</button>
        {state.samples.some((x) => x.synthetic) && <button className="btn ghost sm" onClick={() => dispatch({ type: 'SET', key: 'samples', value: state.samples.filter((x) => !x.synthetic), action: 'Performance test data removed' })}>Remove synthetic samples</button>}
      </div>
      <p className="muted small">Synthetic samples are copies of legacy records with IDs ending in S, so you can feel how search and filters behave at 10,000+ samples. They never mix with real data in production.</p>
    </div>
  );
}

export function Settings({ state, dispatch, toast }) {
  const s = state.settings;
  const sec = state.security;
  return (
    <div className="page">
      <div className="grid2">
        <div className="panel">
          <h4>Laboratory</h4>
          <dl className="kv"><dt>Name</dt><dd>{s.labName}</dd><dt>Address</dt><dd>{s.address}</dd><dt>Phone</dt><dd>{s.phone}</dd><dt>Email</dt><dd>{s.email}</dd><dt>Turnaround target</dt><dd>{s.tat} days</dd><dt>Retention after report</dt><dd>{s.disposal} days</dd><dt>Lab ID format</dt><dd>YYMMDD-code## (B, P, BP, A)</dd></dl>
        </div>
        <div className="panel">
          <h4>Clients</h4>
          {state.clients.map((c) => <div key={c.id} className="note"><b>{c.name}</b><p className="small">{c.lead} · {c.email}<br />{c.address}</p></div>)}
          <button className="btn ghost sm mt" onClick={() => { dispatch({ type: 'RESET' }); toast('Demo data reset'); }}>Reset demo data</button>
        </div>
        <div className="panel">
          <h4>Notifications</h4>
          <table className="tbl compact"><thead><tr><th>Event</th><th>Recipients</th><th>Email</th><th>Text</th></tr></thead>
            <tbody>{state.notifRules.map((r) => <tr key={r.id}><td>{r.label}</td><td className="small muted">{r.to}</td>{['email', 'sms'].map((k) => <td key={k}><input type="checkbox" checked={r[k]} onChange={(e) => dispatch({ type: 'SET', key: 'notifRules', value: state.notifRules.map((x) => (x.id === r.id ? { ...x, [k]: e.target.checked } : x)), action: 'Notification rule changed', entity: r.label, detail: `${k} ${e.target.checked ? 'on' : 'off'}` })} aria-label={`${r.label} ${k}`} /></td>)}</tr>)}</tbody></table>
          <p className="muted small">Everything appears in the bell in-app. Email and text delivery switch on with the production build.</p>
        </div>
        <div className="panel">
          <h4>Security</h4>
          <dl className="kv"><dt>2-step sign-in</dt><dd>{sec.mfa}</dd><dt>Session timeout</dt><dd>{sec.timeout} minutes idle</dd><dt>Passwords</dt><dd>At least {sec.pwdLen} characters; checked against breached-password lists</dd><dt>Lockout</dt><dd>After {sec.lockout} failed attempts</dd><dt>Backups</dt><dd>{sec.backups}</dd><dt>E-signatures</dt><dd>Re-authentication with meaning, time and signature ID</dd></dl>
          <p className="muted small">These take effect in the production build; the prototype runs in your browser only.</p>
        </div>
        <Migration state={state} dispatch={dispatch} toast={toast} />
      </div>
    </div>
  );
}
