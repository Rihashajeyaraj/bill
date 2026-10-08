-- Migration 00004: Invoice Templates Table
-- Tenant-specific template configuration with default flag & active status

CREATE TABLE IF NOT EXISTS public.invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  template_name TEXT NOT NULL,
  description TEXT,
  preview_image TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_invoice_templates_org ON public.invoice_templates(organization_id);

ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant member template access" ON public.invoice_templates;
CREATE POLICY "Tenant member template access" ON public.invoice_templates
  FOR ALL USING (
    organization_id IS NULL OR public.is_org_member(organization_id)
  );

-- Function to set default template for a tenant
CREATE OR REPLACE FUNCTION public.set_default_invoice_template(p_org_id UUID, p_template_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Unset existing defaults
  UPDATE public.invoice_templates
  SET is_default = false
  WHERE organization_id = p_org_id;

  -- Set new default
  UPDATE public.invoice_templates
  SET is_default = true
  WHERE organization_id = p_org_id AND template_key = p_template_key;
END;
$$;
