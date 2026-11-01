-- =====================================================================
-- Cuina Casa · 0006: plantilles de menú
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- (cal haver executat abans 0001 a 0005). Es pot tornar a executar.
-- =====================================================================

-- Una setmana de menú desada per tornar-la a fer servir.
-- entries: [{ "dow": 0-6 (dilluns-diumenge), "meal": "dinar", "recipe_id": …,
--             "title": "Nom de la recepta", "note": null, "servings": null }]
create table if not exists public.menu_templates (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  entries      jsonb not null default '[]'::jsonb check (jsonb_typeof(entries) = 'array'),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists menu_templates_household_idx on public.menu_templates (household_id);

alter table public.menu_templates enable row level security;

-- Tothom les veu i les pot aplicar (si és col·laborador, els plats queden com a proposta);
-- tothom en pot desar; les edita o esborra qui la va crear o un privilegiat.
drop policy if exists "membres veuen les plantilles" on public.menu_templates;
drop policy if exists "membres desen plantilles" on public.menu_templates;
drop policy if exists "autor o privilegiat edita plantilles" on public.menu_templates;
drop policy if exists "autor o privilegiat esborra plantilles" on public.menu_templates;
create policy "membres veuen les plantilles" on public.menu_templates for select using (public.is_member(household_id));
create policy "membres desen plantilles" on public.menu_templates for insert
  with check (public.is_member(household_id) and created_by = auth.uid());
create policy "autor o privilegiat edita plantilles" on public.menu_templates for update
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)))
  with check (public.is_member(household_id));
create policy "autor o privilegiat esborra plantilles" on public.menu_templates for delete
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)));

-- Al registre d'accions, i es poden desfer
drop trigger if exists menu_templates_log on public.menu_templates;
create trigger menu_templates_log after insert or update or delete on public.menu_templates
  for each row execute function public.log_change();

create or replace function public.undo_actions(p_ids bigint[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  e activity_log%rowtype;
  data jsonb;
  done int := 0;
begin
  if auth.uid() is null then raise exception 'Cal iniciar sessió'; end if;
  perform set_config('cuina.undo', 'on', true);

  for e in select * from activity_log where id = any(p_ids) order by id desc loop
    if not public.is_member(e.household_id) then raise exception 'No autoritzat'; end if;
    if e.undone_at is not null then continue; end if;
    if e.table_name not in ('recipes', 'meal_plan', 'shopping_items', 'pantry_items', 'foods', 'menu_templates') then
      raise exception 'Aquesta acció no es pot desfer';
    end if;
    if not public.is_privileged(e.household_id) and e.user_id is distinct from auth.uid() then
      raise exception 'Només pots desfer les teves accions';
    end if;
    if exists (
      select 1 from activity_log l
      where l.table_name = e.table_name and l.row_id = e.row_id and l.id > e.id and l.undone_at is null
    ) then
      raise exception 'Abans cal desfer els canvis posteriors de «%»', coalesce(e.label, 'aquest element');
    end if;

    if e.table_name = 'recipes' then
      if e.action = 'insert' then
        delete from recipes where id = e.row_id;
      elsif e.action = 'update' then
        if exists (select 1 from recipes where id = e.row_id) then
          perform public.restore_columns('recipes', e.old_data->'row', e.row_id);
          perform public.restore_recipe_ingredients(e.row_id, e.old_data->'ingredients');
        end if;
      else
        insert into recipes select (jsonb_populate_record(null::recipes, e.old_data->'row')).* on conflict (id) do nothing;
        perform public.restore_recipe_ingredients(e.row_id, e.old_data->'ingredients');
        update meal_plan set recipe_id = e.row_id
          where id in (select (x #>> '{}')::uuid from jsonb_array_elements(e.old_data->'meal_refs') x) and recipe_id is null;
        update recipe_ingredients set sub_recipe_id = e.row_id
          where id in (select (x #>> '{}')::uuid from jsonb_array_elements(e.old_data->'sub_refs') x) and sub_recipe_id is null;
      end if;
    else
      data := e.old_data;
      -- Un àpat que apuntava a una recepta que ja no hi és queda sense recepta
      if e.table_name = 'meal_plan' and (data->>'recipe_id') is not null
         and not exists (select 1 from recipes where id = (data->>'recipe_id')::uuid) then
        data := data || '{"recipe_id": null}'::jsonb;
      end if;
      if e.action = 'insert' then
        execute format('delete from public.%I where id = $1', e.table_name) using e.row_id;
      elsif e.action = 'update' then
        perform public.restore_columns(e.table_name, data, e.row_id);
      else
        execute format('insert into public.%1$I select (jsonb_populate_record(null::public.%1$I, $1)).* on conflict (id) do nothing',
                       e.table_name) using data;
      end if;
    end if;

    update activity_log set undone_at = now(), undone_by = auth.uid() where id = e.id;
    done := done + 1;
  end loop;

  perform set_config('cuina.undo', '', true);
  return done;
end;
$$;
revoke all on function public.undo_actions(bigint[]) from anon;
