-- =====================================================================
-- Cuina Casa · 0009: correccions de seguretat (auditoria de l'1/11/2026)
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- (cal haver executat abans 0001 a 0008). Es pot tornar a executar.
--
-- 1. A Postgres, qualsevol funció nova la pot executar tothom (PUBLIC), fins
--    i tot sense iniciar sessió. Algunes funcions internes del registre i de
--    «Desfés» (restore_columns, write_activity…) quedaven exposades.
--    Ara totes les funcions de la llar queden tancades per defecte i només
--    s'obren, una per una, les que l'app fa servir.
-- 2. Les fotos les poden esborrar qui les ha pujat o un privilegiat.
-- 3. Els enllaços de les receptes han de ser http(s).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permisos de les funcions
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  -- Tot tancat (excepte les funcions de les extensions)
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public', f.sig);
    begin execute format('revoke all on function %s from anon', f.sig); exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f.sig); exception when undefined_object then null; end;
  end loop;
end $$;

-- Funcions que fan servir les polítiques de seguretat (només responen sí/no)
grant execute on function public.is_member(uuid) to anon, authenticated;
grant execute on function public.is_privileged(uuid) to anon, authenticated;
grant execute on function public.can_edit_recipe(uuid) to anon, authenticated;
grant execute on function public.photo_household(text) to anon, authenticated;

-- Funcions que l'app crida (totes comproven qui ho demana)
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.undo_actions(bigint[]) to authenticated;
grant execute on function public.set_member_food_prefs(uuid, uuid, text[], text[]) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.push_targets(uuid, text, uuid) to authenticated;
grant execute on function public.drop_push_endpoint(uuid, text) to authenticated;

-- Les funcions noves que es creïn d'ara endavant també neixen tancades
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 2. Fotos: les esborra qui les ha pujat o un privilegiat
-- ---------------------------------------------------------------------
drop policy if exists "membres esborren fotos de la llar" on storage.objects;
drop policy if exists "autor o privilegiat esborra fotos" on storage.objects;
create policy "autor o privilegiat esborra fotos" on storage.objects
  for delete using (
    bucket_id = 'fotos-receptes'
    and public.is_member(public.photo_household(name))
    and (owner_id = auth.uid()::text or public.is_privileged(public.photo_household(name)))
  );

-- ---------------------------------------------------------------------
-- 3. Enllaços de les receptes: només http(s)
-- ---------------------------------------------------------------------
alter table public.recipes drop constraint if exists recipes_source_url_http;
alter table public.recipes add constraint recipes_source_url_http
  check (source_url is null or source_url ~* '^https?://[^\s]+$') not valid;
alter table public.recipes drop constraint if exists recipes_image_url_http;
alter table public.recipes add constraint recipes_image_url_http
  check (image_url is null or image_url ~* '^https?://[^\s]+$') not valid;

-- Si les receptes que ja hi ha compleixen la norma, es valida del tot;
-- si alguna no, s'aplica igualment a tot el que es desi a partir d'ara.
do $$
begin
  begin alter table public.recipes validate constraint recipes_source_url_http; exception when others then null; end;
  begin alter table public.recipes validate constraint recipes_image_url_http; exception when others then null; end;
end $$;
