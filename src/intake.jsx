import React, { useState, useMemo } from 'react';
import { labCode } from './store.js';
import { METHODS, TEST_ORDER } from './config.js';
import { cx, Icon, TestChips, Field, fmtDate, Barcode } from './ui.jsx';
import { PhotoInput, PhotoGrid, filesToPhotos } from './photos.jsx';

const MATRICES = ['Lyophilized peptide', 'Fabrics', 'Waterproof Fabrics', 'Paper', 'Liquid Foundation', 'Powder Cosmetics', 'Waterproof Mascara', 'Lipstick', 'Non-Viscous Liquids', 'Coffee', 'Cocoa Powder', 'Cereal', 'Other'];
const PANELS = [
  { id: 'BPS', label: 'BPS', tests: ['BPS'] },
  { id: 'PFAS', label: 'PFAS', tests: ['PFAS'] },
  { id: 'BP', label: 'BPS + PFAS', tests: ['BPS', 'PFAS'] },
  { id: 'OTA', label: 'Ochratoxin A', tests: ['OTA'] },
  { id: 'PEP', label: 'Peptide purity and identity', tests: ['PEP'] },
];
const CARRIERS = ['Amazon Logistics', 'UPS', 'USPS', 'FedEx', 'DHL', 'OnTrac', 'Client drop-off'];
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeStr = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const blank = (keep = {}) => ({
  clientId: keep.clientId || 'artemis', panel: keep.panel || 'BPS', tests: keep.tests || ['BPS'],
  name: '', link: '', asin: '', matrix: keep.matrix || 'Fabrics', weight: '', bin: keep.bin || '',
  carrier: keep.carrier || 'Amazon Logistics', tracking: keep.tracking || '', shipped: keep.shipped || '', expected: keep.expected || '',
  recvDate: keep.recvDate || todayStr(), recvTime: timeStr(), condition: 'Good', prop65: false, rush: false, comment: '', photos: [],
});

export function nextLabId(samples, dateStr, tests) {
  const d = new Date(dateStr + 'T00:00');
  const key = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${labCode(tests)}`;
  const used = samples.filter((s) => s.id.startsWith(key) && /^\d+$/.test(s.id.slice(key.length))).map((s) => +s.id.slice(key.length));
  return `${key}${pad((used.length ? Math.max(...used) : 0) + 1)}`;
}

export function Intake({ state, dispatch, toast, openSample, prefill }) {
  const [f, setF] = useState(() => {
    if (!prefill) return blank();
    const p = PANELS.find((x) => x.tests.join() === prefill.tests.join());
    return { ...blank({ clientId: prefill.clientId, panel: p ? p.id : 'custom', tests: prefill.tests, carrier: prefill.carrier || 'Amazon Logistics', tracking: prefill.tracking, expected: prefill.expected }), name: prefill.name, link: prefill.link, asin: prefill.asin, matrix: prefill.tests.includes('PEP') ? 'Lyophilized peptide' : 'Fabrics', expectedId: prefill.id, orderRef: prefill.orderRef };
  });
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const client = state.clients.find((c) => c.id === f.clientId);
  const labId = useMemo(() => (f.tests.length ? nextLabId(state.samples, f.recvDate, f.tests) : '—'), [state.samples, f.recvDate, f.tests]);
  const bins = useMemo(() => [...new Set([...state.samples.map((s) => s.bin).filter(Boolean), 'Bin-B01', 'Bin-B02', 'Bin-B03', 'Bin-B04', 'Bin-P01', 'Bin-P02', 'Bin-P03', 'Bin-P04', 'Bin-A01'])].sort(), [state.samples]);
  const dup = f.asin && state.samples.find((s) => s.asin === f.asin && s.clientId === f.clientId);
  const binHint = `Bin-${METHODS[f.tests[0] || 'BPS'].letter}01`;

  const onLink = (link) => {
    const m = link.match(/\/dp\/([A-Z0-9]{10})/i);
    set({ link, ...(m && !f.asin ? { asin: m[1].toUpperCase() } : {}) });
  };
  const setPanel = (id) => { const p = PANELS.find((x) => x.id === id); set({ panel: id, tests: p.tests }); };
  const toggleTest = (t) => {
    const tests = f.tests.includes(t) ? f.tests.filter((x) => x !== t) : TEST_ORDER.filter((x) => x === t || f.tests.includes(x));
    const p = PANELS.find((x) => x.tests.join() === tests.join());
    set({ tests, panel: p ? p.id : 'custom' });
  };
  const addPhotos = async (files) => {
    setErr(''); setBusy(true);
    try { const ph = await filesToPhotos(files, state.session.initials, 'Receipt'); set({ photos: [...f.photos, ...ph] }); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const missing = [!f.name.trim() && 'product name', !f.tests.length && 'at least one test', !f.photos.length && 'at least one photo'].filter(Boolean);

  const register = () => {
    const receivedAt = `${f.recvDate}T${f.recvTime}`;
    const s = {
      id: labId, name: f.name.trim(), asin: f.asin.trim() || null, link: f.link.trim() || (f.asin ? 'www.amazon.com/dp/' + f.asin.trim() : null),
      matrix: f.matrix, tests: f.tests, clientId: f.clientId, receivedAt, receivedBy: state.session.initials, expectedAt: f.expected || null, shippedAt: f.shipped || null,
      carrier: f.carrier, tracking: f.tracking.trim() || null, weight: f.weight === '' ? null : +f.weight, bin: f.bin || null, condition: f.condition,
      stage: 'received', rush: f.rush, comments: f.comment.trim() ? [{ at: receivedAt, by: state.session.initials, text: f.comment.trim() }] : [],
      prop65: f.prop65 ? { status: 'pending', note: 'Prop 65 warning on packaging.' } : null,
      hold: f.prop65 ? { reason: 'Prop 65 warning label. Awaiting client decision.', by: state.session.initials, at: receivedAt } : f.condition === 'Wrong item' ? { reason: 'Item does not match the order. Awaiting client instruction.', by: state.session.initials, at: receivedAt } : null,
      photos: f.photos, expectedId: f.expectedId || null, prepBatch: null, subsampleMass: null, disposed: null,
    };
    dispatch({ type: 'INTAKE', samples: [s] });
    setDone(s);
    toast(`${s.id} registered${s.photos.length ? ` with ${s.photos.length} photo${s.photos.length > 1 ? 's' : ''}` : ''}`);
    window.scrollTo(0, 0);
  };
  const next = () => { setF(blank({ ...f })); setDone(null); };

  if (done) {
    return (
      <div className="page">
        <div className="panel done">
          <div className="done-head">
            <span className="okmark y big"><Icon n="check" size={18} /></span>
            <div><h3>{done.id} registered</h3><p className="muted small">{done.name}</p></div>
            <div className="row gap push wrap">
              <button className="btn ghost" onClick={() => window.print()}><Icon n="print" size={14} />Print label and COC</button>
              <button className="btn ghost" onClick={() => openSample(done.id)}>Open sample</button>
              <button className="btn primary" onClick={next}><Icon n="plus" size={14} />Register next sample</button>
            </div>
          </div>
          <p className="muted small">"Register next sample" keeps the client, panel, carrier, tracking number and dates so you can work through a shipment quickly.</p>
          <div className="labels printable">
            <div className="label"><Barcode value={done.id} height={34} /><div className="lid">{done.id}</div><div className="small ellip">{done.name}</div><div className="small muted">{done.tests.join(' + ')} · {fmtDate(done.receivedAt, false)} · {done.receivedBy}</div></div>
          </div>
          <PhotoGrid photos={done.photos} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="intake">
        <div className="intake-main">
          <section className="panel">
            <h4>Client and sample</h4>
            {f.expectedId && <div className="callout ok"><Icon n="box" /><div>Receiving from order <b>{f.orderRef}</b>. Details were filled from the client's order list; check them against the package.</div></div>}
            <div className="fg2">
              <Field label="Client *"><select value={f.clientId} onChange={(e) => set({ clientId: e.target.value })}>{state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Test panel *"><select value={f.panel} onChange={(e) => setPanel(e.target.value)}>{PANELS.map((p) => <option key={p.id} value={p.id}>{p.label} · prefix {labCode(p.tests)}</option>)}{f.panel === 'custom' && <option value="custom">Custom · prefix {labCode(f.tests)}</option>}</select></Field>
            </div>
            <Field label="Product name *"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="As listed on the order" /></Field>
            <Field label="Product link"><input value={f.link} onChange={(e) => onLink(e.target.value)} placeholder="https://www.amazon.com/dp/…" /></Field>
            <div className="fg3">
              <Field label="ASIN"><input value={f.asin} onChange={(e) => set({ asin: e.target.value.toUpperCase() })} placeholder="Filled from the link" /></Field>
              <Field label="Matrix"><select value={f.matrix} onChange={(e) => set({ matrix: e.target.value })}>{MATRICES.map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Weight"><div className="suffix"><input type="number" step="0.01" value={f.weight} onChange={(e) => set({ weight: e.target.value })} /><span>g</span></div></Field>
            </div>
            {dup && <div className="callout warn"><Icon n="alert" /><div>This ASIN was already received for {client.name} as <button className="link" onClick={() => openSample(dup.id)}>{dup.id}</button> on {fmtDate(dup.receivedAt, false)}. Confirm with the client before testing a duplicate.</div></div>}
            <div className="fg2">
              <Field label="Storage bin"><input list="bins" value={f.bin} onChange={(e) => set({ bin: e.target.value })} placeholder={binHint} /><datalist id="bins">{bins.map((b) => <option key={b} value={b} />)}</datalist></Field>
              <div className="checks-inline">
                <label className="check"><input type="checkbox" checked={f.prop65} onChange={(e) => set({ prop65: e.target.checked })} /> Prop 65 warning on packaging (hold until the client decides)</label>
                <label className="check"><input type="checkbox" checked={f.rush} onChange={(e) => set({ rush: e.target.checked })} /> Rush</label>
              </div>
            </div>
          </section>

          <section className="panel">
            <h4>Tests ordered <span className="muted small">Pre-checked from the panel. Uncheck to opt out.</span></h4>
            <div className="testopts">
              {TEST_ORDER.map((t) => {
                const m = state.methods[t];
                return (
                  <label key={t} className={cx('testopt', f.tests.includes(t) && 'on')}>
                    <input type="checkbox" checked={f.tests.includes(t)} onChange={() => toggleTest(t)} />
                    <div><b>{t}-LCMS</b><span>{m.name} by {m.technique} · {m.sop} rev {m.rev} · {m.analytes.length} analyte{m.analytes.length > 1 ? 's' : ''}</span></div>
                    <TestChips tests={[t]} small />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <h4>Logistics</h4>
            <div className="fg2">
              <Field label="Carrier"><select value={f.carrier} onChange={(e) => set({ carrier: e.target.value })}>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Tracking #"><input value={f.tracking} onChange={(e) => set({ tracking: e.target.value })} placeholder="TBA…" /></Field>
            </div>
            <div className="fg3">
              <Field label="Shipped"><input type="date" value={f.shipped} onChange={(e) => set({ shipped: e.target.value })} /></Field>
              <Field label="Expected"><input type="date" value={f.expected} onChange={(e) => set({ expected: e.target.value })} /></Field>
              <Field label="Received"><input type="date" value={f.recvDate} onChange={(e) => set({ recvDate: e.target.value })} /></Field>
            </div>
            <div className="fg2">
              <Field label="Received time"><input type="time" value={f.recvTime} onChange={(e) => set({ recvTime: e.target.value })} /></Field>
              <Field label="Condition"><select value={f.condition} onChange={(e) => set({ condition: e.target.value })}>{['Good', 'Damaged packaging', 'Opened', 'Leaking', 'Wrong item'].map((c) => <option key={c}>{c}</option>)}</select></Field>
            </div>
          </section>

          <section className="panel">
            <h4>Photos and comments <span className="muted small">At least one photo is required: the package as received, showing the shipping label.</span></h4>
            <PhotoInput onAdd={addPhotos} />
            {busy && <p className="muted small">Processing photos…</p>}
            {err && <p className="err">{err}</p>}
            <PhotoGrid photos={f.photos} onRemove={(id) => set({ photos: f.photos.filter((p) => p.id !== id) })} onCaption={(id, caption) => set({ photos: f.photos.map((p) => (p.id === id ? { ...p, caption } : p)) })} />
            <textarea rows={3} value={f.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Sample condition, special handling, client correspondence…" />
          </section>
        </div>

        <aside className="intake-side">
          <div className="idcard">
            <div className="lid">{labId}</div>
            <p>{labCode(f.tests) || '—'} = {f.tests.map((t) => state.methods[t].short).join(' + ') || 'no test'} · {labId.slice(0, 6)} = received date · {labId.slice(-2)} = today's sequence</p>
          </div>
          <div className="side-sec">
            <h6>Submission</h6>
            <div className="subm"><span className="tag">{client.name.slice(0, 3).toUpperCase()}</span><b>{client.name}</b></div>
            <p className="small ellip2">{f.name || <span className="muted">No product name yet</span>}</p>
            {f.asin && <p className="small muted">ASIN {f.asin}</p>}
          </div>
          <div className="side-sec">
            <h6>Tests ordered ({f.tests.length})</h6>
            {f.tests.map((t) => <p key={t} className="small"><Icon n="check" size={12} /> <b>{t}-LCMS</b> <span className="muted">{state.methods[t].name}</span></p>)}
          </div>
          <div className="side-sec">
            <h6>Receipt</h6>
            <dl className="kv tight"><dt>Carrier</dt><dd>{f.carrier}</dd><dt>Received</dt><dd>{fmtDate(`${f.recvDate}T${f.recvTime}`)}</dd><dt>Condition</dt><dd><span className={cx('pill', f.condition === 'Good' ? 'ok' : 'warn')}>{f.condition}</span></dd><dt>Photos</dt><dd>{f.photos.length ? f.photos.length : <span className="miss">Required</span>}</dd><dt>Received by</dt><dd>{state.session.name}</dd></dl>
            {(f.prop65 || f.condition === 'Wrong item') && <p className="small warn-txt"><Icon n="pause" size={12} /> Will be placed on hold at registration.</p>}
          </div>
          <button className="btn primary block" disabled={!!missing.length || busy} onClick={register}>Register sample</button>
          {missing.length > 0 && <p className="muted small center">Add {missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing.slice(-1) : missing[0]} to register.</p>}
        </aside>
      </div>
    </div>
  );
}
