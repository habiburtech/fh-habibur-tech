-- FH Habibur Tech: edit one payment amount while preserving the payment record.
-- Rebuild all allocations for the affected Client so FIFO stays correct.
-- Other payment rows and their amounts are unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_payment_amount(
  p_payment_id uuid,
  p_new_amount_bdt numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_old_amount numeric(14,2);
  v_new_amount numeric(14,2);
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin'::public.app_role, 'accountant'::public.app_role)
      AND p.approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Only an approved Admin or Accountant can edit a Payment amount.';
  END IF;

  IF p_new_amount_bdt IS NULL OR p_new_amount_bdt <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  v_new_amount := round(p_new_amount_bdt, 2);

  -- Read the Client first, then lock this Client's invoices and payments
  -- in a stable order before locking/validating the target Payment amount.
  SELECT p.client_id
    INTO v_client_id
  FROM public.payments p
  WHERE p.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  PERFORM 1
  FROM public.invoices i
  WHERE i.client_id = v_client_id
  ORDER BY i.id
  FOR UPDATE;

  PERFORM 1
  FROM public.payments p
  WHERE p.client_id = v_client_id
  ORDER BY p.id
  FOR UPDATE;

  SELECT p.amount_bdt
    INTO v_old_amount
  FROM public.payments p
  WHERE p.id = p_payment_id
    AND p.client_id = v_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment Client changed during correction. Reload and try again.';
  END IF;

  IF v_new_amount = v_old_amount THEN
    RAISE EXCEPTION 'The new amount is the same as the current amount.';
  END IF;

  -- Release all allocations for this Client so the full payment set can be
  -- rebuilt in strict payment-date FIFO order against oldest open invoices.
  DELETE FROM public.invoice_payment_allocations a
  USING public.payments p
  WHERE a.payment_id = p.id
    AND p.client_id = v_client_id;

  UPDATE public.payments
  SET amount_bdt = v_new_amount
  WHERE id = p_payment_id;

  PERFORM public.allocate_client_payments_fifo(v_client_id);

  INSERT INTO public.audit_logs (
    actor_id, action, table_name, record_id, details
  )
  VALUES (
    auth.uid(),
    'update_amount',
    'payments',
    p_payment_id::text,
    jsonb_build_object(
      'client_id', v_client_id,
      'old_amount_bdt', v_old_amount,
      'new_amount_bdt', v_new_amount
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_payment_amount(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_payment_amount(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
