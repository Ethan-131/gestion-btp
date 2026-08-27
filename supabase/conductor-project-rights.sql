-- V66.2 — Droits chantier des conducteurs.

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

drop trigger if exists projects_assign_conductor_creator on public.projects;
create trigger projects_assign_conductor_creator
after insert on public.projects
for each row execute function public.assign_conductor_creator();

drop policy if exists projects_conductor_insert on public.projects;
create policy projects_conductor_insert on public.projects for insert with check (
  public.is_conductor() and created_by = auth.uid() and updated_by = auth.uid() and status <> 'archived'
);

drop policy if exists projects_conductor_update on public.projects;
create policy projects_conductor_update on public.projects for update using (
  public.is_conductor() and public.conductor_is_assigned(id)
) with check (
  public.is_conductor() and public.conductor_is_assigned(id) and updated_by = auth.uid() and status <> 'archived'
);
