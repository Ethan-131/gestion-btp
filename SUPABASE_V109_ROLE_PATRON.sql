-- V109 — Ajout du rôle Patron
-- À exécuter dans Supabase > SQL Editor avant d'attribuer le rôle Patron.
-- Cette migration ne modifie aucun compte existant.

DO $$
DECLARE
  role_type text;
  role_udt text;
  c record;
BEGIN
  SELECT data_type, udt_name
    INTO role_type, role_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'role';

  IF role_type IS NULL THEN
    RAISE EXCEPTION 'La colonne public.profiles.role est introuvable.';
  END IF;

  -- Si le rôle est stocké dans un ENUM PostgreSQL, on ajoute Patron à l'ENUM.
  IF role_type = 'USER-DEFINED' THEN
    EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', 'public', role_udt, 'patron');
  ELSE
    -- Si le rôle est stocké en texte avec une contrainte CHECK, on remplace
    -- uniquement les contraintes CHECK de profiles qui concernent la colonne role.
    FOR c IN
      SELECT conname
      FROM pg_constraint pc
      JOIN pg_class t ON t.oid = pc.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'profiles'
        AND pc.contype = 'c'
        AND pg_get_constraintdef(pc.oid) ILIKE '%role%'
    LOOP
      EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
    END LOOP;

    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_allowed_v109
      CHECK (
        role IS NULL OR role IN ('admin', 'patron', 'rh', 'conducteur', 'salarie')
      );
  END IF;
END $$;

-- Vérification informative : doit retourner les rôles actuellement présents.
SELECT role, count(*) AS comptes
FROM public.profiles
GROUP BY role
ORDER BY role;
