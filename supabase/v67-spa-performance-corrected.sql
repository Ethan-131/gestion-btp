-- V67 — Refonte SPA, performances et envoi fiable.
-- Migration additive/idempotente : aucune table ni donnée existante n'est supprimée.

create index if not exists timesheets_week_status_idx
  on public.timesheets (iso_year desc, iso_week desc, status, employee_id);
create index if not exists timesheets_updated_idx
  on public.timesheets (updated_at desc);
create index if not exists leave_requests_approved_employee_idx
  on public.leave_requests (employee_id, status, created_at desc);
create index if not exists leave_periods_dates_idx
  on public.leave_periods (start_date, end_date, request_id);
create index if not exists profiles_active_name_idx
  on public.profiles (status, lower(last_name), lower(first_name));

create or replace function public.french_holiday_name(day date)
returns text language plpgsql immutable as $$
declare y int:=extract(year from day); a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; easter date;
begin
  if to_char(day,'MM-DD')='01-01' then return 'Jour de l''An'; end if;
  if to_char(day,'MM-DD')='05-01' then return 'Fête du Travail'; end if;
  if to_char(day,'MM-DD')='05-08' then return 'Victoire 1945'; end if;
  if to_char(day,'MM-DD')='07-14' then return 'Fête nationale'; end if;
  if to_char(day,'MM-DD')='08-15' then return 'Assomption'; end if;
  if to_char(day,'MM-DD')='11-01' then return 'Toussaint'; end if;
  if to_char(day,'MM-DD')='11-11' then return 'Armistice'; end if;
  if to_char(day,'MM-DD')='12-25' then return 'Noël'; end if;
  a:=y%19;b:=y/100;c:=y%100;d:=b/4;e:=b%4;f:=(b+8)/25;g:=(b-f+1)/3;h:=(19*a+b-d-g+15)%30;i:=c/4;k:=c%4;l:=(32+2*e+2*i-h-k)%7;m:=(a+11*h+22*l)/451;
  easter:=make_date(y,(h+l-7*m+114)/31,(h+l-7*m+114)%31+1);
  if day=easter+1 then return 'Lundi de Pâques'; end if;
  if day=easter+39 then return 'Ascension'; end if;
  if day=easter+50 then return 'Lundi de Pentecôte'; end if;
  return null;
end;$$;

-- Résumé léger : aucune journée ni aucun chantier n'est chargé ici.
create or replace function public.week_timesheet_roster(target_year integer, target_week integer)
returns table (
  employee_id uuid, first_name text, last_name text, email text,
  timesheet_id uuid, sheet_status public.sheet_status, rejection_reason text,
  submitted_at timestamptz, reviewed_at timestamptz,
  absent_full_week boolean, expected boolean
)
language sql stable security definer set search_path=public as $$
  with bounds as (
    select to_date(target_year::text || target_week::text, 'IYYYIW')::date as week_start
  ), active_people as (
    select p.id, p.first_name, p.last_name, p.email
    from public.profiles p
    where p.status='active' and p.role is not null
  ), working_days as (
    select d::date as work_day
    from bounds b, generate_series(b.week_start, b.week_start + 4, interval '1 day') d
    where public.french_holiday_name(d::date) is null
  ), approved_days as (
    select r.employee_id, wd.work_day,
      max(case when lp.duration_type='full' then 1 else 0 end) as full_day
    from public.leave_requests r
    join public.leave_periods lp on lp.request_id=r.id
    join working_days wd on wd.work_day between lp.start_date and lp.end_date
    where r.status='approved'
    group by r.employee_id, wd.work_day
  ), absences as (
    select p.id employee_id,
      bool_and(coalesce(a.full_day,0)=1) as absent_full_week
    from active_people p cross join working_days wd
    left join approved_days a on a.employee_id=p.id and a.work_day=wd.work_day
    group by p.id
  )
  select p.id, p.first_name, p.last_name, p.email,
    t.id, t.status, t.rejection_reason, t.submitted_at, t.reviewed_at,
    a.absent_full_week, not a.absent_full_week
  from active_people p
  join absences a on a.employee_id=p.id
  left join public.timesheets t on t.employee_id=p.id
    and t.iso_year=target_year and t.iso_week=target_week
  where public.is_rh_or_admin() or p.id=auth.uid()
  order by lower(p.last_name), lower(p.first_name);
$$;

grant execute on function public.week_timesheet_roster(integer,integer) to authenticated;

-- Enregistrement complet et partage dans une transaction unique. La contrainte
-- (employee_id, iso_year, iso_week) rend les nouvelles tentatives idempotentes.
create or replace function public.save_and_submit_timesheet(payload jsonb)
returns public.timesheets
language plpgsql security definer set search_path=public as $$
declare
  result public.timesheets;
  day_item jsonb;
  site_item jsonb;
  day_id uuid;
  project_match uuid;
  next_status public.sheet_status := 'pending_review';
  previous_status public.sheet_status;
begin
  if not public.is_active() then raise exception 'Compte inactif'; end if;
  if coalesce((payload->>'iso_year')::integer,0) not between 2020 and 2040 then raise exception 'Année invalide'; end if;
  if coalesce((payload->>'iso_week')::integer,0) not between 1 and 53 then raise exception 'Semaine invalide'; end if;

  select status into previous_status from public.timesheets
  where employee_id=auth.uid() and iso_year=(payload->>'iso_year')::integer and iso_week=(payload->>'iso_week')::integer;

  insert into public.timesheets(employee_id,iso_year,iso_week,observations,status,submitted_at)
  values(auth.uid(),(payload->>'iso_year')::integer,(payload->>'iso_week')::integer,
    coalesce(payload->>'observations',''),'draft',now())
  on conflict(employee_id,iso_year,iso_week) do update set
    observations=excluded.observations,
    status='draft',
    submitted_at=now(), reviewed_by=null, reviewed_at=null, rejection_reason=null,
    version=case when timesheets.status='validated' then timesheets.version+1 else timesheets.version end
  returning * into result;

  delete from public.timesheet_days where timesheet_id=result.id;
  for day_item in select * from jsonb_array_elements(coalesce(payload->'days','[]'::jsonb)) loop
    insert into public.timesheet_days(
      timesheet_id,work_date,meal,travel_km,it_zone_id,it_zone_label_snapshot,
      it_needs_review,establishment_id_snapshot,tasks,manual_task,vehicle,delivery_note
    ) values (
      result.id,(day_item->>'work_date')::date,coalesce((day_item->>'meal')::numeric,0),
      coalesce((day_item->>'travel_km')::numeric,0),nullif(day_item->>'it_zone_id','')::uuid,
      nullif(day_item->>'it_zone_label_snapshot',''),coalesce((day_item->>'it_needs_review')::boolean,false),
      nullif(day_item->>'establishment_id_snapshot','')::uuid,coalesce(day_item->'tasks','[]'::jsonb),
      coalesce(day_item->>'manual_task',''),coalesce(day_item->>'vehicle',''),coalesce(day_item->>'delivery_note','')
    ) returning id into day_id;

    for site_item in select * from jsonb_array_elements(coalesce(day_item->'sites','[]'::jsonb)) loop
      project_match := null;
      select p.id into project_match from public.projects p
      where p.status<>'archived' and (
        lower(regexp_replace(p.code,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(coalesce(site_item->>'code',''),'[^a-zA-Z0-9]','','g'))
        or lower(btrim(p.name))=lower(btrim(coalesce(site_item->>'name','')))
      ) order by case when lower(regexp_replace(p.code,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(coalesce(site_item->>'code',''),'[^a-zA-Z0-9]','','g')) then 0 else 1 end limit 1;
      insert into public.timesheet_sites(day_id,project_id,project_code_snapshot,project_name_snapshot,hours,position)
      values(day_id,project_match,coalesce(site_item->>'code',''),coalesce(site_item->>'name',''),
        coalesce((site_item->>'hours')::numeric,0),coalesce((site_item->>'position')::integer,0));
    end loop;
  end loop;

  update public.timesheets set
    status=case when previous_status='validated' then 'changed_after_validation'::public.sheet_status else next_status end,
    submitted_at=now()
  where id=result.id returning * into result;

  insert into public.timesheet_versions(timesheet_id,version,snapshot,changed_by,change_reason)
  values(result.id,result.version,public.timesheet_snapshot(result.id),auth.uid(),'Enregistrement et partage automatique')
  on conflict(timesheet_id,version) do update set snapshot=excluded.snapshot,created_at=now();

  insert into public.notifications(user_id,kind,title,body,timesheet_id)
  select p.id,'timesheet_submitted','Fiche à valider',
    'Une fiche de la semaine '||result.iso_week||' attend une validation.',result.id
  from public.profiles p where p.status='active' and p.role='rh' and p.id<>auth.uid();
  return result;
end;
$$;

grant execute on function public.save_and_submit_timesheet(jsonb) to authenticated;

-- RH/Direction peut valider sa propre demande ou sa propre fiche. Un autre rôle
-- ne le peut jamais : le contrôle repose sur le profil serveur lié à auth.uid().
create or replace function public.review_leave_request(target_id uuid, decision text, reason text default '')
returns public.leave_requests language plpgsql security definer set search_path=public as $$
declare result public.leave_requests; target_employee uuid; actor_role public.app_role;
begin
  select role into actor_role from public.profiles where id=auth.uid() and status='active';
  if actor_role <> 'rh' then raise exception 'Validation réservée aux RH / Direction'; end if;
  select employee_id into target_employee from public.leave_requests where id=target_id;
  if target_employee is null then raise exception 'Demande introuvable'; end if;
  if decision not in ('approved','rejected','cancelled') then raise exception 'Décision invalide'; end if;
  if decision='rejected' and btrim(coalesce(reason,''))='' then raise exception 'Un motif de refus est obligatoire'; end if;
  if decision='approved' and exists(
    select 1 from public.leave_requests target
    join public.leave_periods incoming on incoming.request_id=target.id
    join public.leave_requests other on other.employee_id=target.employee_id and other.status='approved' and other.id<>target.id
    join public.leave_periods existing on existing.request_id=other.id
    where target.id=target_id and daterange(incoming.start_date,incoming.end_date,'[]') && daterange(existing.start_date,existing.end_date,'[]')
  ) then raise exception 'Cette absence chevauche une absence déjà acceptée'; end if;
  update public.leave_requests set status=decision,
    rejection_reason=case when decision='rejected' then btrim(reason) else null end,
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

create or replace function public.review_timesheet(target_id uuid, decision text, reason text default '')
returns public.timesheets language plpgsql security definer set search_path=public as $$
declare result public.timesheets; actor_role public.app_role;
begin
  select role into actor_role from public.profiles where id=auth.uid() and status='active';
  if actor_role <> 'rh' then raise exception 'Validation réservée aux RH / Direction'; end if;
  if decision not in ('validated','rejected') then raise exception 'Décision invalide'; end if;
  if decision='rejected' and btrim(coalesce(reason,''))='' then raise exception 'Un motif de refus est obligatoire'; end if;
  update public.timesheets set status=decision::public.sheet_status,reviewed_by=auth.uid(),reviewed_at=now(),
    rejection_reason=case when decision='rejected' then btrim(reason) else null end
  where id=target_id and status in ('submitted','pending_review','changed_after_validation') returning * into result;
  if result.id is null then raise exception 'Fiche introuvable ou non révisable'; end if;
  insert into public.notifications(user_id,kind,title,body,timesheet_id)
  values(result.employee_id,'timesheet_'||decision,
    case when decision='validated' then 'Fiche validée' else 'Fiche refusée' end,
    case when decision='validated' then 'Votre fiche a été validée.' else 'Motif : '||btrim(reason) end,result.id);
  return result;
end;
$$;

grant execute on function public.review_leave_request(uuid,text,text) to authenticated;
grant execute on function public.review_timesheet(uuid,text,text) to authenticated;
