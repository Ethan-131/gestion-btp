-- V99 — IT par kilomètre ET par siège de rattachement.
-- À exécuter UNE FOIS dans Supabase > SQL Editor avant de publier V99.

-- On conserve la colonne V98 pour compatibilité / historique.
alter table public.projects
  add column if not exists it_km numeric(8,1) not null default 0;

alter table public.projects
  add column if not exists it_km_plaisance numeric(8,1) not null default 0,
  add column if not exists it_km_salies numeric(8,1) not null default 0;

comment on column public.projects.it_km_plaisance is
  'Kilométrage IT du chantier pour les salariés rattachés à Plaisance-du-Touch / Menuiserie.';

comment on column public.projects.it_km_salies is
  'Kilométrage IT du chantier pour les salariés rattachés à Salies-du-Salat / Antras Ossature Bois.';

-- Reprise automatique de l'ancienne valeur V98 afin de ne pas perdre les IT déjà saisies.
-- Après cette migration, vous pourrez corriger séparément les deux valeurs depuis l'application.
update public.projects
set
  it_km_plaisance = it_km,
  it_km_salies = it_km
where coalesce(it_km, 0) <> 0
  and coalesce(it_km_plaisance, 0) = 0
  and coalesce(it_km_salies, 0) = 0;
