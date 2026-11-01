-- =====================================================================
-- Cuina Casa · 0005: permisos per llar, propostes i registre d'accions
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- (cal haver executat abans 0001 a 0004). Es pot tornar a executar.
--
-- Rols (columna household_members.role):
--   'owner'  → privilegiat: ho pot fer tot
--   'member' → col·laborador: proposa receptes i àpats del menú, afegeix
--              coses a la llista, marca el que s'ha comprat, gestiona el
--              rebost i només edita o esborra el que ha afegit ell.
-- Qui va crear la llar ja és 'owner'; la resta de membres, 'member'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Rols
-- ---------------------------------------------------------------------
create or replace function public.is_privileged(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Ningú no es pot canviar el rol directament: només amb set_member_role
create or replace function public.guard_member_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if; -- llar esborrada sencera
  if tg_op = 'UPDATE' then
    if new.household_id <> old.household_id or new.user_id <> old.user_id then
      raise exception 'No es pot canviar la llar ni l''usuari d''un membre';
    end if;
    if new.role is distinct from old.role and coalesce(current_setting('cuina.role_change', true), '') <> 'on' then
      raise exception 'Només una persona privilegiada pot canviar els permisos';
    end if;
    return new;
  end if;
  -- DELETE: la llar no es pot quedar sense cap persona privilegiada
  if old.role = 'owner'
     and not exists (select 1 from household_members where household_id = old.household_id and role = 'owner' and user_id <> old.user_id)
     and exists (select 1 from household_members where household_id = old.household_id and user_id <> old.user_id) then
    raise exception 'Abans de sortir, dona tots els permisos a una altra persona de casa';
  end if;
  return old;
end;
$$;

drop trigger if exists household_members_guard on public.household_members;
create trigger household_members_guard
  before update or delete on public.household_members
  for each row execute function public.guard_member_changes();

create or replace function public.set_member_role(p_household uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_privileged(p_household) then raise exception 'Només una persona privilegiada pot canviar els permisos'; end if;
  if p_role not in ('owner', 'member') then raise exception 'Rol desconegut'; end if;
  if p_role = 'member' and not exists (
    select 1 from household_members where household_id = p_household and role = 'owner' and user_id <> p_user
  ) then
    raise exception 'Hi ha d''haver almenys una persona amb tots els permisos';
  end if;
  perform set_config('cuina.role_change', 'on', true);
  update household_members set role = p_role where household_id = p_household and user_id = p_user;
  perform set_config('cuina.role_change', '', true);
end;
$$;
revoke all on function public.set_member_role(uuid, uuid, text) from anon;

-- Configuració de la llar i codi d'invitació: només privilegiats
drop policy if exists "membres editen la llar" on public.households;
drop policy if exists "privilegiats editen la llar" on public.households;
create policy "privilegiats editen la llar" on public.households
  for update using (public.is_privileged(id)) with check (public.is_privileged(id));

create or replace function public.regenerate_invite_code(p_household uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare code text;
begin
  if not public.is_privileged(p_household) then raise exception 'Només una persona privilegiada pot canviar el codi'; end if;
  code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  update households set invite_code = code where id = p_household;
  return code;
end;
$$;

-- ---------------------------------------------------------------------
-- Propostes: receptes i àpats del menú que afegeix un col·laborador
-- ---------------------------------------------------------------------
alter table public.recipes
  add column if not exists status text not null default 'aprovada' check (status in ('aprovada', 'proposta'));
alter table public.meal_plan
  add column if not exists status text not null default 'aprovada' check (status in ('aprovada', 'proposta')),
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();

-- Un col·laborador sempre crea propostes, i si edita una recepta o un àpat
-- seu ja aprovat, torna a quedar pendent de revisió.
create or replace function public.enforce_proposals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null or coalesce(current_setting('cuina.undo', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if public.is_privileged(new.household_id) then
      new.created_by := coalesce(new.created_by, auth.uid());
    else
      new.created_by := auth.uid();
      new.status := 'proposta';
    end if;
  else
    new.household_id := old.household_id;
    new.created_by := old.created_by;
    if not public.is_privileged(old.household_id) then new.status := 'proposta'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists recipes_proposals on public.recipes;
create trigger recipes_proposals before insert or update on public.recipes
  for each row execute function public.enforce_proposals();
drop trigger if exists meal_plan_proposals on public.meal_plan;
create trigger meal_plan_proposals before insert or update on public.meal_plan
  for each row execute function public.enforce_proposals();

-- Receptes
drop policy if exists "membres gestionen recipes" on public.recipes;
drop policy if exists "membres veuen receptes" on public.recipes;
drop policy if exists "membres afegeixen receptes" on public.recipes;
drop policy if exists "autor o privilegiat edita receptes" on public.recipes;
drop policy if exists "autor o privilegiat esborra receptes" on public.recipes;
create policy "membres veuen receptes" on public.recipes for select using (public.is_member(household_id));
create policy "membres afegeixen receptes" on public.recipes for insert with check (public.is_member(household_id));
create policy "autor o privilegiat edita receptes" on public.recipes for update
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)))
  with check (public.is_member(household_id));
create policy "autor o privilegiat esborra receptes" on public.recipes for delete
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)));

-- Ingredients: segueixen els permisos de la seva recepta
create or replace function public.can_edit_recipe(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.recipes r
    where r.id = rid
      and public.is_member(r.household_id)
      and (public.is_privileged(r.household_id) or r.created_by = auth.uid())
  );
$$;

drop policy if exists "membres gestionen ingredients" on public.recipe_ingredients;
drop policy if exists "membres veuen ingredients" on public.recipe_ingredients;
drop policy if exists "autor o privilegiat gestiona ingredients" on public.recipe_ingredients;
create policy "membres veuen ingredients" on public.recipe_ingredients for select
  using (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_member(r.household_id)));
create policy "autor o privilegiat gestiona ingredients" on public.recipe_ingredients for all
  using (public.can_edit_recipe(recipe_id))
  with check (public.can_edit_recipe(recipe_id));

-- Menú
drop policy if exists "membres gestionen meal_plan" on public.meal_plan;
drop policy if exists "membres veuen el menú" on public.meal_plan;
drop policy if exists "membres afegeixen al menú" on public.meal_plan;
drop policy if exists "autor o privilegiat edita el menú" on public.meal_plan;
drop policy if exists "autor o privilegiat esborra del menú" on public.meal_plan;
create policy "membres veuen el menú" on public.meal_plan for select using (public.is_member(household_id));
create policy "membres afegeixen al menú" on public.meal_plan for insert with check (public.is_member(household_id));
create policy "autor o privilegiat edita el menú" on public.meal_plan for update
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)))
  with check (public.is_member(household_id));
create policy "autor o privilegiat esborra del menú" on public.meal_plan for delete
  using (public.is_privileged(household_id) or (created_by = auth.uid() and public.is_member(household_id)));

-- ---------------------------------------------------------------------
-- Llista de la compra: tothom hi afegeix i marca el que ha comprat;
-- només s'editen o s'esborren els productes propis (o els ja comprats).
-- ---------------------------------------------------------------------
create or replace function public.guard_shopping_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null or coalesce(current_setting('cuina.undo', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
    return new;
  end if;
  new.added_by := old.added_by;
  if not public.is_privileged(old.household_id) and old.added_by is distinct from auth.uid()
     and (to_jsonb(new) - 'checked' - 'checked_at') <> (to_jsonb(old) - 'checked' - 'checked_at') then
    raise exception 'Només pots marcar com a comprat el que ha afegit una altra persona';
  end if;
  return new;
end;
$$;

drop trigger if exists shopping_items_guard on public.shopping_items;
create trigger shopping_items_guard before insert or update on public.shopping_items
  for each row execute function public.guard_shopping_items();

drop policy if exists "membres gestionen shopping_items" on public.shopping_items;
drop policy if exists "membres veuen la llista" on public.shopping_items;
drop policy if exists "membres afegeixen a la llista" on public.shopping_items;
drop policy if exists "membres marquen la llista" on public.shopping_items;
drop policy if exists "autor, privilegiat o comprat s'esborra" on public.shopping_items;
create policy "membres veuen la llista" on public.shopping_items for select using (public.is_member(household_id));
create policy "membres afegeixen a la llista" on public.shopping_items for insert with check (public.is_member(household_id));
create policy "membres marquen la llista" on public.shopping_items for update
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "autor, privilegiat o comprat s'esborra" on public.shopping_items for delete
  using (public.is_member(household_id) and (public.is_privileged(household_id) or added_by = auth.uid() or checked));

-- Aliments propis: tothom en pot afegir; corregir-los o esborrar-los, els privilegiats
drop policy if exists "membres gestionen aliments propis" on public.foods;
drop policy if exists "membres afegeixen aliments" on public.foods;
drop policy if exists "privilegiats editen aliments" on public.foods;
drop policy if exists "privilegiats esborren aliments" on public.foods;
create policy "membres afegeixen aliments" on public.foods for insert
  with check (household_id is not null and public.is_member(household_id));
create policy "privilegiats editen aliments" on public.foods for update
  using (household_id is not null and public.is_privileged(household_id))
  with check (household_id is not null and public.is_privileged(household_id));
create policy "privilegiats esborren aliments" on public.foods for delete
  using (household_id is not null and public.is_privileged(household_id));

-- (El rebost i el catàleg de productes continuen oberts a tots els membres.)

-- ---------------------------------------------------------------------
-- Registre d'accions
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id           bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  at           timestamptz not null default now(),
  table_name   text not null,
  row_id       uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  label        text,
  old_data     jsonb,
  new_data     jsonb,
  tx           bigint not null default txid_current(),
  undone_at    timestamptz,
  undone_by    uuid references auth.users(id) on delete set null
);
create index if not exists activity_log_household_idx on public.activity_log (household_id, at desc);
create index if not exists activity_log_row_idx on public.activity_log (table_name, row_id, id desc);

alter table public.activity_log enable row level security;
drop policy if exists "membres veuen el registre" on public.activity_log;
create policy "membres veuen el registre" on public.activity_log for select using (public.is_member(household_id));
-- Només s'hi escriu des dels disparadors i de undo_actions (security definer)
revoke insert, update, delete on public.activity_log from anon, authenticated;

create or replace function public.activity_label(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p_table
    when 'recipes' then p_row->>'title'
    when 'meal_plan' then coalesce((select title from recipes where id = (p_row->>'recipe_id')::uuid), p_row->>'note')
    when 'household_members' then p_row->>'display_name'
    else p_row->>'name'
  end;
$$;

create or replace function public.write_activity(
  p_household uuid, p_table text, p_row uuid, p_action text, p_label text, p_old jsonb, p_new jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Una llar que s'està esborrant sencera no deixa registre
  if not exists (select 1 from households where id = p_household) then return; end if;
  insert into activity_log (household_id, user_id, table_name, row_id, action, label, old_data, new_data)
    values (p_household, auth.uid(), p_table, p_row, p_action, p_label, p_old, p_new);
  -- Es guarden els últims 90 dies
  if random() < 0.02 then
    delete from activity_log where household_id = p_household and at < now() - interval '90 days';
  end if;
end;
$$;
revoke all on function public.write_activity(uuid, text, uuid, text, text, jsonb, jsonb) from anon, authenticated;

create or replace function public.should_log()
returns boolean
language sql
stable
as $$
  -- Ni els canvis en cascada (pg_trigger_depth > 1), ni els de desfer, ni els fets des de l'editor SQL
  select pg_trigger_depth() <= 1
     and auth.uid() is not null
     and coalesce(current_setting('cuina.undo', true), '') <> 'on';
$$;

-- Registre genèric: menú, llista, rebost, aliments, llar i membres
create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb;
  n jsonb;
  r jsonb;
  hid uuid;
  rid uuid;
begin
  if not public.should_log() then return coalesce(new, old); end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then return new; end if;
  -- Àpat que es queda sense recepta perquè l'han esborrada: ja consta a l'entrada de la recepta
  if tg_table_name = 'meal_plan' and tg_op = 'UPDATE' and (o->>'recipe_id') is not null and (n->>'recipe_id') is null
     and (o - 'recipe_id') = (n - 'recipe_id')
     and not exists (select 1 from recipes where id = (o->>'recipe_id')::uuid) then
    return new;
  end if;
  r := coalesce(n, o);
  if tg_table_name = 'households' then
    hid := (r->>'id')::uuid;
  else
    hid := (r->>'household_id')::uuid;
  end if;
  if hid is null then return coalesce(new, old); end if; -- aliments de referència
  rid := coalesce(r->>'id', r->>'user_id')::uuid;
  perform public.write_activity(hid, tg_table_name, rid, lower(tg_op), public.activity_label(tg_table_name, r), o, n);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['meal_plan', 'shopping_items', 'pantry_items', 'foods', 'households', 'household_members'] loop
    execute format('drop trigger if exists %1$s_log on public.%1$I', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I
                      for each row execute function public.log_change()', t);
  end loop;
end $$;

-- Receptes: es desa la recepta amb els seus ingredients, per poder-la recuperar sencera
create or replace function public.recipe_snapshot(p_row jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'row', p_row,
    'ingredients', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.position)
      from recipe_ingredients i where i.recipe_id = (p_row->>'id')::uuid
    ), '[]'::jsonb),
    'meal_refs', coalesce((
      select jsonb_agg(m.id) from meal_plan m where m.recipe_id = (p_row->>'id')::uuid
    ), '[]'::jsonb),
    'sub_refs', coalesce((
      select jsonb_agg(i.id) from recipe_ingredients i
      where i.sub_recipe_id = (p_row->>'id')::uuid and i.recipe_id <> (p_row->>'id')::uuid
    ), '[]'::jsonb)
  );
$$;

create or replace function public.log_recipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.should_log() then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    perform public.write_activity(new.household_id, 'recipes', new.id, 'insert', new.title, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    -- Els ingredients encara són els d'abans: l'app els canvia després de desar la recepta
    perform public.write_activity(new.household_id, 'recipes', new.id, 'update', new.title,
      public.recipe_snapshot(to_jsonb(old)), to_jsonb(new));
  else
    perform public.write_activity(old.household_id, 'recipes', old.id, 'delete', old.title,
      public.recipe_snapshot(to_jsonb(old)), null);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists recipes_log on public.recipes;
create trigger recipes_log after insert or update on public.recipes
  for each row execute function public.log_recipe();
-- Abans d'esborrar, perquè els ingredients encara hi siguin
drop trigger if exists recipes_log_delete on public.recipes;
create trigger recipes_log_delete before delete on public.recipes
  for each row execute function public.log_recipe();

-- Canvis d'ingredients fets a banda (p. ex. unificar noms): una entrada
-- "ha editat la recepta" amb la foto d'abans, si no n'hi ha cap de recent.
create or replace function public.log_recipe_ingredients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid := coalesce(new.recipe_id, old.recipe_id);
  rec recipes%rowtype;
begin
  if not public.should_log() then return coalesce(new, old); end if;
  if exists (
    select 1 from activity_log
    where table_name = 'recipes' and row_id = rid and user_id = auth.uid()
      and undone_at is null and at > now() - interval '2 minutes'
  ) then
    return coalesce(new, old);
  end if;
  select * into rec from recipes where id = rid;
  if not found then return coalesce(new, old); end if;
  perform public.write_activity(rec.household_id, 'recipes', rid, 'update', rec.title,
    public.recipe_snapshot(to_jsonb(rec)), to_jsonb(rec));
  return coalesce(new, old);
end;
$$;

drop trigger if exists recipe_ingredients_log on public.recipe_ingredients;
create trigger recipe_ingredients_log before insert or update or delete on public.recipe_ingredients
  for each row execute function public.log_recipe_ingredients();

-- ---------------------------------------------------------------------
-- Desfer: els privilegiats poden desfer qualsevol acció del registre;
-- cada persona, les seves. Cal desfer primer els canvis posteriors
-- sobre el mateix element.
-- ---------------------------------------------------------------------
create or replace function public.restore_columns(p_table text, p_row jsonb, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
  from pg_attribute
  where attrelid = ('public.' || quote_ident(p_table))::regclass
    and attnum > 0 and not attisdropped and attgenerated = '' and attname <> 'id';
  execute format('update public.%1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1)) where id = $2',
                 p_table, cols)
    using p_row, p_id;
end;
$$;
revoke all on function public.restore_columns(text, jsonb, uuid) from anon, authenticated;

create or replace function public.restore_recipe_ingredients(p_recipe uuid, p_ingredients jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from recipe_ingredients where recipe_id = p_recipe;
  insert into recipe_ingredients
  select (jsonb_populate_record(null::recipe_ingredients,
           case when (i->>'sub_recipe_id') is not null
                 and not exists (select 1 from recipes where id = (i->>'sub_recipe_id')::uuid)
                then i || '{"sub_recipe_id": null}'::jsonb else i end)).*
  from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) i
  on conflict (id) do nothing;
end;
$$;
revoke all on function public.restore_recipe_ingredients(uuid, jsonb) from anon, authenticated;

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
    if e.table_name not in ('recipes', 'meal_plan', 'shopping_items', 'pantry_items', 'foods') then
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

-- Temps real: el menú i les receptes (propostes) i el registre s'actualitzen sols
do $$
begin
  begin alter publication supabase_realtime add table public.recipes; exception when others then null; end;
  begin alter publication supabase_realtime add table public.activity_log; exception when others then null; end;
end $$;
