-- Run this once in Supabase SQL Editor to enable company logo uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-assets',
  'company-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/svg+xml']
)
on conflict (id) do nothing;

drop policy if exists "company_assets_select_public" on storage.objects;
create policy "company_assets_select_public"
on storage.objects
for select
to public
using (bucket_id = 'company-assets');

drop policy if exists "company_assets_insert_auth" on storage.objects;
create policy "company_assets_insert_auth"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'company-assets');

drop policy if exists "company_assets_update_auth" on storage.objects;
create policy "company_assets_update_auth"
on storage.objects
for update
to authenticated
using (bucket_id = 'company-assets')
with check (bucket_id = 'company-assets');

drop policy if exists "company_assets_delete_auth" on storage.objects;
create policy "company_assets_delete_auth"
on storage.objects
for delete
to authenticated
using (bucket_id = 'company-assets');
