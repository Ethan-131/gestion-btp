-- Type de congé défini pour chaque journée/période sélectionnée.
alter table public.leave_periods
  add column if not exists leave_type text;

update public.leave_periods p
set leave_type = r.leave_type
from public.leave_requests r
where r.id = p.request_id and p.leave_type is null;

alter table public.leave_periods
  drop constraint if exists leave_periods_leave_type_check;
alter table public.leave_periods
  add constraint leave_periods_leave_type_check
  check (leave_type in ('paid_leave','rtt'));
alter table public.leave_periods
  alter column leave_type set not null;

create or replace function public.create_leave_request(
  target_employee uuid,
  requested_type text,
  note text,
  periods jsonb,
  approve_directly boolean default false
)
returns public.leave_requests language plpgsql security definer set search_path=public as $$
declare result public.leave_requests; item jsonb; item_type text;
begin
  if not public.is_active() then raise exception 'Compte inactif'; end if;
  if target_employee <> auth.uid() then raise exception 'Une demande doit être personnelle'; end if;
  if approve_directly then raise exception 'Toute absence doit être validée par une RH'; end if;
  if jsonb_typeof(periods) <> 'array' or jsonb_array_length(periods) = 0 then
    raise exception 'Ajoutez au moins une période';
  end if;
  if exists(
    select 1 from jsonb_array_elements(periods) p
    where coalesce(p->>'leave_type', requested_type) not in ('paid_leave','rtt')
  ) then raise exception 'Type de demande invalide'; end if;

  insert into public.leave_requests(
    employee_id,leave_type,status,employee_comment,created_by,created_by_rh
  ) values(
    auth.uid(),requested_type,'pending',coalesce(note,''),auth.uid(),false
  ) returning * into result;

  for item in select * from jsonb_array_elements(periods) loop
    item_type = coalesce(item->>'leave_type', requested_type);
    insert into public.leave_periods(
      request_id,start_date,end_date,leave_type,duration_type,position
    ) values(
      result.id,
      (item->>'start_date')::date,
      (item->>'end_date')::date,
      item_type,
      item->>'duration_type',
      coalesce((item->>'position')::integer,0)
    );
  end loop;
  return result;
end;
$$;

grant execute on function public.create_leave_request(uuid,text,text,jsonb,boolean) to authenticated;
