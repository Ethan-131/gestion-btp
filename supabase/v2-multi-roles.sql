-- Gestion BTP V2 — multi-rôles
-- À exécuter APRÈS v2-roles-and-security.sql
begin;

alter table public.profiles
  add column if not exists business_roles text[];

update public.profiles
set business_roles = array[coalesce(business_role,'salarie')]
where business_roles is null or cardinality(business_roles)=0;

alter table public.profiles
  alter column business_roles set default array['salarie']::text[];

alter table public.profiles
  alter column business_roles set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='profiles_business_roles_check'
      and conrelid='public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_business_roles_check
      check (
        cardinality(business_roles) >= 1
        and business_roles <@ array['admin','patron','direction','conducteur','salarie']::text[]
      );
  end if;
end $$;

create index if not exists profiles_business_roles_gin_idx
  on public.profiles using gin(business_roles);

create or replace function public.profile_primary_role_v2(roles text[])
returns text
language sql immutable
as $$
  select case
    when 'admin'=any(roles) then 'admin'
    when 'patron'=any(roles) then 'patron'
    when 'direction'=any(roles) then 'direction'
    when 'conducteur'=any(roles) then 'conducteur'
    else 'salarie'
  end
$$;

create or replace function public.sync_v2_roles()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.business_roles is null or cardinality(new.business_roles)=0 then
    new.business_roles := array[coalesce(new.business_role,'salarie')];
  end if;

  new.business_roles := array(
    select distinct x
    from unnest(new.business_roles) x
    where x in ('admin','patron','direction','conducteur','salarie')
    order by x
  );

  if cardinality(new.business_roles)=0 then new.business_roles:=array['salarie']; end if;
  new.business_role := public.profile_primary_role_v2(new.business_roles);

  if 'admin'=any(new.business_roles) then
    new.role='admin'::public.app_role;
  elsif 'patron'=any(new.business_roles) or 'direction'=any(new.business_roles) then
    new.role='rh'::public.app_role;
  elsif 'conducteur'=any(new.business_roles) then
    new.role='conducteur'::public.app_role;
  else
    new.role='salarie'::public.app_role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_legacy_role_v2 on public.profiles;
drop trigger if exists profiles_sync_v2_roles on public.profiles;
create trigger profiles_sync_v2_roles
before insert or update of business_role,business_roles
on public.profiles
for each row execute function public.sync_v2_roles();

update public.profiles set business_roles=business_roles;

create or replace function public.current_business_roles()
returns text[]
language sql stable security definer set search_path=public
as $$
  select coalesce((select business_roles from public.profiles where id=auth.uid()),array['salarie']::text[])
$$;

create or replace function public.current_business_role()
returns text
language sql stable security definer set search_path=public
as $$ select public.profile_primary_role_v2(public.current_business_roles()) $$;

create or replace function public.is_v2_management()
returns boolean
language sql stable security definer set search_path=public
as $$
  select coalesce((select status='active' and business_roles && array['direction','patron','admin']::text[] from public.profiles where id=auth.uid()),false)
$$;

create or replace function public.can_manage_accounts_v2()
returns boolean
language sql stable security definer set search_path=public
as $$
  select coalesce((select status='active' and business_roles && array['patron','admin']::text[] from public.profiles where id=auth.uid()),false)
$$;

create or replace function public.can_manage_sensitive_roles_v2()
returns boolean
language sql stable security definer set search_path=public
as $$
  select coalesce((select status='active' and 'admin'=any(business_roles) from public.profiles where id=auth.uid()),false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select status='active' and 'admin'=any(business_roles) from public.profiles where id=auth.uid()),false) $$;

create or replace function public.is_conductor()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select status='active' and 'conducteur'=any(business_roles) from public.profiles where id=auth.uid()),false) $$;

create or replace function public.is_rh_or_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_v2_management() $$;

create or replace function public.is_rh()
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_v2_management() $$;

create or replace function public.set_business_roles_v2(target_id uuid,new_roles text[])
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_roles text[];
  target_roles text[];
  cleaned text[];
  result public.profiles;
begin
  if not public.can_manage_accounts_v2() then
    raise exception 'Gestion des rôles réservée au Patron ou à l Administrateur technique';
  end if;

  cleaned := array(select distinct x from unnest(new_roles) x where x in ('admin','patron','direction','conducteur','salarie') order by x);
  if cleaned is null or cardinality(cleaned)=0 then raise exception 'Au moins un rôle est obligatoire'; end if;

  select business_roles into actor_roles from public.profiles where id=auth.uid();
  select business_roles into target_roles from public.profiles where id=target_id;
  if target_roles is null then raise exception 'Compte introuvable'; end if;

  if not ('admin'=any(actor_roles)) and (
    cleaned && array['admin','patron']::text[]
    or target_roles && array['admin','patron']::text[]
  ) then
    raise exception 'Seul l Administrateur technique peut gérer les rôles Administrateur et Patron';
  end if;

  if target_id=auth.uid() and 'admin'=any(target_roles) and not ('admin'=any(cleaned)) then
    if (select count(*) from public.profiles where status='active' and 'admin'=any(business_roles)) <= 1 then
      raise exception 'Impossible de retirer le dernier Administrateur technique actif';
    end if;
  end if;

  update public.profiles
  set business_roles=cleaned,updated_at=now()
  where id=target_id
  returning * into result;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
  values(auth.uid(),'business_roles_changed','profile',target_id,
    jsonb_build_object('business_roles',target_roles),
    jsonb_build_object('business_roles',cleaned));

  return result;
end;
$$;

grant execute on function public.set_business_roles_v2(uuid,text[]) to authenticated;

-- Compatibilité : l'ancienne RPC mono-rôle remplace la liste par un seul rôle.
create or replace function public.set_business_role_v2(target_id uuid,new_role text)
returns public.profiles
language sql
security definer
set search_path=public
as $$ select public.set_business_roles_v2(target_id,array[new_role]) $$;

grant execute on function public.set_business_role_v2(uuid,text) to authenticated;

commit;
