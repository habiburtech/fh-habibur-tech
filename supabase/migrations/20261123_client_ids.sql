-- FH Habibur Tech: permanent human-readable Client IDs.
-- Adds a unique Client Code, backfills existing clients, and assigns one to every new client.
-- Existing clients and financial records are preserved.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.client_code_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_code text;

DO $$
DECLARE
  v_max bigint;
  v_client record;
BEGIN
  SELECT COALESCE(MAX((regexp_match(client_code, '^FHT-CL-([0-9]+)$'))[1]::bigint), 0)
  INTO v_max
  FROM public.clients
  WHERE client_code IS NOT NULL;

  PERFORM setval('public.client_code_seq'::regclass, v_max + 1, false);

  FOR v_client IN
    SELECT id
    FROM public.clients
    WHERE client_code IS NULL OR btrim(client_code) = ''
    ORDER BY created_at, id
  LOOP
    UPDATE public.clients
    SET client_code = 'FHT-CL-' || lpad(nextval('public.client_code_seq')::text, 5, '0')
    WHERE id = v_client.id;
  END LOOP;
END;
$$;

ALTER TABLE public.clients
  ALTER COLUMN client_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_client_code_uidx
  ON public.clients(client_code);

CREATE OR REPLACE FUNCTION public.assign_client_code_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.client_code IS DISTINCT FROM OLD.client_code THEN
      RAISE EXCEPTION 'Client ID is permanent and cannot be changed.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.client_code IS NULL OR btrim(NEW.client_code) = '' THEN
    NEW.client_code :=
      'FHT-CL-' || lpad(nextval('public.client_code_seq')::text, 5, '0');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_client_code_before_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assign_client_code_before_insert ON public.clients;
DROP TRIGGER IF EXISTS trg_client_code_immutable ON public.clients;

CREATE TRIGGER trg_assign_client_code_before_insert
BEFORE INSERT ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.assign_client_code_before_insert();

CREATE TRIGGER trg_client_code_immutable
BEFORE UPDATE OF client_code ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.assign_client_code_before_insert();

COMMENT ON COLUMN public.clients.client_code IS
  'Permanent unique human-readable Client ID. Format: FHT-CL-00001.';

NOTIFY pgrst, 'reload schema';

COMMIT;
