-- FH Habibur Tech: invoice payment allocation and automatic invoice status.
-- Additive migration. Existing invoices and payments are retained.
-- Payments are applied FIFO to the oldest open invoice for the same client.
-- Any remaining payment amount stays as unallocated client advance.

BEGIN;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','unpaid','partially_paid','paid','overdue','void'));

CREATE TABLE IF NOT EXISTS public.invoice_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  amount_bdt numeric(14,2) NOT NULL CHECK (amount_bdt > 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_payment_allocations_payment_invoice_key
    UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS invoice_payment_allocations_invoice_idx
  ON public.invoice_payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_payment_allocations_payment_idx
  ON public.invoice_payment_allocations(payment_id);

ALTER TABLE public.invoice_payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_payment_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.invoice_payment_allocations TO authenticated;

CREATE POLICY "invoice allocations read permitted"
  ON public.invoice_payment_allocations
  FOR SELECT TO authenticated
  USING (
    public.has_module_access('invoices','view')
    AND public.has_module_access('payments','view')
    AND EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_payment_allocations.invoice_id
    )
  );

CREATE POLICY "invoice allocations insert permitted"
  ON public.invoice_payment_allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_module_access('invoices','manage')
    AND public.has_module_access('payments','manage')
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.payments p ON p.id = invoice_payment_allocations.payment_id
      WHERE i.id = invoice_payment_allocations.invoice_id
        AND i.client_id = p.client_id
        AND (
          public.is_admin_or_accountant()
          OR EXISTS (
            SELECT 1
            FROM public.employee_client_assignments a
            WHERE a.employee_id = auth.uid()
              AND a.client_id = i.client_id
          )
        )
    )
  );

CREATE POLICY "invoice allocations delete permitted"
  ON public.invoice_payment_allocations
  FOR DELETE TO authenticated
  USING (
    public.has_module_access('invoices','manage')
    AND public.has_module_access('payments','manage')
    AND EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.payments p ON p.id = invoice_payment_allocations.payment_id
      WHERE i.id = invoice_payment_allocations.invoice_id
        AND i.client_id = p.client_id
        AND (
          public.is_admin_or_accountant()
          OR EXISTS (
            SELECT 1
            FROM public.employee_client_assignments a
            WHERE a.employee_id = auth.uid()
              AND a.client_id = i.client_id
          )
        )
    )
  );

-- Keep the stored status accurate whenever an allocation changes.
-- The app also derives overdue status at read time, so a due date passing
-- overnight is reflected without requiring a scheduled database job.
CREATE OR REPLACE FUNCTION public.refresh_invoice_payment_status(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_subtotal numeric(14,2);
  v_due_date date;
  v_paid numeric(14,2);
  v_current_status text;
BEGIN
  SELECT i.status, i.subtotal_bdt, i.due_date,
         COALESCE((
           SELECT SUM(a.amount_bdt)
           FROM public.invoice_payment_allocations a
           WHERE a.invoice_id = i.id
         ), 0)
    INTO v_current_status, v_subtotal, v_due_date, v_paid
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_current_status IN ('draft','void') THEN
    v_status := v_current_status;
  ELSIF v_subtotal > 0 AND v_paid >= v_subtotal THEN
    v_status := 'paid';
  ELSIF v_due_date IS NOT NULL AND v_due_date < ((now() AT TIME ZONE 'Asia/Dhaka')::date) THEN
    v_status := 'overdue';
  ELSIF v_paid > 0 THEN
    v_status := 'partially_paid';
  ELSE
    v_status := 'unpaid';
  END IF;

  UPDATE public.invoices
  SET status = v_status
  WHERE id = p_invoice_id
    AND status IS DISTINCT FROM v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.invoice_allocation_status_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_invoice_payment_status(OLD.invoice_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_invoice_payment_status(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.refresh_invoice_payment_status(OLD.invoice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_allocation_status ON public.invoice_payment_allocations;
CREATE TRIGGER trg_invoice_allocation_status
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.invoice_allocation_status_trigger();

-- Guard against cross-client allocations and amounts exceeding either
-- the payment's unallocated amount or the invoice's outstanding balance.
CREATE OR REPLACE FUNCTION public.validate_invoice_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_client uuid;
  v_payment_amount numeric(14,2);
  v_invoice_client uuid;
  v_invoice_total numeric(14,2);
  v_other_payment_allocated numeric(14,2);
  v_other_invoice_allocated numeric(14,2);
BEGIN
  SELECT client_id, amount_bdt
    INTO v_payment_client, v_payment_amount
  FROM public.payments
  WHERE id = NEW.payment_id;

  SELECT client_id, subtotal_bdt
    INTO v_invoice_client, v_invoice_total
  FROM public.invoices
  WHERE id = NEW.invoice_id
  FOR UPDATE;

  IF v_payment_client IS NULL OR v_invoice_client IS NULL THEN
    RAISE EXCEPTION 'The selected payment or invoice does not exist.';
  END IF;

  IF v_payment_client <> v_invoice_client THEN
    RAISE EXCEPTION 'A payment can only be allocated to an invoice for the same client.';
  END IF;

  SELECT COALESCE(SUM(a.amount_bdt),0)
    INTO v_other_payment_allocated
  FROM public.invoice_payment_allocations a
  WHERE a.payment_id = NEW.payment_id
    AND a.id IS DISTINCT FROM NEW.id;

  SELECT COALESCE(SUM(a.amount_bdt),0)
    INTO v_other_invoice_allocated
  FROM public.invoice_payment_allocations a
  WHERE a.invoice_id = NEW.invoice_id
    AND a.id IS DISTINCT FROM NEW.id;

  IF NEW.amount_bdt > v_payment_amount - v_other_payment_allocated THEN
    RAISE EXCEPTION 'Allocation exceeds the payment amount still available.';
  END IF;

  IF NEW.amount_bdt > v_invoice_total - v_other_invoice_allocated THEN
    RAISE EXCEPTION 'Allocation exceeds the invoice balance still due.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_invoice_payment_allocation ON public.invoice_payment_allocations;
CREATE TRIGGER trg_validate_invoice_payment_allocation
BEFORE INSERT OR UPDATE ON public.invoice_payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_payment_allocation();

-- Apply a client's available payments to the oldest outstanding invoices.
-- Unused money remains unallocated and is still counted as client advance.
CREATE OR REPLACE FUNCTION public.allocate_client_payments_fifo(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment record;
  v_invoice record;
  v_available numeric(14,2);
  v_invoice_due numeric(14,2);
  v_apply numeric(14,2);
BEGIN
  FOR v_payment IN
    SELECT p.id, p.amount_bdt
    FROM public.payments p
    WHERE p.client_id = p_client_id
    ORDER BY p.payment_date, p.created_at, p.id
    FOR UPDATE OF p
  LOOP
    SELECT GREATEST(
      v_payment.amount_bdt - COALESCE(SUM(a.amount_bdt),0), 0
    )
    INTO v_available
    FROM public.invoice_payment_allocations a
    WHERE a.payment_id = v_payment.id;

    IF v_available <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_invoice IN
      SELECT i.id, i.subtotal_bdt,
        COALESCE((
          SELECT SUM(a.amount_bdt)
          FROM public.invoice_payment_allocations a
          WHERE a.invoice_id = i.id
        ),0) AS paid_bdt
      FROM public.invoices i
      WHERE i.client_id = p_client_id
        AND i.status NOT IN ('draft','void')
      ORDER BY i.issue_date, i.created_at, i.id
      FOR UPDATE OF i
    LOOP
      v_invoice_due := GREATEST(v_invoice.subtotal_bdt - v_invoice.paid_bdt, 0);
      IF v_invoice_due <= 0 THEN
        CONTINUE;
      END IF;

      v_apply := LEAST(v_available, v_invoice_due);
      IF v_apply <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO public.invoice_payment_allocations
        (invoice_id, payment_id, amount_bdt, created_by)
      VALUES
        (v_invoice.id, v_payment.id, v_apply, auth.uid())
      ON CONFLICT (payment_id, invoice_id)
      DO UPDATE SET
        amount_bdt = public.invoice_payment_allocations.amount_bdt + EXCLUDED.amount_bdt,
        created_by = COALESCE(EXCLUDED.created_by, public.invoice_payment_allocations.created_by);

      v_available := v_available - v_apply;
      EXIT WHEN v_available <= 0;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_invoice_payment_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_client_payments_fifo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoice_allocation_status_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_invoice_payment_allocation() FROM PUBLIC, anon, authenticated;

-- Run allocation after a new payment or invoice is recorded.
CREATE OR REPLACE FUNCTION public.allocate_after_payment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.allocate_client_payments_fifo(NEW.client_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_after_invoice_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.allocate_client_payments_fifo(NEW.client_id);
  PERFORM public.refresh_invoice_payment_status(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_after_payment_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_after_invoice_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_allocate_payment_after_insert ON public.payments;
CREATE TRIGGER trg_allocate_payment_after_insert
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.allocate_after_payment_insert();

DROP TRIGGER IF EXISTS trg_allocate_payment_after_invoice_insert ON public.invoices;
CREATE TRIGGER trg_allocate_payment_after_invoice_insert
AFTER INSERT OR UPDATE OF client_id, subtotal_bdt, due_date ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.allocate_after_invoice_insert();

-- Refresh existing invoice statuses and backfill historical payments.
-- Existing payment rows are applied oldest-payment-first to oldest-invoice-first.
DO $$
DECLARE
  v_client_id uuid;
BEGIN
  FOR v_client_id IN SELECT DISTINCT client_id FROM public.invoices
  LOOP
    PERFORM public.allocate_client_payments_fifo(v_client_id);
  END LOOP;
END;
$$;

UPDATE public.invoices i
SET status = CASE
  WHEN i.status IN ('draft','void') THEN i.status
  WHEN i.subtotal_bdt > 0
    AND COALESCE((
      SELECT SUM(a.amount_bdt)
      FROM public.invoice_payment_allocations a
      WHERE a.invoice_id = i.id
    ),0) >= i.subtotal_bdt THEN 'paid'
  WHEN i.due_date IS NOT NULL AND i.due_date < ((now() AT TIME ZONE 'Asia/Dhaka')::date) THEN 'overdue'
  WHEN COALESCE((
      SELECT SUM(a.amount_bdt)
      FROM public.invoice_payment_allocations a
      WHERE a.invoice_id = i.id
    ),0) > 0 THEN 'partially_paid'
  ELSE 'unpaid'
END;

NOTIFY pgrst, 'reload schema';
COMMIT;
