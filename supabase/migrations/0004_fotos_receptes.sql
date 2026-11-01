-- =====================================================================
-- Cuina Casa · 0004: fotos de receptes pujades des de l'ordinador o el mòbil
-- Executa aquest fitxer sencer a Supabase → SQL Editor → New query → Run
-- =====================================================================

-- Magatzem de fotos (Supabase Storage). Les fotos es veuen amb el seu enllaç,
-- que és llarg i impossible d'endevinar; només els membres de la llar en poden
-- pujar o esborrar. Mida màxima: 5 MB (l'app les redueix abans de pujar-les).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-receptes', 'fotos-receptes', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Cada foto es desa a la carpeta de la seva llar: <id de la llar>/<nom>.webp
create or replace function public.photo_household(object_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists "membres pugen fotos de la llar" on storage.objects;
create policy "membres pugen fotos de la llar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-receptes' and public.is_member(public.photo_household(name)));

drop policy if exists "membres veuen fotos de la llar" on storage.objects;
create policy "membres veuen fotos de la llar" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos-receptes' and public.is_member(public.photo_household(name)));

drop policy if exists "membres esborren fotos de la llar" on storage.objects;
create policy "membres esborren fotos de la llar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-receptes' and public.is_member(public.photo_household(name)));
