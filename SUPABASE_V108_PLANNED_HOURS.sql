-- V108 — Correctif des heures prévues des chantiers
-- À exécuter une seule fois dans Supabase > SQL Editor.
--
-- Certaines versions de la base possèdent projects.planned_hours comme
-- colonne GENERATED. PostgreSQL interdit alors d'y enregistrer une valeur
-- manuellement et renvoie :
--   column "planned_hours" can only be updated to DEFAULT
--
-- La V105+ permet de saisir/corriger les heures prévues : cette migration
-- transforme donc planned_hours en colonne normale éditable, tout en
-- conservant les valeurs déjà calculées.

DO $$
BEGIN
  -- Si la colonne n'existe pas encore, on la crée directement comme colonne normale.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'planned_hours'
  ) THEN
    ALTER TABLE public.projects
      ADD COLUMN planned_hours numeric(10,1) NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$
DECLARE
  generated_state text;
BEGIN
  SELECT is_generated
    INTO generated_state
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'projects'
    AND column_name = 'planned_hours';

  IF generated_state = 'ALWAYS' THEN
    ALTER TABLE public.projects
      ALTER COLUMN planned_hours DROP EXPRESSION;
  END IF;
END $$;

-- Valeur de secours pour d'éventuelles anciennes lignes NULL.
UPDATE public.projects
SET planned_hours = 0
WHERE planned_hours IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN planned_hours SET DEFAULT 0,
  ALTER COLUMN planned_hours SET NOT NULL;
