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

## Invoice and team access update

The current app includes an itemized BDT invoice screen. Finance users can create invoices with line items, view saved invoices, and print or save an invoice as PDF from the browser print dialog. Invoice totals feed the existing client due summary. The app does not send invoice emails automatically; download/print the PDF and send it through your normal email or WhatsApp workflow.

The Admin-only Team Access screen lists registered accounts and lets an Admin assign the `employee`, `accountant` or `admin` role. Staff must first create their own account from the login screen; new accounts default to Employee. Role changes are applied after the user signs out and signs in again. This screen does not send invitation emails or suspend Auth accounts.

### Required additive database migration
After the current v3 finance schema is installed, run `supabase/migrations/20261120_invoice_team_access.sql` once in Supabase SQL Editor. It adds `profiles.email`, backfills existing emails from Supabase Auth, and keeps emails synced for new registrations and Auth email changes. It does not delete or rewrite client, campaign, payment, invoice, spend or purchase data.

Existing Admin profile RLS policies must remain enabled: Admin may read/update profiles; non-admin users may read only their own profile. The Admin screen relies on that policy boundary.

## Employee client assignment access

Employees do not automatically see every client after approval. Admin must assign specific clients from the Team Access screen. The Employee's Client list and Campaign list are filtered by those assignments; Campaign access follows the assigned Client automatically. Employees cannot create new Clients. They may create Campaigns only for clients assigned to them.

Admin/Accountant retain full Client and Campaign visibility. Supabase Row Level Security enforces the same rules at the database level, so a direct API query cannot bypass the assignment list.

### Required additive database migration
After the Admin approval migration has been run, run `supabase/migrations/20261120_employee_client_assignments.sql` in Supabase SQL Editor. It creates the assignment table and Admin-only assignment function, then changes Client/Campaign RLS policies. Existing business records are preserved. Before this migration is active, do not rely on Employee Client/Campaign views as access-filtered.

After merging and deploying, go to **Team Access** as Admin, select the Client checkboxes under each Employee, and press **Save assigned clients**. Removing a checkmark and saving revokes access to that Client and its Campaigns.

## Remaining milestones
- Invoice email delivery and client-facing invoice portal.
- Granular permission settings and safe Auth-user suspension.
- Audit-log UI, CSV exports, backups and automated tests.

Before using for real financial records, test each role with separate accounts, verify all RLS policies, enable email confirmation and MFA for Admin, and reconcile values against actual bank/ad-platform statements.
