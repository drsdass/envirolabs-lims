import React, { useState, useRef, useEffect, useMemo } from 'react';
import { STAGES, stageIdx, can, missingStandards } from './store.js';
import { cx, Icon, TestChips, Modal, Field, GateModal, gateFor, fmtDate, daysSince, Empty, Barcode, nowIso } from './ui.jsx';

// ---------- Scan mode ----------
export function ScanMode({ state, dispatch, toast, openSample, go }) {
  const [code, setCode] = useState('');
  const [cur, setCur] = useState(null);
  const [log, setLog] = useState([]);
  const [gate, setGate] = useState(null);
  const [cam, setCam] = useState(false);
  const input = useRef(null);
  const video = useRef(null);
  useEffect(() => { if (!gate) input.current?.focus(); }, [gate, cur]);
  const lookup = (raw) => {
    const v = raw.trim().toUpperCase(); if (!v) return;
    const s = state.samples.find((x) => x.id === v) || state.samples.find((x) => x.tracking && x.tracking.toUpperCase() === v && !x.legacy);
    const ex = !s && state.expected.find((x) => x.status === 'awaiting' && x.tracking && x.tracking.toUpperCase() === v);
    setCode('');
    if (s) { setCur(s.id); setLog((l) => [{ v, id: s.id, at: new Date().toLocaleTimeString() }, ...l].slice(0, 12)); return; }
    if (ex) { toast(`Tracking ${v} matches an expected shipment. Opening intake.`); go('intake', ex.id); return; }
    toast(`Nothing found for ${v}`); setLog((l) => [{ v, id: null, at: new Date().toLocaleTimeString() }, ...l].slice(0, 12));
  };
  useEffect(() => {
    if (!cam) return;
    let stream, timer, stop = false;
    (async () => {
      try {
        if (!('BarcodeDetector' in window)) throw new Error('This browser cannot read barcodes from the camera. Use a USB or Bluetooth scanner, or Chrome on Android.');
        const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream; await video.current.play();
        const tick = async () => { if (stop) return; try { const r = await det.detect(video.current); if (r[0]) { lookup(r[0].rawValue); setCam(false); return; } } catch (e) { /* keep trying */ } timer = setTimeout(tick, 250); };
        tick();
      } catch (e) { toast(e.message); setCam(false); }
    })();
    return () => { stop = true; clearTimeout(timer); stream && stream.getTracks().forEach((t) => t.stop()); };
  }, [cam]);
  const s = cur && state.samples.find((x) => x.id === cur);
  const i = s ? stageIdx(s.stage) : -1;
  const next = s && !s.legacy ? STAGES[i + 1] : null;
  const g = next ? gateFor(state, s, next.key) : null;
  const ready = g && !g.blocked && g.checks.every((c) => c.ok !== false);
  return (
    <div className="page scan-page">
      <div className="scan-box">
        <Icon n="tag" size={22} />
        <input ref={input} className="scan-in" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { if (!code && ready && next) setGate(next.key); else lookup(code); } }} placeholder="Scan a lab ID label or a tracking number" aria-label="Scan input" autoFocus />
        <button className="btn ghost" onClick={() => setCam(!cam)}><Icon n="camera" size={14} />{cam ? 'Stop camera' : 'Use camera'}</button>
      </div>
      {cam && <video ref={video} className="cam scan-cam" playsInline muted />}
      <p className="muted small center">USB and Bluetooth scanners type the code and press Enter. After a sample appears, press <kbd>Enter</kbd> again to move it to the next stage.</p>
      {s ? (
        <div className="panel scan-card">
          <div className="row gap wrap">
            <span className="lid big">{s.id}</span><TestChips tests={s.tests} /><span className={'stage st-' + s.stage}>{STAGES[i].label}</span>{s.hold && <span className="pill hold">On hold</span>}{s.rush && <span className="pill rush">Rush</span>}
            <button className="link push" onClick={() => openSample(s.id)}>Open record</button>
          </div>
          <div className="scan-body">
            {s.photos?.[0] && <img src={s.photos[0].src} alt="" className="scan-photo" />}
            <div className="grow0">
              <p className="m0">{s.name}</p>
              <p className="muted small">{s.matrix} · bin {s.bin || '—'} · received {fmtDate(s.receivedAt)} · {daysSince(s.receivedAt)} days</p>
              {next ? (
                <>
                  {g.blocked ? <div className="callout fail"><Icon n="lock" />{g.blocked}</div> : (
                    <ul className="checks">{g.checks.map((c, k) => <li key={k} className={c.ok === true ? 'ok' : c.ok === 'warn' ? 'warn' : 'no'}><Icon n={c.ok === true ? 'check' : c.ok === 'warn' ? 'alert' : 'x'} /><div><div>{c.label}</div>{c.hint && c.ok !== true && <small>{c.hint}</small>}</div></li>)}</ul>
                  )}
                  <button className="btn primary big-btn" disabled={!ready} onClick={() => setGate(next.key)}>{STAGES[i].next} <kbd>Enter</kbd></button>
                </>
              ) : <p className="muted">{s.legacy ? 'Legacy record (read-only).' : 'Reported. Nothing further to do.'}</p>}
            </div>
            <div className="scan-label"><Barcode value={s.id} /><span className="lid">{s.id}</span></div>
          </div>
        </div>
      ) : <div className="panel"><Empty icon="tag" title="Ready to scan">Scan a label to see the sample, its next step and anything blocking it.</Empty></div>}
      {log.length > 0 && <div className="panel"><h4>This session</h4>{log.map((l, k) => <div key={k} className="row gap small scan-log"><span className="muted">{l.at}</span><span className="lid">{l.v}</span>{l.id ? <button className="link small" onClick={() => setCur(l.id)}>show</button> : <span className="bad">not found</span>}</div>)}</div>}
      {gate && <GateModal state={state} ids={[s.id]} to={gate} dispatch={dispatch} onClose={() => setGate(null)} toast={toast} />}
    </div>
  );
}

// ---------- My work ----------
export function MyWork({ state, openSample, go }) {
  const me = state.users.find((u) => u.name === state.session.name);
  const tat = state.settings.tat;
  const myStages = STAGES.filter((st) => st.key !== 'reported' && (st.key === 'manager' ? can(state, 'sign') : can(state, 'adv_' + st.key)));
  const [q, setQ] = useState('');
  const live = state.samples.filter((s) => !s.legacy && s.stage !== 'reported' && (!q || `${s.id} ${s.name} ${s.asin || ''} ${s.prepBatch || ''}`.toLowerCase().includes(q.toLowerCase())));
  const mine = live.filter((s) => me && s.assignee === me.id);
  const due = (s) => tat - daysSince(s.receivedAt);
  const sortQ = (a, b) => (b.rush - a.rush) || due(a) - due(b);
  const mentions = state.samples.flatMap((s) => (s.comments || []).filter((c) => c.mentions?.includes(me?.id)).map((c) => ({ s, c }))).slice(-8).reverse();
  const batches = can(state, 'approve') ? state.batches.filter((b) => !b.approved) : [];
  const Row = ({ s }) => <button className="rowbtn" onClick={() => openSample(s.id)}><span className="lid">{s.id}</span><TestChips tests={s.tests} small /><span className="ellip">{s.name}</span>{s.hold && <span className="pill hold sm">Hold</span>}{s.rush && <span className="pill rush sm">Rush</span>}<span className={cx('due', due(s) < 0 && 'late', due(s) >= 0 && due(s) <= 3 && 'near')}>{due(s) < 0 ? `${-due(s)}d late` : due(s) === 0 ? 'Today' : `${due(s)}d`}</span></button>;
  return (
    <div className="page">
      <div className="search-in"><Icon n="search" /><input placeholder="Filter my work by lab ID, product, ASIN or batch" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="grid2">
        <div className="panel">
          <h4>Assigned to me <span className="muted small">{mine.length}</span></h4>
          {mine.length ? mine.sort(sortQ).map((s) => <Row key={s.id} s={s} />) : <Empty icon="users" title="Nothing assigned to you">Managers can assign samples from the Samples list or a sample's record.</Empty>}
          {mentions.length > 0 && <><h4 className="mt">Mentions</h4>{mentions.map(({ s, c }, k) => <button key={k} className="rowbtn" onClick={() => openSample(s.id)}><span className="lid">{s.id}</span><span className="ellip">{c.name || c.by}: {c.text}</span><span className="muted small">{fmtDate(c.at)}</span></button>)}</>}
          {batches.length > 0 && <><h4 className="mt">Batches to approve</h4>{batches.map((b) => <button key={b.key} className="rowbtn" onClick={() => go('runs', b.key)}><TestChips tests={[b.method]} small /><b>{b.name}</b><span className="muted small">{b.eval.results.length} samples</span><Icon n="right" /></button>)}</>}
        </div>
        <div className="panel">
          <h4>Ready for my role</h4>
          {myStages.map((st) => {
            const list = live.filter((s) => s.stage === st.key).sort(sortQ);
            if (!list.length) return null;
            return <div key={st.key} className="mw-group"><h5>{st.label} <span className="muted small">{list.length}</span></h5>{list.slice(0, 8).map((s) => <Row key={s.id} s={s} />)}{list.length > 8 && <button className="link small" onClick={() => go('dashboard')}>+{list.length - 8} more on the board</button>}</div>;
          })}
          {!myStages.length && <Empty icon="lock" title="Your role doesn't move samples" />}
        </div>
      </div>
    </div>
  );
}

// ---------- Prep batch builder ----------
export function PrepBatchModal({ state, dispatch, toast, onClose }) {
  const pool = state.samples.filter((s) => !s.legacy && s.stage === 'extraction');
  const tests = [...new Set(pool.flatMap((s) => s.tests))];
  const [test, setTest] = useState(tests[0] || 'BPS');
  const cands = pool.filter((s) => s.tests.includes(test)).sort((a, b) => (b.rush - a.rush) || (a.receivedAt < b.receivedAt ? -1 : 1));
  const [sel, setSel] = useState(() => Object.fromEntries(cands.slice(0, 20).map((s) => [s.id, true])));
  const d = new Date(); const day = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const used = new Set(state.samples.map((s) => s.prepBatch).filter(Boolean));
  let n = 1; while (used.has(day + String(n).padStart(2, '0'))) n++;
  const [prep, setPrep] = useState(day + String(n).padStart(2, '0'));
  const [vol, setVol] = useState('10');
  const ids = cands.filter((s) => sel[s.id]).map((s) => s.id);
  const gates = ids.map((id) => [id, gateFor(state, state.samples.find((s) => s.id === id), 'analysis')]);
  const blocked = gates.filter(([, g]) => g.blocked || g.checks.some((c) => c.ok === false));
  const miss = missingStandards(state.inventory, [test]);
  const go = () => {
    dispatch({ type: 'MOVE', ids: ids.filter((id) => !blocked.find(([b]) => b === id)), to: 'analysis', fields: { prepBatch: prep, finalVolume: +vol }, reason: `Prep batch ${prep} built with MB, BS and BSD` });
    toast(`Prep batch ${prep}: ${ids.length - blocked.length} samples queued for the instrument`);
    onClose();
  };
  return (
    <Modal wide title="Build a prep batch" sub="Pick up to 20 samples for one extraction. The method blank, blank spike and duplicate are added automatically." onClose={onClose}
      footer={<><span className="muted small push-left">{ids.length} selected{blocked.length ? ` · ${blocked.length} blocked` : ''}</span><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ids.length || ids.length - blocked.length === 0 || ids.length > 20} onClick={go}>Create batch and queue {ids.length - blocked.length}</button></>}>
      {!pool.length ? <Empty icon="flask" title="No samples at Extraction" /> : (
        <>
          <div className="row gap wrap">
            <div className="seg">{tests.map((t) => <button key={t} className={cx(test === t && 'on', 't-' + state.methods[t].color)} onClick={() => { setTest(t); setSel({}); }}>{t}</button>)}</div>
            <Field label="Prep batch ID"><input value={prep} onChange={(e) => setPrep(e.target.value)} /></Field>
            <Field label="Final extract volume (mL)"><input type="number" value={vol} onChange={(e) => setVol(e.target.value)} /></Field>
          </div>
          {miss.length > 0 && <div className="callout fail"><Icon n="alert" />No in-date lot for {miss.join(', ')}. Add one under Standards & reagents.</div>}
          {ids.length > 20 && <div className="callout warn"><Icon n="alert" />A prep batch holds at most 20 samples.</div>}
          <div className="qc-auto"><span className="pill">Method Blank {prep}</span><span className="pill">Blank Spike 1:{prep}</span><span className="pill">Blank Spike Duplicate:{prep}</span></div>
          <table className="tbl compact"><thead><tr><th><input type="checkbox" checked={cands.length > 0 && cands.every((s) => sel[s.id])} onChange={(e) => setSel(Object.fromEntries(cands.map((s) => [s.id, e.target.checked])))} aria-label="Select all" /></th><th>Lab ID</th><th>Product</th><th className="num">Subsample (g)</th><th>Age</th><th>Check</th></tr></thead>
            <tbody>{cands.map((s) => { const g = gates.find(([id]) => id === s.id)?.[1]; const bad = g && (g.blocked || g.checks.some((c) => c.ok === false)); return <tr key={s.id}><td><input type="checkbox" checked={!!sel[s.id]} onChange={(e) => setSel({ ...sel, [s.id]: e.target.checked })} aria-label={'Select ' + s.id} /></td><td className="lid">{s.id}{s.rush && <span className="pill rush sm">Rush</span>}</td><td className="ellip-cell">{s.name}</td><td className="num">{s.subsampleMass ?? '—'}</td><td>{daysSince(s.receivedAt)}d</td><td className="small">{!sel[s.id] ? '' : bad ? <span className="bad">{g.blocked || g.checks.filter((c) => c.ok === false).map((c) => c.label).join('; ')}</span> : <span className="pill ok">Ready</span>}</td></tr>; })}</tbody></table>
        </>
      )}
    </Modal>
  );
}

// ---------- Labels (print sheet + Zebra ZPL) ----------
export function LabelsModal({ state, ids, onClose }) {
  const list = ids.map((id) => state.samples.find((s) => s.id === id)).filter(Boolean);
  const zpl = list.map((s) => `^XA^CI28^PW406^LL203^FO20,20^BY2^BCN,70,N,N,N^FD${s.id}^FS^FO20,100^A0N,34,34^FD${s.id}^FS^FO20,140^A0N,22,22^FD${s.name.replace(/[\^~]/g, '').slice(0, 34)}^FS^FO20,168^A0N,20,20^FD${s.tests.join('+')} ${s.receivedAt.slice(0, 10)} ${s.receivedBy}^FS^XZ`).join('\n');
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zpl], { type: 'text/plain' })); a.download = `labels_${list.length}.zpl`; a.click(); };
  return (
    <Modal wide title={`Labels for ${list.length} sample${list.length > 1 ? 's' : ''}`} sub="Print on sheet labels, or send the ZPL file to a Zebra printer (2 × 1 in labels)." onClose={onClose}
      footer={<><button className="btn ghost" onClick={dl}><Icon n="download" size={14} />Download ZPL</button><button className="btn primary" onClick={() => window.print()}><Icon n="print" size={14} />Print sheet</button></>}>
      <div className="labels printable">{list.map((s) => <div key={s.id} className="label"><Barcode value={s.id} height={34} /><div className="lid">{s.id}</div><div className="small ellip">{s.name}</div><div className="small muted">{s.tests.join(' + ')} · {fmtDate(s.receivedAt, false)} · {s.receivedBy}</div></div>)}</div>
    </Modal>
  );
}

// ---------- Comments with @mentions ----------
export function Comments({ state, s, dispatch }) {
  const [t, setT] = useState('');
  const [pick, setPick] = useState(null);
  const staff = state.users.filter((u) => !u.client && u.status === 'active');
  const onChange = (v) => { setT(v); const m = v.match(/@([\w]*)$/); setPick(m ? m[1].toLowerCase() : null); };
  const choose = (u) => { setT(t.replace(/@[\w]*$/, '@' + u.name.replace(/\s+/g, '') + ' ')); setPick(null); };
  const send = () => {
    const mentions = staff.filter((u) => t.includes('@' + u.name.replace(/\s+/g, ''))).map((u) => u.id);
    dispatch({ type: 'COMMENT', id: s.id, text: t.trim(), mentions }); setT('');
  };
  const render = (text) => text.split(/(@\w+)/g).map((p, k) => (p.startsWith('@') ? <b key={k} className="mention">{p}</b> : p));
  return (
    <div className="comments">
      {(s.comments || []).map((c, k) => <div key={k} className="note"><b>{c.name || c.by}</b> <span className="muted small">{fmtDate(c.at)}</span><p>{render(c.text)}</p></div>)}
      <div className="pop-wrap">
        <div className="row gap"><input className="grow" value={t} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && t.trim() && !pick && send()} placeholder="Add a note. Type @ to mention someone." /><button className="btn ghost sm" disabled={!t.trim()} onClick={send}>Post</button></div>
        {pick != null && <div className="menu-pop left">{staff.filter((u) => u.name.toLowerCase().replace(/\s+/g, '').includes(pick)).slice(0, 6).map((u) => <button key={u.id} onClick={() => choose(u)}>{u.name}</button>)}</div>}
      </div>
    </div>
  );
}

// ---------- Stage cycle times from the audit trail ----------
export function cycleTimes(state) {
  const by = {};
  state.audit.forEach((a) => { if (/^Moved to |^Sample received|Certificate of analysis signed/.test(a.action)) (by[a.entity] = by[a.entity] || []).push(a); });
  const sums = {};
  Object.values(by).forEach((ev) => {
    ev.sort((x, y) => (x.ts < y.ts ? -1 : 1));
    for (let k = 0; k < ev.length - 1; k++) {
      const from = ev[k].action === 'Sample received' ? 'Received' : ev[k].action.replace('Moved to ', '');
      const h = (new Date(ev[k + 1].ts) - new Date(ev[k].ts)) / 36e5;
      if (h >= 0 && h < 24 * 60) (sums[from] = sums[from] || []).push(h);
    }
  });
  return STAGES.slice(0, 6).map((st) => { const a = sums[st.label] || []; a.sort((x, y) => x - y); return [st.label, a.length ? a[Math.floor(a.length / 2)] : 0, a.length]; });
}

// ---------- Help ----------
export const SHORTCUTS = [['⌘K / Ctrl K', 'Search samples and run any command'], ['N', 'New intake'], ['S', 'Scan mode'], ['B', 'Lab board'], ['W', 'My work'], ['?', 'This help']];
export function HelpModal({ onClose }) {
  return (
    <Modal title="Quick help" onClose={onClose}>
      <h5>Keyboard shortcuts</h5>
      <dl className="kv">{SHORTCUTS.map(([k, d]) => <React.Fragment key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></React.Fragment>)}</dl>
      <h5>Getting around</h5>
      <p className="small"><b>Lab board</b>: drag samples between stages; each move checks that the step is complete. <b>Scan mode</b>: scan a label, press Enter to move it on. <b>My work</b>: what's assigned to you and what your role can act on, most urgent first. <b>Samples</b>: tick several rows to move, assign, label or export them together.</p>
      <p className="small muted">Anything you do is recorded in the audit trail with your name, role and time. If you move something by mistake, use Undo in the message at the bottom of the screen.</p>
    </Modal>
  );
}
