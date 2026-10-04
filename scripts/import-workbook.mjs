// One-time migration from the tracking workbook into the LIMS database.
//   node scripts/import-workbook.mjs "Sample tracking and reporting - Enviro Labs.xlsx" [--dry-run]
// Reads TotalProducts (every sample ever logged) and every Gen_LIMs_* sheet (MassHunter exports),
// runs the same QC engine the app uses, and writes legacy samples, their results and the QC history
// that feeds control charts and uncertainty. Safe to re-run: existing lab IDs are skipped.
import fs from 'fs';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { rowsFromSheet, evaluateBatch } from '../src/qc.js';
import { METHODS } from '../src/config.js';

const env = Object.fromEntries((fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const file = process.argv[2];
const dry = process.argv.includes('--dry-run');
if (!file) { console.error('Usage: node scripts/import-workbook.mjs <workbook.xlsx> [--dry-run]'); process.exit(1); }
if (!dry && (!URL || !KEY)) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const sb = dry ? null : createClient(URL, KEY, { auth: { persistSession: false } });

const wb = XLSX.readFile(file, { cellDates: true });
const testsFromId = (id) => { const c = (id.split('-')[1] || '').replace(/\d+L?$/, ''); const t = []; if (c.includes('B')) t.push('BPS'); if (c.includes('P')) t.push('PFAS'); if (c.includes('A')) t.push('OTA'); if (c.includes('Q')) t.push('PEP'); return t.length ? t : ['BPS']; };
const iso = (v) => (v instanceof Date && !isNaN(v) ? v.toISOString() : null);

// ---- samples
const rows = XLSX.utils.sheet_to_json(wb.Sheets.TotalProducts, { defval: '' });
const col = (r, name) => { const k = Object.keys(r).find((x) => x.replace(/\s+/g, ' ').trim().toLowerCase() === name); return k ? r[k] : ''; };
const samples = new Map();
for (const r of rows) {
  const id = String(col(r, 'laboratory id')).trim().toUpperCase();
  if (!/^\d{6}-[A-Z]+\d+L?$/.test(id) || samples.has(id)) continue;
  const asin = String(col(r, 'asin (identifier)')).trim();
  const recv = iso(col(r, 'received on')) || `20${id.slice(0, 2)}-${id.slice(2, 4)}-${id.slice(4, 6)}T09:00:00Z`;
  const client = /consumer safety/i.test(col(r, 'client')) ? 'ccs' : 'artemis';
  const s = {
    id, name: String(col(r, 'product name')).slice(0, 300), link: String(col(r, 'link to product')) || null, asin: asin && !asin.startsWith('#') ? asin : null,
    matrix: String(col(r, 'matrix')) || 'Fabrics', tests: testsFromId(id), clientId: client, receivedAt: recv.slice(0, 16), receivedBy: String(col(r, 'received by')).trim().toUpperCase() || '—',
    stage: 'reported', legacy: true, rush: false, bin: String(col(r, 'storage bin no')) || null, weight: Number(col(r, 'weight (grams)')) || null, condition: null,
    comments: String(col(r, 'comments')).trim() ? [{ at: recv.slice(0, 16), by: 'import', text: String(col(r, 'comments')).trim() }] : [], photos: [], hold: null, prop65: null, prepBatch: null, subsampleMass: null, disposed: null,
  };
  samples.set(id, s);
}
console.log(`TotalProducts: ${samples.size} samples with valid lab IDs`);

// ---- instrument runs
const hist = { legacy: [], batches: [], results: {} };
const results = [];
const r1 = (x, d = 1) => (x == null || isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
for (const name of wb.SheetNames.filter((n) => n.startsWith('Gen_LIMs'))) {
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
  let raw; try { raw = rowsFromSheet(aoa); } catch { continue; }
  const comps = new Set(raw.rows.map((r) => r[1]));
  const m = Object.values(METHODS).find((x) => x.analytes.some((a) => comps.has(a.name)));
  if (!m) continue;
  const e = evaluateBatch(raw, m);
  const label = (raw.meta['Batch Name'] || name).replace('.batch.bin', '');
  const b = { k: label, m: m.code, d: (e.acqStart || '').slice(0, 10), n: e.results.length, preps: e.preps.map((p) => p.id), lcs: {}, ccv: {}, surr: {}, fails: e.issues.filter((i) => i.level === 'fail').length };
  e.preps.forEach((p) => p.lcs?.forEach((l) => (b.lcs[l.analyte] = b.lcs[l.analyte] || []).push([r1(l.r1), r1(l.r2), r1(l.rpd)])));
  e.ccv.forEach((c) => c.analytes.forEach((a) => (b.ccv[a.analyte] = b.ccv[a.analyte] || []).push(r1(a.rec))));
  e.results.forEach((r) => r.surrogates.forEach((s) => s.rec != null && (b.surr[s.name] = b.surr[s.name] || []).push(r1(s.rec))));
  const bi = hist.batches.push(b) - 1;
  e.results.forEach((r) => {
    if (!samples.has(r.id)) return;
    samples.get(r.id).prepBatch = r.prep;
    results.push({ sample_id: r.id, test: m.code, data: { batchKey: 'H' + bi, legacyBatch: label, prep: r.prep, acq: r.acq, analytes: r.analytes.map((a) => ({ name: a.name, value: a.value, mrl: a.mrl, units: a.units, dil: a.dil, qualifiers: a.qualifiers })), surrogates: r.surrogates.map((s) => ({ name: s.name, rec: r1(s.rec), ok: s.ok })) } });
  });
}
hist.batches.sort((a, b) => (a.d < b.d ? -1 : 1));
console.log(`Instrument exports: ${hist.batches.length} runs, ${results.length} sample results matched`);
if (dry) { console.log('Dry run: nothing written.'); process.exit(0); }

// ---- write (skip lab IDs that already exist)
const existing = new Set();
for (let from = 0; ; from += 1000) { const { data } = await sb.from('samples').select('id').range(from, from + 999); data.forEach((d) => existing.add(d.id)); if (data.length < 1000) break; }
const fresh = [...samples.values()].filter((s) => !existing.has(s.id));
for (let i = 0; i < fresh.length; i += 500) {
  const { error } = await sb.from('samples').insert(fresh.slice(i, i + 500).map((s) => ({ id: s.id, client_id: s.clientId, stage: 'reported', received_at: s.receivedAt, legacy: true, tests: s.tests, name: s.name || '(no name)', asin: s.asin, prep_batch: s.prepBatch, data: s })));
  if (error) throw error;
  process.stdout.write(`\rSamples ${Math.min(i + 500, fresh.length)}/${fresh.length}`);
}
const freshIds = new Set(fresh.map((s) => s.id));
const rs = results.filter((r) => freshIds.has(r.sample_id));
for (let i = 0; i < rs.length; i += 500) { const { error } = await sb.from('results').upsert(rs.slice(i, i + 500)); if (error) throw error; }
const { error } = await sb.from('kv').upsert({ key: 'hist', value: hist });
if (error) throw error;
await sb.from('audit_log').insert({ actor: '00000000-0000-0000-0000-000000000000', user_name: 'Data migration', action: 'Legacy data imported', entity: file, detail: `${fresh.length} samples, ${rs.length} results, ${hist.batches.length} historical runs` }).then(() => {}, () => {});
console.log(`\nDone: ${fresh.length} new samples, ${rs.length} results, ${hist.batches.length} historical runs.`);
