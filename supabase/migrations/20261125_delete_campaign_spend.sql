-- FH Habibur Tech: safely delete one Campaign Spend and restore its USD lot.
-- The insert reservation trigger has no delete counterpart, so this RPC reverses
-- exactly the reserved USD amount, updates the denormalized Campaign total,
-- deletes only one spend row, and records the action atomically.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_campaign_spend(p_spend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_purchase_lot_id uuid;
  v_amount_usd numeric(14,2);
  v_spend_date date;
  v_client_bill_bdt numeric(14,2);
  v_campaign_spent numeric(14,2);
  v_lot_amount_usd numeric(14,2);
  v_lot_remaining_usd numeric(14,2);
  v_deleted_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin'::public.app_role, 'accountant'::public.app_role)
      AND p.approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Only an approved Admin or Accountant can delete Campaign Spend.';
  END IF;

  IF NOT public.has_module_access('campaign_spend','manage') THEN
    RAISE EXCEPTION 'Campaign Spend Manage permission is required.';
  END IF;

  SELECT s.campaign_id, s.purchase_lot_id, s.amount_usd,
         s.spend_date, s.client_bill_bdt
    INTO v_campaign_id, v_purchase_lot_id, v_amount_usd,
         v_spend_date, v_client_bill_bdt
  FROM public.campaign_spend_entries s
  WHERE s.id = p_spend_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign Spend record not found. No data was changed.';
  END IF;

  IF v_campaign_id IS NULL OR v_purchase_lot_id IS NULL OR v_amount_usd IS NULL OR v_amount_usd <= 0 THEN
    RAISE EXCEPTION 'Spend record is missing its Campaign, Dollar Lot, or valid USD amount. No data was changed.';
  END IF;

  -- Lock the original lot and campaign before changing either balance.
  SELECT l.amount_usd, l.remaining_usd
    INTO v_lot_amount_usd, v_lot_remaining_usd
  FROM public.dollar_purchase_lots l
  WHERE l.id = v_purchase_lot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original Dollar Purchase Lot was not found. No data was changed.';
  END IF;

  SELECT c.spent_usd
    INTO v_campaign_spent
  FROM public.campaigns c
  WHERE c.id = v_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign was not found. No data was changed.';
  END IF;

  -- Prevent a duplicate refund or a corrupted lot balance.
  IF v_lot_remaining_usd + v_amount_usd > v_lot_amount_usd + 0.009 THEN
    RAISE EXCEPTION
      'Safety check stopped deletion: returning % USD would exceed the original Dollar Lot total. Check the Lot balance first.',
      v_amount_usd;
  END IF;

  -- The app updates campaigns.spent_usd after spend insertion. If that
  -- earlier update failed or the total drifted, stop instead of guessing.
  IF v_campaign_spent + 0.009 < v_amount_usd THEN
    RAISE EXCEPTION
      'Safety check stopped deletion: Campaign Spent total (%) is lower than this Spend (%). Reconcile the Campaign total first.',
      v_campaign_spent, v_amount_usd;
  END IF;

  UPDATE public.dollar_purchase_lots
  SET remaining_usd = remaining_usd + v_amount_usd
  WHERE id = v_purchase_lot_id;

  UPDATE public.campaigns
  SET spent_usd = GREATEST(spent_usd - v_amount_usd, 0)
  WHERE id = v_campaign_id;

  DELETE FROM public.campaign_spend_entries
  WHERE id = p_spend_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'Expected to delete exactly one Campaign Spend row. Transaction cancelled.';
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, action, table_name, record_id, details
  )
  VALUES (
    auth.uid(),
    'delete',
    'campaign_spend_entries',
    p_spend_id::text,
    jsonb_build_object(
      'campaign_id', v_campaign_id,
      'purchase_lot_id', v_purchase_lot_id,
      'amount_usd', v_amount_usd,
      'spend_date', v_spend_date,
      'client_bill_bdt', v_client_bill_bdt,
      'restored_to_dollar_lot', true
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_campaign_spend(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_campaign_spend(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
