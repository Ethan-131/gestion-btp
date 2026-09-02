-- Gestion BTP V2 — rôles métier, sécurité et qualité des données
-- À exécuter une seule fois dans Supabase SQL Editor avant de tester la V2.
-- Cette migration conserve la colonne legacy `role` afin de ne pas casser l'application actuelle.

begin;

-- 1) Nouveau rôle métier V2, séparé du rôle technique legacy.
alter table public.profiles
  add column if not exists business_role text;

update public.profiles
set business_role = case
  when role::text = 'admin' then 'admin'
  when role::text = 'conducteur' then 'conducteur'
  when role::text = 'salarie' then 'salarie'
  when role::text = 'rh' then 'direction'
  else 'salarie'
end
where business_role is null;

alter table public.profiles
  alter column business_role set default 'salarie';

alter table public.profiles
  alter column business_role set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_business_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_business_role_check
      check (business_role in ('admin','patron','direction','conducteur','salarie'));
  end if;
end $$;

create index if not exists profiles_business_role_idx
  on public.profiles(business_role, status);

-- 2) Compatibilité automatique avec l'application actuelle.
-- patron / direction continuent d'être vus comme `rh` par le code historique.
create or replace function public.sync_legacy_role_from_business_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.business_role = 'admin' then
    new.role = 'admin'::public.app_role;
  elsif new.business_role in ('patron','direction') then
    new.role = 'rh'::public.app_role;
  elsif new.business_role = 'conducteur' then
    new.role = 'conducteur'::public.app_role;
  else
    new.role = 'salarie'::public.app_role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_legacy_role_v2 on public.profiles;
create trigger profiles_sync_legacy_role_v2
before insert or update of business_role on public.profiles
for each row execute function public.sync_legacy_role_from_business_role();

-- Resynchronisation immédiate de tous les profils.
update public.profiles set business_role = business_role;

-- 3) Helpers de permissions V2.
create or replace function public.current_business_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select business_role from public.profiles where id = auth.uid()), 'salarie')
$$;

create or replace function public.is_v2_management()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select status = 'active' and business_role in ('direction','patron','admin')
    from public.profiles where id = auth.uid()
  ), false)
$$;

create or replace function public.can_manage_accounts_v2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select status = 'active' and business_role in ('patron','admin')
    from public.profiles where id = auth.uid()
  ), false)
$$;

create or replace function public.can_manage_sensitive_roles_v2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select status = 'active' and business_role = 'admin'
    from public.profiles where id = auth.uid()
  ), false)
$$;

-- Compatibilité avec toutes les RPC/policies existantes.
create or replace function public.is_rh_or_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_v2_management() $$;

-- `is_rh()` reste la permission de validation fonctionnelle : Direction + Patron + Admin.
create or replace function public.is_rh()
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_v2_management() $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select status = 'active' and business_role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_conductor()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select status = 'active' and business_role = 'conducteur' from public.profiles where id = auth.uid()), false)
$$;

-- 4) La Direction ne doit pas pouvoir modifier les comptes/rôles.
drop policy if exists profiles_rh_update on public.profiles;
drop policy if exists profiles_admin_non_pending_update on public.profiles;
drop policy if exists profiles_v2_account_managers_update on public.profiles;
create policy profiles_v2_account_managers_update
on public.profiles for update
using (public.can_manage_accounts_v2())
with check (public.can_manage_accounts_v2());

-- Un utilisateur garde le droit de modifier ses propres informations via les RPC dédiées,
-- mais pas de changer son rôle par un UPDATE direct.

-- 5) RPC dédiée pour attribuer un rôle métier avec protections.
create or replace function public.set_business_role_v2(target_id uuid, new_role text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  target_role text;
  result public.profiles;
begin
  if not public.can_manage_accounts_v2() then
    raise exception 'Gestion des rôles réservée au Patron ou à l Administrateur technique';
  end if;

  if new_role not in ('admin','patron','direction','conducteur','salarie') then
    raise exception 'Rôle invalide';
  end if;

  select business_role into actor_role from public.profiles where id = auth.uid();
  select business_role into target_role from public.profiles where id = target_id;

  if target_role is null then raise exception 'Compte introuvable'; end if;

  -- Seul l'administrateur technique peut créer/retirer un administrateur ou un patron.
  if actor_role <> 'admin' and (
    new_role in ('admin','patron') or target_role in ('admin','patron')
  ) then
    raise exception 'Seul l Administrateur technique peut gérer les rôles Administrateur et Patron';
  end if;

  -- Empêche l'administrateur de se retirer lui-même son dernier accès critique par erreur.
  if target_id = auth.uid() and target_role = 'admin' and new_role <> 'admin' then
    if (select count(*) from public.profiles where status='active' and business_role='admin') <= 1 then
      raise exception 'Impossible de retirer le dernier Administrateur technique actif';
    end if;
  end if;

  update public.profiles
  set business_role = new_role,
      updated_at = now()
  where id = target_id
  returning * into result;

  insert into public.audit_log(actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    auth.uid(), 'business_role_changed', 'profile', target_id,
    jsonb_build_object('business_role', target_role),
    jsonb_build_object('business_role', new_role)
  );

  return result;
end;
$$;

grant execute on function public.set_business_role_v2(uuid,text) to authenticated;

-- 6) Données IT : distinguer calcul automatique, modification manuelle et validation bureau.
alter table public.timesheet_days
  add column if not exists travel_km_auto numeric(8,2),
  add column if not exists travel_km_source text not null default 'automatic',
  add column if not exists travel_km_reviewed_by uuid references public.profiles(id),
  add column if not exists travel_km_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='timesheet_days_travel_km_source_check'
      and conrelid='public.timesheet_days'::regclass
  ) then
    alter table public.timesheet_days
      add constraint timesheet_days_travel_km_source_check
      check (travel_km_source in ('automatic','manual','office_reviewed','unknown'));
  end if;
end $$;

update public.timesheet_days
set travel_km_auto = coalesce(travel_km_auto, travel_km),
    travel_km_source = case when coalesce(it_needs_review,false) then 'manual' else 'automatic' end
where travel_km_auto is null;

create or replace function public.track_travel_km_source_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.travel_km_auto := coalesce(new.travel_km_auto, new.travel_km);
    if coalesce(new.it_needs_review,false) then new.travel_km_source := 'manual';
    else new.travel_km_source := coalesce(new.travel_km_source,'automatic'); end if;
  elsif new.travel_km is distinct from old.travel_km then
    if coalesce(new.it_needs_review,false) then
      new.travel_km_source := 'manual';
    elsif public.is_v2_management() then
      new.travel_km_source := 'office_reviewed';
      new.travel_km_reviewed_by := auth.uid();
      new.travel_km_reviewed_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists timesheet_days_track_it_v2 on public.timesheet_days;
create trigger timesheet_days_track_it_v2
before insert or update of travel_km,it_needs_review on public.timesheet_days
for each row execute function public.track_travel_km_source_v2();

-- 7) Vue normalisée des heures : l'ID chantier est la clé principale des statistiques.
create or replace view public.v2_project_time_entries
with (security_invoker = true)
as
select
  t.id as timesheet_id,
  t.employee_id,
  t.iso_year,
  t.iso_week,
  t.status as timesheet_status,
  d.id as day_id,
  d.work_date,
  d.meal,
  d.travel_km,
  d.travel_km_auto,
  d.travel_km_source,
  d.it_needs_review,
  s.id as site_id,
  s.project_id,
  coalesce(p.code, s.project_code_snapshot) as project_code,
  coalesce(p.name, s.project_name_snapshot) as project_name,
  s.hours
from public.timesheets t
join public.timesheet_days d on d.timesheet_id = t.id
join public.timesheet_sites s on s.day_id = d.id
left join public.projects p on p.id = s.project_id;

grant select on public.v2_project_time_entries to authenticated;

-- 8) Vue synthèse destinée aux tableaux de bord.
create or replace view public.v2_timesheet_week_summary
with (security_invoker = true)
as
select
  t.id,
  t.employee_id,
  t.iso_year,
  t.iso_week,
  t.status,
  coalesce(sum(s.hours),0)::numeric(10,2) as total_hours,
  coalesce(sum(distinct case when d.meal > 0 then d.meal else 0 end),0)::numeric(10,2) as meals_indicator,
  bool_or(coalesce(d.it_needs_review,false)) as has_it_warning
from public.timesheets t
left join public.timesheet_days d on d.timesheet_id=t.id
left join public.timesheet_sites s on s.day_id=d.id
group by t.id,t.employee_id,t.iso_year,t.iso_week,t.status;

grant select on public.v2_timesheet_week_summary to authenticated;

commit;

-- Après exécution, vous pouvez attribuer le premier Administrateur technique ainsi :
-- update public.profiles set business_role='admin' where email='VOTRE_EMAIL';
