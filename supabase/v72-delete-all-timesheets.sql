-- V72 — Suppression volontaire de toutes les fiches d'heures.
-- Ne supprime ni les comptes, ni les chantiers, ni les congés/RTT.

begin;

-- Supprime aussi les anciennes notifications de fiches qui ne seraient plus liées.
delete from public.notifications
where timesheet_id is not null
   or kind like 'timesheet_%';

-- Les journées, lignes chantier et versions sont supprimées automatiquement
-- grâce aux clés étrangères ON DELETE CASCADE.
delete from public.timesheets;

commit;

-- Contrôle final : toutes ces valeurs doivent être égales à 0.
select
  (select count(*) from public.timesheets) as fiches,
  (select count(*) from public.timesheet_days) as journees,
  (select count(*) from public.timesheet_sites) as lignes_chantier,
  (select count(*) from public.timesheet_versions) as versions;
