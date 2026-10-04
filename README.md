# Enviro Labs LIMS

Laboratory information management system for Enviro Labs (Irvine, CA): sample intake with photos, gated workflow board, MassHunter import with automatic QC, signed and verifiable certificates, client portal, ISO/IEC 17025 quality records, billing and analytics.

React (Vite) on Vercel · Supabase (Postgres, Auth, Storage, Realtime, Edge Functions).

Without database settings the app runs as a self-contained demo with sample data (`npm run dev`).

---

## One-time setup

### 1. Supabase project
1. Create a project at supabase.com. Use the **Pro plan** so you get daily backups and point-in-time recovery.
2. **Authentication › Providers › Email**: keep email sign-in on, turn **"Allow new users to sign up" off**. Accounts are created by invitation only.
3. **Authentication › URL Configuration**: Site URL `https://lims.envirolabsusa.com`; add the same URL to Redirect URLs (plus `http://localhost:5173` for local testing).
4. **Authentication › Multi-Factor**: make sure TOTP (authenticator app) is enabled.
5. **Project Settings › Auth › SMTP**: connect a sender (for example Resend or your Microsoft 365 mailbox) so invitations come from `reports@envirolabsusa.com`, not Supabase.

### 2. Database
Open **SQL Editor** and run, in order:
1. `supabase/migrations/20261004000000_init.sql` — tables, security rules, audit trail, certificate lock, verification
2. `supabase/migrations/20261004000100_seed.sql` — default roles, methods, lab settings, current clients

(Or with the Supabase CLI: `supabase link` then `supabase db push`.)

### 3. Invitation email function
```
supabase functions deploy invite-user
supabase secrets set SITE_URL=https://lims.envirolabsusa.com
```

### 4. Vercel
1. Import the GitHub repo `drsdass/envirolabs-lims`.
2. Environment variables (Production):
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase › Project Settings › API
   - `VITE_SITE_URL` = `https://lims.envirolabsusa.com`
3. **Domains**: add `lims.envirolabsusa.com` and create the CNAME record Vercel shows at your DNS provider.

### 5. First administrator
1. Supabase › Authentication › Users › **Add user**: your email and a strong password, tick *Auto confirm*.
2. Sign in at the LIMS. The first person to sign in becomes **Lab Admin + Lab Manager** and is asked to set up 2-step sign-in.
3. Go to **Users › Invite user** for everyone else. Roles are attached to the invite; people set their own password from the email.

### 6. Bring in the history
On your computer (never on Vercel):
```
copy .env.example .env      # fill in VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm install
npm run import:workbook -- "Sample tracking and reporting - Enviro Labs.xlsx" --dry-run
npm run import:workbook -- "Sample tracking and reporting - Enviro Labs.xlsx"
```
It imports every logged sample as a read-only legacy record, runs every `Gen_LIMs_*` export through the same QC engine as the app, attaches results, and loads the QC history used by control charts and uncertainty. Re-running skips lab IDs already present.

---

## How the data is protected
- **Row-level security on every table.** What the database allows follows the roles you edit in the app (Users › Roles & permissions).
- **Invite-only roles.** A new account gets roles only from an invitation written by an admin; sign-up data is ignored.
- **Append-only audit trail.** The server stamps who and when; entries cannot be edited or deleted, even by admins.
- **Locked certificates.** Signed report versions cannot be changed or deleted; corrections are new versions with a reason. A sample with a signed certificate cannot be moved back.
- **Public verification** at `/verify` checks a report number and code against the stored fingerprint without exposing anything else.
- **Photos** are in private storage, viewable by lab staff and by the client who owns the sample.
- **E-signatures** re-enter the user's password.

## Day-to-day development
```
npm install
npm run dev          # demo mode, or set .env to work against Supabase
```
Push changes:
```
cd C:\Users\sdaas\envirolabs-lims
git add -A
git commit -m "Describe the change"
git push --force origin main
```
Vercel deploys automatically.

## Status
Live in this foundation: sign-in with 2-step, invites, roles and permissions, audit trail, all workflow screens saving to the database, photos in storage, real-time updates between users, locked certificates, public verification, history import.

Next: email/text delivery for notifications, instrument-PC agent for automatic result import and chromatogram images, server-side paging for very large searches, sample aliquots, quotes.
