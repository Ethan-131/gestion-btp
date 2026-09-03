-- V110 — Correctif validation des annulations de congés / RTT
-- À exécuter dans Supabase > SQL Editor.
--
-- Corrige la fonction appelée par l'application lorsqu'une RH, un Patron ou
-- un Administrateur technique choisit :
--   • Accepter une demande d'absence
--   • Refuser une demande d'absence
--   • Conserver une absence dont l'annulation a été demandée
--   • Accepter l'annulation d'une absence
--
-- Le rôle Conducteur et le rôle Salarié n'ont pas le droit d'utiliser cette
-- fonction pour prendre une décision RH.

create or replace function public.review_leave_request(
  target_id uuid,
  decision text,
  reason text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  current_status text;
begin
  select p.role
    into caller_role
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'active';

  if caller_role is null or caller_role not in ('admin', 'patron', 'rh') then
    raise exception 'Vous n''êtes pas autorisé à prendre cette décision.';
  end if;

  select lr.status
    into current_status
  from public.leave_requests lr
  where lr.id = target_id
  for update;

  if current_status is null then
    raise exception 'Cette demande est introuvable.';
  end if;

  if decision = 'approved' then
    -- Une demande en attente peut être acceptée.
    -- Une annulation demandée peut être refusée en conservant l'absence.
    if current_status not in ('pending', 'cancellation_requested') then
      raise exception 'Cette demande ne peut plus être acceptée dans son état actuel.';
    end if;

    update public.leave_requests
    set status = 'approved',
        rejection_reason = null,
        updated_at = now()
    where id = target_id;

  elsif decision = 'rejected' then
    if current_status <> 'pending' then
      raise exception 'Seule une demande en attente peut être refusée.';
    end if;

    if nullif(btrim(reason), '') is null then
      raise exception 'Un motif de refus est obligatoire.';
    end if;

    update public.leave_requests
    set status = 'rejected',
        rejection_reason = btrim(reason),
        updated_at = now()
    where id = target_id;

  elsif decision = 'cancelled' then
    -- C'est le cas qui manquait : la RH accepte la demande d'annulation
    -- d'une absence précédemment approuvée.
    if current_status <> 'cancellation_requested' then
      raise exception 'Cette absence n''est pas en attente d''annulation.';
    end if;

    update public.leave_requests
    set status = 'cancelled',
        rejection_reason = null,
        updated_at = now()
    where id = target_id;

  else
    raise exception 'Décision inconnue.';
  end if;
end;
$$;

grant execute on function public.review_leave_request(uuid, text, text) to authenticated;

-- Vérification informative : la fonction doit apparaître dans le résultat.
select
  p.proname as fonction,
  pg_get_function_identity_arguments(p.oid) as parametres
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'review_leave_request';
