import React, { useState } from 'react';
import { PERMS } from './store.js';
import { cx, Icon, Modal, Field } from './ui.jsx';

const COLORS = ['#525B6E', '#0E8A6E', '#B46B07', '#A35F00', '#2457C5', '#7A3FB0', '#C0362C', '#1787C9', '#8E73AE', '#0F766E', '#BE185D', '#4D7C0F'];
const SUMMARY = [['sign', 'Signs certificates'], ['approve', 'Approves QC'], ['import', 'Imports runs'], ['intake', 'Registers samples'], ['users', 'Manages users'], ['portal', 'Client portal'], ['quality', 'Quality records']];

export function RolesManager({ state, dispatch, toast }) {
  const [sel, setSel] = useState('chemist');
  const [over, setOver] = useState(null);
  const [view, setView] = useState('board');
  const [menu, setMenu] = useState(null);
  const [create, setCreate] = useState(null);
  const roles = state.roles;
  const role = roles[sel] || roles[Object.keys(roles)[0]];
  const key = roles[sel] ? sel : Object.keys(roles)[0];
  const holders = (k) => state.users.filter((u) => u.roles.includes(k));
  const staff = state.users.filter((u) => !u.client), clients = state.users.filter((u) => u.client);

  // at least one active person must keep the ability to manage users
  const keepsAdmin = (nextRoles, nextUsers) => nextUsers.some((u) => u.status === 'active' && u.roles.some((r) => nextRoles[r]?.perms.users));
  const assign = (userId, k) => {
    const u = state.users.find((x) => x.id === userId);
    if (u.roles.includes(k)) return toast(`${u.name} already has ${roles[k].label}`);
    dispatch({ type: 'ASSIGN_ROLE', userId, role: k, add: true }); toast(`${roles[k].label} assigned to ${u.name}`);
  };
  const unassign = (userId, k) => {
    const users = state.users.map((u) => (u.id === userId ? { ...u, roles: u.roles.filter((r) => r !== k) } : u));
    if (!keepsAdmin(roles, users)) return toast('Someone active must keep a role that can manage users');
    dispatch({ type: 'ASSIGN_ROLE', userId, role: k, add: false });
  };
  const setPerm = (k, perm, on) => {
    const next = { ...roles, [k]: { ...roles[k], perms: { ...roles[k].perms, [perm]: on } } };
    if (perm === 'users' && !on && !keepsAdmin(next, state.users)) return toast('Someone active must keep a role that can manage users');
    const label = PERMS.flatMap(([, l]) => l).find(([p]) => p === perm)[1];
    dispatch({ type: 'ROLE_UPSERT', key: k, role: next[k], detail: `${label}: ${on ? 'allowed' : 'removed'}` });
  };
  const setField = (patch, detail) => dispatch({ type: 'ROLE_UPSERT', key, role: { ...role, ...patch }, detail });
  const del = () => {
    if (holders(key).length) return toast(`Remove ${roles[key].label} from ${holders(key).length} people first`);
    if (Object.keys(roles).length <= 1) return;
    dispatch({ type: 'ROLE_DELETE', key }); setSel(Object.keys(roles).find((k) => k !== key)); toast('Role deleted');
  };
  const onDrop = (e, userId) => { e.preventDefault(); setOver(null); const k = e.dataTransfer.getData('text/role'); const from = e.dataTransfer.getData('text/from'); if (!k || !roles[k]) return; assign(userId, k); if (from && from !== userId) unassign(from, k); };
  const Chip = ({ k, userId }) => (
    <span className="rchip2" style={{ '--rc': roles[k]?.color || '#888' }} draggable onDragStart={(e) => { e.dataTransfer.setData('text/role', k); e.dataTransfer.setData('text/from', userId || ''); }}>
      <i />{roles[k]?.label || k}{userId && <button aria-label={`Remove ${roles[k]?.label}`} onClick={(e) => { e.stopPropagation(); unassign(userId, k); }}><Icon n="x" size={10} /></button>}
    </span>
  );
  const Person = ({ u }) => (
    <div className={cx('person', over === u.id && 'over', u.status !== 'active' && 'inactive')} onDragOver={(e) => { e.preventDefault(); setOver(u.id); }} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(e, u.id)}>
      <div className="row gap"><span className={cx('avatar sm', u.client && 'client')}>{u.initials}</span><div className="grow0"><b>{u.name}</b><div className="muted small">{u.title || u.email}</div></div>
        <div className="pop-wrap push"><button className="icon-btn" aria-label={`Add role to ${u.name}`} onClick={() => setMenu(menu === u.id ? null : u.id)}><Icon n="plus" size={14} /></button>
          {menu === u.id && <div className="menu-pop" onMouseLeave={() => setMenu(null)}>{Object.entries(roles).filter(([k]) => !u.roles.includes(k)).map(([k, r]) => <button key={k} onClick={() => { assign(u.id, k); setMenu(null); }}><span className="cdot" style={{ background: r.color }} />{r.label}</button>)}</div>}
        </div>
      </div>
      <div className="rchips">{u.roles.length ? u.roles.map((k) => <React.Fragment key={k}>{Chip({ k, userId: u.id })}</React.Fragment>) : <span className="muted small">Drop a role here</span>}</div>
    </div>
  );
  return (
    <div className="stack">
      <div className="row between wrap gap">
        <p className="muted small m0">Drag a role from the list onto a person to give it to them (or use +). Drag a chip from one person to another to move it. Click a role to change what it allows. Every change is recorded in the audit trail and applies immediately.</p>
        <div className="seg">{[['board', 'Assign'], ['matrix', 'Permission matrix']].map(([k, l]) => <button key={k} className={cx(view === k && 'on')} onClick={() => setView(k)}>{l}</button>)}</div>
      </div>
      {view === 'board' ? (
        <div className="roles-layout">
          <aside className="panel role-pal">
            <div className="row between"><h4 className="m0">Roles</h4><button className="btn ghost sm" onClick={() => setCreate({ label: '', desc: '', color: COLORS[Object.keys(roles).length % COLORS.length], from: '' })}><Icon n="plus" size={13} />New role</button></div>
            {Object.entries(roles).map(([k, r]) => (
              <div key={k} className={cx('role-card', key === k && 'on')} style={{ '--rc': r.color }} draggable onDragStart={(e) => { e.dataTransfer.setData('text/role', k); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => setSel(k)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(k)}>
                <span className="grip" aria-hidden="true">⋮⋮</span>
                <div className="grow0"><b>{r.label}</b><div className="small muted">{SUMMARY.filter(([p]) => r.perms[p]).map(([, l]) => l).slice(0, 3).join(' · ') || 'Workflow steps only'}</div></div>
                <span className="count">{holders(k).length}</span>
              </div>
            ))}
          </aside>
          <section className="people">
            <h5>Lab staff</h5>
            <div className="people-grid">{staff.map((u) => <React.Fragment key={u.id}>{Person({ u })}</React.Fragment>)}</div>
            {clients.length > 0 && <><h5>Client contacts</h5><div className="people-grid">{clients.map((u) => <React.Fragment key={u.id}>{Person({ u })}</React.Fragment>)}</div></>}
          </section>
          <aside className="panel role-edit" style={{ '--rc': role.color }}>
            <div className="role-edit-head"><span className="cdot big" /><input className="role-name" value={role.label} onChange={(e) => setField({ label: e.target.value })} aria-label="Role name" /></div>
            <input value={role.desc} onChange={(e) => setField({ desc: e.target.value })} placeholder="What this role is for" aria-label="Role description" />
            <div className="swatches">{COLORS.map((c) => <button key={c} className={cx('sw', role.color === c && 'on')} style={{ background: c }} onClick={() => setField({ color: c }, 'Colour changed')} aria-label={'Colour ' + c} />)}</div>
            {PERMS.map(([group, list]) => (
              <div key={group} className="perm-group">
                <h6>{group}</h6>
                {list.map(([p, l]) => (
                  <label key={p} className="perm"><span>{l}</span><input type="checkbox" className="switch" checked={!!role.perms[p]} onChange={(e) => setPerm(key, p, e.target.checked)} /></label>
                ))}
              </div>
            ))}
            <div className="row gap mt-s">
              <button className="btn ghost sm" onClick={() => setCreate({ label: role.label + ' (copy)', desc: role.desc, color: role.color, from: key })}>Duplicate</button>
              <button className="btn ghost sm danger push" onClick={del}>Delete role</button>
            </div>
            <p className="muted small">{holders(key).length} {holders(key).length === 1 ? 'person has' : 'people have'} this role{holders(key).length ? ': ' + holders(key).map((u) => u.name).join(', ') : ''}.</p>
          </aside>
        </div>
      ) : (
        <div className="panel flush matrix">
          <table className="tbl compact">
            <thead><tr><th>Permission</th>{Object.entries(roles).map(([k, r]) => <th key={k} className="mx-h"><span className="cdot" style={{ background: r.color }} />{r.label}</th>)}</tr></thead>
            <tbody>{PERMS.map(([group, list]) => (
              <React.Fragment key={group}>
                <tr className="grp-row"><td colSpan={Object.keys(roles).length + 1}>{group}</td></tr>
                {list.map(([p, l]) => <tr key={p}><td>{l}</td>{Object.keys(roles).map((k) => <td key={k} className="center"><input type="checkbox" checked={!!roles[k].perms[p]} onChange={(e) => setPerm(k, p, e.target.checked)} aria-label={`${roles[k].label}: ${l}`} /></td>)}</tr>)}
              </React.Fragment>
            ))}</tbody>
          </table>
        </div>
      )}
      {create && (
        <Modal title={create.from ? 'Duplicate role' : 'New role'} sub="Start blank or from an existing role, then adjust its permissions." onClose={() => setCreate(null)}
          footer={<><button className="btn ghost" onClick={() => setCreate(null)}>Cancel</button><button className="btn primary" disabled={!create.label.trim()} onClick={() => {
            const k = create.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) + '_' + Date.now().toString(36).slice(-3);
            const base = create.from ? roles[create.from].perms : Object.fromEntries(PERMS.flatMap(([, l]) => l.map(([p]) => [p, false])));
            dispatch({ type: 'ROLE_UPSERT', key: k, role: { label: create.label.trim(), desc: create.desc, color: create.color, perms: { ...base } }, detail: create.from ? `Copied from ${roles[create.from].label}` : 'Blank role' });
            setSel(k); setCreate(null); toast('Role created. Drag it onto people to assign it.');
          }}>Create role</button></>}>
          <Field label="Name"><input value={create.label} onChange={(e) => setCreate({ ...create, label: e.target.value })} placeholder="e.g. Data Reviewer, Weekend Intake, Auditor" /></Field>
          <Field label="Description"><input value={create.desc} onChange={(e) => setCreate({ ...create, desc: e.target.value })} /></Field>
          <Field label="Start from"><select value={create.from} onChange={(e) => setCreate({ ...create, from: e.target.value })}><option value="">Blank (no permissions)</option>{Object.entries(roles).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></Field>
        </Modal>
      )}
    </div>
  );
}
