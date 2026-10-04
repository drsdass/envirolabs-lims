import React, { useState, useMemo, useRef, useEffect } from 'react';
import { cx, Icon, fmtDate } from './ui.jsx';

// Filters survive navigation: each page keeps its last filter state for the session.
const MEMO = {};
const blank = () => ({ q: '', facets: {}, flags: [], from: '', to: '' });
const asArr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const norm = (s) => String(s).toLowerCase();

/*
  cfg = {
    text: (item) => string,                          // free-text search haystack
    facets: [{ key, label, get: (item) => value | value[] }],
    flags: [{ key, label, test: (item) => bool }],   // one-tap toggles
    date: { label, get: (item) => 'YYYY-MM-DD…' },   // optional date range
  }
*/
export function useFilters(page, items, cfg, extra) {
  const [f, setF0] = useState(() => MEMO[page]?.f || blank());
  const setF = (next) => { const v = typeof next === 'function' ? next(f) : next; MEMO[page] = { ...MEMO[page], f: v }; setF0(v); };
  // tokens like client:artemis test:pfas become facet filters
  const parsed = useMemo(() => {
    const toks = []; const rest = [];
    f.q.split(/\s+/).filter(Boolean).forEach((t) => {
      const m = t.match(/^([a-z]+):(.+)$/i);
      const fc = m && cfg.facets.find((x) => x.key === m[1].toLowerCase() || norm(x.label).startsWith(m[1].toLowerCase()));
      if (fc) toks.push([fc, norm(m[2])]); else rest.push(norm(t));
    });
    return { toks, rest };
  }, [f.q, cfg.facets]);
  const filtered = useMemo(() => {
    const fl = cfg.flags || [];
    return items.filter((it) => {
      if (parsed.rest.length) { const h = norm(cfg.text(it)); if (!parsed.rest.every((w) => h.includes(w))) return false; }
      for (const [fc, v] of parsed.toks) if (!asArr(fc.get(it)).some((x) => norm(x).includes(v))) return false;
      for (const [k, vals] of Object.entries(f.facets)) { if (!vals?.length) continue; const fc = cfg.facets.find((x) => x.key === k); if (fc && !asArr(fc.get(it)).some((x) => vals.includes(String(x)))) return false; }
      for (const k of f.flags) { const g = fl.find((x) => x.key === k); if (g && !g.test(it)) return false; }
      if (cfg.date && (f.from || f.to)) { const d = (cfg.date.get(it) || '').slice(0, 10); if (!d || (f.from && d < f.from) || (f.to && d > f.to)) return false; }
      return true;
    });
  }, [items, f, parsed, cfg]);
  const active = Object.values(f.facets).reduce((n, v) => n + (v?.length || 0), 0) + f.flags.length + (f.from || f.to ? 1 : 0) + parsed.toks.length;
  return { f, setF, filtered, active, total: items.length, cfg, page, items, extra };
}

export function FilterBar({ ctl, state, dispatch, toast, placeholder, right, compact }) {
  const { f, setF, filtered, active, total, cfg, page, items, extra } = ctl;
  const [open, setOpen] = useState(false);
  const [vopen, setVopen] = useState(false);
  const [fq, setFq] = useState({});
  const pop = useRef(null);
  useEffect(() => {
    if (!open && !vopen) return;
    const h = (e) => { if (pop.current && !pop.current.contains(e.target)) { setOpen(false); setVopen(false); } };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [open, vopen]);
  const options = useMemo(() => {
    if (!open) return {};
    const o = {};
    cfg.facets.forEach((fc) => { const c = {}; items.forEach((it) => asArr(fc.get(it)).forEach((v) => { const k = String(v); c[k] = (c[k] || 0) + 1; })); o[fc.key] = Object.entries(c).sort((a, b) => b[1] - a[1]); });
    return o;
  }, [open, items, cfg.facets]);
  const toggle = (k, v) => { const cur = f.facets[k] || []; setF({ ...f, facets: { ...f.facets, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } }); };
  const views = (state?.views || []).filter((v) => v.page === page && (v.user === state.session.name || v.shared));
  const saveView = () => {
    const name = window.prompt('Name this view:'); if (!name) return;
    const shared = window.confirm('Share this view with everyone in the lab? (Cancel keeps it private.)');
    dispatch({ type: 'SET', key: 'views', value: [...(state.views || []), { id: 'V' + Date.now(), page, user: state.session.name, shared, name, f, extra: extra?.get() }], action: 'Saved view created', entity: name });
    toast?.(`View "${name}" saved`);
  };
  const applyView = (v) => { setF(v.f); v.extra && extra?.set(v.extra); setVopen(false); };
  const chips = [];
  Object.entries(f.facets).forEach(([k, vals]) => (vals || []).forEach((v) => { const fc = cfg.facets.find((x) => x.key === k); chips.push({ label: `${fc?.label}: ${v}`, rm: () => toggle(k, v) }); }));
  if (f.from || f.to) chips.push({ label: `${cfg.date?.label || 'Date'}: ${f.from ? fmtDate(f.from, false) : '…'} – ${f.to ? fmtDate(f.to, false) : '…'}`, rm: () => setF({ ...f, from: '', to: '' }) });
  const presets = [['Today', 0], ['7 days', 7], ['30 days', 30], ['90 days', 90]];
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  return (
    <div className={cx('fbar', compact && 'compact')} ref={pop}>
      <div className="fbar-row">
        <div className="search-in fsearch"><Icon n="search" /><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={placeholder || 'Search'} aria-label="Search" />{f.q && <button className="icon-btn" onClick={() => setF({ ...f, q: '' })} aria-label="Clear search"><Icon n="x" size={12} /></button>}</div>
        {(cfg.flags || []).map((g) => <button key={g.key} className={cx('qchip', f.flags.includes(g.key) && 'on')} onClick={() => setF({ ...f, flags: f.flags.includes(g.key) ? f.flags.filter((x) => x !== g.key) : [...f.flags, g.key] })}>{g.label}</button>)}
        <div className="pop-wrap">
          <button className={cx('btn ghost', active && 'has')} onClick={() => { setOpen(!open); setVopen(false); }}><Icon n="filter" size={14} />Filter{active ? ` · ${active}` : ''}</button>
          {open && (
            <div className="popover fpop">
              {cfg.date && (
                <div className="fsec">
                  <h6>{cfg.date.label}</h6>
                  <div className="row gap wrap">{presets.map(([l, n]) => <button key={l} className={cx('qchip sm', f.from === daysAgo(n) && !f.to && 'on')} onClick={() => setF({ ...f, from: daysAgo(n), to: '' })}>{l}</button>)}</div>
                  <div className="fg2"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" /><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" /></div>
                </div>
              )}
              {cfg.facets.map((fc) => {
                const opts = options[fc.key] || [];
                const sq = fq[fc.key] || '';
                const shown = opts.filter(([v]) => !sq || norm(v).includes(norm(sq)));
                return (
                  <div key={fc.key} className="fsec">
                    <h6>{fc.label}{(f.facets[fc.key] || []).length > 0 && <button className="link small" onClick={() => setF({ ...f, facets: { ...f.facets, [fc.key]: [] } })}>clear</button>}</h6>
                    {opts.length > 8 && <input className="fmini" value={sq} onChange={(e) => setFq({ ...fq, [fc.key]: e.target.value })} placeholder={`Find ${fc.label.toLowerCase()}`} />}
                    <div className="fopts">{shown.slice(0, 60).map(([v, n]) => <label key={v} className="fopt"><input type="checkbox" checked={(f.facets[fc.key] || []).includes(v)} onChange={() => toggle(fc.key, v)} /><span className="ellip">{v}</span><em>{n.toLocaleString()}</em></label>)}{shown.length > 60 && <span className="muted small">+{shown.length - 60} more, type to narrow</span>}</div>
                  </div>
                );
              })}
              <div className="row gap"><button className="btn ghost sm" onClick={() => setF(blank())}>Clear all</button><button className="btn primary sm push" onClick={() => setOpen(false)}>Show {filtered.length.toLocaleString()}</button></div>
            </div>
          )}
        </div>
        {state && (
          <div className="pop-wrap">
            <button className="btn ghost" onClick={() => { setVopen(!vopen); setOpen(false); }}><Icon n="list" size={14} />Views{views.length ? ` · ${views.length}` : ''}</button>
            {vopen && (
              <div className="popover fpop views-pop">
                {views.length ? views.map((v) => <div key={v.id} className="view-row"><button className="link" onClick={() => applyView(v)}>{v.name}</button><span className="muted small">{v.shared ? 'Shared' : 'Private'}{v.user !== state.session.name ? ` · ${v.user}` : ''}</span>{v.user === state.session.name && <button className="icon-btn" aria-label={'Delete ' + v.name} onClick={() => dispatch({ type: 'SET', key: 'views', value: state.views.filter((x) => x.id !== v.id) })}><Icon n="x" size={11} /></button>}</div>) : <p className="muted small m0">No saved views for this page yet.</p>}
                <button className="btn primary sm" onClick={saveView}><Icon n="plus" size={13} />Save current view</button>
              </div>
            )}
          </div>
        )}
        <span className="muted small fcount">{filtered.length === total ? `${total.toLocaleString()}` : `${filtered.length.toLocaleString()} of ${total.toLocaleString()}`}</span>
        {right}
      </div>
      {(chips.length > 0 || parsed(f.q)) && (
        <div className="fchips">
          {chips.map((c, k) => <span key={k} className="fchip">{c.label}<button onClick={c.rm} aria-label={'Remove ' + c.label}><Icon n="x" size={10} /></button></span>)}
          {(chips.length > 0 || f.flags.length > 0 || f.q) && <button className="link small" onClick={() => setF(blank())}>Clear all</button>}
        </div>
      )}
    </div>
  );
}
const parsed = (q) => /\b[a-z]+:\S/i.test(q);

// Paged rendering for long lists: renders 200 at a time with a "show more" footer.
export function usePaged(list, size = 200, reset) {
  const [n, setN] = useState(size);
  useEffect(() => setN(size), [reset]);
  return { rows: list.slice(0, n), more: list.length > n ? <div className="pad center"><button className="btn ghost sm" onClick={() => setN(n + size * 2)}>Show more ({(list.length - n).toLocaleString()} remaining)</button></div> : null };
}
