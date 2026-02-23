import { authGetOrganizationId, authGetRole, authGetUser } from "./auth.service";
import { fromDbRole, isOwnerRole, toDbRole } from "./roles";
import { LS_KEYS, lsGet, lsGetUserScoped, lsRemove, lsSet, lsSetUserScoped } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { setInvoiceTemplateCompleted } from "../lib/templateStore";

export const COUNTRIES = ["India", "Sri Lanka", "UAE", "USA", "United Kingdom", "Ireland"];
export const ORGANIZATION_UPDATED_EVENT = "organization:updated";

const COUNTRY_NAME_TO_CODE = {
  India: "IN",
  "Sri Lanka": "LK",
  UAE: "AE",
  USA: "US",
  "United Kingdom": "GB",
  Ireland: "IE"
};

const COUNTRY_CODE_TO_NAME = {
  IN: "India",
  LK: "Sri Lanka",
  AE: "UAE",
  US: "USA",
  GB: "United Kingdom",
  IE: "Ireland"
};

function getCountryCode(countryName) {
  return COUNTRY_NAME_TO_CODE[countryName] || "IN";
}

function getCountryName(countryCode) {
  return COUNTRY_CODE_TO_NAME[String(countryCode || "").toUpperCase()] || "India";
}

function emitOrganizationUpdated(profile = null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ORGANIZATION_UPDATED_EVENT, {
      detail: profile || companyGetProfile() || null
    })
  );
}

function normalizeProfileCountry(profile = {}) {
  const fromProfileCode = String(profile?.countryCode || "").trim().toUpperCase();
  const fromProfileCountry = String(profile?.country || "").trim();
  const normalizedCountry = fromProfileCountry || getCountryName(fromProfileCode);
  const normalizedCode = fromProfileCode || getCountryCode(normalizedCountry);
  return {
    country: normalizedCountry || "India",
    countryCode: normalizedCode || "IN"
  };
}

function deriveTaxRegime(country) {
  if (country === "India") return "gst";
  if (["Sri Lanka", "UAE", "United Kingdom", "Ireland"].includes(country)) return "vat";
  if (country === "USA") return "sales_tax";
  return "none";
}

function mapOrganizationToProfile(organization, taxProfile = null) {
  if (!organization) return null;
  const country = getCountryName(organization.country_code);
  const baseCurrency = organization.base_currency || "INR";

  return {
    companyName: organization.company_name || "",
    logoBase64: organization.logo_base64 || "",
    country,
    countryCode: String(organization.country_code || getCountryCode(country)).toUpperCase(),
    currency: baseCurrency,
    currencies: [baseCurrency, ...(organization?.settings?.currencies || [])]
      .map((entry) => String(entry || "").trim().toUpperCase())
      .filter(Boolean)
      .filter((entry, index, arr) => arr.indexOf(entry) === index)
      .slice(0, 3),
    phone: organization.phone || "",
    email: organization.email || "",
    ownerRole: fromDbRole(organization?.settings?.owner_role || "owner"),
    address: {
      line1: organization.address_line1 || "",
      line2: organization.address_line2 || "",
      city: organization.city || "",
      state: organization.state_name || "",
      postalCode: organization.postal_code || ""
    },
    tax: {
      gstin: organization.gstin || taxProfile?.gstin || "",
      vatNumber: taxProfile?.vat_number || "",
      vatRate: Number(taxProfile?.default_output_tax_rate || 0),
      taxId: taxProfile?.tax_id || organization.pan || ""
    },
    settings: organization.settings || {},
    created_at: organization.created_at,
    updated_at: organization.updated_at
  };
}

function mapProfileToOrganizationPayload(profile, userId, existingOrgId = "") {
  const countryData = normalizeProfileCountry(profile);
  const country = countryData.country;
  const currency = profile?.currency || profile?.currencies?.[0] || "INR";

  return {
    id: existingOrgId || undefined,
    owner_user_id: userId,
    company_name: profile?.companyName || "",
    logo_base64: profile?.logoBase64 || "",
    country_code: countryData.countryCode,
    state_name: profile?.address?.state || "",
    city: profile?.address?.city || "",
    address_line1: profile?.address?.line1 || "",
    address_line2: profile?.address?.line2 || "",
    postal_code: profile?.address?.postalCode || "",
    phone: profile?.phone || "",
    email: profile?.email || "",
    gstin: profile?.tax?.gstin || "",
    pan: profile?.tax?.taxId || "",
    tax_regime: deriveTaxRegime(country),
    base_currency: String(currency).toUpperCase(),
    is_setup_completed: true,
    settings: {
      ...(profile?.settings || {}),
      owner_role: toDbRole(authGetRole()),
      currencies: Array.isArray(profile?.currencies) ? profile.currencies : [currency]
    },
    updated_at: new Date().toISOString()
  };
}

function mapProfileToTaxPayload(profile, organizationId) {
  const countryData = normalizeProfileCountry(profile);
  const country = countryData.country;
  const tax = profile?.tax || {};

  return {
    organization_id: organizationId,
    country_code: countryData.countryCode,
    tax_regime: deriveTaxRegime(country),
    gstin: tax.gstin || "",
    pan: tax.taxId || "",
    vat_number: tax.vatNumber || "",
    default_output_tax_rate: Number(tax.vatRate || 0),
    gst_split_mode: country === "India" ? "cgst_sgst_or_igst" : "not_applicable",
    is_gst_registered: country === "India" ? !!tax.gstin : false,
    updated_at: new Date().toISOString()
  };
}

function pickOrganization(payload) {
  const raw = payload?.organizations;
  if (Array.isArray(raw)) return raw[0] || null;
  return raw || null;
}

function pickTaxProfile(organization) {
  const raw = organization?.organization_tax_profiles;
  if (Array.isArray(raw)) return raw[0] || null;
  return raw || null;
}

function isQuotaExceededError(error) {
  return (
    error?.name === "QuotaExceededError" ||
    error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error?.code === 22 ||
    error?.code === 1014
  );
}

function trimHeavyProfileFields(profile) {
  const base = { ...(profile || {}) };
  base.logoBase64 = "";
  if (base?.settings && typeof base.settings === "object") {
    base.settings = { ...base.settings };
    if (base.settings?.profile && typeof base.settings.profile === "object") {
      base.settings.profile = { ...base.settings.profile, logoBase64: "" };
    }
    if (base.settings?.invoiceTemplate && typeof base.settings.invoiceTemplate === "object") {
      base.settings.invoiceTemplate = { ...base.settings.invoiceTemplate, logoUrl: "" };
    }
  }
  return base;
}

function persistProfileLocal(profile, { completedStatus = true } = {}) {
  let toPersist = profile;

  // Remove duplicated legacy copy to reduce storage usage.
  lsRemove(LS_KEYS.company_profile);

  try {
    lsSetUserScoped(LS_KEYS.company_profile, toPersist);
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    toPersist = trimHeavyProfileFields(profile);
    try {
      lsSetUserScoped(LS_KEYS.company_profile, toPersist);
    } catch (retryError) {
      if (!isQuotaExceededError(retryError)) throw retryError;
      throw new Error("Storage is full. Remove old local data and try again.");
    }
  }

  lsSetUserScoped(LS_KEYS.companyProfileCompleted, !!completedStatus);
  lsSet(LS_KEYS.companyProfileCompleted, !!completedStatus);
  return toPersist;
}

async function upsertMembershipDirectly({ organizationId, userId, role }) {
  const { error: memberError } = await supabase.from("organization_members").upsert(
    {
      organization_id: organizationId,
      user_id: userId,
      role,
      status: "active",
      joined_at: new Date().toISOString()
    },
    { onConflict: "organization_id,user_id" }
  );

  if (memberError?.code === "42501") {
    throw new Error(
      "Supabase RLS denied organization member create. Run supabase/fix_organizations_rls.sql in SQL Editor."
    );
  }
  if (memberError) throw new Error(memberError.message || "Failed to save organization membership");
}

async function getCurrentUserId() {
  if (!isSupabaseConfigured || !supabase) return "";
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id || "";
}

export function companyIsCompleted() {
  return !!lsGetUserScoped(LS_KEYS.companyProfileCompleted, false);
}

export function companySetCompleted(status) {
  lsSetUserScoped(LS_KEYS.companyProfileCompleted, !!status);
  lsSet(LS_KEYS.companyProfileCompleted, !!status);
  emitOrganizationUpdated();
}

export function companyGetProfile() {
  return lsGetUserScoped(LS_KEYS.company_profile, null);
}

export function companySaveProfile(profile) {
  const normalizedCountry = normalizeProfileCountry(profile || {});
  const normalizedProfile = {
    ...(profile || {}),
    country: normalizedCountry.country,
    countryCode: normalizedCountry.countryCode
  };
  const savedProfile = persistProfileLocal(normalizedProfile, { completedStatus: true });
  emitOrganizationUpdated(savedProfile);
  return savedProfile;
}

export function companyUpdateProfile(partial) {
  const prev = companyGetProfile() || {};
  const merged = { ...prev, ...partial, updated_at: new Date().toISOString() };
  const normalizedCountry = normalizeProfileCountry(merged);
  const next = {
    ...merged,
    country: normalizedCountry.country,
    countryCode: normalizedCountry.countryCode
  };
  const savedProfile = persistProfileLocal(next, { completedStatus: companyIsCompleted() });
  emitOrganizationUpdated(savedProfile);
  return savedProfile;
}

async function fetchOrganizationBundle(organizationId) {
  if (!organizationId) return null;

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationError || !organization) return null;

  const { data: taxProfile } = await supabase
    .from("organization_tax_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  return { organization, taxProfile: taxProfile || null };
}

export async function companyLoadMyOrganization(selectedOrganizationId = "") {
  if (!isSupabaseConfigured || !supabase) {
    return companyGetProfile();
  }

  const userId = await getCurrentUserId();
  if (!userId) return companyGetProfile();

  const activeOrganizationId = String(selectedOrganizationId || authGetOrganizationId() || "").trim();
  if (!activeOrganizationId) {
    return null;
  }

  const bundle = await fetchOrganizationBundle(activeOrganizationId);
  if (!bundle?.organization) return null;

  const organization = bundle.organization;
  const taxProfile = bundle.taxProfile;
  const profile = mapOrganizationToProfile(organization, taxProfile);
  if (!profile) return companyGetProfile();

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", activeOrganizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  lsSet(LS_KEYS.organization_id, activeOrganizationId);
  lsSetUserScoped(LS_KEYS.organization_id, activeOrganizationId, authGetUser()?.id);
  if (membership?.role) {
    lsSet(LS_KEYS.role, fromDbRole(membership.role));
  }
  const savedProfile = persistProfileLocal(profile, {
    completedStatus: !!organization?.is_setup_completed
  });
  setInvoiceTemplateCompleted(
    !!(
      organization?.settings?.invoice_template_selected ||
      organization?.settings?.invoiceTemplateSelected ||
      organization?.settings?.invoiceTemplate?.templateId
    )
  );
  emitOrganizationUpdated(savedProfile);
  return savedProfile;
}

export async function companySaveProfileRemote(profile, options = {}) {
  const forceCreate = !!options?.forceCreate;
  const previous = forceCreate ? {} : companyGetProfile() || {};
  const countryData = normalizeProfileCountry({
    country: profile?.country || previous?.country || "",
    countryCode: profile?.countryCode || previous?.countryCode || ""
  });
  const mergedProfile = {
    ...previous,
    ...profile,
    country: countryData.country,
    countryCode: countryData.countryCode,
    settings: {
      ...(previous.settings || {}),
      ...(profile?.settings || {})
    },
    currency: profile?.currencies?.[0] || profile?.currency || previous?.currency || "INR",
    updated_at: new Date().toISOString()
  };
  companySaveProfile(mergedProfile);

  if (!isSupabaseConfigured || !supabase) {
    const localOrganizationId = forceCreate
      ? `org_${Date.now().toString(16)}`
      : authGetOrganizationId() || "";
    lsSet(LS_KEYS.organization_id, localOrganizationId);
    lsSetUserScoped(LS_KEYS.organization_id, localOrganizationId, authGetUser()?.id);
    if (forceCreate) {
      setInvoiceTemplateCompleted(false);
      lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, false, authGetUser()?.id);
      lsSet(LS_KEYS.invoiceTemplateCompleted, false);
    }
    return { profile: mergedProfile, organizationId: localOrganizationId };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Login required before organization setup");
  }

  const existingOrgId = forceCreate ? "" : authGetOrganizationId();
  const payload = mapProfileToOrganizationPayload(mergedProfile, userId, existingOrgId);

  let organizationId = existingOrgId;

  if (existingOrgId) {
    const { error } = await supabase.from("organizations").update(payload).eq("id", existingOrgId);
    if (error?.code === "42501") {
      throw new Error(
        "Supabase RLS denied organization update. Run supabase/fix_organizations_rls.sql in SQL Editor."
      );
    }
    if (error) throw new Error(error.message || "Failed to update organization");
  } else {
    const generatedOrgId = payload.id || crypto.randomUUID();
    const { error } = await supabase
      .from("organizations")
      .insert({ ...payload, id: generatedOrgId, created_at: new Date().toISOString() });

    if (error?.code === "42501") {
      throw new Error(
        "Supabase RLS denied organization create. Run supabase/fix_organizations_rls.sql in SQL Editor."
      );
    }
    if (error) {
      throw new Error(error?.message || "Failed to create organization");
    }
    organizationId = generatedOrgId;
  }

  const ownerMode = isOwnerRole(authGetRole()) || toDbRole(authGetRole()) === "owner";
  if (ownerMode) {
    const { error: ownerMembershipError } = await supabase.rpc("ensure_owner_membership", {
      p_organization_id: organizationId
    });
    if (ownerMembershipError?.code === "PGRST202") {
      await upsertMembershipDirectly({ organizationId, userId, role: "owner" });
    } else if (ownerMembershipError) {
      throw new Error(
        ownerMembershipError?.message ||
          "Failed to create owner membership. Run supabase/fix_organizations_rls.sql in SQL Editor."
      );
    }
  } else {
    const memberRole = toDbRole(authGetRole());
    await upsertMembershipDirectly({ organizationId, userId, role: memberRole });
  }

  const taxPayload = mapProfileToTaxPayload(mergedProfile, organizationId);
  const { error: taxError } = await supabase
    .from("organization_tax_profiles")
    .upsert(taxPayload, { onConflict: "organization_id" });

  if (taxError) throw new Error(taxError.message || "Failed to save tax settings");

  lsSet(LS_KEYS.organization_id, organizationId);
  lsSetUserScoped(LS_KEYS.organization_id, organizationId, authGetUser()?.id);
  lsSetUserScoped(LS_KEYS.companyProfileCompleted, true, authGetUser()?.id);
  lsSet(LS_KEYS.companyProfileCompleted, true);
  if (forceCreate || !existingOrgId) {
    setInvoiceTemplateCompleted(false);
    lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, false, authGetUser()?.id);
    lsSet(LS_KEYS.invoiceTemplateCompleted, false);
  }

  return { profile: companyGetProfile(), organizationId };
}

function generateInviteCodeToken() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  const timestamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `BJ-${timestamp}-${random}`;
}

export async function organizationGenerateCode({ targetRole = "Accounter", maxUses = 10, expiresInDays = 30 }) {
  if (!isSupabaseConfigured || !supabase) {
    return {
      code: generateInviteCodeToken(),
      target_role: toDbRole(targetRole),
      max_uses: maxUses,
      expires_at: new Date(Date.now() + expiresInDays * 86400000).toISOString()
    };
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    throw new Error("Organization is not available. Complete setup first.");
  }

  const code = generateInviteCodeToken();
  const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();

  const { data, error } = await supabase
    .from("organization_invite_codes")
    .insert({
      organization_id: organizationId,
      code,
      target_role: toDbRole(targetRole),
      created_by: lsGet(LS_KEYS.auth_user, null)?.id || null,
      expires_at: expiresAt,
      max_uses: Math.max(1, Number(maxUses || 1)),
      used_count: 0,
      is_active: true
    })
    .select("id, code, target_role, expires_at, max_uses, used_count, is_active")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to generate register code");
  }

  return data;
}

export async function organizationListActiveCodes(limit = 10) {
  if (!isSupabaseConfigured || !supabase) return [];

  const organizationId = authGetOrganizationId();
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from("organization_invite_codes")
    .select("id, code, target_role, expires_at, max_uses, used_count, is_active, created_at")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) return [];
  return data;
}

export function companyGetCountryCode(countryName) {
  return getCountryCode(countryName);
}

export function companyGetCountryName(countryCode) {
  return getCountryName(countryCode);
}
