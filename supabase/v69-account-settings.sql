-- V69 — modification sécurisée des informations personnelles.
create or replace function public.update_own_profile(new_first_name text,new_last_name text)
returns public.profiles
language plpgsql
security definer
set search_path=public
as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if length(btrim(coalesce(new_first_name,''))) not between 1 and 80 then raise exception 'Prénom invalide'; end if;
  if length(btrim(coalesce(new_last_name,''))) not between 1 and 80 then raise exception 'Nom invalide'; end if;
  update public.profiles
  set first_name=btrim(new_first_name),last_name=btrim(new_last_name)
  where id=auth.uid()
  returning * into result;
  if result.id is null then raise exception 'Profil introuvable'; end if;
  return result;
end;
$$;
revoke all on function public.update_own_profile(text,text) from public;
grant execute on function public.update_own_profile(text,text) to authenticated;
