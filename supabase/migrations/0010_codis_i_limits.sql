-- =====================================================================
-- Cuina Casa · 0010: codis d'invitació, límits i mides màximes
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- (cal haver executat abans 0001 a 0009). Es pot tornar a executar.
--
-- 1. Els codis d'invitació caduquen (7 dies) i hi ha un límit d'intents
--    fallits per persona (perquè no es puguin endevinar a força de provar).
-- 2. Límit d'avisos al mòbil per persona (contra l'abús).
-- 3. Mides màximes dels camps de text i de les llistes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Codis d'invitació
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'households' and column_name = 'invite_expires_at') then
    alter table public.households add column invite_expires_at timestamptz not null default (now() + interval '7 days');
  end if;
end $$;

-- Intents fallits d'entrar a una llar (només els llegeix la funció)
create table if not exists public.join_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists join_attempts_user_idx on public.join_attempts (user_id, at desc);
alter table public.join_attempts enable row level security;
revoke all on public.join_attempts from anon, authenticated;

-- Torna la llar, o null si el codi no existeix (i compta l'intent fallit)
create or replace function public.join_household(p_code text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  expires timestamptz;
  fails int;
begin
  if auth.uid() is null then raise exception 'Cal iniciar sessió'; end if;

  select count(*) into fails from join_attempts where user_id = auth.uid() and at > now() - interval '1 hour';
  if fails >= 8 then
    raise exception 'Massa intents amb codis que no existeixen. Torna-ho a provar d''aquí a una hora.';
  end if;

  select id, invite_expires_at into hid, expires from households where invite_code = upper(trim(coalesce(p_code, '')));
  if hid is null then
    insert into join_attempts (user_id) values (auth.uid());
    delete from join_attempts where at < now() - interval '1 day';
    return null;
  end if;

  -- Qui ja n'és membre hi pot tornar a entrar encara que el codi hagi caducat
  if exists (select 1 from household_members where household_id = hid and user_id = auth.uid()) then
    return hid;
  end if;
  if expires < now() then
    raise exception 'El codi ha caducat. Demana''n un de nou a una persona privilegiada de casa.';
  end if;

  insert into household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), left(nullif(trim(p_display_name), ''), 60))
    on conflict (household_id, user_id) do nothing;
  return hid;
end;
$$;

-- Codi nou: 10 caràcters i 7 dies de validesa
create or replace function public.regenerate_invite_code(p_household uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare code text;
begin
  if not public.is_privileged(p_household) then raise exception 'Només una persona privilegiada pot canviar el codi'; end if;
  code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
  update households set invite_code = code, invite_expires_at = now() + interval '7 days' where id = p_household;
  return code;
end;
$$;

-- Allarga 7 dies el codi actual (sense canviar-lo)
create or replace function public.extend_invite_code(p_household uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare expires timestamptz := now() + interval '7 days';
begin
  if not public.is_privileged(p_household) then raise exception 'Només una persona privilegiada pot renovar el codi'; end if;
  update households set invite_expires_at = expires where id = p_household;
  return expires;
end;
$$;

revoke all on function public.join_household(text, text) from public, anon;
revoke all on function public.regenerate_invite_code(uuid) from public, anon;
revoke all on function public.extend_invite_code(uuid) from public, anon;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.extend_invite_code(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Límit d'avisos: com a molt 30 enviaments cada 10 minuts per persona
-- ---------------------------------------------------------------------
create table if not exists public.push_sends (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists push_sends_user_idx on public.push_sends (user_id, at desc);
alter table public.push_sends enable row level security;
revoke all on public.push_sends from anon, authenticated;

create or replace function public.push_targets(p_household uuid, p_kind text, p_user uuid default null)
returns table (endpoint text, p256dh text, auth text, sender_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_household) then return; end if;
  if (select count(*) from push_sends where user_id = auth.uid() and at > now() - interval '10 minutes') >= 30 then
    return; -- massa avisos seguits: no se n'envien més durant una estona
  end if;
  insert into push_sends (user_id) values (auth.uid());
  delete from push_sends where at < now() - interval '1 day';

  return query
    select s.endpoint, s.p256dh, s.auth,
           coalesce((select display_name from household_members where household_id = p_household and user_id = auth.uid()), 'Algú de casa')
    from push_subscriptions s
    join household_members m on m.household_id = s.household_id and m.user_id = s.user_id
    where s.household_id = p_household
      and s.user_id <> auth.uid()
      and coalesce((s.prefs ->> p_kind)::boolean, true)
      and (p_kind <> 'propostes' or m.role = 'owner')
      and (p_user is null or s.user_id = p_user);
end;
$$;
revoke all on function public.push_targets(uuid, text, uuid) from public, anon;
grant execute on function public.push_targets(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Mides màximes
-- ---------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('recipes', 'recipes_instructions_len', 'instructions is null or char_length(instructions) <= 20000'),
      ('recipes', 'recipes_tags_len', 'cardinality(tags) <= 30'),
      ('recipes', 'recipes_urls_len', 'char_length(coalesce(source_url, '''')) <= 2000 and char_length(coalesce(image_url, '''')) <= 2000'),
      ('recipes', 'recipes_yield_unit_len', 'yield_unit is null or char_length(yield_unit) <= 30'),
      ('recipe_ingredients', 'recipe_ingredients_len', 'char_length(name) <= 200 and char_length(coalesce(unit, '''')) <= 30 and char_length(section) <= 40'),
      ('meal_plan', 'meal_plan_note_len', 'note is null or char_length(note) <= 200'),
      ('shopping_items', 'shopping_items_len', 'char_length(coalesce(note, '''')) <= 300 and char_length(coalesce(unit, '''')) <= 30'),
      ('pantry_items', 'pantry_items_len', 'char_length(coalesce(unit, '''')) <= 30 and char_length(coalesce(barcode, '''')) <= 64'),
      ('products', 'products_len', 'char_length(name) <= 120 and char_length(coalesce(barcode, '''')) <= 64'),
      ('menu_templates', 'menu_templates_size', 'jsonb_array_length(entries) <= 150 and octet_length(entries::text) <= 100000'),
      ('household_members', 'household_members_len', 'char_length(coalesce(display_name, '''')) <= 60 and cardinality(allergies) <= 40 and cardinality(avoid) <= 40'),
      ('foods', 'foods_aliases_len', 'cardinality(aliases) <= 30'),
      ('product_prices', 'product_prices_len', 'char_length(key) <= 120 and char_length(coalesce(unit, '''')) <= 30'),
      ('stores', 'stores_order_len', 'cardinality(section_order) <= 30'),
      ('push_subscriptions', 'push_subscriptions_len', 'char_length(endpoint) <= 1000 and char_length(p256dh) <= 200 and char_length(auth) <= 100')
    ) as t(tbl, name, expr)
  loop
    execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.name);
    execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    -- Si les dades d'ara ja ho compleixen, es valida del tot
    begin
      execute format('alter table public.%I validate constraint %I', c.tbl, c.name);
    exception when others then null;
    end;
  end loop;
end $$;
