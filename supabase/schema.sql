-- Gestion BTP V66 - schéma initial Supabase
-- À exécuter dans le SQL Editor d'un nouveau projet Supabase.

create extension if not exists pgcrypto;

create type public.app_role as enum ('salarie', 'conducteur', 'rh', 'admin');
create type public.account_status as enum ('pending', 'active', 'rejected', 'disabled');
create type public.project_status as enum ('upcoming', 'active', 'overdue', 'completed', 'archived');
create type public.sheet_status as enum ('draft', 'submitted', 'pending_review', 'rejected', 'validated', 'changed_after_validation');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  employee_number text,
  role public.app_role,
  status public.account_status not null default 'pending',
  rejection_reason text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_idx on public.profiles (lower(email));
create unique index profiles_employee_number_idx on public.profiles (employee_number) where employee_number is not null;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  planned_days numeric(8,2) not null check (planned_days > 0),
  planned_hours numeric(10,2) generated always as (planned_days * 7.8) stored,
  estimate_method text not null default 'temporary_average_7_8h',
  planned_start_date date not null,
  planned_end_date date not null,
  actual_start_date date,
  actual_end_date date,
  status public.project_status not null default 'upcoming',
  internal_notes text not null default '',
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates_check check (planned_end_date >= planned_start_date),
  constraint projects_actual_dates_check check (actual_end_date is null or actual_start_date is null or actual_end_date >= actual_start_date)
);

create unique index projects_code_normalized_idx on public.projects (lower(regexp_replace(code, '[^a-zA-Z0-9]', '', 'g')));
create index projects_name_search_idx on public.projects using gin (to_tsvector('simple', name));

create table public.project_conductors (
  project_id uuid not null references public.projects(id) on delete cascade,
  conductor_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (project_id, conductor_id)
);

create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  iso_year integer not null check (iso_year between 2020 and 2040),
  iso_week integer not null check (iso_week between 1 and 53),
  status public.sheet_status not null default 'draft',
  observations text not null default '',
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, iso_year, iso_week)
);

create table public.timesheet_days (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references public.timesheets(id) on delete cascade,
  work_date date not null,
  day_type text not null default 'worked' check (day_type in ('worked','cp','rtt','holiday')),
  meal numeric(4,2) not null default 0,
  travel_km numeric(8,2) not null default 0,
  tasks jsonb not null default '[]'::jsonb,
  manual_task text not null default '',
  vehicle text not null default '',
  delivery_note text not null default '',
  unique (timesheet_id, work_date)
);

create table public.timesheet_sites (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.timesheet_days(id) on delete cascade,
  project_id uuid references public.projects(id),
  project_code_snapshot text not null,
  project_name_snapshot text not null,
  hours numeric(5,2) not null check (hours >= 0 and hours <= 24),
  position integer not null default 0
);

create index timesheet_sites_project_idx on public.timesheet_sites(project_id);
create index timesheets_employee_idx on public.timesheets(employee_id, iso_year, iso_week);

create table public.timesheet_versions (
  id uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references public.timesheets(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid not null references public.profiles(id),
  change_reason text not null default '',
  created_at timestamptz not null default now(),
  unique (timesheet_id, version)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  timesheet_id uuid references public.timesheets(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger timesheets_touch before update on public.timesheets for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, employee_number)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'employee_number', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_profile()
returns public.profiles
language sql stable security definer set search_path = public
as $$ select * from public.profiles where id = auth.uid() $$;

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select status = 'active' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_rh_or_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select status = 'active' and role in ('rh','admin') from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_rh()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select status = 'active' and role = 'rh' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select status = 'active' and role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.is_conductor()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select status = 'active' and role = 'conducteur' from public.profiles where id = auth.uid()), false) $$;

create or replace function public.conductor_is_assigned(target_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_conductors
    where project_id = target_project and conductor_id = auth.uid()
  )
$$;

create or replace function public.assign_conductor_creator()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
    where id = new.created_by and status = 'active' and role = 'conducteur'
  ) then
    insert into public.project_conductors (project_id, conductor_id, assigned_by)
    values (new.id, new.created_by, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger projects_assign_conductor_creator
after insert on public.projects
for each row execute function public.assign_conductor_creator();

create or replace function public.conductor_can_view_sheet(sheet_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.timesheet_days d
    join public.timesheet_sites s on s.day_id = d.id
    join public.project_conductors pc on pc.project_id = s.project_id
    join public.profiles p on p.id = auth.uid()
    where d.timesheet_id = sheet_id
      and pc.conductor_id = auth.uid()
      and p.status = 'active'
      and p.role = 'conducteur'
  )
$$;

create or replace function public.conductor_can_view_employee(employee uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.timesheets t
    where t.employee_id = employee
      and public.conductor_can_view_sheet(t.id)
  )
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_conductors enable row level security;
alter table public.timesheets enable row level security;
alter table public.timesheet_days enable row level security;
alter table public.timesheet_sites enable row level security;
alter table public.timesheet_versions enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_self_read on public.profiles for select using (
  id = auth.uid() or public.is_rh_or_admin() or public.conductor_can_view_employee(id)
);
create policy profiles_pending_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_rh_update on public.profiles for update using (public.is_rh()) with check (public.is_rh());
create policy profiles_admin_non_pending_update on public.profiles for update
  using (public.is_admin() and status <> 'pending')
  with check (public.is_admin() and status <> 'pending');

create policy projects_active_read on public.projects for select using (public.is_active());
create policy projects_manage on public.projects for all using (public.is_rh_or_admin()) with check (public.is_rh_or_admin());
create policy projects_conductor_insert on public.projects for insert with check (
  public.is_conductor() and created_by = auth.uid() and updated_by = auth.uid() and status <> 'archived'
);
create policy projects_conductor_update on public.projects for update using (
  public.is_conductor() and public.conductor_is_assigned(id)
) with check (
  public.is_conductor() and public.conductor_is_assigned(id) and updated_by = auth.uid() and status <> 'archived'
);
create policy assignments_read on public.project_conductors for select using (public.is_active());
create policy assignments_manage on public.project_conductors for all using (public.is_rh_or_admin()) with check (public.is_rh_or_admin());

create policy sheets_read on public.timesheets for select using (
  employee_id = auth.uid() or public.is_rh_or_admin() or public.conductor_can_view_sheet(id)
);
create policy sheets_employee_insert on public.timesheets for insert with check (employee_id = auth.uid() and public.is_active());
create policy sheets_employee_update on public.timesheets for update using (employee_id = auth.uid() or public.is_rh_or_admin()) with check (employee_id = auth.uid() or public.is_rh_or_admin());

create policy days_read on public.timesheet_days for select using (
  exists (select 1 from public.timesheets t where t.id = timesheet_id and (t.employee_id = auth.uid() or public.is_rh_or_admin() or public.conductor_can_view_sheet(t.id)))
);
create policy days_write on public.timesheet_days for all using (
  exists (select 1 from public.timesheets t where t.id = timesheet_id and (t.employee_id = auth.uid() or public.is_rh_or_admin()))
) with check (
  exists (select 1 from public.timesheets t where t.id = timesheet_id and (t.employee_id = auth.uid() or public.is_rh_or_admin()))
);

create policy sites_read on public.timesheet_sites for select using (
  exists (select 1 from public.timesheet_days d join public.timesheets t on t.id = d.timesheet_id where d.id = day_id and (t.employee_id = auth.uid() or public.is_rh_or_admin() or public.conductor_can_view_sheet(t.id)))
);
create policy sites_write on public.timesheet_sites for all using (
  exists (select 1 from public.timesheet_days d join public.timesheets t on t.id = d.timesheet_id where d.id = day_id and (t.employee_id = auth.uid() or public.is_rh_or_admin()))
) with check (
  exists (select 1 from public.timesheet_days d join public.timesheets t on t.id = d.timesheet_id where d.id = day_id and (t.employee_id = auth.uid() or public.is_rh_or_admin()))
);

create policy versions_read on public.timesheet_versions for select using (
  exists (select 1 from public.timesheets t where t.id = timesheet_id and (t.employee_id = auth.uid() or public.is_rh_or_admin()))
);
create policy versions_write on public.timesheet_versions for insert with check (
  exists (select 1 from public.timesheets t where t.id = timesheet_id and (t.employee_id = auth.uid() or public.is_rh_or_admin()))
);

create policy notifications_own_read on public.notifications for select using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_rh_read on public.audit_log for select using (public.is_rh_or_admin());

create or replace function public.timesheet_snapshot(target_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select to_jsonb(t) || jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(
        to_jsonb(d) || jsonb_build_object(
          'sites', coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from public.timesheet_sites s where s.day_id = d.id), '[]'::jsonb)
        ) order by d.work_date
      )
      from public.timesheet_days d where d.timesheet_id = t.id
    ), '[]'::jsonb)
  )
  from public.timesheets t where t.id = target_id
$$;

create or replace function public.submit_timesheet(target_id uuid)
returns public.timesheets
language plpgsql security definer set search_path = public
as $$
declare result public.timesheets;
begin
  if not public.is_active() then raise exception 'Compte inactif'; end if;
  select * into result from public.timesheets where id = target_id for update;
  if result.id is null or result.employee_id <> auth.uid() then raise exception 'Fiche inaccessible'; end if;

  insert into public.timesheet_versions(timesheet_id, version, snapshot, changed_by, change_reason)
  values (result.id, result.version, public.timesheet_snapshot(result.id), auth.uid(), 'Envoi aux RH')
  on conflict (timesheet_id, version) do nothing;

  update public.timesheets
  set status='pending_review', submitted_at=now(), reviewed_by=null, reviewed_at=null, rejection_reason=null
  where id=result.id returning * into result;

  insert into public.notifications(user_id, kind, title, body, timesheet_id)
  select p.id, 'timesheet_submitted', 'Fiche à valider',
         'Une fiche de la semaine ' || result.iso_week || ' attend une validation.', result.id
  from public.profiles p where p.status='active' and p.role='rh';
  return result;
end;
$$;

create or replace function public.review_timesheet(target_id uuid, decision text, reason text default '')
returns public.timesheets
language plpgsql security definer set search_path = public
as $$
declare result public.timesheets;
begin
  if not public.is_rh() then raise exception 'Validation réservée aux RH'; end if;
  if decision not in ('validated','rejected') then raise exception 'Décision invalide'; end if;
  if decision='rejected' and btrim(coalesce(reason,''))='' then raise exception 'Un motif de refus est obligatoire'; end if;

  update public.timesheets set
    status=decision::public.sheet_status,
    reviewed_by=auth.uid(), reviewed_at=now(),
    rejection_reason=case when decision='rejected' then btrim(reason) else null end
  where id=target_id and status in ('submitted','pending_review','changed_after_validation')
  returning * into result;
  if result.id is null then raise exception 'Fiche introuvable ou non révisable'; end if;

  insert into public.notifications(user_id, kind, title, body, timesheet_id)
  values (result.employee_id, 'timesheet_' || decision,
          case when decision='validated' then 'Fiche validée' else 'Fiche refusée' end,
          case when decision='validated' then 'Votre fiche a été validée.' else 'Motif : ' || btrim(reason) end,
          result.id);
  return result;
end;
$$;

create or replace function public.mark_timesheet_changed()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare target_id uuid;
begin
  if tg_table_name='timesheet_days' then target_id=coalesce(new.timesheet_id,old.timesheet_id);
  else select timesheet_id into target_id from public.timesheet_days where id=coalesce(new.day_id,old.day_id); end if;
  update public.timesheets
  set status='changed_after_validation', version=version+1, reviewed_by=null, reviewed_at=null
  where id=target_id and status in ('submitted','pending_review','validated');
  return coalesce(new,old);
end;
$$;

create trigger days_mark_sheet_changed after insert or update or delete on public.timesheet_days
for each row execute function public.mark_timesheet_changed();
create trigger sites_mark_sheet_changed after insert or update or delete on public.timesheet_sites
for each row execute function public.mark_timesheet_changed();

grant execute on function public.submit_timesheet(uuid) to authenticated;
grant execute on function public.review_timesheet(uuid,text,text) to authenticated;

-- La toute première RH doit être promue manuellement après son inscription :
-- update public.profiles set status='active', role='rh', approved_at=now() where email='adresse@entreprise.fr';
