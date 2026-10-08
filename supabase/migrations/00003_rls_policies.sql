-- Migration 00003: Multi-Tenant RLS Security Policies
-- Strict row-level security for tenant isolation

-- Helper function to check org membership
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
  );
$$;

-- Enable RLS on core multi-tenant tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_years ENABLE ROW LEVEL SECURITY;

-- Organizations policies
DROP POLICY IF EXISTS "Users can view own organizations" ON public.organizations;
CREATE POLICY "Users can view own organizations" ON public.organizations
  FOR SELECT USING (
    owner_user_id = auth.uid() OR public.is_org_member(id)
  );

DROP POLICY IF EXISTS "Owners can update own organization" ON public.organizations;
CREATE POLICY "Owners can update own organization" ON public.organizations
  FOR UPDATE USING (
    owner_user_id = auth.uid() OR public.is_org_member(id)
  );

DROP POLICY IF EXISTS "Authenticated users can create organization" ON public.organizations;
CREATE POLICY "Authenticated users can create organization" ON public.organizations
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
  );

-- Organization Members policies
DROP POLICY IF EXISTS "Members can view membership" ON public.organization_members;
CREATE POLICY "Members can view membership" ON public.organization_members
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_org_member(organization_id)
  );

-- Parties policies
DROP POLICY IF EXISTS "Tenant member party access" ON public.parties;
CREATE POLICY "Tenant member party access" ON public.parties
  FOR ALL USING (public.is_org_member(organization_id));

-- Items policies
DROP POLICY IF EXISTS "Tenant member item access" ON public.items;
CREATE POLICY "Tenant member item access" ON public.items
  FOR ALL USING (public.is_org_member(organization_id));

-- Pro Forma Invoices policies
DROP POLICY IF EXISTS "Tenant member proforma access" ON public.proforma_invoices;
CREATE POLICY "Tenant member proforma access" ON public.proforma_invoices
  FOR ALL USING (public.is_org_member(organization_id));

-- Tax Invoices policies
DROP POLICY IF EXISTS "Tenant member invoice access" ON public.invoices;
CREATE POLICY "Tenant member invoice access" ON public.invoices
  FOR ALL USING (public.is_org_member(organization_id));

-- Payments policies
DROP POLICY IF EXISTS "Tenant member payment access" ON public.payments;
CREATE POLICY "Tenant member payment access" ON public.payments
  FOR ALL USING (public.is_org_member(organization_id));

-- Settings & FY policies
DROP POLICY IF EXISTS "Tenant member settings access" ON public.company_settings;
CREATE POLICY "Tenant member settings access" ON public.company_settings
  FOR ALL USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Tenant member fy access" ON public.financial_years;
CREATE POLICY "Tenant member fy access" ON public.financial_years
  FOR ALL USING (public.is_org_member(organization_id));
