-- Migration 00006: Multi-Tenant SaaS Platform Foundation
-- Adds user_profiles, audit_logs, helper functions, RLS policies, indexes.
-- Safe version: audit_logs.organization_id has NO foreign key (avoids order dependency).

-- 1. User Profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  platform_role TEXT DEFAULT 'TENANT_USER', -- 'SUPER_ADMIN' or 'TENANT_USER'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Audit/Activity Logs table (NO FK on organization_id — avoids dependency issues)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,                    -- intentionally no FK constraint
  user_id UUID,
  user_name TEXT,
  company_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Super Admin helper function
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
      AND platform_role = 'SUPER_ADMIN'
  );
$$;

-- 4. Organization Membership Helper (replaces the one in 00003)
CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = org_id
      AND owner_user_id = auth.uid()
  );
$$;

-- 5. is_org_admin helper
-- Note: organization_role enum = ('owner', 'accounter', 'staff') — no 'admin' value
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
      AND role::text      = 'owner'
      AND status::text    = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id            = org_id
      AND owner_user_id = auth.uid()
  );
$$;

-- 6. Enable RLS on new tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- User Profiles RLS
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile" ON public.user_profiles
  FOR SELECT USING (id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile" ON public.user_profiles
  FOR UPDATE USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
CREATE POLICY "Users can insert own profile" ON public.user_profiles
  FOR INSERT WITH CHECK (id = auth.uid() OR public.is_super_admin());

-- Audit Logs RLS
DROP POLICY IF EXISTS "Org members can view own org audit logs" ON public.audit_logs;
CREATE POLICY "Org members can view own org audit logs" ON public.audit_logs
  FOR SELECT USING (public.is_org_member(organization_id) OR public.is_super_admin());

DROP POLICY IF EXISTS "Org members can create audit logs" ON public.audit_logs;
CREATE POLICY "Org members can create audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_org_member(organization_id) OR public.is_super_admin());

-- 7. Organization members INSERT / UPDATE / DELETE policies (the 42501 fix)
DROP POLICY IF EXISTS "Admins can insert members" ON public.organization_members;
CREATE POLICY "Admins can insert members" ON public.organization_members
  FOR INSERT WITH CHECK (
    public.is_org_admin(organization_id)
    OR EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = organization_members.organization_id
        AND owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can update members" ON public.organization_members;
CREATE POLICY "Admins can update members" ON public.organization_members
  FOR UPDATE USING (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS "Admins can delete members" ON public.organization_members;
CREATE POLICY "Admins can delete members" ON public.organization_members
  FOR DELETE USING (public.is_org_admin(organization_id));

-- 8. Super Admin can view all organizations
DROP POLICY IF EXISTS "Super admin can view all organizations" ON public.organizations;
CREATE POLICY "Super admin can view all organizations" ON public.organizations
  FOR SELECT USING (owner_user_id = auth.uid() OR public.is_org_member(id) OR public.is_super_admin());

-- 9. Performance indexes
CREATE INDEX IF NOT EXISTS idx_org_members_user_org ON public.organization_members(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_parties_org_status    ON public.parties(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_items_org_status      ON public.items(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_proforma_org_status   ON public.proforma_invoices(organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status   ON public.invoices(organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_org_date     ON public.payments(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_date   ON public.audit_logs(organization_id, created_at);
