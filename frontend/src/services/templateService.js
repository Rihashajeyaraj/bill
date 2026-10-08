import { isSupabaseConfigured, supabase } from "./supabaseClient";
import {
  LS_KEYS,
  lsGetOrganizationScoped,
  lsSetOrganizationScoped,
  ssGet,
  ssSet
} from "./storage";
import { authGetOrganizationId } from "./auth.service";

export const BUILTIN_TEMPLATES = [
  {
    template_key: "new_globe_export",
    name: "New Globe – Export",
    description: "Logistics / Export Tax Invoice featuring MAWB/HAWB, Cargo Weights, Package details & IGST.",
    preview_color: "#1E3A8A",
    is_default: true,
    is_active: true,
    category: "Logistics / Export",
    badge: "Export TAX"
  },
  {
    template_key: "anvase_exim_import",
    name: "ANVASE EXIM – Import",
    description: "Import / GST Tax Invoice with BE Number, Job Type, MBL/HBL, CIF & Assessable Value.",
    preview_color: "#991B1B",
    is_default: false,
    is_active: true,
    category: "Import / Customs",
    badge: "Import GST"
  },
  {
    template_key: "uprichard_international",
    name: "UPRICHARD – International",
    description: "International / VAT Invoice with simple Qty, Rate, Net Amount, VAT breakdown & SWIFT/IBAN.",
    preview_color: "#0F766E",
    is_default: false,
    is_active: true,
    category: "International / VAT",
    badge: "International"
  },
  {
    template_key: "pga_shipping_draft",
    name: "PGA Shipping – Draft Tax Invoice",
    description: "Shipping / GST Tax Invoice with Origin, Destination, Vessel, Voyage, Container No & ROE.",
    preview_color: "#334155",
    is_default: false,
    is_active: true,
    category: "Shipping / Logistics",
    badge: "Shipping GST"
  },
  {
    template_key: "modern_gst",
    name: "Modern GST",
    description: "Vibrant emerald header with prominent GSTIN badges, clean rounded cards & tax summaries.",
    preview_color: "#0F766E",
    is_default: false,
    is_active: true,
    category: "GST Standard",
    badge: "Popular"
  },
  {
    template_key: "classic",
    name: "Classic",
    description: "Traditional double-bordered formal layout with crisp headings & structured grid rows.",
    preview_color: "#1E293B",
    is_default: false,
    is_active: true,
    category: "Traditional",
    badge: "Formal"
  },
  {
    template_key: "professional",
    name: "Professional",
    description: "Executive dark header banner with contrast logo block, icon metadata & sleek totals card.",
    preview_color: "#1E40AF",
    is_default: false,
    is_active: true,
    category: "Corporate",
    badge: "Executive"
  },
  {
    template_key: "compact",
    name: "Compact",
    description: "High-density space-saving template ideal for long multi-item billing with slim padding.",
    preview_color: "#475569",
    is_default: false,
    is_active: true,
    category: "High-Density",
    badge: "Slim"
  }
];

const LOCAL_STORAGE_TEMPLATES_KEY = "tenant_invoice_templates";
const LOCAL_STORAGE_DEFAULT_TEMPLATE_KEY = "tenant_default_template_key";

function getFallbackTemplates(tenantId) {
  const stored = lsGetOrganizationScoped(`${LOCAL_STORAGE_TEMPLATES_KEY}_${tenantId}`, null);
  if (Array.isArray(stored) && stored.length > 0) {
    return stored;
  }
  return BUILTIN_TEMPLATES.map((tmpl) => ({
    id: `tpl_${tmpl.template_key}`,
    tenant_id: tenantId,
    template_key: tmpl.template_key,
    name: tmpl.name,
    description: tmpl.description,
    preview_color: tmpl.preview_color,
    is_default: tmpl.is_default,
    is_active: tmpl.is_active,
    category: tmpl.category,
    badge: tmpl.badge
  }));
}

function saveFallbackTemplates(tenantId, templates) {
  lsSetOrganizationScoped(`${LOCAL_STORAGE_TEMPLATES_KEY}_${tenantId}`, templates);
}

export async function fetchTenantTemplates(tenantIdInput = null) {
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";
  let customTemplates = [];

  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("invoice_templates")
        .select("*")
        .or(`tenant_id.eq.${tenantId},organization_id.eq.${tenantId}`)
        .order("created_at", { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        customTemplates = data.map((row) => {
          const settings = row.settings || {};
          const builtin = BUILTIN_TEMPLATES.find((b) => b.template_key === row.template_key) || {};
          const isCustom = Boolean(settings.is_custom || row.is_custom || row.template_key.startsWith("custom_"));
          return {
            id: row.id,
            tenant_id: row.tenant_id || row.organization_id || tenantId,
            organization_id: row.organization_id || row.tenant_id || tenantId,
            template_key: row.template_key,
            name: row.template_name || row.name || builtin.name || row.template_key,
            description: row.description || builtin.description || "",
            preview_color: row.preview_color || builtin.preview_color || "#4F46E5",
            is_default: Boolean(row.is_default),
            is_active: row.is_active !== false,
            category: isCustom ? "Custom Upload" : builtin.category || "Standard",
            badge: isCustom ? (settings.file_type ? settings.file_type.toUpperCase() : "CUSTOM") : (builtin.badge || ""),
            is_custom: isCustom,
            template_type: settings.file_type || settings.template_type || "html",
            file_name: settings.file_name || "",
            file_content: settings.file_content || "",
            created_by: settings.created_by || "User",
            created_at: row.created_at
          };
        });
      }
    } catch {
      // Fallback to local storage if query fails
    }
  }

  const fallbacks = getFallbackTemplates(tenantId);
  const combinedMap = new Map();

  // Load builtin templates first
  BUILTIN_TEMPLATES.forEach((b) => {
    const override = fallbacks.find((f) => f.template_key === b.template_key);
    combinedMap.set(b.template_key, {
      id: `tpl_${b.template_key}`,
      tenant_id: tenantId,
      organization_id: tenantId,
      template_key: b.template_key,
      name: b.name,
      description: b.description,
      preview_color: b.preview_color,
      is_default: override ? Boolean(override.is_default) : b.is_default,
      is_active: override ? override.is_active !== false : b.is_active,
      category: b.category,
      badge: b.badge,
      is_custom: false
    });
  });

  // Merge custom templates from DB or fallback storage
  const storedFallbacks = lsGetOrganizationScoped(`${LOCAL_STORAGE_TEMPLATES_KEY}_${tenantId}`, []);
  const allCustom = [
    ...customTemplates,
    ...storedFallbacks.filter((f) => f.is_custom || f.template_key.startsWith("custom_"))
  ];

  allCustom.forEach((c) => {
    if (!combinedMap.has(c.template_key)) {
      combinedMap.set(c.template_key, c);
    }
  });

  return Array.from(combinedMap.values());
}

export async function saveCustomTemplate(templatePayload, tenantIdInput = null) {
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";
  const { name, description, fileName, fileType, fileContent, previewColor } = templatePayload;
  const templateKey = `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const newTpl = {
    id: `tpl_${templateKey}`,
    tenant_id: tenantId,
    organization_id: tenantId,
    template_key: templateKey,
    name: name || "Custom Invoice Template",
    template_name: name || "Custom Invoice Template",
    description: description || "Uploaded custom invoice template layout.",
    preview_color: previewColor || "#4F46E5",
    is_default: false,
    is_active: true,
    category: "Custom Upload",
    badge: (fileType || "HTML").toUpperCase(),
    is_custom: true,
    template_type: fileType || "html",
    file_name: fileName || "template",
    file_content: fileContent || "",
    created_by: "billing.test@example.com",
    created_at: new Date().toISOString()
  };

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.from("invoice_templates").insert({
        organization_id: tenantId,
        tenant_id: tenantId,
        template_key: templateKey,
        template_name: newTpl.name,
        description: newTpl.description,
        is_default: false,
        is_active: true,
        settings: {
          is_custom: true,
          file_type: fileType,
          file_name: fileName,
          file_content: fileContent,
          created_by: "billing.test@example.com"
        }
      });
    } catch {
      // Non-blocking fallback to local storage
    }
  }

  const current = getFallbackTemplates(tenantId);
  const updated = [...current, newTpl];
  saveFallbackTemplates(tenantId, updated);
  return fetchTenantTemplates(tenantId);
}

export async function renameCustomTemplate(templateKey, newName, newDescription, tenantIdInput = null) {
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase
        .from("invoice_templates")
        .update({
          template_name: newName,
          description: newDescription,
          updated_at: new Date().toISOString()
        })
        .or(`tenant_id.eq.${tenantId},organization_id.eq.${tenantId}`)
        .eq("template_key", templateKey);
    } catch {
      // Fallback
    }
  }

  const current = getFallbackTemplates(tenantId);
  const updated = current.map((t) =>
    t.template_key === templateKey ? { ...t, name: newName, template_name: newName, description: newDescription } : t
  );
  saveFallbackTemplates(tenantId, updated);
  return fetchTenantTemplates(tenantId);
}

export async function deleteCustomTemplate(templateKey, tenantIdInput = null) {
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";

  // Prevent deleting builtin system templates
  if (BUILTIN_TEMPLATES.some((b) => b.template_key === templateKey)) {
    throw new Error("System-provided templates cannot be deleted.");
  }

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase
        .from("invoice_templates")
        .delete()
        .or(`tenant_id.eq.${tenantId},organization_id.eq.${tenantId}`)
        .eq("template_key", templateKey);
    } catch {
      // Fallback
    }
  }

  const current = getFallbackTemplates(tenantId);
  const updated = current.filter((t) => t.template_key !== templateKey);
  saveFallbackTemplates(tenantId, updated);
  return fetchTenantTemplates(tenantId);
}

export async function setTemplateAsDefault(templateKey, tenantIdInput = null) {
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";
  
  if (isSupabaseConfigured && supabase) {
    try {
      // Unset previous defaults
      await supabase
        .from("invoice_templates")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .or(`tenant_id.eq.${tenantId},organization_id.eq.${tenantId}`);

      // Set new default
      await supabase
        .from("invoice_templates")
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .or(`tenant_id.eq.${tenantId},organization_id.eq.${tenantId}`)
        .eq("template_key", templateKey);
    } catch {
      // Non-blocking fallback
    }
  }

  // Update fallback storage
  const current = getFallbackTemplates(tenantId);
  const updated = current.map((t) => ({
    ...t,
    is_default: t.template_key === templateKey
  }));
  saveFallbackTemplates(tenantId, updated);
  lsSetOrganizationScoped(`${LOCAL_STORAGE_DEFAULT_TEMPLATE_KEY}_${tenantId}`, templateKey);
  ssSet(LOCAL_STORAGE_DEFAULT_TEMPLATE_KEY, templateKey);
  return fetchTenantTemplates(tenantId);
}

export async function toggleTemplateActive(templateKey, isActive, tenantIdInput = null) {
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";
  
  if (isSupabaseConfigured && supabase) {
    try {
      await supabase
        .from("invoice_templates")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .or(`tenant_id.eq.${tenantId},organization_id.eq.${tenantId}`)
        .eq("template_key", templateKey);
    } catch {
      // Non-blocking fallback
    }
  }

  const current = getFallbackTemplates(tenantId);
  const updated = current.map((t) => (t.template_key === templateKey ? { ...t, is_active: isActive } : t));
  saveFallbackTemplates(tenantId, updated);
  return fetchTenantTemplates(tenantId);
}

export function getDefaultTemplateKey(tenantIdInput = null) {
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";
  const sessionDefault = ssGet(LOCAL_STORAGE_DEFAULT_TEMPLATE_KEY, null);
  if (sessionDefault) return sessionDefault;

  const scopedDefault = lsGetOrganizationScoped(`${LOCAL_STORAGE_DEFAULT_TEMPLATE_KEY}_${tenantId}`, null);
  if (scopedDefault) return scopedDefault;

  const templates = getFallbackTemplates(tenantId);
  const def = templates.find((t) => t.is_default && t.is_active) || templates.find((t) => t.is_active) || templates[0];
  return def?.template_key || "modern_gst";
}

export function getCustomTemplateByKey(templateKey, tenantIdInput = null) {
  if (!templateKey) return null;
  const tenantId = tenantIdInput || authGetOrganizationId() || "default_tenant";
  const stored = getFallbackTemplates(tenantId);
  return stored.find((t) => t.template_key === templateKey || t.id === templateKey) || null;
}

