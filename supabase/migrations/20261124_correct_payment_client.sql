-- FH Habibur Tech: correct a payment that was accidentally assigned to the wrong Client.
-- Preserves the original payment row and all payment attributes except client_id.
-- Releases allocations, moves the payment, then recalculates FIFO allocation for both Clients.

BEGIN;

CREATE OR REPLACE FUNCTION public.correct_payment_client(
  p_payment_id uuid,
  p_new_client_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_client_id uuid;
  v_amount_bdt numeric(14,2);
  v_payment_date date;
  v_method text;
  v_reference text;
BEGIN
  -- Finance-only accounting correction; current_user approval is required.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin'::public.app_role, 'accountant'::public.app_role)
      AND p.approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Only an approved Admin or Accountant can correct a Payment Client.';
  END IF;

  SELECT p.client_id, p.amount_bdt, p.payment_date, p.method, p.reference
    INTO v_old_client_id, v_amount_bdt, v_payment_date, v_method, v_reference
  FROM public.payments p
  WHERE p.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  IF p_new_client_id IS NULL THEN
    RAISE EXCEPTION 'Choose the correct Client.';
  END IF;

  IF v_old_client_id = p_new_client_id THEN
    RAISE EXCEPTION 'The Payment is already assigned to this Client.';
  END IF;

  -- Lock both Clients in stable order to reduce concurrent correction races.
  PERFORM 1
  FROM public.clients c
  WHERE c.id IN (v_old_client_id, p_new_client_id)
  ORDER BY c.id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_new_client_id
  ) THEN
    RAISE EXCEPTION 'The selected destination Client does not exist.';
  END IF;

  -- Release this payment's old invoice allocations. The payment itself remains.
  DELETE FROM public.invoice_payment_allocations
  WHERE payment_id = p_payment_id;

  -- Change only the Client foreign key; amount/date/method/reference remain.
  UPDATE public.payments
  SET client_id = p_new_client_id
  WHERE id = p_payment_id;

  -- Recalculate available funds for the previous Client and destination Client.
  PERFORM public.allocate_client_payments_fifo(v_old_client_id);
  PERFORM public.allocate_client_payments_fifo(p_new_client_id);

  -- Record the correction for future audit/reconciliation.
  INSERT INTO public.audit_logs (
    actor_id, action, table_name, record_id, details
  )
  VALUES (
    auth.uid(),
    'correct_client',
    'payments',
    p_payment_id::text,
    jsonb_build_object(
      'from_client_id', v_old_client_id,
      'to_client_id', p_new_client_id,
      'amount_bdt', v_amount_bdt,
      'payment_date', v_payment_date,
      'method', v_method,
      'reference', v_reference
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_payment_client(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_payment_client(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
