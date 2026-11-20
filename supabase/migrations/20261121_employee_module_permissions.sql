-- FH Habibur Tech: per-Employee module permissions.
-- Run after the Admin approval and employee-client-assignment migrations.
-- Existing business rows are preserved. Employee permissions default to the
-- agreed least-privilege profile and can be changed by Admin in Team Access.

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_module_permissions (
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_key text NOT NULL CHECK (module_key IN (
    'dashboard',
    'clients',
    'campaigns',
    'campaign_spend',
    'dollar_purchases',
    'client_due',
    'invoices',
    'payments',
    'expenses',
    'reports'
  )),
  access_level text NOT NULL DEFAULT 'none'
    CHECK (access_level IN ('none','view','manage')),
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, module_key)
);

CREATE INDEX IF NOT EXISTS employee_module_permissions_module_idx
  ON public.employee_module_permissions(module_key, access_level);

ALTER TABLE public.employee_module_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.employee_module_permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.employee_module_permissions TO authenticated;

DROP POLICY IF EXISTS "read own module permissions" ON public.employee_module_permissions;
CREATE POLICY "read own module permissions"
  ON public.employee_module_permissions
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR public.current_user_role() = 'admin'::public.app_role
  );

-- Admin/Accountant retain their existing full finance access. Employee access
-- is read from the per-module permission record; approval is always required.
CREATE OR REPLACE FUNCTION public.has_module_access(
  p_module_key text,
  p_required_level text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_level text;
BEGIN
  SELECT role
    INTO v_role
  FROM public.profiles
  WHERE id = auth.uid()
    AND approval_status = 'approved'
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role IN ('admin'::public.app_role, 'accountant'::public.app_role) THEN
    RETURN true;
  END IF;

  IF v_role <> 'employee'::public.app_role
     OR p_module_key NOT IN (
       'dashboard','clients','campaigns','campaign_spend',
       'dollar_purchases','client_due','invoices','payments',
       'expenses','reports'
     ) THEN
    RETURN false;
  END IF;

  SELECT access_level
    INTO v_level
  FROM public.employee_module_permissions
  WHERE employee_id = auth.uid()
    AND module_key = p_module_key;

  IF p_required_level = 'manage' THEN
    RETURN COALESCE(v_level = 'manage', false);
  END IF;

  RETURN COALESCE(v_level IN ('view','manage'), false);
END;
$$;

REVOKE ALL ON FUNCTION public.has_module_access(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_module_access(text,text) TO authenticated;

-- Defaults agreed for newly registered and existing Employee accounts.
CREATE OR REPLACE FUNCTION public.seed_employee_module_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'employee'::public.app_role THEN
    INSERT INTO public.employee_module_permissions
      (employee_id, module_key, access_level)
    VALUES
      (NEW.id, 'dashboard', 'view'),
      (NEW.id, 'clients', 'view'),
      (NEW.id, 'campaigns', 'manage'),
      (NEW.id, 'campaign_spend', 'view'),
      (NEW.id, 'dollar_purchases', 'none'),
      (NEW.id, 'client_due', 'view'),
      (NEW.id, 'invoices', 'view'),
      (NEW.id, 'payments', 'view'),
      (NEW.id, 'expenses', 'none'),
      (NEW.id, 'reports', 'none')
    ON CONFLICT (employee_id, module_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_employee_module_permissions_after_profile_change
  ON public.profiles;
CREATE TRIGGER seed_employee_module_permissions_after_profile_change
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.seed_employee_module_permissions();

-- Backfill current Employees without overwriting any permission already set.
INSERT INTO public.employee_module_permissions
  (employee_id, module_key, access_level)
SELECT p.id, defaults.module_key, defaults.access_level
FROM public.profiles p
CROSS JOIN (
  VALUES
    ('dashboard','view'),
    ('clients','view'),
    ('campaigns','manage'),
    ('campaign_spend','view'),
    ('dollar_purchases','none'),
    ('client_due','view'),
    ('invoices','view'),
    ('payments','view'),
    ('expenses','none'),
    ('reports','none')
) AS defaults(module_key, access_level)
WHERE p.role = 'employee'::public.app_role
ON CONFLICT (employee_id, module_key) DO NOTHING;

-- Atomic Admin-only replacement of one Employee's complete permission set.
CREATE OR REPLACE FUNCTION public.admin_set_employee_module_permissions(
  p_employee_id uuid,
  p_permissions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients text;
  v_campaigns text;
  v_campaign_spend text;
  v_dollar_purchases text;
  v_client_due text;
  v_invoices text;
  v_payments text;
  v_reports text;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Only an approved Admin can change Employee module permissions.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_employee_id
      AND role = 'employee'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Module permissions can only be assigned to an Employee account.';
  END IF;

  IF p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_permissions)) <> 10
     OR EXISTS (
       SELECT 1
       FROM jsonb_each_text(p_permissions) item
       WHERE item.key NOT IN (
         'dashboard','clients','campaigns','campaign_spend',
         'dollar_purchases','client_due','invoices','payments',
         'expenses','reports'
       )
       OR item.value NOT IN ('none','view','manage')
     )
     OR p_permissions->>'dashboard' NOT IN ('none','view')
     OR p_permissions->>'client_due' NOT IN ('none','view')
     OR p_permissions->>'clients' NOT IN ('none','view')
     OR p_permissions->>'reports' NOT IN ('none','view') THEN
    RAISE EXCEPTION 'Invalid permission set. Choose No Access, View Only, or Manage for each available module.';
  END IF;

  v_clients := p_permissions->>'clients';
  v_campaigns := p_permissions->>'campaigns';
  v_campaign_spend := p_permissions->>'campaign_spend';
  v_dollar_purchases := p_permissions->>'dollar_purchases';
  v_client_due := p_permissions->>'client_due';
  v_invoices := p_permissions->>'invoices';
  v_payments := p_permissions->>'payments';
  v_reports := p_permissions->>'reports';

  -- Client-based modules need the Client list to show only assigned records.
  IF v_clients = 'none'
     AND (v_campaigns <> 'none' OR v_campaign_spend <> 'none'
       OR v_client_due <> 'none' OR v_invoices <> 'none' OR v_payments <> 'none') THEN
    RAISE EXCEPTION 'Enable at least View Only for Clients before enabling other client-based modules.';
  END IF;

  IF v_campaign_spend <> 'none' AND v_campaigns = 'none' THEN
    RAISE EXCEPTION 'Enable Campaigns before enabling Campaign Spend.';
  END IF;

  -- The spend entry form needs to select a purchase lot. This is an explicit
  -- disclosure of the company USD wallet and must also be approved by Admin.
  IF v_campaign_spend = 'manage' AND v_dollar_purchases <> 'manage' THEN
    RAISE EXCEPTION 'Campaign Spend Manage requires Manage access to Dollar Purchases so the selected USD lot can be consumed safely.';
  END IF;

  -- Client Due is calculated from campaign billing, invoices and payments.
  IF v_client_due <> 'none'
     AND (v_campaign_spend = 'none' OR v_invoices = 'none' OR v_payments = 'none') THEN
    RAISE EXCEPTION 'Client Due requires View Only or Manage access to Campaign Spend, Invoices, and Payments.';
  END IF;

  DELETE FROM public.employee_module_permissions
  WHERE employee_id = p_employee_id;

  INSERT INTO public.employee_module_permissions
    (employee_id, module_key, access_level, updated_by, updated_at)
  SELECT
    p_employee_id,
    item.key,
    item.value,
    auth.uid(),
    now()
  FROM jsonb_each_text(p_permissions) AS item;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_employee_module_permissions(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_module_permissions(uuid,jsonb) TO authenticated;

-- Reports shown to an Employee must be limited to that Employee's assigned
-- clients. This RPC returns monthly aggregates only, not raw spend records,
-- wallet balances, or company operating expenses.
CREATE OR REPLACE FUNCTION public.employee_assigned_client_monthly_report()
RETURNS TABLE (
  month date,
  campaign_client_billed_bdt numeric,
  service_revenue_bdt numeric,
  fx_margin_bdt numeric,
  actual_ad_cost_bdt numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_module_access('reports','view') THEN
    RAISE EXCEPTION 'You do not have access to Employee reports.';
  END IF;

  IF public.current_user_role() <> 'employee'::public.app_role THEN
    RAISE EXCEPTION 'This report is only for Employee accounts.';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('month', s.spend_date)::date AS month,
    COALESCE(sum(s.client_bill_bdt), 0)::numeric AS campaign_client_billed_bdt,
    COALESCE(sum(s.service_charge_bdt), 0)::numeric AS service_revenue_bdt,
    COALESCE(sum(s.ad_cost_bdt - (s.amount_usd * s.exchange_rate)), 0)::numeric AS fx_margin_bdt,
    COALESCE(sum(s.amount_usd * s.exchange_rate), 0)::numeric AS actual_ad_cost_bdt
  FROM public.campaign_spend_entries s
  JOIN public.campaigns c ON c.id = s.campaign_id
  JOIN public.employee_client_assignments a
    ON a.client_id = c.client_id
   AND a.employee_id = auth.uid()
  GROUP BY date_trunc('month', s.spend_date)
  ORDER BY date_trunc('month', s.spend_date) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_assigned_client_monthly_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_assigned_client_monthly_report() TO authenticated;

-- Client visibility: only Admin/Accountant, or Employee with module access
-- and an Admin-created client assignment.
DROP POLICY IF EXISTS "assigned clients read policy" ON public.clients;
DROP POLICY IF EXISTS "approved staff read clients" ON public.clients;
DROP POLICY IF EXISTS "staff read clients" ON public.clients;
CREATE POLICY "module permission clients read"
  ON public.clients FOR SELECT TO authenticated
  USING (
    public.has_module_access('clients','view')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = clients.id
      )
    )
  );

DROP POLICY IF EXISTS "finance insert clients" ON public.clients;
DROP POLICY IF EXISTS "approved staff add clients" ON public.clients;
DROP POLICY IF EXISTS "staff add clients" ON public.clients;
CREATE POLICY "finance create clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_accountant()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "finance update clients" ON public.clients;
CREATE POLICY "module permission clients update"
  ON public.clients FOR UPDATE TO authenticated
  USING (
    public.has_module_access('clients','manage')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = clients.id
      )
    )
  )
  WITH CHECK (
    public.has_module_access('clients','manage')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = clients.id
      )
    )
  );

-- Campaigns are visible/manageable only for assigned clients.
DROP POLICY IF EXISTS "assigned campaigns read policy" ON public.campaigns;
DROP POLICY IF EXISTS "approved staff read campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "staff read campaigns" ON public.campaigns;
CREATE POLICY "module permission campaigns read"
  ON public.campaigns FOR SELECT TO authenticated
  USING (
    public.has_module_access('campaigns','view')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = campaigns.client_id
      )
    )
  );

DROP POLICY IF EXISTS "assigned campaigns insert policy" ON public.campaigns;
DROP POLICY IF EXISTS "approved staff create campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "staff create campaigns" ON public.campaigns;
CREATE POLICY "module permission campaigns insert"
  ON public.campaigns FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('campaigns','manage')
    AND created_by = auth.uid()
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = campaigns.client_id
      )
    )
  );

DROP POLICY IF EXISTS "finance update campaigns" ON public.campaigns;
CREATE POLICY "module permission campaigns update"
  ON public.campaigns FOR UPDATE TO authenticated
  USING (
    (
      public.has_module_access('campaigns','manage')
      OR public.has_module_access('campaign_spend','manage')
    )
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = campaigns.client_id
      )
    )
  )
  WITH CHECK (
    (
      public.has_module_access('campaigns','manage')
      OR public.has_module_access('campaign_spend','manage')
    )
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = campaigns.client_id
      )
    )
  );

-- Campaign spend permissions are separate from Campaign permissions.
DROP POLICY IF EXISTS "approved finance read campaign spend" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "approved finance insert campaign spend" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "finance read campaign spend entries" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "finance insert campaign spend entries" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "finance manage campaign spend" ON public.campaign_spend_entries;
DROP POLICY IF EXISTS "staff read campaign spend" ON public.campaign_spend_entries;
CREATE POLICY "module permission campaign spend read"
  ON public.campaign_spend_entries FOR SELECT TO authenticated
  USING (
    public.has_module_access('campaign_spend','view')
    AND EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_spend_entries.campaign_id
        AND (
          public.is_admin_or_accountant()
          OR EXISTS (
            SELECT 1 FROM public.employee_client_assignments a
            WHERE a.employee_id = auth.uid()
              AND a.client_id = c.client_id
          )
        )
    )
  );

CREATE POLICY "finance maintain campaign spend"
  ON public.campaign_spend_entries FOR ALL TO authenticated
  USING (public.is_admin_or_accountant())
  WITH CHECK (public.is_admin_or_accountant());

CREATE POLICY "module permission campaign spend insert"
  ON public.campaign_spend_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('campaign_spend','manage')
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.campaigns c
      WHERE c.id = campaign_spend_entries.campaign_id
        AND (
          public.is_admin_or_accountant()
          OR EXISTS (
            SELECT 1 FROM public.employee_client_assignments a
            WHERE a.employee_id = auth.uid()
              AND a.client_id = c.client_id
          )
        )
    )
  );

-- USD purchase lots and company expenses are global data. Employees only see
-- them when the Admin explicitly grants the corresponding module permission.
DROP POLICY IF EXISTS "approved finance read dollar purchase lots" ON public.dollar_purchase_lots;
DROP POLICY IF EXISTS "approved finance insert dollar purchase lots" ON public.dollar_purchase_lots;
DROP POLICY IF EXISTS "finance read dollar purchase lots" ON public.dollar_purchase_lots;
DROP POLICY IF EXISTS "finance insert dollar purchase lots" ON public.dollar_purchase_lots;
CREATE POLICY "module permission dollar purchases read"
  ON public.dollar_purchase_lots FOR SELECT TO authenticated
  USING (public.has_module_access('dollar_purchases','view'));

CREATE POLICY "module permission dollar purchases insert"
  ON public.dollar_purchase_lots FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('dollar_purchases','manage')
    AND created_by = auth.uid()
  );

CREATE POLICY "module permission dollar purchases update"
  ON public.dollar_purchase_lots FOR UPDATE TO authenticated
  USING (public.has_module_access('dollar_purchases','manage'))
  WITH CHECK (public.has_module_access('dollar_purchases','manage'));

-- Payments are scoped to assigned client records for Employees.
DROP POLICY IF EXISTS "finance read payments" ON public.payments;
DROP POLICY IF EXISTS "finance insert payments" ON public.payments;
DROP POLICY IF EXISTS "admin manage payments" ON public.payments;
CREATE POLICY "module permission payments read"
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.has_module_access('payments','view')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = payments.client_id
      )
    )
  );

CREATE POLICY "module permission payments insert"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('payments','manage')
    AND created_by = auth.uid()
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = payments.client_id
      )
    )
  );

CREATE POLICY "module permission payments update"
  ON public.payments FOR UPDATE TO authenticated
  USING (
    public.has_module_access('payments','manage')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = payments.client_id
      )
    )
  )
  WITH CHECK (
    public.has_module_access('payments','manage')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = payments.client_id
      )
    )
  );

-- Company-wide Expenses are global and must be explicitly granted.
DROP POLICY IF EXISTS "finance read expenses" ON public.expenses;
DROP POLICY IF EXISTS "finance manage expenses" ON public.expenses;
CREATE POLICY "module permission expenses read"
  ON public.expenses FOR SELECT TO authenticated
  USING (public.has_module_access('expenses','view'));

CREATE POLICY "module permission expenses insert"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('expenses','manage')
    AND created_by = auth.uid()
  );

CREATE POLICY "module permission expenses update"
  ON public.expenses FOR UPDATE TO authenticated
  USING (public.has_module_access('expenses','manage'))
  WITH CHECK (public.has_module_access('expenses','manage'));

-- Invoices are client-scoped. Manage permits creation and updates; deleting
-- a financial document remains restricted to Finance roles.
DROP POLICY IF EXISTS "approved finance read invoices" ON public.invoices;
DROP POLICY IF EXISTS "approved finance manage invoices" ON public.invoices;
DROP POLICY IF EXISTS "finance read invoices" ON public.invoices;
DROP POLICY IF EXISTS "finance manage invoices" ON public.invoices;
CREATE POLICY "finance delete invoices"
  ON public.invoices FOR DELETE TO authenticated
  USING (public.is_admin_or_accountant());

CREATE POLICY "module permission invoices delete"
  ON public.invoices FOR DELETE TO authenticated
  USING (
    public.has_module_access('invoices','manage')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = invoices.client_id
      )
    )
  );
CREATE POLICY "module permission invoices read"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    public.has_module_access('invoices','view')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = invoices.client_id
      )
    )
  );

CREATE POLICY "module permission invoices insert"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('invoices','manage')
    AND created_by = auth.uid()
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = invoices.client_id
      )
    )
  );

CREATE POLICY "module permission invoices update"
  ON public.invoices FOR UPDATE TO authenticated
  USING (
    public.has_module_access('invoices','manage')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = invoices.client_id
      )
    )
  )
  WITH CHECK (
    public.has_module_access('invoices','manage')
    AND (
      public.is_admin_or_accountant()
      OR EXISTS (
        SELECT 1 FROM public.employee_client_assignments a
        WHERE a.employee_id = auth.uid()
          AND a.client_id = invoices.client_id
      )
    )
  );

DROP POLICY IF EXISTS "approved finance read invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "approved finance manage invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "finance read invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "finance manage invoice items" ON public.invoice_items;
CREATE POLICY "finance delete invoice items"
  ON public.invoice_items FOR DELETE TO authenticated
  USING (public.is_admin_or_accountant());

CREATE POLICY "module permission invoice items delete"
  ON public.invoice_items FOR DELETE TO authenticated
  USING (
    public.has_module_access('invoices','manage')
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
  );
CREATE POLICY "module permission invoice items read"
  ON public.invoice_items FOR SELECT TO authenticated
  USING (
    public.has_module_access('invoices','view')
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
  );

CREATE POLICY "module permission invoice items insert"
  ON public.invoice_items FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('invoices','manage')
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
  );

CREATE POLICY "module permission invoice items update"
  ON public.invoice_items FOR UPDATE TO authenticated
  USING (
    public.has_module_access('invoices','manage')
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
  )
  WITH CHECK (
    public.has_module_access('invoices','manage')
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
  );

-- Employee-level reports are returned via the assigned-client aggregate RPC.
-- Never expose company-wide operating expenses or profit to an Employee report.
ALTER VIEW public.client_due_summary SET (security_invoker = true);
ALTER VIEW public.finance_monthly_accrual_summary SET (security_invoker = true);

NOTIFY pgrst, 'reload schema';

COMMIT;
