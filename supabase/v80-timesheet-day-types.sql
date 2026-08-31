-- V80 — Type de journée sur les fiches : travaillé, congé payé, RTT ou férié.
begin;

alter table public.timesheet_days
  add column if not exists day_type text not null default 'worked';

alter table public.timesheet_days
  drop constraint if exists timesheet_days_day_type_check;
alter table public.timesheet_days
  add constraint timesheet_days_day_type_check
  check (day_type in ('worked','cp','rtt','holiday'));

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
  selected_day_type text;
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
    observations=excluded.observations,status='draft',submitted_at=now(),
    reviewed_by=null,reviewed_at=null,rejection_reason=null,
    version=case when timesheets.status='validated' then timesheets.version+1 else timesheets.version end
  returning * into result;

  delete from public.timesheet_days where timesheet_id=result.id;
  for day_item in select * from jsonb_array_elements(coalesce(payload->'days','[]'::jsonb)) loop
    selected_day_type := coalesce(nullif(day_item->>'day_type',''),'worked');
    if selected_day_type not in ('worked','cp','rtt','holiday') then
      raise exception 'Type de journée invalide';
    end if;
    insert into public.timesheet_days(
      timesheet_id,work_date,day_type,meal,travel_km,it_zone_id,it_zone_label_snapshot,
      it_needs_review,establishment_id_snapshot,tasks,manual_task,vehicle,delivery_note
    ) values (
      result.id,(day_item->>'work_date')::date,selected_day_type,
      case when selected_day_type='worked' then coalesce((day_item->>'meal')::numeric,0) else 0 end,
      case when selected_day_type='worked' then coalesce((day_item->>'travel_km')::numeric,0) else 0 end,
      case when selected_day_type='worked' then nullif(day_item->>'it_zone_id','')::uuid else null end,
      case when selected_day_type='worked' then nullif(day_item->>'it_zone_label_snapshot','') else null end,
      case when selected_day_type='worked' then coalesce((day_item->>'it_needs_review')::boolean,false) else false end,
      nullif(day_item->>'establishment_id_snapshot','')::uuid,
      case when selected_day_type='worked' then coalesce(day_item->'tasks','[]'::jsonb) else '[]'::jsonb end,
      case when selected_day_type='worked' then coalesce(day_item->>'manual_task','') else '' end,
      case when selected_day_type='worked' then coalesce(day_item->>'vehicle','') else '' end,
      case when selected_day_type='worked' then coalesce(day_item->>'delivery_note','') else '' end
    ) returning id into day_id;

    if selected_day_type='worked' then
      for site_item in select * from jsonb_array_elements(coalesce(day_item->'sites','[]'::jsonb)) loop
        if btrim(coalesce(site_item->>'code',''))='' or btrim(coalesce(site_item->>'name',''))='' then
          raise exception 'Le code chantier et le nom du chantier sont obligatoires';
        end if;
        project_match := null;
        select p.id into project_match from public.projects p
        where p.status<>'archived'
          and lower(regexp_replace(p.code,'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(site_item->>'code','[^a-zA-Z0-9]','','g'))
          and lower(btrim(p.name))=lower(btrim(site_item->>'name'))
        limit 1;
        insert into public.timesheet_sites(day_id,project_id,project_code_snapshot,project_name_snapshot,hours,position)
        values(day_id,project_match,site_item->>'code',site_item->>'name',
          coalesce((site_item->>'hours')::numeric,0),coalesce((site_item->>'position')::integer,0));
      end loop;
    end if;
  end loop;

  update public.timesheets set
    status=case when previous_status='validated' then 'changed_after_validation'::public.sheet_status else next_status end,
    submitted_at=now()
  where id=result.id returning * into result;

  insert into public.timesheet_versions(timesheet_id,version,snapshot,changed_by,change_reason)
  values(result.id,result.version,public.timesheet_snapshot(result.id),auth.uid(),'Enregistrement et partage automatique')
  on conflict(timesheet_id,version) do update set snapshot=excluded.snapshot,created_at=now();

  insert into public.notifications(user_id,kind,title,body,timesheet_id)
  select p.id,'timesheet_submitted','Fiche transmise',
    'Une fiche de la semaine '||result.iso_week||' a été transmise.',result.id
  from public.profiles p where p.status='active' and p.role='rh' and p.id<>auth.uid();
  return result;
end;
$$;

grant execute on function public.save_and_submit_timesheet(jsonb) to authenticated;

commit;
