import React, { useEffect, useRef, useState } from 'react';
import App from './App.jsx';
import { supabase, loadState, persist, subscribe, onSyncStatus } from './lib/sync.js';
import { ESIG, PROD, Field, Icon } from './ui.jsx';
import { SITE } from './pages2.jsx';
import { LOGO_FULL } from './logo.js';

PROD.on = true;
SITE.url = import.meta.env.VITE_SITE_URL || window.location.origin;

function Card({ children }) {
  return <div className="auth"><div className="auth-card"><img src={LOGO_FULL} alt="Enviro Labs" className="auth-logo-img" />{children}</div></div>;
}

export default function ProdRoot() {
  const [phase, setPhase] = useState('checking'); // checking | signin | setpw | mfa-enroll | mfa-verify | noaccess | loading | ready
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [initial, setInitial] = useState(null);
  const [progress, setProgress] = useState('');
  const [profile, setProfile] = useState(null);
  const [enroll, setEnroll] = useState(null);
  const [status, setStatus] = useState({});
  const prev = useRef(null);

  useEffect(() => onSyncStatus(setStatus), []);
  useEffect(() => {
    const isSetup = /type=(invite|recovery)/.test(window.location.hash);
    supabase.auth.getSession().then(({ data }) => { if (data.session) (isSetup ? setPhase('setpw') : afterSignIn()); else setPhase('signin'); });
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') setPhase('setpw'); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function afterSignIn() {
    setErr('');
    const { data: { user } } = await supabase.auth.getUser();
    let { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (p && !p.roles.length) { const { data: claimed } = await supabase.rpc('claim_first_admin'); if (claimed) ({ data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()); }
    if (!p || !p.roles.length || p.status !== 'active') { setProfile(p); setPhase('noaccess'); return; }
    setProfile(p);
    // e-signatures re-enter the account password
    ESIG.label = 'Password'; ESIG.hint = 'Re-enter your password to sign. This confirms it is you.';
    ESIG.verify = async (pw) => !!pw && !(await supabase.auth.signInWithPassword({ email: p.email, password: pw })).error;
    // 2-step sign-in
    const { data: roles } = await supabase.from('roles').select('*');
    const needsMfa = (roles || []).some((r) => p.roles.includes(r.key) && r.data.perms?.mfa);
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { setPhase('mfa-verify'); return; }
    if (needsMfa && aal.currentLevel !== 'aal2') {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Enviro Labs LIMS' });
      if (error) { setErr(error.message); setPhase('signin'); return; }
      setEnroll(data); setPhase('mfa-enroll'); return;
    }
    await load(p);
  }
  async function load(p) {
    setPhase('loading');
    try { const st = await loadState(p, setProgress); prev.current = st; setInitial(st); setPhase('ready'); }
    catch (e) { setErr(e.message); setPhase('signin'); }
  }
  const signIn = async (e) => {
    e.preventDefault(); setErr('');
    const f = new FormData(e.target);
    const { error } = await supabase.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) return setErr(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
    afterSignIn();
  };
  const reset = async (email) => {
    if (!email) return setErr('Enter your email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMsg(error ? '' : 'Check your email for a link to set a new password.'); if (error) setErr(error.message);
  };
  const setPassword = async (e) => {
    e.preventDefault(); setErr('');
    const f = new FormData(e.target); const pw = f.get('pw');
    if (pw.length < 12) return setErr('Use at least 12 characters.');
    if (pw !== f.get('pw2')) return setErr('The passwords do not match.');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setErr(error.message);
    window.history.replaceState(null, '', window.location.pathname);
    afterSignIn();
  };
  const verifyCode = async (code, factorId) => {
    setErr('');
    const fid = factorId || (await supabase.auth.mfa.listFactors()).data?.totp?.[0]?.id;
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId: fid });
    if (e1) return setErr(e1.message);
    const { error } = await supabase.auth.mfa.verify({ factorId: fid, challengeId: ch.id, code });
    if (error) return setErr('That code did not work. Check the time on your phone and try again.');
    if (enroll) await supabase.from('profiles').update({ mfa: true }).eq('id', profile.id);
    await load(profile);
  };
  const logout = async () => { await supabase.auth.signOut(); setInitial(null); setPhase('signin'); };

  if (phase === 'ready') {
    return (
      <>
        <App initial={initial} onLogout={logout}
          onReady={(dispatch) => { subscribe(dispatch, profile.id); }}
          onState={(st) => { persist(prev.current, st); prev.current = st; }} />
        <div className={`sync-pill ${status.error ? 'err' : status.saving ? 'busy' : ''}`} role="status">{status.error ? `Not saved: ${status.error}` : status.saving ? 'Saving…' : 'All changes saved'}</div>
      </>
    );
  }
  if (phase === 'checking' || phase === 'loading') return <Card><h1>{phase === 'loading' ? 'Opening the LIMS' : 'One moment'}</h1><p className="muted center">{progress || 'Checking your session…'}</p></Card>;
  if (phase === 'setpw') return (
    <Card><h1>Set your password</h1>
      <form onSubmit={setPassword}><Field label="New password" hint="At least 12 characters."><input name="pw" type="password" autoComplete="new-password" required /></Field><Field label="Repeat password"><input name="pw2" type="password" autoComplete="new-password" required /></Field>{err && <p className="err">{err}</p>}<button className="btn primary block">Save and continue</button></form>
    </Card>
  );
  if (phase === 'mfa-enroll') return (
    <Card><h1>Set up 2-step sign-in</h1>
      <p className="small">Your role requires a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Scan this code, then enter the 6 digits it shows.</p>
      <img className="mfa-qr" src={enroll.totp.qr_code} alt="Authenticator QR code" />
      <p className="muted small center">Can't scan? Enter this key: <span className="mono-code">{enroll.totp.secret}</span></p>
      <CodeForm onCode={(c) => verifyCode(c, enroll.id)} err={err} />
    </Card>
  );
  if (phase === 'mfa-verify') return <Card><h1>Enter your sign-in code</h1><p className="small center">Open your authenticator app and enter the 6-digit code for Enviro Labs LIMS.</p><CodeForm onCode={(c) => verifyCode(c)} err={err} /><button className="link small" onClick={logout}>Use a different account</button></Card>;
  if (phase === 'noaccess') return <Card><h1>No access yet</h1><p className="small">{profile?.status === 'inactive' ? 'This account has been deactivated.' : 'Your account exists but no role has been assigned. Ask a Lab Admin to add you on the Users page.'}</p><button className="btn ghost block" onClick={logout}>Sign out</button></Card>;
  return (
    <Card><h1>Sign in to the LIMS</h1>
      <form onSubmit={signIn}>
        <Field label="Work email"><input name="email" type="email" autoComplete="username" required id="em" /></Field>
        <Field label="Password"><input name="password" type="password" autoComplete="current-password" required /></Field>
        {err && <p className="err">{err}</p>}{msg && <p className="small">{msg}</p>}
        <button className="btn primary block">Sign in</button>
      </form>
      <button className="link small" onClick={() => reset(document.getElementById('em').value)}>Forgot password?</button>
      <p className="muted small">Accounts are created by invitation. Ask your Lab Admin if you need access.</p>
    </Card>
  );
}

function CodeForm({ onCode, err }) {
  const [c, setC] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onCode(c); }}>
      <input className="code-in" value={c} onChange={(e) => setC(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus aria-label="6-digit code" />
      {err && <p className="err">{err}</p>}
      <button className="btn primary block" disabled={c.length !== 6}>Verify</button>
    </form>
  );
}
