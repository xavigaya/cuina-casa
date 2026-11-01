-- =====================================================================
-- Cuina Casa · 0007: supermercats i preus
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- (cal haver executat abans 0001 a 0006). Es pot tornar a executar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Supermercats: cadascun amb el seu ordre de seccions
-- ---------------------------------------------------------------------
create table if not exists public.stores (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  section_order text[] not null default '{}',
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists stores_household_idx on public.stores (household_id);
alter table public.stores enable row level security;

drop policy if exists "membres veuen els súpers" on public.stores;
drop policy if exists "membres afegeixen súpers" on public.stores;
drop policy if exists "autor o privilegiat edita súpers" on public.stores;
drop policy if exists "autor o privilegiat esborra súpers" on public.stores;
create policy "membres veuen els súpers" on public.stores for select using (public.is_member(household_id));
create policy "membres afegeixen súpers" on public.stores for insert
  with check (public.is_member(household_id) and created_by = auth.uid());
create policy "autor o privilegiat edita súpers" on public.stores for update
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)))
  with check (public.is_member(household_id));
create policy "autor o privilegiat esborra súpers" on public.stores for delete
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)));

-- ---------------------------------------------------------------------
-- Preus aproximats dels productes (un per producte i llar)
--   price: euros que costa `quantity` `unit` (p. ex. 1,20 € per 1 l)
-- ---------------------------------------------------------------------
create table if not exists public.product_prices (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  key          text not null,
  price        numeric not null check (price >= 0 and price < 10000),
  quantity     numeric not null default 1 check (quantity > 0),
  unit         text,
  updated_by   uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now(),
  unique (household_id, key)
);
alter table public.product_prices enable row level security;

-- Els preus són orientatius: tota la família els pot posar i corregir
drop policy if exists "membres gestionen preus" on public.product_prices;
create policy "membres gestionen preus" on public.product_prices for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create or replace function public.touch_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;
drop trigger if exists product_prices_touch on public.product_prices;
create trigger product_prices_touch before insert or update on public.product_prices
  for each row execute function public.touch_price();

-- ---------------------------------------------------------------------
-- Registre i desfer
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stores', 'product_prices'] loop
    execute format('drop trigger if exists %1$s_log on public.%1$I', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I
                      for each row execute function public.log_change()', t);
  end loop;
end $$;

-- Taules que es poden desfer des del registre (les migracions noves només cal que canviïn aquesta funció)
create or replace function public.is_undoable_table(t text)
returns boolean
language sql
immutable
as $$
  select t in ('recipes', 'meal_plan', 'shopping_items', 'pantry_items', 'foods', 'menu_templates', 'stores', 'product_prices');
$$;

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
    if not public.is_undoable_table(e.table_name) then
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
