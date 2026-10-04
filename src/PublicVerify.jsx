import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { LOGO_FULL } from './logo.js';

// Public page (no login). Anyone holding a certificate can confirm it is genuine and unaltered.
const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const fmt = (s) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function PublicVerify() {
  const fromPath = decodeURIComponent(window.location.pathname.replace(/^\/verify\/?/, ''));
  const [rid, setRid] = useState(fromPath);
  const [code, setCode] = useState(new URLSearchParams(window.location.search).get('c') || '');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async (e) => {
    e?.preventDefault(); setBusy(true);
    const { data, error } = await sb.rpc('verify_report', { p_report: rid, p_code: code || null });
    setBusy(false);
    setRes(error ? { valid: false, message: 'The verification service is unavailable. Try again shortly.' } : data[0]);
  };
  useEffect(() => { if (fromPath) check(); }, []);
  return (
    <div className="auth">
      <div className="auth-card verify-card">
        <img src={LOGO_FULL} alt="Enviro Labs" className="auth-logo-img" />
        <h1>Verify a certificate</h1>
        <p className="muted small center">Enter the report number and the code printed under the QR code on the certificate.</p>
        <form onSubmit={check}>
          <label className="field"><span>Report number</span><input value={rid} onChange={(e) => setRid(e.target.value)} placeholder="260922-B13-R1" /></label>
          <label className="field"><span>Verification code</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="12 characters" /></label>
          <button className="btn primary block" disabled={busy || !rid}>{busy ? 'Checking…' : 'Verify'}</button>
        </form>
        {res && (res.valid ? (
          <div className="callout ok"><div><b>Authentic.</b> Report {res.sample_id}-R{res.version} was issued by Enviro Labs and electronically signed by {res.signed_by} on {fmt(res.signed_at)} (signature {res.esig}).{res.superseded && <><br /><b>Note:</b> this version has been replaced by an amended report. Ask the laboratory for the current version.</>}</div></div>
        ) : <div className="callout fail"><div><b>Not verified.</b> {res.message}</div></div>)}
        <p className="muted small center">Enviro Labs, LLC · 18102 Sky Park Circle, Suite G, Irvine, CA 92614 · (949) 892-1915</p>
      </div>
    </div>
  );
}
