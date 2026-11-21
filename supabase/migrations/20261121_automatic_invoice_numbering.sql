-- FH Habibur Tech: database-generated unique invoice numbers.
-- Additive and safe for existing invoices. Existing legitimate numbers are kept.
-- New invoice numbers use FHT-YYYY-00001, with a separate counter per issue year.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_number_counters (
  invoice_year integer PRIMARY KEY CHECK (invoice_year BETWEEN 2000 AND 9999),
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_number_counters FROM PUBLIC, anon, authenticated;

-- Atomic per-year counter. The max-number lookup also protects against older
-- invoices that already use the FHT-YYYY-NNNNN naming convention.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next bigint;
  v_pattern text;
BEGIN
  IF p_year IS NULL OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'Invalid invoice year: %', p_year;
  END IF;

  v_pattern := '^FHT-' || p_year::text || '-[0-9]+$';

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

REVOKE ALL ON FUNCTION public.next_invoice_number(integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_invoice_number_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_number IS NULL
     OR btrim(NEW.invoice_number) = ''
     OR lower(btrim(NEW.invoice_number)) IN (
       'invoice number',
       'invoice no',
       'invoice #',
       'number',
       'auto',
       'auto-generated',
       'tbd',
       'n/a'
     )
  THEN
    NEW.invoice_number := public.next_invoice_number(
      COALESCE(EXTRACT(YEAR FROM NEW.issue_date)::integer,
               EXTRACT(YEAR FROM CURRENT_DATE)::integer)
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_invoice_number_before_insert() FROM PUBLIC, anon, authenticated;

-- The default lets clients omit invoice_number entirely. The BEFORE trigger
-- replaces the empty value before the NOT NULL and UNIQUE constraints run.
ALTER TABLE public.invoices
  ALTER COLUMN invoice_number SET DEFAULT '';

DROP TRIGGER IF EXISTS trg_assign_invoice_number_before_insert ON public.invoices;
CREATE TRIGGER trg_assign_invoice_number_before_insert
BEFORE INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.assign_invoice_number_before_insert();

-- Backfill only recognizable placeholders. Existing valid identifiers such as
-- 1241 or previously generated FHT references remain untouched.
DO $$
DECLARE
  v_invoice record;
BEGIN
  FOR v_invoice IN
    SELECT id, EXTRACT(YEAR FROM issue_date)::integer AS issue_year
    FROM public.invoices
    WHERE lower(btrim(invoice_number)) IN (
      'invoice number',
      'invoice no',
      'invoice #',
      'number',
      'auto',
      'auto-generated',
      'tbd',
      'n/a',
      ''
    )
    ORDER BY issue_date, created_at, id
  LOOP
    UPDATE public.invoices
    SET invoice_number = public.next_invoice_number(v_invoice.issue_year)
    WHERE id = v_invoice.id;
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.invoices.invoice_number IS
  'Unique invoice reference. Automatically generated as FHT-YYYY-00001 when omitted or left as a placeholder.';

NOTIFY pgrst, 'reload schema';
COMMIT;
