-- =====================================================================
-- Cuina Casa · 0002: tipus de plat, preelaborats i receptes enllaçades
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- (cal haver executat abans 0001_esquema_inicial.sql)
-- =====================================================================

-- Tipus de plat: entrant, primer, segon, postres o plat únic
alter table public.recipes
  add column if not exists course text
    check (course in ('entrant', 'primer', 'segon', 'postres', 'plat_unic'));

-- Preelaborats (sofregit, brou, beixamel…): receptes que s'utilitzen dins d'altres
alter table public.recipes
  add column if not exists is_component boolean not null default false;

-- Quantitat que en surt (p. ex. 500 g de sofregit). Serveix per calcular
-- quanta recepta cal fer quan una altra en demana una part.
alter table public.recipes
  add column if not exists yield_quantity numeric check (yield_quantity is null or yield_quantity > 0),
  add column if not exists yield_unit text;

-- Un ingredient pot ser una altra recepta de la llar
alter table public.recipe_ingredients
  add column if not exists sub_recipe_id uuid references public.recipes(id) on delete set null;

create index if not exists recipe_ingredients_sub_recipe_idx on public.recipe_ingredients (sub_recipe_id);

-- La recepta enllaçada ha de ser de la mateixa llar
create or replace function public.check_sub_recipe_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sub_recipe_id is null then return new; end if;
  if new.sub_recipe_id = new.recipe_id then
    raise exception 'Una recepta no pot ser ingredient d''ella mateixa';
  end if;
  if (select household_id from recipes where id = new.sub_recipe_id)
     is distinct from (select household_id from recipes where id = new.recipe_id) then
    raise exception 'La recepta enllaçada ha de ser de la mateixa llar';
  end if;
  return new;
end;
$$;

drop trigger if exists recipe_ingredients_sub_recipe_check on public.recipe_ingredients;
create trigger recipe_ingredients_sub_recipe_check
  before insert or update of sub_recipe_id on public.recipe_ingredients
  for each row execute function public.check_sub_recipe_household();
