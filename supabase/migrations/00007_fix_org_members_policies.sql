-- Migration 00007: Fix organization_members RLS policies
-- Adds missing INSERT / UPDATE / DELETE policies so Tenant Admins can manage their own team
-- and Super Admin can bootstrap companies without a service role key.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.  is_org_admin() helper – returns true when the calling user is an owner/admin
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id         = auth.uid()
      AND role            IN ('owner', 'admin')
      AND status          = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id            = org_id
      AND owner_user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2.  organization_members  – INSERT / UPDATE / DELETE policies
-- ─────────────────────────────────────────────────────────────────────────────

-- Allow Tenant Admins to add new members to their own organization
DROP POLICY IF EXISTS "Admins can insert members" ON public.organization_members;
CREATE POLICY "Admins can insert members" ON public.organization_members
  FOR INSERT WITH CHECK (
    public.is_org_admin(organization_id)
    -- Also allow inserting the first member when the org was just created (owner bootstrapping)
    OR EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id            = organization_members.organization_id
        AND owner_user_id = auth.uid()
    )
  );

-- Allow Tenant Admins to update roles/status of members in their org
DROP POLICY IF EXISTS "Admins can update members" ON public.organization_members;
CREATE POLICY "Admins can update members" ON public.organization_members
  FOR UPDATE USING (
    public.is_org_admin(organization_id)
  );

-- Allow Tenant Admins to remove members from their org
DROP POLICY IF EXISTS "Admins can delete members" ON public.organization_members;
CREATE POLICY "Admins can delete members" ON public.organization_members
  FOR DELETE USING (
    public.is_org_admin(organization_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3.  organizations – INSERT policy (let an authenticated user create their org)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can create organization" ON public.organizations;
CREATE POLICY "Authenticated users can create organization" ON public.organizations
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4.  user_profiles / profiles – ensure upsert works for new tenant users
-- ─────────────────────────────────────────────────────────────────────────────
-- Allow any authenticated user to insert their own profile row
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (id = auth.uid() OR public.is_super_admin());

-- Ensure profiles table (legacy) also allows insert
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
      CREATE POLICY "Users can insert own profile" ON public.profiles
        FOR INSERT WITH CHECK (id = auth.uid());
    $p$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5.  Ensure RLS is enabled on organization_members (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
