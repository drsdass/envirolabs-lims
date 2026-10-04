import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { STAGES, labCode } from './store.js';
import { TEST_ORDER } from './config.js';
import { cx, Icon, TestChips, Modal, Field, fmtDate, daysSince, Empty, ago, sig } from './ui.jsx';
import { cycleTimes } from './prod.jsx';
import { useFilters, FilterBar, usePaged } from './filters.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const csvDl = (name, rows) => { const b = new Blob([rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); };
const money = (n) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- order list parsing (also reads the TotalProducts sheet of the tracking workbook) ----------
export async function parseOrderList(file, clientId, by) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = wb.SheetNames.find((n) => /order|total|product/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  const pick = (r, ...keys) => { for (const k of Object.keys(r)) { const kk = k.replace(/\s+/g, ' ').trim().toLowerCase(); if (keys.some((x) => kk === x || kk.startsWith(x))) return r[k]; } return ''; };
  const ref = 'ORDER-' + new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return rows.map((r, i) => {
    const name = String(pick(r, 'product name', 'product', 'item', 'description')).trim();
    if (!name) return null;
    const chem = String(pick(r, 'test', 'anticipated chemical', 'analysis')).toUpperCase();
    const tests = TEST_ORDER.filter((t) => chem.includes(t) || (t === 'PEP' && /PEPTIDE|PURITY/.test(chem)));
    let exp = pick(r, 'expected delivery date', 'expected', 'delivery');
    exp = exp instanceof Date ? exp.toISOString().slice(0, 10) : String(exp).slice(0, 10);
    const link = String(pick(r, 'link to product', 'link', 'url')).trim();
    const asin = String(pick(r, 'asin')).trim() || (link.match(/\/dp\/([A-Z0-9]{10})/i) || [])[1] || '';
    return { id: 'EX' + Date.now() + i, clientId, orderRef: String(pick(r, 'order', 'po')).trim() || ref, name, link, asin: asin.startsWith('#') ? '' : asin.toUpperCase(), tests: tests.length ? tests : ['BPS'], carrier: String(pick(r, 'carrier name', 'carrier')).trim(), tracking: String(pick(r, 'tracking number', 'tracking')).trim(), expected: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : '', status: 'awaiting', createdBy: by, createdAt: today() };
  }).filter(Boolean);
}
export function orderTemplate() {
  csvDl('order_list_template.csv', [['Order', 'Product Name', 'Link to Product', 'ASIN', 'Test', 'Carrier Name', 'Tracking Number', 'Expected Delivery Date'], ['PO-1050', 'Example rain jacket, size M', 'https://www.amazon.com/dp/B000000000', 'B000000000', 'PFAS', 'Amazon Logistics', 'TBA000000000000', today()]]);
}

// ---------- Expected shipments ----------
export function Shipments({ state, dispatch, toast, go, clientOnly }) {
  const [tab, setTab] = useState('awaiting');
  const [clientId, setClientId] = useState(clientOnly || 'artemis');
  const [err, setErr] = useState('');
  const [add, setAdd] = useState(null);
  const file = useRef(null);
  const all = state.expected.filter((x) => !clientOnly || x.clientId === clientOnly);
  const late = (x) => x.status === 'awaiting' && x.expected && x.expected < today();
  const cfg = useMemo(() => ({ text: (x) => `${x.name} ${x.asin} ${x.tracking} ${x.orderRef} ${x.labId || ''}`, facets: [{ key: 'client', label: 'Client', get: (x) => state.clients.find((c) => c.id === x.clientId)?.name }, { key: 'carrier', label: 'Carrier', get: (x) => x.carrier || 'Not given' }, { key: 'test', label: 'Test', get: (x) => x.tests }, { key: 'order', label: 'Order', get: (x) => x.orderRef }], flags: [], date: { label: 'Expected', get: (x) => x.expected } }), [state.clients]);
  const ctl = useFilters('shipments' + (clientOnly || ''), all, cfg);
  const list = ctl.filtered;
  const groups = {};
  list.filter((x) => (tab === 'awaiting' ? x.status === 'awaiting' : tab === 'late' ? late(x) : x.status !== 'awaiting')).forEach((x) => { const k = x.tracking || 'No tracking · ' + x.orderRef; (groups[k] = groups[k] || []).push(x); });
  const upload = async (f) => {
    setErr('');
    try { const items = await parseOrderList(f, clientId, state.session.name); if (!items.length) throw new Error('No rows with a product name were found.'); dispatch({ type: 'ADD_EXPECTED', items }); toast(`${items.length} expected item${items.length > 1 ? 's' : ''} added`); setTab('awaiting'); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="page">
      <div className="mini-tiles four">
        <div className="mini-tile"><span>Awaiting arrival</span><b>{list.filter((x) => x.status === 'awaiting').length}</b><small>items on order lists</small></div>
        <div className={cx('mini-tile', list.some(late) && 'bad-tile')}><span>Late</span><b>{list.filter(late).length}</b><small>past expected delivery</small></div>
        <div className="mini-tile"><span>Due today</span><b>{list.filter((x) => x.status === 'awaiting' && x.expected === today()).length}</b><small>expected today</small></div>
        <div className="mini-tile"><span>Received</span><b>{list.filter((x) => x.status === 'received').length}</b><small>matched to lab IDs</small></div>
      </div>
      <div className="panel">
        <div className="row between wrap gap">
          <h4 className="m0">{clientOnly ? 'Send us your order list' : 'Add an order list'} <span className="muted small">CSV or Excel. The tracking workbook's TotalProducts layout works as-is.</span></h4>
          <div className="row gap wrap">
            {!clientOnly && <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">{state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            <button className="btn ghost sm" onClick={orderTemplate}><Icon n="download" size={13} />Template</button>
            <button className="btn ghost sm" onClick={() => setAdd({ name: '', link: '', asin: '', tests: ['BPS'], carrier: 'Amazon Logistics', tracking: '', expected: today(), orderRef: '' })}><Icon n="plus" size={13} />Add one item</button>
            <button className="btn primary sm" onClick={() => file.current.click()}><Icon n="upload" size={13} />Upload list</button>
          </div>
        </div>
        <input ref={file} type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => { e.target.files[0] && upload(e.target.files[0]); e.target.value = ''; }} />
        {err && <p className="err">{err}</p>}
      </div>
      <FilterBar ctl={ctl} state={clientOnly ? null : state} dispatch={dispatch} toast={toast} placeholder="Search product, ASIN, tracking, order, lab ID" />
      <div className="tabs">{[['awaiting', 'Awaiting'], ['late', 'Late'], ['done', 'Received / cancelled']].map(([k, l]) => <button key={k} className={cx('tab', tab === k && 'on')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {Object.keys(groups).length ? Object.entries(groups).map(([trk, items]) => (
        <div key={trk} className="panel ship">
          <div className="row gap wrap ship-head"><Icon n="box" /><b className="lid">{trk}</b><span className="muted small">{items[0].carrier || 'Carrier not given'} · {state.clients.find((c) => c.id === items[0].clientId)?.name} · {items[0].orderRef}</span><span className={cx('pill push', late(items[0]) ? 'fail' : items[0].status === 'received' ? 'ok' : 'warn')}>{items[0].status === 'received' ? 'Received' : items[0].status === 'cancelled' ? 'Cancelled' : late(items[0]) ? `Late · expected ${fmtDate(items[0].expected, false)}` : `Expected ${fmtDate(items[0].expected, false)}`}</span></div>
          {items.map((x) => (
            <div key={x.id} className="ship-row">
              <TestChips tests={x.tests} small /><span className="ellip">{x.name}</span>{x.asin && <span className="muted small">{x.asin}</span>}
              {x.status === 'received' ? <button className="link small" onClick={() => go('sample', x.labId)}>{x.labId}</button>
                : x.status === 'cancelled' ? <span className="muted small">Cancelled</span>
                : !clientOnly ? <><button className="btn primary sm" onClick={() => go('intake', x.id)}>Receive</button><button className="link small" onClick={() => dispatch({ type: 'UPDATE_EXPECTED', id: x.id, patch: { status: 'cancelled' } })}>Cancel</button></> : <span className="muted small">Awaiting</span>}
            </div>
          ))}
        </div>
      )) : <div className="panel"><Empty icon="box" title="Nothing here">Upload an order list to see items before they arrive.</Empty></div>}
      {add && (
        <Modal title="Add expected item" onClose={() => setAdd(null)} footer={<><button className="btn ghost" onClick={() => setAdd(null)}>Cancel</button><button className="btn primary" disabled={!add.name.trim()} onClick={() => { dispatch({ type: 'ADD_EXPECTED', items: [{ ...add, id: 'EX' + Date.now(), clientId, status: 'awaiting', createdBy: state.session.name, createdAt: today(), orderRef: add.orderRef || 'Manual' }] }); setAdd(null); toast('Item added'); }}>Add</button></>}>
          <Field label="Product name"><input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <Field label="Product link"><input value={add.link} onChange={(e) => { const m = e.target.value.match(/\/dp\/([A-Z0-9]{10})/i); setAdd({ ...add, link: e.target.value, asin: m ? m[1].toUpperCase() : add.asin }); }} /></Field>
          <div className="fg2"><Field label="Order / PO"><input value={add.orderRef} onChange={(e) => setAdd({ ...add, orderRef: e.target.value })} /></Field><Field label="Tests"><div className="seg">{TEST_ORDER.map((t) => <button key={t} type="button" className={cx(add.tests.includes(t) && 'on', 't-' + state.methods[t].color)} onClick={() => setAdd({ ...add, tests: add.tests.includes(t) ? add.tests.filter((x) => x !== t) : [...add.tests, t] })}>{t}</button>)}</div></Field></div>
          <div className="fg3"><Field label="Carrier"><input value={add.carrier} onChange={(e) => setAdd({ ...add, carrier: e.target.value })} /></Field><Field label="Tracking #"><input value={add.tracking} onChange={(e) => setAdd({ ...add, tracking: e.target.value })} /></Field><Field label="Expected"><input type="date" value={add.expected} onChange={(e) => setAdd({ ...add, expected: e.target.value })} /></Field></div>
        </Modal>
      )}
    </div>
  );
}

// ---------- Inventory ----------
export function Inventory({ state, dispatch, toast }) {
  const [add, setAdd] = useState(null);
  const status = (x) => (x.expires < today() ? ['Expired', 'fail'] : x.expires < new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? ['Expires soon', 'warn'] : ['In date', 'ok']);
  const used = (id) => state.samples.filter((s) => s.stdLots?.includes(id)).length;
  const cfg = useMemo(() => ({ text: (x) => `${x.id} ${x.name} ${x.lot} ${x.vendor} ${x.location}`, facets: [{ key: 'type', label: 'Type', get: (x) => x.type }, { key: 'method', label: 'Method', get: (x) => x.methods }, { key: 'status', label: 'Status', get: (x) => status(x)[0] }, { key: 'loc', label: 'Location', get: (x) => x.location }], flags: [{ key: 'soon', label: 'Expiring / expired', test: (x) => status(x)[1] !== 'ok' }], date: { label: 'Expires', get: (x) => x.expires } }), []);
  const ctl = useFilters('inventory', state.inventory, cfg);
  return (
    <div className="page">
      <FilterBar ctl={ctl} state={state} dispatch={dispatch} toast={toast} placeholder="Search material, lot, vendor, location" />
      <div className="row between wrap"><p className="muted small m0">Every in-date standard and surrogate lot is recorded on each sample when it goes to the instrument. Expired lots block that step.</p><button className="btn primary" onClick={() => setAdd({ type: 'Calibration standard', name: '', methods: ['BPS'], role: 'native', vendor: '', lot: '', received: today(), opened: '', expires: '', location: '', qty: '' })}><Icon n="plus" size={14} />Add lot</button></div>
      <div className="panel flush">
        <table className="tbl"><thead><tr><th>ID</th><th>Material</th><th>Methods</th><th>Lot</th><th>Opened</th><th>Expires</th><th>Location</th><th className="num">Used on</th><th>Status</th></tr></thead>
          <tbody>{ctl.filtered.map((x) => { const [l, t] = status(x); return <tr key={x.id}><td className="lid">{x.id}</td><td>{x.name}<div className="muted small">{x.type} · {x.vendor} · {x.qty}</div></td><td><TestChips tests={x.methods} small /></td><td>{x.lot}</td><td className="muted">{fmtDate(x.opened, false)}</td><td className={t === 'fail' ? 'bad' : ''}>{fmtDate(x.expires, false)}</td><td className="small">{x.location}</td><td className="num">{used(x.id) || '—'}</td><td><span className={'pill ' + t}>{l}</span></td></tr>; })}</tbody></table>
      </div>
      {add && (
        <Modal title="Add standard or reagent lot" onClose={() => setAdd(null)} footer={<><button className="btn ghost" onClick={() => setAdd(null)}>Cancel</button><button className="btn primary" disabled={!add.name || !add.lot || !add.expires} onClick={() => { const id = (add.role === 'reagent' ? 'RG-' : 'STD-') + String(500 + state.inventory.length); dispatch({ type: 'ADD_ROW', coll: 'inventory', row: { ...add, id }, action: 'Inventory lot added', entity: id, detail: `${add.name} lot ${add.lot}, expires ${add.expires}` }); setAdd(null); toast(id + ' added'); }}>Add lot</button></>}>
          <div className="fg2"><Field label="Type"><select value={add.type} onChange={(e) => { const t = e.target.value; setAdd({ ...add, type: t, role: { 'Calibration standard': 'native', Surrogate: 'surrogate', 'Internal standard': 'istd', Reagent: 'reagent' }[t] }); }}>{['Calibration standard', 'Surrogate', 'Internal standard', 'Reagent'].map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="Methods"><div className="seg">{TEST_ORDER.map((t) => <button key={t} type="button" className={cx(add.methods.includes(t) && 'on', 't-' + state.methods[t].color)} onClick={() => setAdd({ ...add, methods: add.methods.includes(t) ? add.methods.filter((x) => x !== t) : [...add.methods, t] })}>{t}</button>)}</div></Field></div>
          <Field label="Material"><input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <div className="fg3"><Field label="Vendor"><input value={add.vendor} onChange={(e) => setAdd({ ...add, vendor: e.target.value })} /></Field><Field label="Lot"><input value={add.lot} onChange={(e) => setAdd({ ...add, lot: e.target.value })} /></Field><Field label="Quantity"><input value={add.qty} onChange={(e) => setAdd({ ...add, qty: e.target.value })} /></Field></div>
          <div className="fg3"><Field label="Received"><input type="date" value={add.received} onChange={(e) => setAdd({ ...add, received: e.target.value })} /></Field><Field label="Opened"><input type="date" value={add.opened} onChange={(e) => setAdd({ ...add, opened: e.target.value })} /></Field><Field label="Expires"><input type="date" value={add.expires} onChange={(e) => setAdd({ ...add, expires: e.target.value })} /></Field></div>
          <Field label="Location"><input value={add.location} onChange={(e) => setAdd({ ...add, location: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

// ---------- Billing ----------
export function Billing({ state, dispatch, toast }) {
  const [view, setView] = useState(null);
  const invoiced = new Set(state.invoices.flatMap((i) => i.lines.map((l) => l.sampleId)));
  const lineFor = (s) => {
    const r = state.reports[s.id]; const at = r?.[r.length - 1].at;
    const items = s.tests.map((t) => ({ test: t, price: state.methods[t].price }));
    const sub = items.reduce((n, x) => n + x.price, 0);
    const rush = s.rush ? Math.round(sub * state.pricing.rushPct) / 100 : 0;
    return { sampleId: s.id, product: s.name, tests: s.tests, items, rush, amount: sub + rush, reported: at };
  };
  const unbilled = state.samples.filter((s) => !s.legacy && s.stage === 'reported' && state.reports[s.id] && !invoiced.has(s.id));
  const groups = {};
  unbilled.forEach((s) => { const at = state.reports[s.id].slice(-1)[0].at.slice(0, 7); const k = s.clientId + '|' + at; (groups[k] = groups[k] || []).push(lineFor(s)); });
  const create = (k, lines) => {
    const [clientId, period] = k.split('|');
    const no = `INV-${new Date().getFullYear()}-${String(state.invoices.length + 1).padStart(4, '0')}`;
    const inv = { id: no, clientId, period, date: today(), due: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), lines, total: lines.reduce((n, l) => n + l.amount, 0), status: 'Draft' };
    dispatch({ type: 'ADD_ROW', coll: 'invoices', row: inv, action: 'Invoice created', entity: no, detail: `${lines.length} samples, ${money(inv.total)}` });
    toast(`${no} created`); setView(no);
  };
  const qbo = () => csvDl('quickbooks_invoices.csv', [['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount'], ...state.invoices.flatMap((i) => i.lines.flatMap((l) => [...l.items.map((x) => [i.id, state.clients.find((c) => c.id === i.clientId).name, i.date, i.due, `${x.test} analysis`, `${l.sampleId} ${l.product.slice(0, 80)}`, 1, x.price, x.price]), ...(l.rush ? [[i.id, state.clients.find((c) => c.id === i.clientId).name, i.date, i.due, 'Rush surcharge', l.sampleId, 1, l.rush, l.rush]] : [])]))]);
  const inv = state.invoices.find((i) => i.id === view);
  const icfg = useMemo(() => ({ text: (i) => `${i.id} ${i.lines.map((l) => l.sampleId).join(' ')}`, facets: [{ key: 'client', label: 'Client', get: (i) => state.clients.find((c) => c.id === i.clientId)?.name }, { key: 'status', label: 'Status', get: (i) => i.status }, { key: 'period', label: 'Period', get: (i) => i.period }], flags: [{ key: 'unpaid', label: 'Unpaid', test: (i) => i.status !== 'Paid' }, { key: 'overdue', label: 'Past due', test: (i) => i.status !== 'Paid' && i.due < today() }], date: { label: 'Invoice date', get: (i) => i.date } }), [state.clients]);
  const ictl = useFilters('invoices', state.invoices, icfg);
  return (
    <div className="page">
      <div className="grid2">
        <div className="panel">
          <h4>Price list</h4>
          <table className="tbl compact"><tbody>{TEST_ORDER.map((t) => <tr key={t}><td><TestChips tests={[t]} small /> {state.methods[t].name}</td><td className="num"><input className="price" type="number" value={state.methods[t].price} onChange={(e) => dispatch({ type: 'METHOD_PRICE', code: t, price: +e.target.value })} aria-label={t + ' price'} /></td></tr>)}<tr><td>Rush surcharge</td><td className="num">{state.pricing.rushPct}%</td></tr></tbody></table>
          <p className="muted small">Placeholder prices. Enter your real rates; client-specific pricing can be added per contract.</p>
        </div>
        <div className="panel">
          <h4>Ready to invoice</h4>
          {Object.keys(groups).length ? Object.entries(groups).map(([k, lines]) => { const [c, p] = k.split('|'); return <div key={k} className="rowbtn static"><b>{state.clients.find((x) => x.id === c).name}</b><span className="muted small">{p} · {lines.length} certificates · {money(lines.reduce((n, l) => n + l.amount, 0))}</span><button className="btn primary sm push" onClick={() => create(k, lines)}>Create invoice</button></div>; }) : <Empty icon="check" title="Everything reported has been invoiced" />}
        </div>
      </div>
      <div className="panel flush">
        <div className="pad"><FilterBar ctl={ictl} state={state} dispatch={dispatch} toast={toast} placeholder="Search invoice number or lab ID" compact /></div>
        <div className="row between pad"><h4 className="m0">Invoices</h4><button className="btn ghost sm" disabled={!state.invoices.length} onClick={qbo}><Icon n="download" size={13} />QuickBooks export</button></div>
        <table className="tbl"><thead><tr><th>Invoice</th><th>Client</th><th>Period</th><th className="num">Samples</th><th className="num">Total</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>{ictl.filtered.map((i) => <tr key={i.id} className="click" onClick={() => setView(i.id)}><td className="lid">{i.id}</td><td>{state.clients.find((c) => c.id === i.clientId).name}</td><td>{i.period}</td><td className="num">{i.lines.length}</td><td className="num">{money(i.total)}</td><td>{fmtDate(i.due, false)}</td><td><span className={cx('pill', i.status === 'Paid' ? 'ok' : i.status === 'Sent' ? 'flag' : '')}>{i.status}</span></td></tr>)}</tbody></table>
        {!state.invoices.length && <Empty icon="doc" title="No invoices yet">Create one from "Ready to invoice".</Empty>}
      </div>
      {inv && (
        <Modal wide title={inv.id} sub={`${state.clients.find((c) => c.id === inv.clientId).name} · ${inv.period}`} onClose={() => setView(null)}
          footer={<><button className="btn ghost" onClick={() => window.print()}><Icon n="print" size={14} />Print</button>{inv.status === 'Draft' && <button className="btn primary" onClick={() => { dispatch({ type: 'PATCH_ROW', coll: 'invoices', id: inv.id, patch: { status: 'Sent' }, action: 'Invoice sent' }); toast('Marked as sent'); }}>Mark sent</button>}{inv.status === 'Sent' && <button className="btn primary" onClick={() => { dispatch({ type: 'PATCH_ROW', coll: 'invoices', id: inv.id, patch: { status: 'Paid' }, action: 'Invoice paid' }); toast('Marked as paid'); }}>Mark paid</button>}</>}>
          <table className="tbl compact"><thead><tr><th>Lab ID</th><th>Product</th><th>Tests</th><th className="num">Amount</th></tr></thead>
            <tbody>{inv.lines.map((l) => <tr key={l.sampleId}><td className="lid">{l.sampleId}</td><td className="ellip-cell">{l.product}</td><td>{l.items.map((x) => `${x.test} ${money(x.price)}`).join(' + ')}{l.rush ? ` + rush ${money(l.rush)}` : ''}</td><td className="num">{money(l.amount)}</td></tr>)}<tr><td colSpan={3}><b>Total</b></td><td className="num"><b>{money(inv.total)}</b></td></tr></tbody></table>
        </Modal>
      )}
    </div>
  );
}

// ---------- Analytics ----------
const Bars = ({ data, fmt = (v) => v, max, color }) => {
  const m = max || Math.max(1, ...data.map((d) => d[1]));
  return <div className="hbars">{data.map(([l, v, sub]) => <div key={l} className="hbar"><span className="hl" title={l}>{l}</span><span className="ht"><i style={{ width: `${(v / m) * 100}%`, background: color }} /></span><span className="hv">{fmt(v)}{sub && <small> {sub}</small>}</span></div>)}</div>;
};
export function Analytics({ state }) {
  const [test, setTest] = useState('BPS');
  const data = useMemo(() => {
    const all = state.samples;
    const months = {};
    all.forEach((s) => { if (s.receivedAt < '2024') return; const k = s.receivedAt.slice(0, 7); months[k] = months[k] || { BPS: 0, PFAS: 0, other: 0 }; s.tests.forEach((t) => (months[k][t] != null ? months[k][t]++ : months[k].other++)); });
    const byTech = {};
    all.forEach((s) => { const k = String(s.receivedBy || '').trim().toUpperCase(); if (k && k !== '—') byTech[k] = (byTech[k] || 0) + 1; });
    const det = {}, an = {}, tat = [];
    all.forEach((s) => {
      const r = state.results[s.id]; if (!r) return;
      Object.entries(r).forEach(([t, x]) => {
        const hit = x.analytes.some((a) => a.value != null);
        const k = t + '|' + s.matrix; det[k] = det[k] || [0, 0]; det[k][1]++; if (hit) det[k][0]++;
        x.analytes.forEach((a) => { const kk = t + '|' + a.name; an[kk] = an[kk] || [0, 0]; an[kk][1]++; if (a.value != null) an[kk][0]++; });
        if (x.acq && s.receivedAt) { const d = (new Date(x.acq) - new Date(s.receivedAt)) / 864e5; if (d >= 0 && d < 120) tat.push(d); }
      });
    });
    tat.sort((a, b) => a - b);
    return { months, byTech, det, an, tat };
  }, [state.samples, state.results]);
  const med = data.tat.length ? data.tat[Math.floor(data.tat.length / 2)] : 0;
  const p90 = data.tat.length ? data.tat[Math.floor(data.tat.length * 0.9)] : 0;
  const tested = Object.entries(data.det).filter(([k]) => k.startsWith(test + '|'));
  const totalT = tested.reduce((n, [, v]) => n + v[1], 0), hitT = tested.reduce((n, [, v]) => n + v[0], 0);
  const months = Object.entries(data.months).sort().slice(-14);
  const mMax = Math.max(...months.map(([, v]) => v.BPS + v.PFAS + v.other));
  const bins = [0, 3, 7, 10, 14, 21, 30, 60];
  const hist = bins.map((b, i) => [i < bins.length - 1 ? `${b}–${bins[i + 1]} d` : `${b}+ d`, data.tat.filter((d) => d >= b && (i === bins.length - 1 || d < bins[i + 1])).length]);
  return (
    <div className="page">
      <div className="mini-tiles four">
        <div className="mini-tile"><span>Samples on record</span><b>{state.samples.length.toLocaleString()}</b><small>since {fmtDate(state.samples.map((s) => s.receivedAt).filter((d) => d >= '2024').sort()[0], false)}</small></div>
        <div className="mini-tile"><span>Samples with results</span><b>{Object.keys(state.results).length.toLocaleString()}</b><small>instrument data on file</small></div>
        <div className="mini-tile"><span>Receipt to analysis</span><b>{med.toFixed(1)} d</b><small>median · 90% within {p90.toFixed(0)} d</small></div>
        <div className="mini-tile"><span>{test} detection rate</span><b>{totalT ? Math.round((hitT / totalT) * 100) : 0}%</b><small>{hitT} of {totalT} samples ≥ MRL</small></div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h4>Samples received per month</h4>
          <div className="vbars" role="img" aria-label="Samples per month">{months.map(([m, v]) => <div key={m} className="vb" title={`${m}: BPS ${v.BPS}, PFAS ${v.PFAS}${v.other ? ', other ' + v.other : ''}`}><div className="vstack" style={{ height: `${((v.BPS + v.PFAS + v.other) / mMax) * 100}%` }}><i className="bps" style={{ flex: v.BPS }} /><i className="pfas" style={{ flex: v.PFAS }} /><i className="oth" style={{ flex: v.other }} /></div><em>{m.slice(2).replace('-', '/')}</em></div>)}</div>
          <div className="legend"><span><i className="bdot lg-bps" />BPS</span><span><i className="bdot lg-pfas" />PFAS</span><span><i className="bdot lg-oth" />Other</span></div>
        </div>
        <div className="panel">
          <h4>Receipt to analysis (days)</h4>
          <Bars data={hist} />
          <p className="muted small">From receipt to instrument acquisition, across {data.tat.length} test results.</p>
        </div>
        <div className="panel">
          <div className="row between"><h4>Detection rate by sample type</h4><div className="seg">{['BPS', 'PFAS'].map((t) => <button key={t} className={cx(test === t && 'on', 't-' + state.methods[t].color)} onClick={() => setTest(t)}>{t}</button>)}</div></div>
          <Bars data={tested.filter(([, v]) => v[1] >= 5).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).map(([k, v]) => [k.split('|')[1], Math.round((v[0] / v[1]) * 100), `(${v[0]}/${v[1]})`])} max={100} fmt={(v) => v + '%'} />
          <p className="muted small">Share of tested samples with any {test} analyte at or above the MRL. Types with fewer than 5 samples hidden.</p>
        </div>
        <div className="panel">
          <h4>{test} detections by analyte</h4>
          <Bars data={Object.entries(data.an).filter(([k]) => k.startsWith(test + '|')).map(([k, v]) => [k.split('|')[1], Math.round((v[0] / v[1]) * 100), `(${v[0]}/${v[1]})`]).sort((a, b) => b[1] - a[1])} max={100} fmt={(v) => v + '%'} />
          {test === 'PFAS' && <p className="callout warn small">SAmPAP and N-MeFOSE are detected in most samples where they were measured. Worth checking against the method blanks and the MRL before these are reported widely.</p>}
        </div>
        <div className="panel">
          <h4>Intake by technician</h4>
          <Bars data={Object.entries(data.byTech).sort((a, b) => b[1] - a[1]).slice(0, 10)} fmt={(v) => v.toLocaleString()} />
        </div>
        <div className="panel">
          <h4>Where samples wait (median hours per stage)</h4>
          <Bars data={cycleTimes(state).map(([l, h, n]) => [l, Math.round(h), n ? `(${n})` : ''])} fmt={(v) => v + ' h'} />
          <p className="muted small">Measured from the audit trail: time from entering a stage to leaving it. The longest bar is your bottleneck.</p>
        </div>
        <div className="panel">
          <h4>Current pipeline</h4>
          <Bars data={STAGES.slice(0, 6).map((st) => [st.label, state.samples.filter((s) => !s.legacy && s.stage === st.key).length])} />
        </div>
      </div>
    </div>
  );
}

// ---------- Notifications ----------
export function buildNotifications(state) {
  const n = [];
  const t = today();
  const tat = state.settings.tat;
  const on = (id) => state.notifRules.find((r) => r.id === id);
  const me = state.users.find((u) => u.name === state.session?.name);
  state.samples.forEach((s) => {
    if (s.legacy) return;
    (s.comments || []).forEach((c, k) => { if (me && c.mentions?.includes(me.id)) n.push({ id: `men-${s.id}-${k}`, rule: 'mention', level: 'warn', text: `${c.name || c.by} mentioned you on ${s.id}: ${c.text.slice(0, 60)}`, sample: s.id }); });
    if (s.stage !== 'reported' && daysSince(s.receivedAt) > tat) n.push({ id: 'od-' + s.id, rule: 'overdue', level: 'fail', text: `${s.id} is ${daysSince(s.receivedAt) - tat} days past turnaround`, sample: s.id });
    if (s.hold) n.push({ id: 'hold-' + s.id, rule: 'hold', level: 'warn', text: `${s.id} on hold: ${s.hold.reason}`, sample: s.id });
  });
  state.batches.filter((b) => !b.approved && b.eval.issues.some((i) => i.level === 'fail')).forEach((b) => n.push({ id: 'qc-' + b.key, rule: 'qc', level: 'fail', text: `${b.name} has QC failures awaiting review`, page: ['runs', b.key] }));
  state.expected.filter((x) => x.status === 'awaiting' && x.expected && x.expected < t).forEach((x) => n.push({ id: 'late-' + x.id, rule: 'late', level: 'warn', text: `Shipment ${x.tracking || x.orderRef} is late (${x.name.slice(0, 40)})`, page: ['shipments'] }));
  state.inventory.filter((x) => x.expires < new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)).forEach((x) => n.push({ id: 'inv-' + x.id, rule: 'inventory', level: x.expires < t ? 'fail' : 'warn', text: `${x.name} lot ${x.lot} ${x.expires < t ? 'expired' : 'expires'} ${fmtDate(x.expires, false)}`, page: ['inventory'] }));
  state.equipment.filter((e) => e.nextCal < t).forEach((e) => n.push({ id: 'eq-' + e.id, rule: 'equipment', level: 'fail', text: `${e.id} ${e.name} calibration overdue`, page: ['quality'] }));
  Object.entries(state.reports).forEach(([id, v]) => { const last = v[v.length - 1]; if (daysSince(last.at) <= 2) n.push({ id: 'rel-' + id + last.version, rule: 'released', level: 'ok', text: `Certificate ${id}-R${last.version} released`, page: ['report', id] }); });
  return n.filter((x) => on(x.rule) && !state.dismissed.includes(x.id));
}
export function Bell({ state, dispatch, go, openSample }) {
  const [open, setOpen] = useState(false);
  const list = buildNotifications(state);
  return (
    <div className="pop-wrap">
      <button className="icon-btn bell" onClick={() => setOpen(!open)} aria-label={`Notifications (${list.length})`}><Icon n="bell" size={18} />{list.length > 0 && <span className="badge">{list.length > 99 ? '99+' : list.length}</span>}</button>
      {open && (
        <div className="popover right notif">
          <div className="row between"><b>Notifications</b><div className="row gap"><button className="link small" onClick={() => { dispatch({ type: 'SET', key: 'dismissed', value: [...state.dismissed, ...list.map((x) => x.id)] }); }}>Mark all read</button><button className="link small" onClick={() => { setOpen(false); go('settings'); }}>Settings</button></div></div>
          <div className="notif-list">
            {list.slice(0, 40).map((x) => (
              <div key={x.id} className={cx('notif-row', x.level)}>
                <span className="nd" />
                <button className="ntext" onClick={() => { setOpen(false); x.sample ? openSample(x.sample) : go(...x.page); }}>{x.text}<small>{state.notifRules.find((r) => r.id === x.rule).label} · {[state.notifRules.find((r) => r.id === x.rule).email && 'email', state.notifRules.find((r) => r.id === x.rule).sms && 'text'].filter(Boolean).join(' + ') || 'in-app only'}</small></button>
                <button className="icon-btn" aria-label="Dismiss" onClick={() => dispatch({ type: 'SET', key: 'dismissed', value: [...state.dismissed, x.id] })}><Icon n="x" size={12} /></button>
              </div>
            ))}
            {!list.length && <Empty icon="check" title="All caught up" />}
          </div>
        </div>
      )}
    </div>
  );
}
