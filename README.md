# FH Habibur Tech Management System — Starter Release

A deployable Next.js + Supabase foundation for your agency. It includes email/password login, client directory, campaign budgets in USD, stored BDT exchange rates, BDT payment records, basic reports, and database row-level security policies for Admin, Accountant and Employee roles.

## Requirements
- Node.js 20.9 or newer
- Supabase project
- Vercel account for free-tier initial testing

## A. Set up database
1. Create a Supabase project.
2. Open SQL Editor and run all of `supabase/schema.sql`.
3. Enable Email authentication in Authentication → Providers.
4. For initial testing only, you may disable email confirmation; enable it before inviting staff.

## B. Configure locally
1. Copy `.env.example` to `.env.local`.
2. Add your Supabase Project URL and anon/publishable key from Project Settings → API.
3. Never expose the Supabase `service_role` secret in browser code or a `NEXT_PUBLIC_` variable.

```bash
npm install
npm run dev
```
Open http://localhost:3000.

## C. Create the first Admin
1. Register your own email through the app.
2. In Supabase SQL Editor run this after replacing the email:

```sql
update public.profiles set role='admin', full_name='FH Habibur Rahman'
where id=(select id from auth.users where email='YOUR_ADMIN_EMAIL');
```
3. Sign out and sign in again. New users default to Employee. Promote an accountant explicitly:

```sql
update public.profiles set role='accountant'
where id=(select id from auth.users where email='ACCOUNTANT_EMAIL');
```

## D. Deploy on Vercel free tier
1. Push the project to a private GitHub repository.
2. Import that repository in Vercel → Add New Project.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel Environment Variables.
4. Deploy. Set Supabase Authentication → URL Configuration Site URL and Redirect URLs to your Vercel deployment URL.
5. Open the Vercel URL from phone or computer.

## Accounting design rules
- Campaign budgets and media spend are in USD.
- Store the USD/BDT exchange rate per campaign/transaction so historical conversions do not shift when rates change.
- Record client collections in BDT.
- Ads budget is not agency revenue. Separate ad spend, agency service fees and operating expenses.
- This starter does not yet calculate invoice-based due balances or reconciled net profit. Do not treat collections as profit.

## Next build milestones
- Campaign spend entries, start/end dates, platform and objective editing.
- Invoice generation, due ledger and receipt PDF.
- Expense and dollar-wallet transaction UI.
- Admin team-management screen and granular employee permissions.
- Audit-log UI, CSV/PDF exports, backups and automated tests.

Before using for real financial records, test each role with separate accounts, verify all RLS policies, enable email confirmation and MFA for Admin, and reconcile values against actual bank/ad-platform statements.
