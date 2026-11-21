-- FH Habibur Tech: safely void an incorrect invoice without deleting real payments.
-- Run after 20261121_invoice_payment_allocation.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_invoice_status text;
BEGIN
  -- Restrict this accounting action to approved Finance users.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin'::public.app_role, 'accountant'::public.app_role)
      AND p.approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Only an approved Admin or Accountant can void an invoice.';
  END IF;

  SELECT i.client_id, i.status
    INTO v_client_id, v_invoice_status
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;

  IF v_invoice_status = 'void' THEN
    RETURN;
  END IF;

  -- Release allocations, but never delete or modify the original payment.
  DELETE FROM public.invoice_payment_allocations
  WHERE invoice_id = p_invoice_id;

  UPDATE public.invoices
  SET status = 'void'
  WHERE id = p_invoice_id;

  -- Reapply released payments FIFO to any other valid open invoices for
  -- this same client. If none remain, payment value stays unallocated and
  -- is still included in the app's client-level Client Due calculation.
  PERFORM public.allocate_client_payments_fifo(v_client_id);

  -- Keep the void state authoritative after allocation triggers run.
  PERFORM public.refresh_invoice_payment_status(p_invoice_id);
END;
$$;

REVOKE ALL ON FUNCTION public.void_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
