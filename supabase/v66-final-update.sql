-- MISE À JOUR FINALE V66.4 — À EXÉCUTER UNE SEULE FOIS DANS SUPABASE

-- V66.3 — Sièges et zones IT, sans donnée financière.

create table if not exists public.establishments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.establishments (name) values
  ('Antras Menuiserie'),
  ('Antras Ossature Bois')
on conflict (name) do nothing;

alter table public.profiles
  add column if not exists establishment_id uuid references public.establishments(id);

create table if not exists public.it_zones (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_it_zones (
  project_id uuid not null references public.projects(id) on delete cascade,
  establishment_id uuid not null references public.establishments(id),
  it_zone_id uuid not null references public.it_zones(id),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (project_id, establishment_id)
);

alter table public.timesheet_days
  add column if not exists it_zone_id uuid references public.it_zones(id),
  add column if not exists it_zone_label_snapshot text,
  add column if not exists it_needs_review boolean not null default false,
  add column if not exists establishment_id_snapshot uuid references public.establishments(id);

alter table public.establishments enable row level security;
alter table public.it_zones enable row level security;
alter table public.project_it_zones enable row level security;

drop policy if exists establishments_active_read on public.establishments;
create policy establishments_active_read on public.establishments for select using (public.is_active());
drop policy if exists establishments_manage on public.establishments;
create policy establishments_manage on public.establishments for all using (public.is_rh_or_admin()) with check (public.is_rh_or_admin());

drop policy if exists it_zones_active_read on public.it_zones;
create policy it_zones_active_read on public.it_zones for select using (public.is_active());
drop policy if exists it_zones_manage on public.it_zones;
create policy it_zones_manage on public.it_zones for all using (public.is_rh_or_admin()) with check (public.is_rh_or_admin());

drop policy if exists project_it_zones_read on public.project_it_zones;
create policy project_it_zones_read on public.project_it_zones for select using (public.is_active());
drop policy if exists project_it_zones_manage_staff on public.project_it_zones;
create policy project_it_zones_manage_staff on public.project_it_zones for all
using (public.is_rh_or_admin() or (public.is_conductor() and public.conductor_is_assigned(project_id)))
with check (public.is_rh_or_admin() or (public.is_conductor() and public.conductor_is_assigned(project_id)));

create or replace function public.prevent_unresolved_it_validation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'validated' and exists (
    select 1 from public.timesheet_days
    where timesheet_id = new.id and it_needs_review
  ) then
    raise exception 'Choisissez la zone IT des journées multi-chantiers avant de valider.';
  end if;
  return new;
end;
$$;

drop trigger if exists timesheets_require_resolved_it on public.timesheets;
create trigger timesheets_require_resolved_it
before update of status on public.timesheets
for each row execute function public.prevent_unresolved_it_validation();

-- V66.4 — Demandes de congés payés et RTT.

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  leave_type text not null check (leave_type in ('paid_leave','rtt')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','cancellation_requested')),
  employee_comment text not null default '',
  rejection_reason text,
  created_by uuid not null references public.profiles(id),
  created_by_rh boolean not null default false,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leave_periods (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.leave_requests(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  duration_type text not null default 'full' check (duration_type in ('full','morning','afternoon')),
  requested_days numeric(6,2) not null default 0,
  position integer not null default 0,
  check (end_date >= start_date),
  check (duration_type = 'full' or start_date = end_date)
);

create index if not exists leave_requests_employee_idx on public.leave_requests(employee_id, created_at desc);
create index if not exists leave_periods_request_idx on public.leave_periods(request_id, position);

create or replace function public.fr_easter_sunday(target_year integer)
returns date language plpgsql immutable as $$
declare a integer; b integer; c integer; d integer; e integer; f integer; g integer; h integer; i integer; k integer; l integer; m integer; month_no integer; day_no integer;
begin
  a=target_year%19; b=target_year/100; c=target_year%100; d=b/4; e=b%4;
  f=(b+8)/25; g=(b-f+1)/3; h=(19*a+b-d-g+15)%30; i=c/4; k=c%4;
  l=(32+2*e+2*i-h-k)%7; m=(a+11*h+22*l)/451;
  month_no=(h+l-7*m+114)/31; day_no=((h+l-7*m+114)%31)+1;
  return make_date(target_year,month_no,day_no);
end;
$$;

create or replace function public.fr_public_holiday_name(target_date date)
returns text language plpgsql immutable as $$
declare y integer=extract(year from target_date); easter date;
begin
  easter=public.fr_easter_sunday(y);
  if target_date=make_date(y,1,1) then return 'Jour de l''An'; end if;
  if target_date=easter+1 then return 'Lundi de Pâques'; end if;
  if target_date=make_date(y,5,1) then return 'Fête du Travail'; end if;
  if target_date=make_date(y,5,8) then return 'Victoire 1945'; end if;
  if target_date=easter+39 then return 'Ascension'; end if;
  if target_date=easter+50 then return 'Lundi de Pentecôte'; end if;
  if target_date=make_date(y,7,14) then return 'Fête nationale'; end if;
  if target_date=make_date(y,8,15) then return 'Assomption'; end if;
  if target_date=make_date(y,11,1) then return 'Toussaint'; end if;
  if target_date=make_date(y,11,11) then return 'Armistice 1918'; end if;
  if target_date=make_date(y,12,25) then return 'Noël'; end if;
  return null;
end;
$$;

create or replace function public.leave_business_days(start_on date,end_on date)
returns numeric language sql immutable as $$
  select count(*)::numeric from generate_series(start_on,end_on,'1 day'::interval) d
  where extract(isodow from d)<6 and public.fr_public_holiday_name(d::date) is null
$$;

create or replace function public.prepare_leave_period()
returns trigger language plpgsql as $$
begin
  if extract(isodow from new.start_date)>=6 or public.fr_public_holiday_name(new.start_date) is not null then
    raise exception 'La date de début doit être un jour ouvré';
  end if;
  if extract(isodow from new.end_date)>=6 or public.fr_public_holiday_name(new.end_date) is not null then
    raise exception 'La date de fin doit être un jour ouvré';
  end if;
  if new.duration_type<>'full' and new.start_date<>new.end_date then
    raise exception 'Une demi-journée doit concerner une seule date';
  end if;
  if exists(select 1 from public.leave_periods p where p.request_id=new.request_id and p.id<>new.id
    and daterange(p.start_date,p.end_date,'[]') && daterange(new.start_date,new.end_date,'[]')) then
    raise exception 'Deux périodes de la demande se chevauchent';
  end if;
  new.requested_days=case when new.duration_type='full' then public.leave_business_days(new.start_date,new.end_date) else 0.5 end;
  if new.requested_days<=0 then raise exception 'La période ne contient aucun jour ouvré'; end if;
  return new;
end;
$$;

drop trigger if exists leave_periods_prepare on public.leave_periods;
create trigger leave_periods_prepare before insert or update on public.leave_periods
for each row execute function public.prepare_leave_period();

alter table public.leave_requests enable row level security;
alter table public.leave_periods enable row level security;

drop policy if exists leave_requests_read on public.leave_requests;
create policy leave_requests_read on public.leave_requests for select using (
  employee_id=auth.uid() or public.is_rh_or_admin() or
  (public.is_conductor() and status='approved' and public.conductor_can_view_employee(employee_id))
);
drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests for insert with check (
  public.is_active() and ((employee_id=auth.uid() and created_by=auth.uid() and not created_by_rh and status='pending') or public.is_rh())
);
drop policy if exists leave_requests_employee_update on public.leave_requests;
create policy leave_requests_employee_update on public.leave_requests for update using (
  employee_id=auth.uid() and status in ('pending','approved')
) with check (employee_id=auth.uid() and status in ('cancelled','cancellation_requested'));
drop policy if exists leave_requests_rh_update on public.leave_requests;
create policy leave_requests_rh_update on public.leave_requests for update using (public.is_rh()) with check (public.is_rh());

drop policy if exists leave_periods_read on public.leave_periods;
create policy leave_periods_read on public.leave_periods for select using (
  exists(select 1 from public.leave_requests r where r.id=request_id and
    (r.employee_id=auth.uid() or public.is_rh_or_admin() or
     (public.is_conductor() and r.status='approved' and public.conductor_can_view_employee(r.employee_id))))
);
drop policy if exists leave_periods_insert on public.leave_periods;
create policy leave_periods_insert on public.leave_periods for insert with check (
  exists(select 1 from public.leave_requests r where r.id=request_id and
    ((r.employee_id=auth.uid() and r.status='pending') or public.is_rh()))
);
drop policy if exists leave_periods_rh_manage on public.leave_periods;
create policy leave_periods_rh_manage on public.leave_periods for all using (public.is_rh()) with check (public.is_rh());

create or replace function public.protect_leave_request_fields()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.is_rh() and (
    new.employee_id is distinct from old.employee_id or new.leave_type is distinct from old.leave_type or
    new.created_by is distinct from old.created_by or new.created_by_rh is distinct from old.created_by_rh or
    new.status not in ('cancelled','cancellation_requested')
  ) then raise exception 'Modification non autorisée'; end if;
  return new;
end;
$$;
drop trigger if exists leave_requests_protect_fields on public.leave_requests;
create trigger leave_requests_protect_fields before update on public.leave_requests
for each row execute function public.protect_leave_request_fields();

create or replace function public.notify_leave_request()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and new.status='pending' and not new.created_by_rh then
    insert into public.notifications(user_id,kind,title,body)
    select id,'leave_submitted','Nouvelle demande d''absence','Une demande de congé ou RTT attend une validation.'
    from public.profiles where status='active' and role='rh';
  elsif tg_op='UPDATE' and new.status='cancellation_requested' and old.status='approved' then
    insert into public.notifications(user_id,kind,title,body)
    select id,'leave_cancellation','Annulation demandée','Une demande d''annulation d''absence attend une décision.'
    from public.profiles where status='active' and role='rh';
  end if;
  return new;
end;
$$;
drop trigger if exists leave_requests_notify_insert on public.leave_requests;
create trigger leave_requests_notify_insert after insert on public.leave_requests
for each row execute function public.notify_leave_request();
drop trigger if exists leave_requests_notify_update on public.leave_requests;
create trigger leave_requests_notify_update after update of status on public.leave_requests
for each row execute function public.notify_leave_request();

create or replace function public.create_leave_request(target_employee uuid, requested_type text, note text, periods jsonb, approve_directly boolean default false)
returns public.leave_requests language plpgsql security definer set search_path=public as $$
declare result public.leave_requests; item jsonb; direct boolean;
begin
  if not public.is_active() then raise exception 'Compte inactif'; end if;
  direct=approve_directly and public.is_rh();
  if not direct and target_employee<>auth.uid() then raise exception 'Demande inaccessible'; end if;
  if requested_type not in ('paid_leave','rtt') then raise exception 'Type de demande invalide'; end if;
  if jsonb_typeof(periods)<>'array' or jsonb_array_length(periods)=0 then raise exception 'Ajoutez au moins une période'; end if;
  insert into public.leave_requests(employee_id,leave_type,status,employee_comment,created_by,created_by_rh,reviewed_by,reviewed_at)
  values(target_employee,requested_type,case when direct then 'approved' else 'pending' end,coalesce(note,''),auth.uid(),direct,case when direct then auth.uid() end,case when direct then now() end)
  returning * into result;
  for item in select * from jsonb_array_elements(periods) loop
    insert into public.leave_periods(request_id,start_date,end_date,duration_type,position)
    values(result.id,(item->>'start_date')::date,(item->>'end_date')::date,item->>'duration_type',coalesce((item->>'position')::integer,0));
  end loop;
  if direct and exists(
    select 1 from public.leave_periods incoming
    join public.leave_requests other on other.employee_id=target_employee and other.status='approved' and other.id<>result.id
    join public.leave_periods existing on existing.request_id=other.id
    where incoming.request_id=result.id and daterange(incoming.start_date,incoming.end_date,'[]') && daterange(existing.start_date,existing.end_date,'[]')
  ) then raise exception 'Cette absence chevauche une absence déjà acceptée'; end if;
  if direct then
    insert into public.notifications(user_id,kind,title,body)
    values(target_employee,'leave_approved','Absence enregistrée','Une absence a été enregistrée par les RH.');
  end if;
  return result;
end;
$$;

create or replace function public.review_leave_request(target_id uuid, decision text, reason text default '')
returns public.leave_requests language plpgsql security definer set search_path=public as $$
declare result public.leave_requests;
begin
  if not public.is_rh() then raise exception 'Validation réservée aux RH'; end if;
  if decision not in ('approved','rejected','cancelled') then raise exception 'Décision invalide'; end if;
  if decision='rejected' and btrim(coalesce(reason,''))='' then raise exception 'Un motif de refus est obligatoire'; end if;
  if not exists(select 1 from public.leave_periods where request_id=target_id) then raise exception 'Aucune période renseignée'; end if;
  if decision='approved' and exists(
    select 1 from public.leave_requests target
    join public.leave_periods incoming on incoming.request_id=target.id
    join public.leave_requests other on other.employee_id=target.employee_id and other.status='approved' and other.id<>target.id
    join public.leave_periods existing on existing.request_id=other.id
    where target.id=target_id and daterange(incoming.start_date,incoming.end_date,'[]') && daterange(existing.start_date,existing.end_date,'[]')
  ) then raise exception 'Cette absence chevauche une absence déjà acceptée'; end if;
  update public.leave_requests set status=decision, rejection_reason=case when decision='rejected' then btrim(reason) else null end,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where id=target_id and status in ('pending','cancellation_requested') returning * into result;
  if result.id is null then raise exception 'Demande introuvable ou non révisable'; end if;
  insert into public.notifications(user_id,kind,title,body)
  values(result.employee_id,'leave_'||decision,
    case when decision='approved' then 'Absence acceptée' when decision='cancelled' then 'Absence annulée' else 'Absence refusée' end,
    case when decision='rejected' then 'Motif : '||btrim(reason) else 'Votre demande a été mise à jour.' end);
  return result;
end;
$$;

grant execute on function public.review_leave_request(uuid,text,text) to authenticated;
grant execute on function public.create_leave_request(uuid,text,text,jsonb,boolean) to authenticated;
