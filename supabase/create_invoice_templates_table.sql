-- Create invoice_templates table for tenant-specific template management
CREATE TABLE IF NOT EXISTS invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  template_key VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  preview_color VARCHAR(20) DEFAULT '#0F766E',
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_tenant_template_key UNIQUE (tenant_id, template_key)
);

-- Enable RLS
ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to access tenant templates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'invoice_templates' AND policyname = 'Users can view and manage their organization templates'
  ) THEN
    CREATE POLICY "Users can view and manage their organization templates"
      ON invoice_templates
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
