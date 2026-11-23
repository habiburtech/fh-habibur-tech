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
- The basic starter schema alone does not calculate reconciled invoice payment status or net profit. Install the additive invoice-payment and v3 finance migrations described below before relying on those reports. Do not treat collections as profit. The Monthly Campaign Accrual report includes Campaign Spend service charges and FX margin less operating expenses. Invoices are formal documents for the same Campaign Spend bill, not additional revenue, and are not added again to profit.

## Invoice and team access update

The current app includes an itemized BDT invoice screen. Finance users can create invoices with line items, view saved invoices, and print or save an invoice as PDF from the browser print dialog. An Invoice is the formal document for the same Campaign Spend bill, not a second charge. Client Due uses the greater of the RLS-filtered Campaign Spend bill total and issued Invoice total per client (Draft and Void invoices are excluded), so the same bill is never added twice. This also preserves legacy invoice balances where old Campaign Spend ledger rows are unavailable. All recorded Client Payments reduce the overall Client Due balance. The app does not send invoice emails automatically; download/print the PDF and send it through your normal email or WhatsApp workflow.

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

## Employee module permissions

Admin can set each Employee's access to Dashboard, Clients, Campaigns, Campaign Spend, Dollar Purchases, Client Due, Invoices, Payments, Expenses and Reports as **No Access**, **View Only** or **Manage**. Supabase RLS enforces the module permission and assigned-client scope; hiding a menu item is not the security boundary.

### Required additive database migration
After the Admin approval and Employee client-assignment migrations, run `supabase/migrations/20261121_employee_module_permissions.sql` once in Supabase SQL Editor. It seeds the agreed default permissions for existing and new Employees, adds the Admin-only permission-save RPC, and replaces the relevant RLS policies. Existing business records are preserved.

Default Employee access is Dashboard/View, Clients/View, Campaigns/Manage, Campaign Spend/View, Client Due/View, Invoices/View and Payments/View. Dollar Purchases, Expenses and Reports start as No Access. Reports granted to an Employee show only assigned-client aggregates; company-wide expenses and profit remain hidden. Dollar Purchases and Expenses expose company-wide financial information. Campaign Spend Manage requires Dollar Purchases Manage because an Employee who records spend must consume a selected USD lot.

After both the migration and app deployment are active, open **Team Access** as Admin. Under each Employee, first save Client assignments, then select the required permission for each module and press **Save module permissions**. The Employee should refresh or sign in again to see the updated menu. Accountants retain their existing Finance-role access; Team Access remains Admin-only.

## Permanent Client IDs and Client Summary Search

Run `supabase/migrations/20261123_client_ids.sql` once in Supabase SQL Editor. It backfills a permanent unique Client ID in the format `FHT-CL-00001` for existing clients and automatically assigns one to every new client. Existing financial records are not changed.

The app displays each Client ID in the Clients list. The global Client ID search in the top bar is available from the workspace pages; submitting an ID opens the matching Client Summary. The summary shows the permitted Campaigns, Campaign Spend USD usage, Payments, Invoices, and current Client Due/Advance. All figures are derived from rows the signed-in user is allowed to access through existing RLS and module permissions.

USD purchase lots are shared company wallet records and are not assigned to a single client. The Client Summary therefore reports client-linked USD Campaign Spend, not the full company-wide purchase amount.

## Editing a Client Payment amount

Approved Finance users can select **Edit Amount** on a Payment row. The amount is updated atomically while its Client, payment date, method, reference and original payment record remain unchanged. The database releases and rebuilds invoice allocations for that Client in FIFO order, recalculates invoice statuses, and writes the old/new amount to `audit_logs`. Client Due updates from the new payment amount.

Run `supabase/migrations/20261124_edit_payment_amount.sql` once before using this action.

## Correcting a Payment assigned to the wrong Client

Approved Finance users can choose **Correct Client** on a Payment row. The correction changes only the payment's client association. It preserves the original payment amount, date, method, reference, notes, and payment record. In one database transaction, allocations on the payment are released, the payment is moved to the selected Client, and FIFO allocations are recalculated for both the old and new Client. The operation is logged in `audit_logs`.

Run `supabase/migrations/20261124_correct_payment_client.sql` once before using the correction action. The function is restricted to approved Admin/Accountant accounts. No other payment or invoice rows are deleted.

## Safely voiding an incorrect invoice

Finance Admins and Accountants can use the **Void** action in the Invoice list for an incorrect invoice. Voiding does not delete the invoice or the original client payment. In one database transaction, the invoice is marked `void`, its payment allocations are released, and available payments are automatically reapplied FIFO to other open invoices for that same client. If no valid invoice remains, the payment stays unallocated to an invoice but still reduces the client's overall Client Due balance.

Before using the Void action, run `supabase/migrations/20261122_safe_invoice_void.sql` once in Supabase SQL Editor, after the invoice-payment-allocation migration. The operation is restricted to approved Admin and Accountant accounts. Void invoices are excluded from Client Due.

## Automatic invoice numbering

Run `supabase/migrations/20261121_automatic_invoice_numbering.sql` once after the invoice and finance schema migrations. New invoices receive a database-generated unique number in the format `FHT-YYYY-00001`, based on the invoice issue year. Number allocation is concurrency-safe, the numbering counter is not directly accessible to signed-in users, and the database unique constraint remains the final duplicate guard. Existing valid invoice numbers are preserved; only obvious placeholder values such as `Invoice Number` are backfilled to generated numbers. The app no longer asks staff to type invoice numbers.

## Invoice payment allocation and automatic status

Run `supabase/migrations/20261121_invoice_payment_allocation.sql` once **after** the Employee module-permissions migration. It creates the invoice-payment allocation ledger and backfills existing client payments into that client's oldest open invoices (FIFO). Existing payments and invoices are preserved.

When a new payment is recorded, it is automatically applied to the oldest outstanding invoice(s) for that Client. When a new invoice is created, any previously unallocated payment amount is applied to it. Payment amounts above all invoice balances remain unallocated to an invoice. All recorded payments still reduce the client's overall Client Due balance. A payment can never be allocated across different clients or beyond the payment amount/invoice balance.

Invoice states are derived from allocated payments and due date:
- **Unpaid** — no amount allocated and not past due.
- **Partially Paid** — some, but not all, of the invoice has been allocated.
- **Paid** — allocated payments cover the full invoice amount.
- **Overdue** — unpaid balance remains after the due date.
- Existing Draft and Void states are preserved.

The Invoice list and printable invoice show total, paid-to-date, balance due, status and the payments applied. The Payments list shows how much of each payment was allocated and how much remains unallocated to an invoice; that remainder is not automatically a client-level advance because it may still offset Campaign Spend charges. Employee visibility continues to follow both Invoice/Payment module permissions and Admin-assigned-client RLS.

## Remaining milestones
- Invoice email delivery and client-facing invoice portal.
- Safe Auth-user suspension.
- Audit-log UI, CSV exports, backups and automated tests.

Before using for real financial records, test each role with separate accounts, verify all RLS policies, enable email confirmation and MFA for Admin, and reconcile values against actual bank/ad-platform statements.
