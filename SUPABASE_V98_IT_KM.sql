-- V98 — IT par kilomètre directement sur les chantiers.
-- À exécuter UNE FOIS dans Supabase > SQL Editor avant de publier V98.

alter table public.projects
  add column if not exists it_km numeric(8,1) not null default 0;

comment on column public.projects.it_km is
  'Kilométrage IT attribué au chantier et repris automatiquement dans les fiches d''heures.';

-- Les anciennes tables/colonnes de zones IT sont conservées uniquement pour l'historique.
-- V98 ne les utilise plus pour les nouvelles fiches.
