-- V86 — retrait sécurisé de l'accès à un compte, sans supprimer ses données.
create or replace function public.disable_account_access(target_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare result public.profiles;
begin
  if not public.is_rh_or_admin() then
    raise exception 'Action réservée aux RH ou à la Direction';
  end if;
  if target_id = auth.uid() then
    raise exception 'Vous ne pouvez pas supprimer votre propre accès';
  end if;

  update public.profiles
  set status='disabled', updated_at=now()
  where id=target_id and status='active'
  returning * into result;

  if result.id is null then
    raise exception 'Compte actif introuvable';
  end if;

  insert into public.audit_log(actor_id,action,entity_type,entity_id,after_data)
  values(auth.uid(),'account_access_disabled','profile',target_id,jsonb_build_object('status','disabled'));
  return result;
end;
$$;

revoke all on function public.disable_account_access(uuid) from public;
grant execute on function public.disable_account_access(uuid) to authenticated;
