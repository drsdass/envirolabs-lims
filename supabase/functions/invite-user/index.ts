// Sends a Supabase invitation email. Only callable by someone whose role can manage users.
// Deploy: supabase functions deploy invite-user   (set SITE_URL in the function's secrets)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: allowed } = await asUser.rpc('has_perm', { p: 'users' });
    if (!allowed) return json({ error: 'Your role cannot invite users.' }, 403);
    const { email, name } = await req.json();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'A valid email is required.' }, 400);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // roles and client link are read from the invites row the app saved first (see handle_new_user)
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { data: { name }, redirectTo: Deno.env.get('SITE_URL') ?? undefined });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
