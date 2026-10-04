import { createClient } from '@supabase/supabase-js';
import { emptyState } from '../store.js';
import { HIST } from '../history.js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// collections stored as (id, data jsonb)
const COLLS = { clients: 'clients', expected: 'expected', inventory: 'inventory', equipment: 'equipment', invoices: 'invoices', ncrs: 'ncrs', audits: 'audits', mgmtReviews: 'mgmt_reviews', risks: 'risks', mdl: 'mdl', validation: 'validation', documents: 'documents', complaints: 'complaints', pt: 'pt', grants: 'grants', invites: 'invites', views: 'views', training: 'training' };
const KV = ['methods', 'settings', 'security', 'notifRules', 'pricing', 'methodHistory'];
const rowId = (coll, x) => x.id || (coll === 'training' ? `${x.user}|${x.method}` : JSON.stringify(x).slice(0, 60));
const BUCKET = 'sample-photos';
const uploaded = new Map(); // photo id -> storage path
export const remote = new WeakSet(); // objects that arrived from the database (never echo them back)

async function fetchAll(table, select = '*', order) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(select).range(from, from + size - 1);
    if (order) q = q.order(order[0], { ascending: order[1] });
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < size) return out;
  }
}

const fromSampleRow = (r) => ({ ...r.data, id: r.id, stage: r.stage, clientId: r.client_id, legacy: r.legacy, assignee: r.assignee, tests: r.tests, name: r.name, asin: r.asin, prepBatch: r.prep_batch, receivedAt: r.data.receivedAt || r.received_at });
const toSampleRow = (s) => ({
  id: s.id, client_id: s.clientId, stage: s.stage, received_at: s.receivedAt, legacy: !!s.legacy, assignee: s.assignee || null, tests: s.tests, name: s.name, asin: s.asin || null, prep_batch: s.prepBatch || null,
  data: { ...s, photos: (s.photos || []).map(({ src, ...p }) => ({ ...p, path: p.path || uploaded.get(p.id) || null })) },
});
const fromReportRow = (r) => ({ version: r.version, at: r.signed_at, by: r.signed_by, title: r.data.title, esig: r.esig, reason: r.reason, snapshot: r.data.snapshot, hash: r.hash });
const fromAuditRow = (r) => ({ id: 'a' + r.id, sid: r.id, ts: r.ts.slice(0, 16), user: r.user_name, role: r.role, action: r.action, entity: r.entity, detail: r.detail, esig: r.esig });
const fromProfile = (p) => ({ id: p.id, email: p.email, name: p.name, initials: p.initials, title: p.title, roles: p.roles, methods: p.methods, status: p.status, mfa: p.mfa, client: !!p.client_id, clientId: p.client_id });

export async function loadState(profile, onProgress = () => {}) {
  const st = emptyState();
  onProgress('Loading configuration');
  const [roles, kv, profiles] = await Promise.all([fetchAll('roles'), fetchAll('kv'), fetchAll('profiles')]);
  if (roles.length) st.roles = Object.fromEntries(roles.map((r) => [r.key, r.data]));
  kv.forEach((r) => { if (r.key === 'hist') Object.assign(HIST, r.value); else if (KV.includes(r.key)) st[r.key] = r.value; });
  st.users = profiles.map(fromProfile);
  onProgress('Loading samples');
  const samples = await fetchAll('samples', '*', ['received_at', false]);
  st.samples = samples.map(fromSampleRow);
  onProgress('Loading results and certificates');
  const [results, batches, reports, audit] = await Promise.all([
    fetchAll('results'), fetchAll('batches', '*', ['created_at', false]), fetchAll('report_versions', '*', ['version', true]),
    supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(3000).then((r) => r.data || []),
  ]);
  results.forEach((r) => { (st.results[r.sample_id] = st.results[r.sample_id] || {})[r.test] = r.data; });
  st.batches = batches.map((b) => b.data);
  reports.forEach((r) => { (st.reports[r.sample_id] = st.reports[r.sample_id] || []).push(fromReportRow(r)); });
  st.audit = audit.map(fromAuditRow);
  onProgress('Loading records');
  await Promise.all(Object.entries(COLLS).map(async ([k, t]) => { const rows = await fetchAll(t); st[k] = rows.map((r) => ({ ...r.data, id: r.data.id || r.id })); }));
  // signed links for photos on samples still in the lab
  const paths = st.samples.filter((s) => !s.legacy && s.stage !== 'reported').flatMap((s) => (s.photos || []).filter((p) => p.path).map((p) => p.path));
  if (paths.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 8 * 3600);
    const url = Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]));
    st.samples.forEach((s) => (s.photos || []).forEach((p) => { if (p.path) { p.src = url[p.path] || p.src; uploaded.set(p.id, p.path); } }));
  }
  st.session = { ...fromProfile(profile), role: null };
  [st.samples, st.batches, ...Object.keys(COLLS).map((k) => st[k])].forEach((list) => list.forEach((x) => remote.add(x)));
  return st;
}

// signed link for a photo that was loaded without one (e.g. on an older sample)
export async function photoUrl(path) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl;
}

// ---------------------------------------------------------------- save changes
let chain = Promise.resolve();
let listeners = new Set();
let pending = 0;
export const onSyncStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (s) => listeners.forEach((f) => f(s));

export function persist(prev, next) {
  if (!prev || !next || prev === next || !next.session) return;
  pending++; emit({ saving: true });
  chain = chain.then(() => save(prev, next)).then(() => { pending--; emit({ saving: pending > 0, error: null, at: new Date() }); })
    .catch((e) => { pending--; console.error(e); emit({ saving: pending > 0, error: e.message }); });
}

const changed = (a = [], b = [], key = 'id') => { const m = new Map(a.map((x) => [x[key], x])); return b.filter((x) => m.get(x[key]) !== x && !remote.has(x)); };
const removed = (a = [], b = [], key = 'id') => { const ids = new Set(b.map((x) => x[key])); return a.filter((x) => !ids.has(x[key])); };
const must = async (p) => { const { error } = await p; if (error) throw new Error(error.message); };

async function uploadPhotos(s) {
  for (const p of s.photos || []) {
    if (uploaded.has(p.id) || !p.src || !p.src.startsWith('data:')) continue;
    const path = `${s.id}/${p.id}.jpg`;
    const blob = await (await fetch(p.src)).blob();
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error('Photo upload: ' + error.message);
    uploaded.set(p.id, path);
  }
}

async function save(prev, next) {
  const portal = next.roles[next.session.role]?.perms?.portal;
  // audit first, so every change has its trail even if a later write fails
  const known = new Set(prev.audit.map((a) => a.id));
  const fresh = next.audit.filter((a) => !known.has(a.id) && !a.sid).reverse();
  if (fresh.length && !portal) await must(supabase.from('audit_log').insert(fresh.map((a) => ({ user_name: a.user, role: a.role || null, action: a.action, entity: a.entity || null, detail: a.detail || null, esig: a.esig || null, client_ts: a.ts }))));

  // samples
  const sm = changed(prev.samples, next.samples);
  if (portal) {
    for (const s of sm) { const o = prev.samples.find((x) => x.id === s.id); if (o?.hold && !s.hold || s.returned && !o?.returned) await must(supabase.rpc('client_decision', { p_sample: s.id, p_approve: !s.hold, p_note: s.prop65?.note || '' })); }
  } else if (sm.length) {
    for (const s of sm) await uploadPhotos(s);
    for (let i = 0; i < sm.length; i += 500) await must(supabase.from('samples').upsert(sm.slice(i, i + 500).map(toSampleRow)));
  }
  // results
  const res = [];
  Object.entries(next.results).forEach(([id, tests]) => Object.entries(tests).forEach(([t, r]) => { if (prev.results[id]?.[t] !== r && !remote.has(r)) res.push({ sample_id: id, test: t, data: r }); }));
  if (res.length && !portal) for (let i = 0; i < res.length; i += 500) await must(supabase.from('results').upsert(res.slice(i, i + 500)));
  // instrument runs and manual entries
  const bt = changed(prev.batches, next.batches, 'key');
  if (bt.length && !portal) await must(supabase.from('batches').upsert(bt.map((b) => ({ key: b.key, method: b.method, data: b }))));
  // certificates: insert new versions only (the database refuses edits)
  const rv = [];
  Object.entries(next.reports).forEach(([id, vs]) => { const n0 = (prev.reports[id] || []).length; vs.slice(n0).forEach((v) => { if (!v.sid) rv.push({ sample_id: id, version: v.version, hash: v.hash, signed_by: v.by, esig: v.esig, reason: v.reason, data: { title: v.title, snapshot: v.snapshot } }); }); });
  if (rv.length) await must(supabase.from('report_versions').insert(rv));
  // roles and people
  if (prev.roles !== next.roles) {
    const up = Object.entries(next.roles).filter(([k, r]) => prev.roles[k] !== r).map(([k, r]) => ({ key: k, data: r, updated_at: new Date().toISOString() }));
    if (up.length) await must(supabase.from('roles').upsert(up));
    const gone = Object.keys(prev.roles).filter((k) => !next.roles[k]);
    if (gone.length) await must(supabase.from('roles').delete().in('key', gone));
  }
  for (const u of changed(prev.users, next.users)) {
    if (!prev.users.find((x) => x.id === u.id)) continue; // new accounts are created by invite, not here
    await must(supabase.from('profiles').update({ roles: u.roles, methods: u.methods || [], status: u.status, title: u.title || '' }).eq('id', u.id));
  }
  // collections
  for (const [k, t] of Object.entries(COLLS)) {
    if (prev[k] === next[k]) continue;
    const up = changed(prev[k], next[k]).map((x) => ({ id: rowId(k, x), data: x }));
    if (up.length) await must(supabase.from(t).upsert(up));
    const del = removed(prev[k], next[k]).map((x) => rowId(k, x));
    if (del.length && k !== 'invites') await must(supabase.from(t).delete().in('id', del));
  }
  // new invites send a real email
  for (const inv of changed(prev.invites, next.invites).filter((i) => !prev.invites.find((x) => x.id === i.id))) {
    const { error } = await supabase.functions.invoke('invite-user', { body: { email: inv.email, name: inv.name, roles: inv.roles, client_id: inv.clientId || null } });
    if (error) throw new Error('Invite email: ' + error.message);
  }
  // singletons
  for (const k of KV) if (prev[k] !== next[k]) await must(supabase.from('kv').upsert({ key: k, value: next[k], updated_at: new Date().toISOString() }));
}

// ---------------------------------------------------------------- realtime
export function subscribe(dispatch, myId) {
  const ch = supabase.channel('lims')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'samples' }, (p) => { if (!p.new?.id || p.new.updated_by === myId) return; const s = fromSampleRow(p.new); remote.add(s); dispatch({ type: 'REMOTE', coll: 'samples', item: s }); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'batches' }, (p) => { if (!p.new?.key || p.new.created_by === myId) return; const b = p.new.data; remote.add(b); dispatch({ type: 'REMOTE', coll: 'batches', item: b }); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'results' }, (p) => { if (!p.new?.sample_id) return; remote.add(p.new.data); dispatch({ type: 'REMOTE', coll: 'results', sampleId: p.new.sample_id, test: p.new.test, data: p.new.data }); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'report_versions' }, (p) => { if (p.new.created_by === myId) return; dispatch({ type: 'REMOTE', coll: 'reports', sampleId: p.new.sample_id, v: { ...fromReportRow(p.new), sid: true } }); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, (p) => { if (p.new.actor === myId) return; dispatch({ type: 'REMOTE', coll: 'audit', item: fromAuditRow(p.new) }); })
    .subscribe();
  return () => supabase.removeChannel(ch);
}
