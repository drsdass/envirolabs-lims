-- Enviro Labs LIMS — foundation schema
-- Every table has row-level security. Permissions come from the admin-editable roles table,
-- so changing a role in the app changes what the database allows.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- roles and people
create table public.roles (
  key        text primary key,
  data       jsonb not null,               -- { label, desc, color, perms: { sign: true, ... } }
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  name       text not null,
  initials   text not null,
  title      text default '',
  roles      text[] not null default '{}',
  methods    text[] not null default '{}',  -- method training authorizations (mirrors the training record)
  status     text not null default 'active' check (status in ('active','inactive')),
  client_id  text,                          -- set for client-portal contacts
  mfa        boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.my_profile() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;

-- true when any of the caller's roles allows the permission
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr join public.roles r on r.key = any(pr.roles)
    where pr.id = auth.uid() and pr.status = 'active' and coalesce((r.data->'perms'->>p)::boolean, false)
  )
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr join public.roles r on r.key = any(pr.roles)
    where pr.id = auth.uid() and pr.status = 'active' and not coalesce((r.data->'perms'->>'portal')::boolean, false)
  )
$$;

create or replace function public.my_client() returns text
language sql stable security definer set search_path = public as $$
  select client_id from public.profiles where id = auth.uid()
$$;

-- The first person to sign up claims Lab Admin + Lab Manager. After that, only admins assign roles.
create or replace function public.claim_first_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles pr join public.roles r on r.key = any(pr.roles)
             where coalesce((r.data->'perms'->>'users')::boolean,false) and pr.status='active') then
    return false;
  end if;
  update public.profiles set roles = array['admin','manager'], methods = array['BPS','PFAS','OTA','PEP'] where id = auth.uid();
  return true;
end $$;

-- create a profile row automatically for every new auth user.
-- Roles and client link come ONLY from a pending invite written by an admin (never from sign-up metadata).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv jsonb; n text;
begin
  select data into inv from public.invites where lower(data->>'email') = lower(new.email) order by updated_at desc limit 1;
  n := coalesce(nullif(inv->>'name',''), new.raw_user_meta_data->>'name', split_part(new.email,'@',1));
  insert into public.profiles (id, email, name, initials, title, roles, client_id)
  values (new.id, lower(new.email), n,
          upper(left(regexp_replace(n,'[^A-Za-z ]','','g'),1) || coalesce(left(split_part(n,' ',2),1),'')),
          coalesce(inv->>'title',''),
          coalesce(array(select jsonb_array_elements_text(inv->'roles')), '{}'),
          inv->>'clientId')
  on conflict (id) do nothing;
  delete from public.invites where lower(data->>'email') = lower(new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- samples and results
create table public.samples (
  id          text primary key,                 -- lab ID, e.g. 261004-B01
  client_id   text not null,
  stage       text not null check (stage in ('received','prep','extraction','analysis','review','manager','reported')),
  received_at timestamptz not null,
  legacy      boolean not null default false,
  assignee    text,
  tests       text[] not null,
  name        text not null,
  asin        text,
  prep_batch  text,
  data        jsonb not null,                   -- full record (holds, photos paths, comments, bins…)
  search      tsvector generated always as (to_tsvector('simple', coalesce(id,'') || ' ' || coalesce(name,'') || ' ' || coalesce(asin,'') || ' ' || coalesce(prep_batch,''))) stored,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);
create index samples_stage_idx on public.samples (stage) where not legacy;
create index samples_client_idx on public.samples (client_id, received_at desc);
create index samples_received_idx on public.samples (received_at desc);
create index samples_search_idx on public.samples using gin (search);
create index samples_name_trgm on public.samples using gin (name gin_trgm_ops);

-- reported and legacy records are locked: only disposal/assignment metadata may change
create or replace function public.guard_sample() returns trigger language plpgsql as $$
begin
  if old.stage = 'reported' and new.stage <> 'reported' then
    raise exception 'Sample % has a signed certificate. Issue an amended report instead.', old.id;
  end if;
  if old.legacy and (new.name is distinct from old.name or new.tests is distinct from old.tests) then
    raise exception 'Legacy record % is read-only.', old.id;
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
create trigger samples_guard before update on public.samples for each row execute function public.guard_sample();

create table public.results (
  sample_id  text not null references public.samples(id) on delete restrict,
  test       text not null,
  data       jsonb not null,                    -- analytes, surrogates, qualifiers, batch key, prior results
  updated_at timestamptz not null default now(),
  primary key (sample_id, test)
);

create table public.batches (
  key        text primary key,                  -- instrument run / manual entry
  method     text not null,
  approved   boolean generated always as ((data ? 'approved') and data->'approved' <> 'null'::jsonb) stored,
  data       jsonb not null,                    -- evaluation, raw rows, approval signature
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- Certificates: insert-only. A version can never be edited or deleted; amendments are new versions.
create table public.report_versions (
  sample_id  text not null references public.samples(id) on delete restrict,
  version    int  not null,
  hash       text not null,                     -- SHA-256 of the signed snapshot
  signed_by  text not null,
  signed_at  timestamptz not null default now(),
  esig       text not null,
  reason     text,                              -- amendment reason (null for v1)
  data       jsonb not null,                    -- frozen snapshot of sample + results
  created_by uuid not null default auth.uid(),
  primary key (sample_id, version)
);
create or replace function public.no_change() returns trigger language plpgsql as $$
begin raise exception '% rows are permanent and cannot be changed or deleted.', tg_table_name; end $$;
create trigger report_versions_locked before update or delete on public.report_versions for each row execute function public.no_change();

-- ---------------------------------------------------------------- audit trail (append-only)
create table public.audit_log (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),  -- server time, not the browser's
  actor     uuid default auth.uid(),            -- null only for server-side migration jobs
  user_name text not null,
  role      text,
  action    text not null,
  entity    text,
  detail    text,
  esig      text,
  client_ts timestamptz
);
create index audit_entity_idx on public.audit_log (entity, ts desc);
create index audit_ts_idx on public.audit_log (ts desc);
create or replace function public.stamp_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.ts := now(); new.actor := auth.uid();
  new.user_name := coalesce((select name from public.profiles where id = auth.uid()), new.user_name);
  return new;
end $$;
create trigger audit_stamp before insert on public.audit_log for each row execute function public.stamp_audit();
create trigger audit_locked before update or delete on public.audit_log for each row execute function public.no_change();

-- ---------------------------------------------------------------- other collections (id + jsonb)
do $$
declare t text;
begin
  foreach t in array array['clients','expected','inventory','equipment','invoices','ncrs','audits','mgmt_reviews','risks','mdl','validation','documents','complaints','pt','grants','invites','views','training'] loop
    execute format('create table public.%I (id text primary key, data jsonb not null, updated_at timestamptz not null default now(), updated_by uuid default auth.uid())', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- singletons: methods, settings, security, notification rules, pricing, method history, historical QC summary
create table public.kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now(), updated_by uuid default auth.uid());

-- ---------------------------------------------------------------- row-level security
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.samples enable row level security;
alter table public.results enable row level security;
alter table public.batches enable row level security;
alter table public.report_versions enable row level security;
alter table public.audit_log enable row level security;
alter table public.kv enable row level security;

create policy roles_read  on public.roles for select to authenticated using (true);
create policy roles_write on public.roles for all    to authenticated using (has_perm('users')) with check (has_perm('users'));

create policy profiles_read on public.profiles for select to authenticated using (is_staff() or id = auth.uid());
create policy profiles_admin on public.profiles for update to authenticated using (has_perm('users')) with check (has_perm('users'));
create policy profiles_self on public.profiles for update to authenticated using (id = auth.uid())
  with check (id = auth.uid() and roles = (select roles from public.profiles where id = auth.uid()) and status = (select status from public.profiles where id = auth.uid()));

create policy samples_read   on public.samples for select to authenticated using (is_staff() or client_id = my_client());
create policy samples_insert on public.samples for insert to authenticated with check (has_perm('intake'));
create policy samples_update on public.samples for update to authenticated using (is_staff()) with check (is_staff());
-- clients may record a Prop 65 decision on their own held samples (handled by RPC below)

create policy results_read  on public.results for select to authenticated using (is_staff() or exists (select 1 from public.samples s where s.id = sample_id and s.client_id = my_client() and s.stage = 'reported'));
create policy results_write on public.results for all    to authenticated using (has_perm('import') or has_perm('results')) with check (has_perm('import') or has_perm('results'));

create policy batches_read   on public.batches for select to authenticated using (is_staff());
create policy batches_insert on public.batches for insert to authenticated with check (has_perm('import') or has_perm('results'));
create policy batches_update on public.batches for update to authenticated using (has_perm('approve') or has_perm('import')) with check (has_perm('approve') or has_perm('import'));

create policy reports_read   on public.report_versions for select to authenticated using (is_staff() or exists (select 1 from public.samples s where s.id = sample_id and s.client_id = my_client()));
create policy reports_insert on public.report_versions for insert to authenticated with check (has_perm('sign') or (version > 1 and has_perm('amend')));

create policy audit_read   on public.audit_log for select to authenticated using (is_staff());
create policy audit_insert on public.audit_log for insert to authenticated with check (actor = auth.uid());

create policy kv_read  on public.kv for select to authenticated using (true);
create policy kv_write on public.kv for all to authenticated
  using (case key when 'methods' then has_perm('methods') when 'methodHistory' then has_perm('methods') when 'pricing' then has_perm('billing') when 'hist' then has_perm('users') else has_perm('users') end)
  with check (case key when 'methods' then has_perm('methods') when 'methodHistory' then has_perm('methods') when 'pricing' then has_perm('billing') when 'hist' then has_perm('users') else has_perm('users') end);

-- collection policies: staff read; write by the matching permission
do $$
declare r record;
begin
  for r in select * from (values
    ('clients','users'), ('expected','intake'), ('inventory','inventory'), ('equipment','quality'), ('invoices','billing'),
    ('ncrs','quality'), ('audits','quality'), ('mgmt_reviews','quality'), ('risks','quality'), ('mdl','methods'),
    ('validation','quality'), ('documents','quality'), ('complaints','quality'), ('pt','quality'), ('grants','users'),
    ('invites','users'), ('training','quality')) as v(t, p) loop
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (is_staff())', r.t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated using (has_perm(%2$L)) with check (has_perm(%2$L))', r.t, r.p);
  end loop;
end $$;
-- clients can see their own client record and add order lists for themselves
create policy clients_own on public.clients for select to authenticated using (id = my_client());
create policy expected_client_read on public.expected for select to authenticated using (data->>'clientId' = my_client());
create policy expected_client_add  on public.expected for insert to authenticated with check (data->>'clientId' = my_client());
-- equipment logbook entries can be added by anyone in the lab
create policy equipment_staff_update on public.equipment for update to authenticated using (is_staff()) with check (is_staff());
-- saved views belong to their owner (shared views are readable by all staff)
create policy views_read  on public.views for select to authenticated using (data->>'user' = (select name from public.profiles where id = auth.uid()) or (data->>'shared')::boolean or is_staff());
create policy views_write on public.views for all to authenticated using (data->>'user' = (select name from public.profiles where id = auth.uid())) with check (data->>'user' = (select name from public.profiles where id = auth.uid()));

-- ---------------------------------------------------------------- RPCs
-- Client portal: approve or decline testing for one of the client's held samples.
create or replace function public.client_decision(p_sample text, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.samples; pr public.profiles := my_profile();
begin
  select * into s from public.samples where id = p_sample and client_id = pr.client_id for update;
  if not found or (s.data->'hold') is null or s.data->'hold' = 'null'::jsonb then raise exception 'No decision is pending for %', p_sample; end if;
  update public.samples set data = data
      || jsonb_build_object('hold', case when p_approve then 'null'::jsonb else jsonb_build_object('reason','Client declined testing. Return or dispose.') end)
      || jsonb_build_object('prop65', coalesce(data->'prop65','{}'::jsonb) || jsonb_build_object('status', case when p_approve then 'approved' else 'declined' end, 'by', pr.name, 'note', p_note))
    where id = p_sample;
  insert into public.audit_log (user_name, role, action, entity, detail) values (pr.name, 'Client portal', case when p_approve then 'Client approved testing' else 'Client declined testing' end, p_sample, p_note);
end $$;

-- Public certificate verification (no login). Returns only what is printed on the certificate.
create or replace function public.verify_report(p_report text, p_code text default null)
returns table (valid boolean, sample_id text, version int, signed_by text, signed_at timestamptz, esig text, superseded boolean, message text)
language plpgsql stable security definer set search_path = public as $$
declare m text[]; v public.report_versions; latest int;
begin
  m := regexp_match(upper(trim(p_report)), '^(\d{6}-[A-Z]+\d+L?)-R(\d+)$');
  if m is null then return query select false, null::text, null::int, null::text, null::timestamptz, null::text, null::boolean, 'Enter the report number exactly as printed, e.g. 260922-B13-R1.'; return; end if;
  select * into v from public.report_versions where report_versions.sample_id = m[1] and report_versions.version = m[2]::int;
  if not found then return query select false, m[1], m[2]::int, null::text, null::timestamptz, null::text, null::boolean, 'No report with that number exists in this laboratory''s records.'; return; end if;
  select max(r.version) into latest from public.report_versions r where r.sample_id = m[1];
  if p_code is not null and length(trim(p_code)) > 0 and left(v.hash, length(trim(p_code))) <> lower(trim(p_code)) then
    return query select false, v.sample_id, v.version, v.signed_by, v.signed_at, v.esig, latest > v.version, 'The verification code does not match this report. The document may have been altered.'; return;
  end if;
  return query select true, v.sample_id, v.version, v.signed_by, v.signed_at, v.esig, latest > v.version, null::text;
end $$;
grant execute on function public.verify_report(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- storage for photos and certificates
insert into storage.buckets (id, name, public) values ('sample-photos', 'sample-photos', false) on conflict do nothing;
create policy photos_staff_read  on storage.objects for select to authenticated using (bucket_id = 'sample-photos' and public.is_staff());
create policy photos_staff_write on storage.objects for insert to authenticated with check (bucket_id = 'sample-photos' and public.is_staff());
create policy photos_client_read on storage.objects for select to authenticated using (
  bucket_id = 'sample-photos' and exists (select 1 from public.samples s where s.id = split_part(name, '/', 1) and s.client_id = public.my_client()));

-- ---------------------------------------------------------------- realtime: everyone sees moves live
alter publication supabase_realtime add table public.samples, public.results, public.batches, public.report_versions, public.audit_log;
