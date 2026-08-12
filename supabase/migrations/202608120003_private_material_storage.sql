-- v0.6: persist private study materials, metadata and parsed chunks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'study-materials',
  'study-materials',
  false,
  26214400,
  array['application/pdf', 'text/markdown', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy study_materials_owner_select
on storage.objects for select to authenticated
using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);

create policy study_materials_owner_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);

create policy study_materials_owner_update
on storage.objects for update to authenticated
using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);

create policy study_materials_owner_delete
on storage.objects for delete to authenticated
using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.document_chunks
  add column if not exists flagged_untrusted_instruction boolean not null default false;

grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_chunks to authenticated;
grant usage, select on sequence public.document_chunks_id_seq to authenticated;
