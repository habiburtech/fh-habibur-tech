-- FH Habibur Tech: Admin-controlled employee-to-client assignments.
-- Additive migration: existing business records are preserved.
-- After running this migration:
--   * Admin/Accountant can continue to see all clients and campaigns.
--   * Employees can see only clients assigned to them by an Admin.
--   * Employees can see campaigns only when their client is assigned.
--   * Only Admin can add/remove employee-client assignments.

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_client_assignments (
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES public.profiles(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, client_id)
);

CREATE INDEX IF NOT EXISTS employee_client_assignments_client_idx
  ON public.employee_client_assignments(client_id);

ALTER TABLE public.employee_client_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read employee client assignments" ON public.employee_client_assignments;
CREATE POLICY "admin read employee client assignments"
  ON public.employee_client_assignments
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'admin'::public.app_role);

-- SECURITY DEFINER helper reads the assignment table without causing RLS recursion.
CREATE OR REPLACE FUNCTION public.employee_has_client_access(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_client_assignments a
    JOIN public.profiles p ON p.id = a.employee_id
    WHERE a.employee_id = auth.uid()
      AND a.client_id = p_client_id
      AND p.role = 'employee'::public.app_role
      AND p.approval_status = 'approved'
  );
$$;

REVOKE ALL ON FUNCTION public.employee_has_client_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_has_client_access(uuid) TO authenticated;

-- Atomic Admin-only assignment replacement.
CREATE OR REPLACE FUNCTION public.admin_set_employee_clients(
  p_employee_id uuid,
  p_client_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Only an approved Admin can assign clients to employees.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_employee_id
      AND role = 'employee'::public.app_role
  ) THEN
    RAISE EXCEPTION 'The selected account is not an Employee.';
  END IF;

  DELETE FROM public.employee_client_assignments
  WHERE employee_id = p_employee_id;

  INSERT INTO public.employee_client_assignments (employee_id, client_id, assigned_by)
  SELECT p_employee_id, client_id, auth.uid()
  FROM (
    SELECT DISTINCT unnest(COALESCE(p_client_ids, ARRAY[]::uuid[])) AS client_id
  ) selected_clients;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_employee_clients(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_clients(uuid, uuid[]) TO authenticated;

-- Clients: Finance roles retain full visibility; Employees get assigned rows only.
DROP POLICY IF EXISTS "approved staff read clients" ON public.clients;
DROP POLICY IF EXISTS "approved staff add clients" ON public.clients;
CREATE POLICY "assigned clients read policy"
  ON public.clients
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_accountant()
    OR public.employee_has_client_access(id)
  );

CREATE POLICY "finance insert clients"
  ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_accountant()
    AND created_by = auth.uid()
  );

-- Campaigns: an Employee can read/create only campaigns under assigned clients.
DROP POLICY IF EXISTS "approved staff read campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "approved staff create campaigns" ON public.campaigns;
CREATE POLICY "assigned campaigns read policy"
  ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    public.is_admin_or_accountant()
    OR public.employee_has_client_access(client_id)
  );

CREATE POLICY "assigned campaigns insert policy"
  ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.is_admin_or_accountant()
      OR public.employee_has_client_access(client_id)
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
