-- Hotfix: correctly extract only the numeric suffix from generated invoice numbers.
-- The previous expression matched the whole FHT-YYYY-NNNNN string and cast it to bigint.

BEGIN;

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next bigint;
  -- Capture group 1 is the numeric suffix only (not the complete FHT reference).
  v_pattern text;
BEGIN
  IF p_year IS NULL OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Invalid invoice year: %', p_year;
  END IF;

  v_pattern := '^FHT-' || p_year::text || '-([0-9]+)$';

  INSERT INTO public.invoice_number_counters(invoice_year, last_number)
  VALUES (p_year, 0)
  ON CONFLICT (invoice_year) DO NOTHING;

  UPDATE public.invoice_number_counters AS counter
  SET last_number = GREATEST(
        counter.last_number,
        COALESCE((
          SELECT MAX((regexp_match(i.invoice_number, v_pattern))[1]::bigint)
          FROM public.invoices AS i
          WHERE i.invoice_number ~ v_pattern
        ), 0)
      ) + 1,
      updated_at = now()
  WHERE counter.invoice_year = p_year
  RETURNING counter.last_number INTO v_next;

  RETURN 'FHT-' || p_year::text || '-' ||
    lpad(v_next::text, GREATEST(5, length(v_next::text)), '0');
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
