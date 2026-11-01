-- =====================================================================
-- Cuina Casa · 0008: avisos al mòbil, preferències i al·lèrgies, treure membres
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- (cal haver executat abans 0001 a 0007). Es pot tornar a executar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Preferències de menjar de cada persona
--   allergies: al·lèrgens («gluten», «llet», «fruits_secs»…) o ingredients concrets
--   avoid:     ingredients que no menja o no li agraden
-- ---------------------------------------------------------------------
alter table public.household_members
  add column if not exists allergies text[] not null default '{}',
  add column if not exists avoid text[] not null default '{}';

-- Cadascú les seves; un privilegiat, les de tothom (p. ex. les dels més petits)
create or replace function public.set_member_food_prefs(p_household uuid, p_user uuid, p_allergies text[], p_avoid text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_household) then raise exception 'No autoritzat'; end if;
  if p_user <> auth.uid() and not public.is_privileged(p_household) then
    raise exception 'Només pots canviar les teves preferències';
  end if;
  update household_members
     set allergies = coalesce((select array_agg(distinct left(trim(x), 60)) from unnest(p_allergies) x where trim(x) <> ''), '{}'),
         avoid     = coalesce((select array_agg(distinct left(trim(x), 60)) from unnest(p_avoid) x where trim(x) <> ''), '{}')
   where household_id = p_household and user_id = p_user;
end;
$$;
revoke all on function public.set_member_food_prefs(uuid, uuid, text[], text[]) from anon;

-- ---------------------------------------------------------------------
-- Treure algú de la llar (només privilegiats; per sortir un mateix ja hi ha la política)
-- ---------------------------------------------------------------------
create or replace function public.remove_member(p_household uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_privileged(p_household) then raise exception 'Només una persona privilegiada pot treure algú de la llar'; end if;
  if p_user = auth.uid() then raise exception 'Per sortir tu de la llar, fes servir «Surt de la llar»'; end if;
  delete from household_members where household_id = p_household and user_id = p_user;
  delete from push_subscriptions where household_id = p_household and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------
-- Avisos al mòbil (Web Push)
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  -- quins avisos vol rebre aquest mòbil: llista, propostes, respostes
  prefs        jsonb not null default '{"llista": true, "propostes": true, "respostes": true}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_household_idx on public.push_subscriptions (household_id);
alter table public.push_subscriptions enable row level security;

-- Cadascú només veu i gestiona els seus mòbils
drop policy if exists "cadascú gestiona els seus avisos" on public.push_subscriptions;
create policy "cadascú gestiona els seus avisos" on public.push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member(household_id));

-- Destinataris d'un avís: els mòbils dels altres membres que el volen rebre.
-- (La ruta /api/notify ho crida amb la sessió de qui envia l'avís.)
create or replace function public.push_targets(p_household uuid, p_kind text, p_user uuid default null)
returns table (endpoint text, p256dh text, auth text, sender_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.endpoint, s.p256dh, s.auth,
         coalesce((select display_name from household_members where household_id = p_household and user_id = auth.uid()), 'Algú de casa')
  from push_subscriptions s
  join household_members m on m.household_id = s.household_id and m.user_id = s.user_id
  where public.is_member(p_household)
    and s.household_id = p_household
    and s.user_id <> auth.uid()
    and coalesce((s.prefs ->> p_kind)::boolean, true)
    and (p_kind <> 'propostes' or m.role = 'owner')
    and (p_user is null or s.user_id = p_user);
$$;
revoke all on function public.push_targets(uuid, text, uuid) from anon;

-- Quan el servei de notificacions diu que un mòbil ja no existeix, s'esborra
create or replace function public.drop_push_endpoint(p_household uuid, p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions where household_id = p_household and endpoint = p_endpoint and public.is_member(p_household);
$$;
revoke all on function public.drop_push_endpoint(uuid, text) from anon;
