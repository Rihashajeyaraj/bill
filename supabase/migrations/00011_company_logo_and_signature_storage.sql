-- Migration 00011: Company Logo & Authorized Signature Persistence
-- Ensures storage bucket 'company-assets' exists, adds logo/signature columns,
-- and configures storage policies so assets are scoped per organization.

-- 1. Ensure columns exist on organizations for explicit URL storage alongside settings JSONB
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signature_url TEXT;

-- 2. Storage Bucket setup for company assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-assets',
  'company-assets',
  true,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

-- 3. Public Read Access for company assets bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Public Access for Company Assets'
  ) THEN
    CREATE POLICY "Public Access for Company Assets" ON storage.objects
      FOR SELECT USING (bucket_id = 'company-assets');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
