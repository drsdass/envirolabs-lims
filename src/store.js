import { SEED } from './seed.js';
import { METHODS, TEST_ORDER } from './config.js';
import { evaluateBatch } from './qc.js';
import { HIST } from './history.js';
import { sha256 } from 'js-sha256';

export const reportHash = (snap) => sha256(JSON.stringify(snap));

export const STAGES = [
  { key: 'received', label: 'Received', roles: ['intake', 'prep'], next: 'Move to sample prep' },
  { key: 'prep', label: 'Sample prep', roles: ['prep'], next: 'Send to extraction' },
  { key: 'extraction', label: 'Extraction', roles: ['extraction'], next: 'Queue for instrument' },
  { key: 'analysis', label: 'Instrument', roles: ['chemist'], next: 'Send to data review' },
  { key: 'review', label: 'Data review', roles: ['chemist'], next: 'Submit for sign-off' },
  { key: 'manager', label: 'Manager sign-off', roles: ['manager'], next: 'Sign and release report' },
  { key: 'reported', label: 'Reported', roles: [], next: null },
];
export const stageIdx = (k) => STAGES.findIndex((s) => s.key === k);

export const PERMS = [
  ['Workflow', [['adv_received', 'Move samples out of Received'], ['adv_prep', 'Move samples out of Sample prep'], ['adv_extraction', 'Move samples out of Extraction'], ['adv_analysis', 'Move samples out of Instrument'], ['adv_review', 'Submit samples for sign-off'], ['sign', 'Sign and release certificates'], ['sendback', 'Send samples back a stage']]],
  ['Samples and data', [['intake', 'Register samples'], ['edit', 'Edit sample records, holds and assignments'], ['import', 'Import instrument runs and build sequences'], ['results', 'Enter results manually'], ['approve', 'Approve batch QC'], ['amend', 'Issue amended certificates']]],
  ['Management', [['methods', 'Revise methods and limits'], ['quality', 'Manage quality records'], ['inventory', 'Manage standards and reagents'], ['billing', 'Billing and invoices'], ['analytics', 'View analytics'], ['users', 'Manage users and roles']]],
  ['Attributes', [['mfa', 'Require 2-step sign-in'], ['training', 'Enforce method training authorization'], ['portal', 'Client portal only (sees own samples)']]],
];
const P = (...k) => Object.fromEntries(PERMS.flatMap(([, l]) => l.map(([x]) => [x, k.includes(x)])));
export const DEFAULT_ROLES = {
  admin: { label: 'Lab Admin', desc: 'Manage users, methods, clients and lab settings.', color: '#525B6E', perms: P('adv_received', 'adv_prep', 'adv_extraction', 'adv_analysis', 'adv_review', 'sendback', 'intake', 'edit', 'import', 'results', 'methods', 'quality', 'inventory', 'billing', 'analytics', 'users', 'mfa') },
  intake: { label: 'Intake Technician', desc: 'Receive shipments, log samples and chain of custody.', color: '#0E8A6E', perms: P('adv_received', 'intake', 'edit') },
  prep: { label: 'Sample Prep Technician', desc: 'Subsample, weigh and cut samples for extraction.', color: '#B46B07', perms: P('adv_received', 'adv_prep', 'edit', 'training') },
  extraction: { label: 'Extraction Technician', desc: 'Run extractions and build prep batches with QC.', color: '#A35F00', perms: P('adv_extraction', 'inventory', 'training') },
  chemist: { label: 'Chemist', desc: 'Run the LC-MS/MS, import data and review QC.', color: '#2457C5', perms: P('adv_analysis', 'adv_review', 'import', 'results', 'approve', 'sendback', 'analytics', 'training') },
  manager: { label: 'Lab Manager', desc: 'Sign off certificates of analysis and oversee QC.', color: '#7A3FB0', perms: P('adv_received', 'adv_prep', 'adv_extraction', 'adv_analysis', 'adv_review', 'sign', 'sendback', 'intake', 'edit', 'import', 'results', 'approve', 'amend', 'methods', 'quality', 'inventory', 'billing', 'analytics', 'users', 'mfa', 'training') },
  qa: { label: 'Quality Manager', desc: 'Own ISO/IEC 17025 records: NCRs, audits, training, documents.', color: '#C0362C', perms: P('quality', 'methods', 'inventory', 'analytics', 'mfa') },
  client: { label: 'Client portal', desc: 'Sees only their own samples and certificates.', color: '#1787C9', perms: P('portal') },
};
// Live role table. Kept in sync with state.roles so every screen reads the admin's current definitions.
export const ROLES = JSON.parse(JSON.stringify(DEFAULT_ROLES));
export function syncRoles(defs) { Object.keys(ROLES).forEach((k) => { if (!defs[k]) delete ROLES[k]; }); Object.assign(ROLES, defs); }
export const can = (state, perm) => !!state.session && !!state.roles?.[state.session.role]?.perms?.[perm];

export const DEMO_PIN = '1234';
export const TAT_DAYS = 14;
export const DISPOSAL_DAYS = 30;

const day = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 16);
const testsFromId = (id) => {
  const code = (id.split('-')[1] || '').replace(/\d+L?$/, '');
  const t = [];
  if (code.includes('B')) t.push('BPS');
  if (code.includes('P')) t.push('PFAS');
  if (code.includes('A')) t.push('OTA');
  if (code.includes('Q')) t.push('PEP');
  return t.length ? t : ['BPS'];
};
export const labCode = (tests) => TEST_ORDER.filter((t) => tests.includes(t)).map((t) => METHODS[t].letter).join('');

export const USERS = [
  { id: 'hv', email: 'hv@envirolabsusa.com', status: 'active', name: 'Himani Vaishnav', initials: 'HV', title: 'Lab Manager', roles: ['manager', 'chemist', 'qa', 'intake'], methods: ['BPS', 'PFAS', 'OTA', 'PEP'], mfa: true },
  { id: 'sc', email: 'sc@envirolabsusa.com', status: 'active', name: 'Sean Condon', initials: 'SC', title: 'Lab Manager', roles: ['manager', 'chemist', 'intake', 'prep', 'extraction'], methods: ['BPS', 'PFAS', 'OTA', 'PEP'], mfa: true },
  { id: 'sd', email: 'sd@envirolabsusa.com', status: 'active', name: 'Technician SD', initials: 'SD', title: 'Laboratory Technician', roles: ['intake', 'prep', 'extraction'], methods: ['BPS', 'PFAS'] },
  { id: 'yc', email: 'yc@envirolabsusa.com', status: 'active', name: 'Technician YC', initials: 'YC', title: 'Laboratory Technician', roles: ['intake', 'prep'], methods: ['BPS'] },
  { id: 'mk', email: 'mk@envirolabsusa.com', status: 'active', name: 'Technician MK', initials: 'MK', title: 'Laboratory Technician', roles: ['intake', 'prep', 'extraction'], methods: ['BPS', 'PFAS'] },
  { id: 'jf', email: 'jf@envirolabsusa.com', status: 'active', name: 'Technician JF', initials: 'JF', title: 'Laboratory Technician', roles: ['intake', 'extraction'], methods: ['PFAS'] },
  { id: 'kf', email: 'testing@artemisresearch.io', status: 'active', name: 'Kelsey Frank', initials: 'KF', title: 'Artemis Research LLC', roles: ['client'], clientId: 'artemis', methods: [], client: true },
  { id: 'rc', email: 'rc@envirolabsusa.com', status: 'active', name: 'Technician RC', initials: 'RC', title: 'Laboratory Technician', roles: ['intake'], methods: [] },
];

export const CLIENTS = [
  { id: 'artemis', name: 'Artemis Research LLC', lead: 'Kelsey Frank', email: 'testing@artemisresearch.io', phone: '', address: '1543 3rd Avenue, Walnut Creek, CA 94597' },
  { id: 'motif', name: 'MOTIF Peptide Solutions', lead: '', email: '', phone: '', address: 'Rocklin, CA' },
  { id: 'ccs', name: 'Center for Consumer Safety LLC', lead: 'Mike White', email: 'mike@centerforconsumersafety.com', phone: '', address: '2001 Addison St, Berkeley, CA 94704' },
];

let auditSeq = 1;
const A = (ts, user, action, entity, detail, extra = {}) => ({ id: auditSeq++, ts, user, action, entity, detail, ...extra });

export function buildInitial() {
  const imported = { Gen_LIMs_BPS_26051302: { approved: true }, Gen_LIMs_PFAS_26051501: { approved: false } };
  const pending = ['Gen_LIMs_BPS_26051802', 'Gen_LIMs_PFAS_26051401'];
  const audit = [];
  const batches = [];
  const results = {};
  const prepOf = {};

  for (const [key, opt] of Object.entries(imported)) {
    const raw = SEED.batches[key];
    const m = key.includes('BPS') ? METHODS.BPS : METHODS.PFAS;
    const ev = evaluateBatch(raw, m);
    const importedAt = iso(new Date(ev.acqEnd).getTime() + 3 * 3600e3);
    batches.push({ key, rows: raw.rows, name: raw.batchName, method: m.code, file: key + '.xlsx', path: raw.path, quant: raw.quantVersion, instrument: 'LCMS1', importedAt, importedBy: 'Sean Condon', eval: ev, approved: opt.approved ? { by: 'Himani Vaishnav', at: iso(new Date(importedAt).getTime() + 5 * 3600e3) } : null });
    audit.push(A(importedAt, 'Sean Condon', 'Instrument data imported', raw.batchName, `${ev.results.length} samples, ${ev.injections} injections`));
    if (opt.approved) audit.push(A(iso(new Date(importedAt).getTime() + 5 * 3600e3), 'Himani Vaishnav', 'Batch QC approved (e-signed)', raw.batchName, 'Meaning: reviewed and approved'));
    ev.results.forEach((r) => {
      results[r.id] = results[r.id] || {};
      results[r.id][m.code] = { batchKey: key, ...r };
      prepOf[r.id] = r.prep;
    });
  }
  const pendingOf = {};
  for (const key of pending) {
    const raw = SEED.batches[key];
    const m = key.includes('BPS') ? METHODS.BPS : METHODS.PFAS;
    const ev = evaluateBatch(raw, m);
    ev.results.forEach((r) => { pendingOf[r.id] = true; prepOf[r.id] = prepOf[r.id] || r.prep; });
  }

  const raw = [...SEED.samples].sort((a, b) => (a.recv < b.recv ? 1 : -1));
  let newest = 0;
  const samples = raw.map((s, i) => {
    const tests = testsFromId(s.id);
    const done = tests.filter((t) => results[s.id]?.[t]);
    const approved = done.length === tests.length && done.every((t) => batches.find((b) => b.key === results[s.id][t].batchKey)?.approved);
    let stage;
    const hasE = done.some((t) => results[s.id][t].analytes.some((x) => x.qualifiers.includes('E')));
    if (done.length === tests.length) stage = approved && !hasE ? 'mgr-or-rep' : 'review';
    else if (pendingOf[s.id] || done.length) stage = 'analysis';
    else { stage = newest < 9 ? 'received' : newest < 17 ? 'prep' : 'extraction'; newest++; }
    const comment = s.comment || '';
    const returned = /returned/i.test(comment);
    const awaiting = /awaiting|doesn't match/i.test(comment) && !returned;
    const p65 = /prop 65/i.test(comment) && /approved|confirmed/i.test(comment);
    const recvBy = String(s.by || 'SC').toUpperCase();
    const letter = (tests[0] === 'PFAS' ? 'P' : 'B');
    const hasBin = stage !== 'received' || i % 3 !== 0;
    return {
      id: s.id, name: s.name, link: s.link, asin: s.asin, matrix: s.matrix || 'Fabrics', tests, clientId: s.client && /consumer safety/i.test(s.client) ? 'ccs' : 'artemis',
      receivedAt: s.recv, receivedBy: recvBy, expectedAt: s.exp, carrier: s.carrier && s.carrier !== 'TBD' ? s.carrier : s.trk && /^TBA/.test(s.trk) ? 'Amazon Logistics' : null, tracking: s.trk && s.trk !== 'TBD' ? s.trk : null,
      weight: s.wt != null && !isNaN(+s.wt) ? +s.wt : null, bin: hasBin ? `Bin-${letter}0${1 + (i % 4)}` : null, condition: hasBin ? 'Good' : null,
      stage, rush: i === 3 || i === 11, comments: comment ? [{ at: s.recv, by: recvBy, text: comment }] : [],
      prop65: p65 ? { status: 'approved', by: 'Kelsey Frank (Artemis)', note: comment } : awaiting ? { status: 'pending', note: comment } : null,
      hold: awaiting ? { reason: /match/i.test(comment) ? 'Product does not match the ASIN listing. Awaiting client instruction.' : 'Prop 65 warning label. Awaiting client decision.', by: recvBy, at: s.recv } : null,
      returned: returned ? { at: s.recv, note: comment } : null,
      prepBatch: stage === 'extraction' || stage === 'received' || stage === 'prep' ? null : prepOf[s.id] || null,
      subsampleMass: stage === 'received' || stage === 'prep' ? null : 1.0,
      disposed: null, photos: [],
    };
  }).filter((s) => !s.returned);

  // split approved samples between manager sign-off and reported
  const reports = {};
  let mc = 0;
  samples.forEach((s) => {
    if (s.stage !== 'mgr-or-rep') return;
    if (mc++ < 9) {
      s.stage = 'reported';
      const at = iso(new Date(batches[0].approved.at).getTime() + 26 * 3600e3 + mc * 60e3);
      { const snapshot = snapshotOf(s, results[s.id]); reports[s.id] = [{ version: 1, at, by: 'Himani Vaishnav', title: 'Lab Manager', esig: 'ES-' + (40210 + mc), reason: null, snapshot, hash: reportHash(snapshot) }]; }
      audit.push(A(at, 'Himani Vaishnav', 'Certificate of analysis signed (v1)', s.id, 'Meaning: reviewed, approved and released'));
    } else s.stage = 'manager';
  });

  // custody events for all samples
  samples.forEach((s) => {
    const t0 = new Date(s.receivedAt).getTime();
    audit.push(A(s.receivedAt, s.receivedBy, 'Sample received', s.id, `${s.carrier || 'Courier'}${s.tracking ? ' ' + s.tracking : ''}. Condition: ${s.condition || 'not recorded'}`));
    const path = STAGES.slice(1, stageIdx(s.stage) + 1);
    path.forEach((st, k) => { if (st.key !== 'reported') audit.push(A(iso(t0 + (k + 1) * day * 0.8), k < 2 ? 'Technician SD' : 'Sean Condon', `Moved to ${st.label}`, s.id, k === 2 && s.prepBatch ? `Prep batch ${s.prepBatch}` : '')); });
    if (s.prop65?.status === 'approved') audit.push(A(iso(t0 + 3600e3), s.receivedBy, 'Client approval recorded', s.id, 'Prop 65 warning reviewed; client approved testing'));
    if (s.hold) audit.push(A(iso(t0 + 600e3), s.receivedBy, 'Placed on hold', s.id, s.hold.reason));
  });
  audit.sort((a, b) => (a.ts < b.ts ? 1 : -1));

  // ---- legacy history imported from the tracking workbook (before May 2026) ----
  const legacy = HIST.legacy.map(([id, name, matrix, recv, by, asin, chem, client]) => ({
    id, name, link: null, asin: asin && !String(asin).startsWith('#') ? asin : null, matrix: matrix || 'Fabrics', tests: testsFromId(id), clientId: /consumer safety/i.test(client || '') ? 'ccs' : 'artemis',
    receivedAt: (recv || '2025-08-01') + 'T09:00', receivedBy: by || '—', stage: 'reported', legacy: true, rush: false, comments: [], photos: [], hold: null, prop65: null, bin: null, weight: null, condition: null, prepBatch: null, subsampleMass: null, disposed: null,
  }));
  Object.entries(HIST.results).forEach(([id, t]) => {
    results[id] = results[id] || {};
    Object.entries(t).forEach(([m, x]) => {
      const hb = HIST.batches[x.b];
      results[id][m] = { batchKey: 'H' + x.b, legacyBatch: hb.k, prep: hb.preps[0], acq: x.a, analytes: x.v.map(([name, value, q]) => ({ name, value, mrl: METHODS[m].analytes.find((a) => a.name === name)?.mrl, units: METHODS[m].units, dil: 1, qualifiers: q })), surrogates: x.s.map(([name, rec]) => ({ name, rec, ok: rec != null && rec >= 50 && rec <= 150 })) };
    });
  });

  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  return {
    session: null,
    roles: JSON.parse(JSON.stringify(DEFAULT_ROLES)),
    views: [],
    expected: [
      { id: 'EX1', clientId: 'artemis', orderRef: 'ART-PO-1042', name: 'Unbranded kids rain jacket, yellow, size 6', link: '', asin: '', tests: ['PFAS'], carrier: 'Amazon Logistics', tracking: 'TBA301122334455', expected: d(0), status: 'awaiting', createdBy: 'Kelsey Frank', createdAt: d(-3) },
      { id: 'EX2', clientId: 'artemis', orderRef: 'ART-PO-1042', name: 'Waterproof picnic blanket, 60x80', link: '', asin: '', tests: ['PFAS'], carrier: 'Amazon Logistics', tracking: 'TBA301122334455', expected: d(0), status: 'awaiting', createdBy: 'Kelsey Frank', createdAt: d(-3) },
      { id: 'EX3', clientId: 'artemis', orderRef: 'ART-PO-1043', name: 'Athletic crew socks, 6 pack', link: '', asin: '', tests: ['BPS'], carrier: 'UPS', tracking: '1Z999AA10123456784', expected: d(-2), status: 'awaiting', createdBy: 'Kelsey Frank', createdAt: d(-6) },
      { id: 'EX4', clientId: 'artemis', orderRef: 'ART-PO-1043', name: 'Thermal receipt paper rolls, 10 pack', link: '', asin: '', tests: ['BPS'], carrier: 'UPS', tracking: '1Z999AA10123456784', expected: d(-2), status: 'awaiting', createdBy: 'Kelsey Frank', createdAt: d(-6) },
      { id: 'EX5', clientId: 'motif', orderRef: 'MOTIF-QC-0019', name: 'Peptide lot release sample (vial)', link: '', asin: '', tests: ['PEP'], carrier: 'Client drop-off', tracking: '', expected: d(2), status: 'awaiting', createdBy: 'MOTIF', createdAt: d(-1) },
    ],
    inventory: [
      { id: 'STD-0412', type: 'Calibration standard', name: 'Bisphenol S, neat CRM', methods: ['BPS'], role: 'native', vendor: 'CRM vendor', lot: 'BPS-23118', received: '2026-02-10', opened: '2026-02-12', expires: d(240), location: 'Freezer FRZ-01', qty: '1 vial' },
      { id: 'STD-0413', type: 'Surrogate', name: 'd8-BPS solution 100 µg/mL', methods: ['BPS'], role: 'surrogate', vendor: 'CRM vendor', lot: 'D8B-5521', received: '2026-02-10', opened: '2026-02-20', expires: d(21), location: 'Freezer FRZ-01', qty: '0.6 mL' },
      { id: 'STD-0414', type: 'Internal standard', name: '13C12 BPS solution', methods: ['BPS'], role: 'istd', vendor: 'CRM vendor', lot: 'C12B-0912', received: '2026-03-01', opened: '2026-03-03', expires: d(300), location: 'Freezer FRZ-01', qty: '0.8 mL' },
      { id: 'STD-0420', type: 'Calibration standard', name: 'PFAS native mix (13 compounds)', methods: ['PFAS'], role: 'native', vendor: 'CRM vendor', lot: 'PFN-7783', received: '2026-03-15', opened: '2026-03-16', expires: d(180), location: 'Fridge 4 °C', qty: '1.2 mL' },
      { id: 'STD-0421', type: 'Surrogate', name: 'Mass-labelled PFAS mix (13C8 PFOA / PFOS)', methods: ['PFAS'], role: 'surrogate', vendor: 'CRM vendor', lot: 'MPF-2210', received: '2026-03-15', opened: '2026-03-16', expires: d(150), location: 'Fridge 4 °C', qty: '0.9 mL' },
      { id: 'STD-0422', type: 'Internal standard', name: '13C9 PFNA', methods: ['PFAS'], role: 'istd', vendor: 'CRM vendor', lot: 'C9N-1180', received: '2026-03-15', opened: '2026-03-16', expires: d(150), location: 'Fridge 4 °C', qty: '0.5 mL' },
      { id: 'STD-0430', type: 'Calibration standard', name: 'Ochratoxin A CRM', methods: ['OTA'], role: 'native', vendor: 'CRM vendor', lot: 'OTA-0081', received: '2025-09-02', opened: '2025-09-04', expires: d(-12), location: 'Freezer FRZ-01', qty: '0.3 mL' },
      { id: 'RG-0101', type: 'Reagent', name: 'Methanol, LC-MS grade', methods: ['BPS', 'PFAS', 'OTA', 'PEP'], role: 'reagent', vendor: 'Solvent vendor', lot: 'M-44102', received: '2026-08-01', opened: '2026-09-02', expires: d(420), location: 'Solvent cabinet', qty: '3 × 4 L' },
      { id: 'RG-0102', type: 'Reagent', name: 'Ammonium acetate, LC-MS grade', methods: ['BPS', 'PFAS'], role: 'reagent', vendor: 'Reagent vendor', lot: 'AA-9920', received: '2026-05-11', opened: '2026-05-12', expires: d(500), location: 'Shelf R2', qty: '250 g' },
    ],
    invoices: [],
    pricing: { rushPct: 50 },
    notifRules: [
      { id: 'overdue', label: 'Sample past turnaround', email: true, sms: false, to: 'Lab Manager' },
      { id: 'hold', label: 'Sample placed on hold', email: true, sms: false, to: 'Lab Manager, client contact' },
      { id: 'qc', label: 'Instrument batch fails QC', email: true, sms: true, to: 'Chemist, Lab Manager' },
      { id: 'released', label: 'Certificate released', email: true, sms: false, to: 'Client contact' },
      { id: 'mention', label: 'Someone mentions me in a note', email: true, sms: false, to: 'Mentioned person' },
      { id: 'late', label: 'Expected shipment late', email: true, sms: false, to: 'Intake' },
      { id: 'inventory', label: 'Standard expiring within 30 days', email: true, sms: false, to: 'Quality Manager' },
      { id: 'equipment', label: 'Equipment calibration due', email: true, sms: false, to: 'Quality Manager' },
    ],
    dismissed: [],
    audits: [
      { id: 'IA-2026-02', date: '2026-09-02', scope: 'Reporting (7.8) and data control (7.11)', auditor: 'Himani Vaishnav', findings: 'Report template RPD limit printed as 0.3; MRL formula errors.', ncr: 'NCR-2026-011', status: 'Closed' },
      { id: 'IA-2026-03', date: d(20), scope: 'Sample handling (7.4) and equipment (6.4)', auditor: 'Sean Condon', findings: '', ncr: '', status: 'Planned' },
    ],
    mgmtReviews: [{ id: 'MR-2026-1', date: '2026-07-15', attendees: 'Himani Vaishnav, Sean Condon', inputs: 'PT results, NCR trend, client feedback, turnaround', outputs: 'Adopt LIMS; add PFAS PT round; review surrogate cleanup for dyed fabrics.', status: 'Actions open' }],
    risks: [
      { id: 'R-01', area: 'Sample receipt', risk: 'Wrong product received vs ASIN', likelihood: 3, impact: 3, control: 'ASIN duplicate check, receipt photo required, hold workflow', owner: 'Sean Condon' },
      { id: 'R-02', area: 'Analysis', risk: 'Matrix suppression lowers surrogate recovery in dyed fabrics', likelihood: 4, impact: 3, control: 'IS1 qualifier, NCR-2026-014 cleanup study', owner: 'Himani Vaishnav' },
      { id: 'R-03', area: 'Data', risk: 'Spreadsheet formula errors on reports', likelihood: 2, impact: 5, control: 'Locked LIMS templates, validation suite', owner: 'Himani Vaishnav' },
      { id: 'R-04', area: 'Impartiality', risk: 'Client pressure on results used in Prop 65 actions', likelihood: 2, impact: 4, control: 'Signed impartiality statements, amendments only with documented reason', owner: 'Lab Director' },
    ],
    mdl: [],
    validation: [],
    security: { mfa: 'Required for Lab Manager and Lab Admin', timeout: 30, pwdLen: 12, lockout: 5, backups: 'Nightly full backup + point-in-time recovery (7 days)' },
    users: USERS,
    clients: CLIENTS,
    methods: JSON.parse(JSON.stringify(METHODS)),
    methodHistory: [{ code: 'BPS', rev: 3, at: '2026-03-02T09:00', by: 'Himani Vaishnav', change: 'Short gradient method BPS_09092025_SHORT adopted after validation.' }, { code: 'PFAS', rev: 4, at: '2026-04-20T09:00', by: 'Himani Vaishnav', change: 'Reporting list reduced to PFOA, PFNA, PFOS for client program.' }],
    samples: [...samples, ...legacy],
    batches,
    pendingImports: pending,
    results,
    reports,
    audit,
    equipment: [
      { id: 'LCMS1', name: 'LC-MS/MS triple quadrupole', type: 'Instrument', serial: 'LCMS1', location: 'Instrument room', lastCal: '2026-07-14', nextCal: '2027-01-14', status: 'In service', notes: 'Annual PM by vendor; tune check before each sequence.' },
      { id: 'BAL-01', name: 'Analytical balance 0.1 mg', type: 'Balance', serial: 'B3201-118', location: 'Prep bench', lastCal: '2025-10-01', nextCal: '2026-10-01', status: 'Calibration overdue', notes: 'Daily check weights 1 g / 100 g.' },
      { id: 'BAL-02', name: 'Top-loading balance 0.01 g', type: 'Balance', serial: 'TL-5521', location: 'Receiving', lastCal: '2026-04-11', nextCal: '2027-04-11', status: 'In service', notes: 'Used for product weight at intake.' },
      { id: 'PIP-07', name: 'Pipette 100–1000 µL', type: 'Pipette', serial: 'P1000-07', location: 'Extraction', lastCal: '2026-06-02', nextCal: '2026-12-02', status: 'In service', notes: 'Gravimetric check quarterly.' },
      { id: 'CEN-01', name: 'Centrifuge', type: 'Equipment', serial: 'CF-883', location: 'Extraction', lastCal: '2026-02-18', nextCal: '2027-02-18', status: 'In service', notes: 'Tachometer verification annually.' },
      { id: 'FRZ-01', name: 'Sample storage freezer −20 °C', type: 'Storage', serial: 'FZ-2093', location: 'Storage', lastCal: '2026-05-05', nextCal: '2026-11-05', status: 'In service', notes: 'Continuous temperature logging.' },
    ],
    grants: [{ id: 'G1', userId: 'mk', role: 'chemist', from: '2026-10-01', expires: '2026-10-31', reason: 'Covering instrument runs during staff leave', by: 'Himani Vaishnav' }],
    invites: [],
    training: USERS.filter((u) => !u.client).flatMap((u) => ['BPS', 'PFAS', 'OTA', 'PEP'].map((m) => ({ user: u.name, initials: u.initials, method: m, status: u.methods.includes(m) ? 'Authorized' : 'Not trained', date: u.methods.includes(m) ? '2026-0' + (3 + (u.initials.charCodeAt(0) % 5)) + '-1' + (u.initials.charCodeAt(1) % 9) : null, by: 'Himani Vaishnav' }))),
    documents: [
      { id: 'EL-QM-001', title: 'Quality manual', rev: 2, effective: '2026-01-15', owner: 'Himani Vaishnav', review: '2027-01-15' },
      { id: 'EL-SOP-001', title: 'Sample receipt, logging and chain of custody', rev: 4, effective: '2026-05-01', owner: 'Sean Condon', review: '2027-05-01' },
      { id: 'EL-SOP-002', title: 'Sample storage, retention and disposal', rev: 2, effective: '2026-02-10', owner: 'Sean Condon', review: '2027-02-10' },
      { id: 'EL-SOP-101', title: 'Bisphenol S by LC-MS/MS', rev: 3, effective: '2026-03-02', owner: 'Himani Vaishnav', review: '2027-03-02' },
      { id: 'EL-SOP-102', title: 'PFAS by LC-MS/MS', rev: 4, effective: '2026-04-20', owner: 'Himani Vaishnav', review: '2027-04-20' },
      { id: 'EL-SOP-103', title: 'Ochratoxin A by LC-MS/MS', rev: 1, effective: '2026-01-08', owner: 'Himani Vaishnav', review: '2026-10-08' },
      { id: 'EL-SOP-201', title: 'Data review, reporting and amended reports', rev: 1, effective: '2026-06-01', owner: 'Himani Vaishnav', review: '2027-06-01' },
    ],
    ncrs: [
      { id: 'NCR-2026-014', opened: '2026-09-24', by: 'Sean Condon', source: 'QC failure', text: 'Surrogate d8-BPS recovery below 50% in 5 samples of prep batch 26092402.', cause: 'Matrix suppression in dyed synthetic fabrics.', action: 'Reported with IS1 qualifier; evaluate additional cleanup step.', status: 'Open', due: '2026-10-15' },
      { id: 'NCR-2026-012', opened: '2026-09-19', by: 'Technician SD', source: 'Sample receipt', text: 'Product received did not match ASIN listing (260925-P04).', cause: 'Vendor substitution.', action: 'Client notified; replacement product received and logged.', status: 'Closed', due: '2026-09-30' },
      { id: 'NCR-2026-011', opened: '2026-09-02', by: 'Himani Vaishnav', source: 'Internal audit', text: 'Report template shows RPD limit as 0.3 instead of 30%.', cause: 'Spreadsheet formatting error.', action: 'Fixed in LIMS report template; template locked under change control.', status: 'Closed', due: '2026-09-20' },
    ],
    complaints: [{ id: 'CMP-2026-003', received: '2026-08-21', client: 'Artemis Research LLC', text: 'Requested clarification of ND vs MRL on BPS reports.', response: 'Definitions section expanded; MRL shown per analyte.', status: 'Closed' }],
    pt: [
      { id: 'PT-2026-02', provider: 'External PT provider', scheme: 'PFAS in textiles', analyte: 'PFOA', assigned: 4.2, reported: 4.6, z: 0.8, date: '2026-06-18', result: 'Satisfactory' },
      { id: 'PT-2026-01', provider: 'External PT provider', scheme: 'Bisphenols in paper', analyte: 'Bisphenol S', assigned: 152, reported: 139, z: -0.9, date: '2026-03-11', result: 'Satisfactory' },
    ],
    settings: { labName: 'Enviro Labs, LLC', address: '18102 Sky Park Circle, Suite G, Irvine, CA 92614', phone: '(949) 892-1915', email: 'support@envirolabsusa.com', tat: TAT_DAYS, disposal: DISPOSAL_DAYS },
  };
}

export function inDateLots(inv, tests) {
  const today = new Date().toISOString().slice(0, 10);
  return (inv || []).filter((x) => x.role !== 'reagent' && x.expires >= today && x.methods.some((m) => tests.includes(m)));
}
export function missingStandards(inv, tests) {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  tests.forEach((t) => {
    const need = (inv || []).filter((x) => x.methods.includes(t) && x.role !== 'reagent').map((x) => x.role);
    [...new Set(need)].forEach((role) => { if (!inv.some((x) => x.methods.includes(t) && x.role === role && x.expires >= today)) out.push(`${t} ${role}`); });
  });
  return out;
}

export function snapshotOf(sample, res) {
  // photos are evidence, not certified content: keep their references, never the image bytes
  const s = { ...sample, photos: (sample.photos || []).map(({ src, ...p }) => p) };
  return JSON.parse(JSON.stringify({ sample: s, results: res || {} }));
}

// Production starting point: configuration only, no demo data. Real data is loaded from the database.
export function emptyState() {
  return {
    session: null, roles: JSON.parse(JSON.stringify(DEFAULT_ROLES)), views: [], expected: [], inventory: [], invoices: [], pricing: { rushPct: 50 },
    notifRules: [], dismissed: [], audits: [], mgmtReviews: [], risks: [], mdl: [], validation: [], security: {}, users: [], clients: [],
    methods: JSON.parse(JSON.stringify(METHODS)), methodHistory: [], samples: [], batches: [], pendingImports: [], results: {}, reports: {}, audit: [],
    equipment: [], training: [], documents: [], ncrs: [], complaints: [], pt: [], grants: [], invites: [],
    settings: { labName: 'Enviro Labs, LLC', address: '', phone: '', email: '', tat: 14, disposal: 30 },
  };
}

const now = () => iso(Date.now());

export function reducer(state, a) {
  const who = state.session?.name || 'System';
  const log = (action, entity, detail, extra) => A(now(), who, action, entity, detail, { role: state.session ? ROLES[state.session.role]?.label : '', ...extra });
  switch (a.type) {
    case 'LOGIN': {
      const exists = state.users.find((u) => u.email === a.session.email || u.name === a.session.name);
      const users = exists ? state.users : [{ id: 'u' + Date.now(), email: a.session.email, status: 'active', name: a.session.name, initials: a.session.initials, title: a.session.title, roles: a.session.roles.filter((r) => r !== 'client'), methods: a.session.methods }, ...state.users];
      return { ...state, users, session: a.session, audit: [A(now(), a.session.name, 'Signed in', a.session.email, ''), ...state.audit] };
    }
    case 'UPDATE_USER': {
      const u0 = state.users.find((u) => u.id === a.id);
      return { ...state, users: state.users.map((u) => (u.id === a.id ? { ...u, ...a.patch } : u)), audit: [log(a.action, u0.name, a.detail || ''), ...state.audit] };
    }
    case 'INVITE':
      return { ...state, invites: [a.invite, ...state.invites], audit: [log('User invited', a.invite.email, a.invite.roles.map((r) => ROLES[r].label).join(', ') + (a.invite.expires ? ` until ${a.invite.expires}` : '')), ...state.audit] };
    case 'REVOKE_INVITE':
      return { ...state, invites: state.invites.filter((i) => i.id !== a.id), audit: [log('Invite revoked', state.invites.find((i) => i.id === a.id).email, ''), ...state.audit] };
    case 'ACCEPT_INVITE': {
      const inv = state.invites.find((i) => i.id === a.id);
      const user = { id: 'u' + Date.now(), email: inv.email, status: 'active', name: inv.name || inv.email.split('@')[0], initials: (inv.name || inv.email).split(/[ .@]/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(), title: inv.title || '', roles: inv.roles, methods: [], client: inv.roles.includes('client'), clientId: inv.clientId };
      return { ...state, users: [...state.users, user], invites: state.invites.filter((i) => i.id !== a.id), audit: [A(now(), user.name, 'Invite accepted', inv.email, 'Account created'), ...state.audit] };
    }
    case 'ADD_GRANT':
      return { ...state, grants: [a.grant, ...state.grants], audit: [log('Temporary role granted', state.users.find((u) => u.id === a.grant.userId).name, `${ROLES[a.grant.role].label} until ${a.grant.expires}. ${a.grant.reason}`), ...state.audit] };
    case 'REVOKE_GRANT': {
      const g = state.grants.find((x) => x.id === a.id);
      return { ...state, grants: state.grants.filter((x) => x.id !== a.id), audit: [log('Temporary role revoked', state.users.find((u) => u.id === g.userId).name, ROLES[g.role].label), ...state.audit] };
    }
    case 'SET_ROLE':
      return { ...state, session: { ...state.session, role: a.role }, audit: [A(now(), state.session.name, 'Role selected for session', ROLES[a.role].label, ''), ...state.audit] };
    case 'LOGOUT':
      return { ...state, session: null };
    case 'MOVE': {
      const to = STAGES.find((s) => s.key === a.to);
      const entries = [];
      let reports = state.reports;
      const samples = state.samples.map((s) => {
        if (!a.ids.includes(s.id)) return s;
        const patch = { ...s, stage: a.to, ...(a.fields || {}) };
        if (a.to === 'analysis') patch.stdLots = inDateLots(state.inventory, s.tests).map((x) => x.id);
        const back = stageIdx(a.to) < stageIdx(s.stage);
        entries.push(log(back ? `Returned to ${to.label}` : `Moved to ${to.label}`, s.id, [a.reason, a.fields?.prepBatch && `Prep batch ${a.fields.prepBatch}`, a.fields?.subsampleMass && `Subsample ${a.fields.subsampleMass} g`].filter(Boolean).join('. '), a.esig ? { esig: a.esig } : {}));
        if (a.to === 'reported') {
          const prev = reports[s.id] || [];
          { const snapshot = snapshotOf(patch, state.results[s.id]); reports = { ...reports, [s.id]: [...prev, { version: prev.length + 1, at: now(), by: who, title: state.session.title || 'Lab Manager', esig: a.esig, reason: null, snapshot, hash: reportHash(snapshot) }] }; }
          entries.push(log(`Certificate of analysis signed (v${prev.length + 1})`, s.id, 'Meaning: reviewed, approved and released', { esig: a.esig }));
        }
        return patch;
      });
      return { ...state, samples, reports, audit: [...entries.reverse(), ...state.audit] };
    }
    case 'UPDATE_SAMPLE': {
      const s0 = state.samples.find((s) => s.id === a.id);
      const changes = Object.keys(a.patch).filter((k) => JSON.stringify(s0[k]) !== JSON.stringify(a.patch[k]));
      if (!changes.length) return state;
      const detail = changes.map((k) => `${k}: ${fmtVal(s0[k])} → ${fmtVal(a.patch[k])}`).join('; ') + (a.reason ? `. Reason: ${a.reason}` : '');
      return { ...state, samples: state.samples.map((s) => (s.id === a.id ? { ...s, ...a.patch } : s)), audit: [log(a.action || 'Sample record edited', a.id, detail), ...state.audit] };
    }
    case 'INTAKE': {
      const entries = a.samples.map((s) => log('Sample received', s.id, `${s.carrier || 'Courier'}${s.tracking ? ' ' + s.tracking : ''}. Condition: ${s.condition}${s.photos?.length ? `. ${s.photos.length} receipt photo${s.photos.length > 1 ? 's' : ''} filed` : ''}${s.hold ? '. Placed on hold: ' + s.hold.reason : ''}`));
      const exp = state.expected.map((x) => { const s = a.samples.find((y) => y.expectedId === x.id); return s ? { ...x, status: 'received', labId: s.id } : x; });
      return { ...state, expected: exp, samples: [...a.samples, ...state.samples], audit: [...entries.reverse(), ...state.audit] };
    }
    case 'IMPORT_BATCH': {
      const results = { ...state.results };
      a.batch.eval.results.forEach((r) => {
        if (!state.samples.find((s) => s.id === r.id)) return;
        const prior = results[r.id]?.[a.batch.method];
        results[r.id] = { ...(results[r.id] || {}), [a.batch.method]: { batchKey: a.batch.key, ...r, prior: prior ? [...(prior.prior || []), { batchKey: prior.batchKey, acq: prior.acq, analytes: prior.analytes }] : undefined } };
      });
      return { ...state, results, batches: [a.batch, ...state.batches], pendingImports: state.pendingImports.filter((k) => k !== a.batch.key), audit: [log('Instrument data imported', a.batch.name, `${a.batch.eval.results.length} samples, ${a.batch.eval.injections} injections from ${a.batch.file}`), ...state.audit] };
    }
    case 'APPROVE_BATCH':
      return { ...state, batches: state.batches.map((b) => (b.key === a.key ? { ...b, approved: { by: who, at: now(), esig: a.esig, note: a.note } } : b)), audit: [log('Batch QC approved (e-signed)', state.batches.find((b) => b.key === a.key).name, `Meaning: reviewed and approved${a.note ? '. ' + a.note : ''}`, { esig: a.esig }), ...state.audit] };
    case 'AMEND_REPORT': {
      const prev = state.reports[a.id];
      const s = state.samples.find((x) => x.id === a.id);
      const snapshot = snapshotOf(s, state.results[a.id]);
      const v = { version: prev.length + 1, at: now(), by: who, title: state.session.title, esig: a.esig, reason: a.reason, snapshot, hash: reportHash(snapshot) };
      return { ...state, reports: { ...state.reports, [a.id]: [...prev, v] }, audit: [log(`Amended report issued (v${v.version})`, a.id, a.reason, { esig: a.esig }), ...state.audit] };
    }
    case 'UPDATE_ANALYTE': {
      const methods = JSON.parse(JSON.stringify(state.methods));
      const m = methods[a.code];
      const an = m.analytes.find((x) => x.name === a.analyte);
      const before = { ...an };
      Object.assign(an, a.patch);
      m.rev += 1;
      if (a.patch.mrl != null) m.confirm = (m.confirm || []).filter((c) => c !== 'MRL');
      const change = Object.keys(a.patch).map((k) => `${a.analyte} ${k}: ${before[k]} → ${a.patch[k]}`).join('; ');
      return { ...state, methods, methodHistory: [{ code: a.code, rev: m.rev, at: now(), by: who, change: change + '. ' + a.reason }, ...state.methodHistory], audit: [log(`Method revised to rev ${m.rev}`, m.sop, change + '. Reason: ' + a.reason), ...state.audit] };
    }
    case 'ADD_PHOTOS':
      return { ...state, samples: state.samples.map((s) => (s.id === a.id ? { ...s, photos: [...(s.photos || []), ...a.photos] } : s)), audit: [log(`Photo${a.photos.length > 1 ? 's' : ''} added`, a.id, `${a.photos.length} photo${a.photos.length > 1 ? 's' : ''} filed at ${a.photos[0].stage}`), ...state.audit] };
    case 'CAPTION_PHOTO':
      return { ...state, samples: state.samples.map((s) => (s.id === a.id ? { ...s, photos: s.photos.map((p) => (p.id === a.photoId ? { ...p, caption: a.caption } : p)) } : s)) };
    case 'DISPOSE':
      return { ...state, samples: state.samples.map((s) => (a.ids.includes(s.id) ? { ...s, disposed: { at: now(), by: who } } : s)), audit: [...a.ids.map((id) => log('Sample disposed', id, 'Retention period complete')), ...state.audit] };
    case 'ADD_NCR':
      return { ...state, ncrs: [a.ncr, ...state.ncrs], audit: [log('Nonconformance opened', a.ncr.id, a.ncr.text), ...state.audit] };
    case 'CLOSE_NCR':
      return { ...state, ncrs: state.ncrs.map((n) => (n.id === a.id ? { ...n, status: 'Closed' } : n)), audit: [log('Nonconformance closed', a.id, ''), ...state.audit] };
    case 'ADD_EXPECTED':
      return { ...state, expected: [...a.items, ...state.expected], audit: [log('Expected shipment list added', a.items[0]?.orderRef || 'Order list', `${a.items.length} item${a.items.length > 1 ? 's' : ''}`), ...state.audit] };
    case 'UPDATE_EXPECTED':
      return { ...state, expected: state.expected.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case 'ADD_ROW': {
      const row = a.row;
      return { ...state, [a.coll]: [row, ...(state[a.coll] || [])], audit: a.action ? [log(a.action, a.entity || row.id, a.detail || ''), ...state.audit] : state.audit };
    }
    case 'PATCH_ROW':
      return { ...state, [a.coll]: state[a.coll].map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)), audit: a.action ? [log(a.action, a.id, a.detail || ''), ...state.audit] : state.audit };
    case 'SET':
      return { ...state, [a.key]: a.value, audit: a.action ? [log(a.action, a.entity || '', a.detail || ''), ...state.audit] : state.audit };
    case 'METHOD_PRICE': {
      const methods = JSON.parse(JSON.stringify(state.methods));
      methods[a.code].price = a.price;
      return { ...state, methods, audit: [log('Price list changed', a.code, `$${a.price}`), ...state.audit] };
    }
    case 'MANUAL_RESULTS': {
      const key = 'M-' + a.id + '-' + a.test + '-' + Date.now();
      const r = { id: a.id, sub: '', prep: 'manual', acq: now(), file: 'manual entry', analytes: a.analytes, surrogates: [] };
      const batch = { key, name: `Manual entry ${a.id} ${a.test}`, method: a.test, file: 'Manual entry', path: '', quant: '—', instrument: state.methods[a.test].instrument, importedAt: now(), importedBy: who, manual: true, approved: null,
        eval: { method: a.test, injections: 0, calLevels: [], topCal: 0, lowCal: 0, calibration: [], ldr: [], ccv: [], calBlanks: [], preps: [], ms: [], results: [r], issues: [], acqStart: now(), acqEnd: now(), ok: true } };
      return { ...state, batches: [batch, ...state.batches], results: { ...state.results, [a.id]: { ...(state.results[a.id] || {}), [a.test]: { batchKey: key, ...r } } }, audit: [log('Results entered manually', a.id, `${a.test}: ` + a.analytes.map((x) => `${x.name} = ${x.text ?? x.value}`).join('; ')), ...state.audit] };
    }
    case 'CLIENT_DECISION':
      return { ...state, samples: state.samples.map((s) => (s.id === a.id ? { ...s, hold: a.approve ? null : { ...s.hold, reason: 'Client declined testing. Return or dispose.' }, prop65: s.prop65 ? { ...s.prop65, status: a.approve ? 'approved' : 'declined', by: who, note: a.note } : s.prop65, returned: a.approve ? null : { at: now(), note: a.note } } : s)), audit: [log(a.approve ? 'Client approved testing' : 'Client declined testing', a.id, a.note || ''), ...state.audit] };
    case 'ROLE_UPSERT': {
      const isNew = !state.roles[a.key];
      return { ...state, roles: { ...state.roles, [a.key]: a.role }, audit: [log(isNew ? 'Role created' : 'Role changed', a.role.label, a.detail || ''), ...state.audit] };
    }
    case 'ROLE_DELETE': {
      const r = { ...state.roles }; const label = r[a.key].label; delete r[a.key];
      return { ...state, roles: r, audit: [log('Role deleted', label, ''), ...state.audit] };
    }
    case 'ASSIGN_ROLE': {
      const u0 = state.users.find((u) => u.id === a.userId);
      const roles = a.add ? [...new Set([...u0.roles, a.role])] : u0.roles.filter((r) => r !== a.role);
      return { ...state, users: state.users.map((u) => (u.id === a.userId ? { ...u, roles } : u)), audit: [log(a.add ? 'Role assigned' : 'Role removed', u0.name, state.roles[a.role]?.label || a.role), ...state.audit] };
    }
    case 'UNDO_MOVE': {
      const samples = state.samples.map((s) => { const p = a.prev.find((x) => x.id === s.id); return p ? { ...s, ...p.fields } : s; });
      return { ...state, samples, audit: [...a.prev.map((p) => log('Move undone', p.id, `Returned to ${STAGES.find((x) => x.key === p.fields.stage).label}`)), ...state.audit] };
    }
    case 'COMMENT': {
      return { ...state, samples: state.samples.map((s) => (s.id === a.id ? { ...s, comments: [...(s.comments || []), { at: now(), by: state.session.initials, name: who, text: a.text, mentions: a.mentions }] } : s)), audit: [log('Comment added', a.id, a.text.slice(0, 120)), ...state.audit] };
    }
    case 'REMOTE': {
      // a change made by someone else, pushed by the database in real time
      if (a.coll === 'results') return { ...state, results: { ...state.results, [a.sampleId]: { ...(state.results[a.sampleId] || {}), [a.test]: a.data } } };
      if (a.coll === 'reports') { const prev = (state.reports[a.sampleId] || []).filter((v) => v.version !== a.v.version); return { ...state, reports: { ...state.reports, [a.sampleId]: [...prev, a.v].sort((x, y) => x.version - y.version) } }; }
      if (a.coll === 'audit') return state.audit.some((x) => x.sid === a.item.sid) ? state : { ...state, audit: [a.item, ...state.audit] };
      const key = a.coll === 'batches' ? 'key' : 'id';
      const list = state[a.coll] || [];
      const i = list.findIndex((x) => x[key] === a.item[key]);
      return { ...state, [a.coll]: i < 0 ? [a.item, ...list] : list.map((x, k) => (k === i ? a.item : x)) };
    }
    case 'RESET':
      return { ...buildInitial(), session: state.session };
    default:
      return state;
  }
}
const fmtVal = (v) => (v == null ? '—' : typeof v === 'object' ? (v.reason || v.status || 'set') : String(v));
