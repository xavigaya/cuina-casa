-- =====================================================================
-- Cuina Casa · esquema inicial
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Llars (famílies) i membres
-- ---------------------------------------------------------------------
create table public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 80),
  servings     int  not null default 4 check (servings between 1 and 20),
  invite_code  text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  expiry_warning_days int not null default 3 check (expiry_warning_days between 0 and 30),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on public.household_members (user_id);

-- Comprova si l'usuari actual és membre d'una llar (s'usa a totes les polítiques)
create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Catàleg de productes (memòria de codis de barres i seccions)
-- ---------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  section      text not null default 'altres',
  barcode      text,
  default_unit text,
  created_at   timestamptz not null default now(),
  unique (household_id, barcode)
);

-- ---------------------------------------------------------------------
-- Llista de la compra
-- ---------------------------------------------------------------------
create table public.shopping_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  quantity     numeric,
  unit         text,
  section      text not null default 'altres',
  note         text,
  checked      boolean not null default false,
  source       text not null default 'manual' check (source in ('manual', 'menu', 'rebost')),
  added_by     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  checked_at   timestamptz
);
create index on public.shopping_items (household_id, checked);

-- ---------------------------------------------------------------------
-- Inventari: rebost, nevera i congelador
-- ---------------------------------------------------------------------
create table public.pantry_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  quantity     numeric,
  unit         text,
  location     text not null default 'rebost' check (location in ('rebost', 'nevera', 'congelador')),
  section      text not null default 'altres',
  expires_on   date,
  barcode      text,
  min_quantity numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.pantry_items (household_id, expires_on);

-- ---------------------------------------------------------------------
-- Receptes
-- ---------------------------------------------------------------------
create table public.recipes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 160),
  servings     int  not null default 4 check (servings between 1 and 50),
  prep_minutes int,
  instructions text,
  source_url   text,
  image_url    text,
  tags         text[] not null default '{}',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  position   int  not null default 0,
  name       text not null,
  quantity   numeric,
  unit       text,
  section    text not null default 'altres',
  optional   boolean not null default false
);
create index on public.recipe_ingredients (recipe_id);

-- ---------------------------------------------------------------------
-- Menú setmanal
-- ---------------------------------------------------------------------
create table public.meal_plan (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  day          date not null,
  meal         text not null check (meal in ('esmorzar', 'dinar', 'sopar')),
  recipe_id    uuid references public.recipes(id) on delete set null,
  note         text,
  servings     int check (servings between 1 and 50),
  created_at   timestamptz not null default now()
);
create index on public.meal_plan (household_id, day);

-- ---------------------------------------------------------------------
-- Seguretat a nivell de fila (RLS)
-- ---------------------------------------------------------------------
alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.products           enable row level security;
alter table public.shopping_items     enable row level security;
alter table public.pantry_items       enable row level security;
alter table public.recipes            enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.meal_plan          enable row level security;

create policy "membres veuen la llar" on public.households
  for select using (public.is_member(id));
create policy "membres editen la llar" on public.households
  for update using (public.is_member(id)) with check (public.is_member(id));

create policy "membres veuen membres" on public.household_members
  for select using (public.is_member(household_id));
create policy "cadascú edita el seu nom" on public.household_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cadascú pot sortir" on public.household_members
  for delete using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['products', 'shopping_items', 'pantry_items', 'recipes', 'meal_plan'] loop
    execute format(
      'create policy "membres gestionen %1$s" on public.%1$I for all
         using (public.is_member(household_id))
         with check (public.is_member(household_id));', t);
  end loop;
end $$;

create policy "membres gestionen ingredients" on public.recipe_ingredients for all
  using (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_member(r.household_id)))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_member(r.household_id)));

-- ---------------------------------------------------------------------
-- Funcions per crear una llar o unir-s'hi amb el codi d'invitació
-- ---------------------------------------------------------------------
create or replace function public.create_household(p_name text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Cal iniciar sessió'; end if;
  insert into households (name, created_by) values (p_name, auth.uid()) returning id into hid;
  insert into household_members (household_id, user_id, display_name, role)
    values (hid, auth.uid(), p_display_name, 'owner');
  return hid;
end;
$$;

create or replace function public.join_household(p_code text, p_display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Cal iniciar sessió'; end if;
  select id into hid from households where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'Codi d''invitació no vàlid'; end if;
  insert into household_members (household_id, user_id, display_name)
    values (hid, auth.uid(), p_display_name)
    on conflict (household_id, user_id) do nothing;
  return hid;
end;
$$;

create or replace function public.regenerate_invite_code(p_household uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare code text;
begin
  if not public.is_member(p_household) then raise exception 'No autoritzat'; end if;
  code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  update households set invite_code = code where id = p_household;
  return code;
end;
$$;

revoke all on function public.create_household(text, text) from anon;
revoke all on function public.join_household(text, text) from anon;
revoke all on function public.regenerate_invite_code(uuid) from anon;

-- Manté updated_at al dia
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger pantry_touch before update on public.pantry_items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Temps real: canvis instantanis entre els mòbils de la família
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.shopping_items;
alter publication supabase_realtime add table public.pantry_items;
alter publication supabase_realtime add table public.meal_plan;
