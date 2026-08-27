-- Toute absence doit commencer par une demande personnelle.
-- Une RH peut traiter les demandes des autres utilisateurs, jamais la sienne.

drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests for insert with check (
  public.is_active()
  and employee_id = auth.uid()
  and created_by = auth.uid()
  and not created_by_rh
  and status = 'pending'
);

drop policy if exists leave_periods_insert on public.leave_periods;
create policy leave_periods_insert on public.leave_periods for insert with check (
  exists(
    select 1 from public.leave_requests r
    where r.id = request_id
      and r.employee_id = auth.uid()
      and r.status = 'pending'
  )
);

create or replace function public.create_leave_request(
  target_employee uuid,
  requested_type text,
  note text,
  periods jsonb,
  approve_directly boolean default false
)
returns public.leave_requests language plpgsql security definer set search_path=public as $$
declare result public.leave_requests; item jsonb;
begin
  if not public.is_active() then raise exception 'Compte inactif'; end if;
  if target_employee <> auth.uid() then raise exception 'Une demande doit être personnelle'; end if;
  if approve_directly then raise exception 'Toute absence doit être validée par une RH'; end if;
  if requested_type not in ('paid_leave','rtt') then raise exception 'Type de demande invalide'; end if;
  if jsonb_typeof(periods) <> 'array' or jsonb_array_length(periods) = 0 then
    raise exception 'Ajoutez au moins une période';
  end if;

  insert into public.leave_requests(
    employee_id,leave_type,status,employee_comment,created_by,created_by_rh
  ) values(
    auth.uid(),requested_type,'pending',coalesce(note,''),auth.uid(),false
  ) returning * into result;

  for item in select * from jsonb_array_elements(periods) loop
    insert into public.leave_periods(request_id,start_date,end_date,duration_type,position)
    values(
      result.id,
      (item->>'start_date')::date,
      (item->>'end_date')::date,
      item->>'duration_type',
      coalesce((item->>'position')::integer,0)
    );
  end loop;
  return result;
end;
$$;

create or replace function public.review_leave_request(
  target_id uuid,
  decision text,
  reason text default ''
)
returns public.leave_requests language plpgsql security definer set search_path=public as $$
declare result public.leave_requests; target_employee uuid;
begin
  if not public.is_rh() then raise exception 'Validation réservée aux RH'; end if;
  select employee_id into target_employee from public.leave_requests where id=target_id;
  if target_employee is null then raise exception 'Demande introuvable'; end if;
  if target_employee = auth.uid() then raise exception 'Une RH ne peut pas valider sa propre demande'; end if;
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
  update public.leave_requests set
    status=decision,
    rejection_reason=case when decision='rejected' then btrim(reason) else null end,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where id=target_id and status in ('pending','cancellation_requested') returning * into result;
  if result.id is null then raise exception 'Demande introuvable ou non révisable'; end if;
  insert into public.notifications(user_id,kind,title,body)
  values(
    result.employee_id,
    'leave_'||decision,
    case when decision='approved' then 'Absence acceptée' when decision='cancelled' then 'Absence annulée' else 'Absence refusée' end,
    case when decision='rejected' then 'Motif : '||btrim(reason) else 'Votre demande a été mise à jour.' end
  );
  return result;
end;
$$;

grant execute on function public.create_leave_request(uuid,text,text,jsonb,boolean) to authenticated;
grant execute on function public.review_leave_request(uuid,text,text) to authenticated;
