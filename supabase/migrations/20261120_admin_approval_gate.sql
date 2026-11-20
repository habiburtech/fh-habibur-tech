-- FH Habibur Tech: mandatory Admin approval before application access.
-- Additive and data-preserving. Run once in Supabase SQL Editor.

BEGIN;

-- New and existing non-admin accounts are pending until explicitly approved.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_approval_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_approval_status_check
      CHECK (approval_status IN ('pending','approved','rejected','suspended'));
  END IF;
END $$;

-- Keep the current administrator active. Everyone else must be approved by Admin.
UPDATE public.profiles
SET approval_status = CASE WHEN role = 'admin' THEN 'approved' ELSE 'pending' END;

-- The profile trigger already stores email. New users are always pending.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, email, approval_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'employee',
    NEW.email,
    'pending'
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- Security-definer helpers avoid profile RLS recursion while checking access.
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND approval_status = 'approved'
  );
$$;

-- Role-based policies now return no role for pending/rejected/suspended users.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND approval_status = 'approved'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_accountant()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role() IN ('admin','accountant'), false);
$$;

-- Remove open-to-all signed-in read policies on client and campaign data.
DROP POLICY IF EXISTS "staff read clients" ON public.clients;
DROP POLICY IF EXISTS "staff add clients" ON public.clients;
CREATE POLICY "approved staff read clients"
  ON public.clients FOR SELECT TO authenticated
  USING (public.is_approved_user());
CREATE POLICY "approved staff add clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user() AND created_by = auth.uid());

DROP POLICY IF EXISTS "staff read campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "staff create campaigns" ON public.campaigns;
CREATE POLICY "approved staff read campaigns"
  ON public.campaigns FOR SELECT TO authenticated
  USING (public.is_approved_user());
CREATE POLICY "approved staff create campaigns"
  ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user() AND created_by = auth.uid());

-- Campaign spend is finance information: approved Admin/Accountant only.
DROP POLICY IF EXISTS "staff read campaign spend" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "finance manage campaign spend" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "finance read campaign spend entries" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "finance insert campaign spend entries" ON public.campaign_spend_entries;
CREATE POLICY "approved finance read campaign spend"
  ON public.campaign_spend_entries FOR SELECT TO authenticated
  USING (public.is_admin_or_accountant());
CREATE POLICY "approved finance insert campaign spend"
  ON public.campaign_spend_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_accountant() AND created_by = auth.uid());

-- Reassert finance-only policies on the USD purchase lots.
DROP POLICY IF EXISTS "finance read dollar purchase lots" ON public.dollar_purchase_lots;
DROP POLICY IF EXISTS "finance insert dollar purchase lots" ON public.dollar_purchase_lots;
CREATE POLICY "approved finance read dollar purchase lots"
  ON public.dollar_purchase_lots FOR SELECT TO authenticated
  USING (public.is_admin_or_accountant());
CREATE POLICY "approved finance insert dollar purchase lots"
  ON public.dollar_purchase_lots FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_accountant() AND created_by = auth.uid());

-- Explicitly secure invoice data and invoice items.
DROP POLICY IF EXISTS "finance read invoices" ON public.invoices;
DROP POLICY IF EXISTS "finance manage invoices" ON public.invoices;
DROP POLICY IF EXISTS "finance read invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "finance manage invoice items" ON public.invoice_items;
CREATE POLICY "approved finance read invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (public.is_admin_or_accountant());
CREATE POLICY "approved finance manage invoices"
  ON public.invoices FOR ALL TO authenticated
  USING (public.is_admin_or_accountant())
  WITH CHECK (public.is_admin_or_accountant());
CREATE POLICY "approved finance read invoice items"
  ON public.invoice_items FOR SELECT TO authenticated
  USING (
    public.is_admin_or_accountant()
    AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id)
  );
CREATE POLICY "approved finance manage invoice items"
  ON public.invoice_items FOR ALL TO authenticated
  USING (public.is_admin_or_accountant())
  WITH CHECK (public.is_admin_or_accountant());

-- Other finance policies already use current_user_role()/is_admin_or_accountant(),
-- which now return no privilege until the profile is approved.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dollar_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dollar_purchase_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_spend_entries ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
