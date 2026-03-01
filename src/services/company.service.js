import { authGetOrganizationId, authGetRole, authGetUser } from "./auth.service";
import { fromDbRole, isOwnerRole, toDbRole } from "./roles";
import {
  LS_KEYS,
  lsGetUserScoped,
  lsGetOrganizationScoped,
  lsRemove,
  lsSet,
  lsSetOrganizationScoped,
  lsSetUserScoped,
  ssGet,
  ssSet
} from "./storage";
import {
  createSupabaseClientWithAccessToken,
  isSupabaseConfigured,
  supabase
} from "./supabaseClient";
import { setInvoiceTemplateCompleted } from "../lib/templateStore";

export const COUNTRIES = ["India", "Sri Lanka", "UAE", "USA", "United Kingdom", "Ireland"];
export const ORGANIZATION_UPDATED_EVENT = "organization:updated";
const COMPANY_SETTINGS_TABLE = "company_settings";

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

const COMPANY_LOGO_BUCKET_CANDIDATES = ["company-assets", "company-logos", "organization-assets"];
const LOGO_MIME_TO_EXTENSION = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg"
};

const DEFAULT_ROLE_PERMISSIONS = {
  Owner: { create: true, edit: true, delete: true, reports: true, approvals: true },
  Accounter: { create: true, edit: true, delete: false, reports: true, approvals: true },
  Staff: { create: true, edit: false, delete: false, reports: false, approvals: false }
};
const DOCUMENT_PREFIX_BASE = {
  invoice: "INV",
  purchase: "BILL",
  creditNote: "CN",
  debitNote: "DN",
  paymentIn: "PR",
  paymentOut: "PO"
};

function normalizeDocumentType(value) {
  const key = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(DOCUMENT_PREFIX_BASE, key) ? key : "";
}

function buildDefaultDocumentPrefix(documentType, countryName = "India") {
  const key = normalizeDocumentType(documentType);
  const base = DOCUMENT_PREFIX_BASE[key] || "DOC";
  const code = getCountryCode(countryName);
  return `${base}-${code}-0001`;
}

function formatDocumentNumber(prefix, counter) {
  const safePrefix = String(prefix || "").trim();
  const safeCounter = Math.max(1, Number(counter) || 1);
  const trailingDigits = safePrefix.match(/^(.*?)(\d+)$/);
  if (trailingDigits) {
    const head = trailingDigits[1];
    const width = trailingDigits[2].length;
    return `${head}${String(safeCounter).padStart(width, "0")}`;
  }
  return `${safePrefix}${safeCounter}`;
}

function nextNumberingStateForYear(numbering = {}) {
  const next = numbering && typeof numbering === "object" ? { ...numbering } : {};
  if (!next.resetYearly) return next;
  const nowYear = new Date().getFullYear();
  const lastResetYear = Number(next.lastResetYear || 0);
  if (lastResetYear === nowYear) return next;
  const counters = next.counters && typeof next.counters === "object" ? { ...next.counters } : {};
  Object.keys(DOCUMENT_PREFIX_BASE).forEach((key) => {
    counters[key] = 1;
  });
  next.counters = counters;
  next.lastResetYear = nowYear;
  return next;
}

function resolveSupabaseClient(accessToken = "") {
  if (!isSupabaseConfigured || !supabase) return null;
  return createSupabaseClientWithAccessToken(accessToken) || supabase;
}

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

function normalizeSupabaseError(error, fallback) {
  if (error?.code === "42501") {
    return `${fallback}. Supabase RLS denied access. Verify organization membership and policies.`;
  }
  return error?.message || fallback;
}

function isMissingRelationError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || message.includes("does not exist");
}

function normalizeRolePermissions(value) {
  const source = value && typeof value === "object" ? value : {};
  const next = {};
  Object.keys(DEFAULT_ROLE_PERMISSIONS).forEach((role) => {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role];
    const row = source[role] && typeof source[role] === "object" ? source[role] : {};
    next[role] = {
      create: row.create ?? defaults.create,
      edit: row.edit ?? defaults.edit,
      delete: row.delete ?? defaults.delete,
      reports: row.reports ?? defaults.reports,
      approvals: row.approvals ?? defaults.approvals
    };
  });
  return next;
}

function sanitizeSettingsPayload(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const preferences =
    source.preferences && typeof source.preferences === "object" ? source.preferences : null;
  if (!preferences || !Object.prototype.hasOwnProperty.call(preferences, "api")) {
    return { settings: source, changed: false };
  }
  const nextPreferences = { ...preferences };
  delete nextPreferences.api;
  return {
    settings: {
      ...source,
      preferences: nextPreferences
    },
    changed: true
  };
}

function normalizeMemberStatus(value) {
  return String(value || "").trim().toLowerCase() === "inactive" ? "Inactive" : "Active";
}

function toDbMemberStatus(value) {
  return normalizeMemberStatus(value).toLowerCase();
}

function normalizeLogoMime(mime = "") {
  return String(mime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isSupportedLogoMime(mime = "") {
  return !!LOGO_MIME_TO_EXTENSION[normalizeLogoMime(mime)];
}

function isDataUrl(value = "") {
  return /^data:/i.test(String(value || "").trim());
}

function getDataUrlMime(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:([^;,]+)[;,]/i);
  return normalizeLogoMime(match?.[1] || "");
}

function appendVersionQuery(url = "", version = Date.now()) {
  const safe = String(url || "").trim();
  if (!safe) return "";
  const clean = safe.replace(/([?&])v=\d+(&?)/g, (full, prefix, tail) => (tail ? prefix : ""));
  const normalized = clean.endsWith("?") || clean.endsWith("&") ? clean.slice(0, -1) : clean;
  const separator = normalized.includes("?") ? "&" : "?";
  return `${normalized}${separator}v=${Number(version) || Date.now()}`;
}

async function prepareLogoUploadPayload({ logoValue = "", logoFile = null }) {
  if (logoFile && typeof logoFile === "object") {
    const mime = normalizeLogoMime(logoFile.type || "");
    if (!isSupportedLogoMime(mime)) {
      return { error: "Only PNG, JPG, JPEG or SVG logos are supported." };
    }
    return {
      blob: logoFile,
      mime,
      extension: LOGO_MIME_TO_EXTENSION[mime] || "png"
    };
  }

  if (!isDataUrl(logoValue)) return { skip: true };

  const mime = getDataUrlMime(logoValue);
  if (!isSupportedLogoMime(mime)) {
    return { error: "Only PNG, JPG, JPEG or SVG logos are supported." };
  }

  try {
    const response = await fetch(String(logoValue));
    const blob = await response.blob();
    return {
      blob,
      mime,
      extension: LOGO_MIME_TO_EXTENSION[mime] || "png"
    };
  } catch {
    return { error: "Unable to process selected logo image." };
  }
}

async function uploadCompanyLogoToStorage({
  logoValue = "",
  logoFile = null,
  organizationId = "",
  userId = "",
  supabaseClient = null
}) {
  const client = supabaseClient || supabase;
  if (!isSupabaseConfigured || !client) {
    return { logoValue };
  }

  const payload = await prepareLogoUploadPayload({ logoValue, logoFile });
  if (payload.skip) return { logoValue };
  if (payload.error) return { logoValue, warning: payload.error };

  const scopedId = String(organizationId || userId || "org").trim();
  const filePath = `organizations/${scopedId}/logo`;
  const version = Date.now();

  let lastError = "";
  for (const bucket of COMPANY_LOGO_BUCKET_CANDIDATES) {
    const { error: uploadError } = await client.storage
      .from(bucket)
      .upload(filePath, payload.blob, {
        upsert: true,
        contentType: payload.mime,
        cacheControl: "3600"
      });

    if (uploadError) {
      lastError = uploadError.message || "Upload failed";
      continue;
    }

    const { data } = client.storage.from(bucket).getPublicUrl(filePath);
    const publicUrl = data?.publicUrl || "";
    if (publicUrl) return { logoValue: appendVersionQuery(publicUrl, version) };
    return { logoValue: appendVersionQuery(logoValue, version) };
  }

  return {
    logoValue,
    warning:
      (lastError ? `${lastError}. ` : "") +
      "Failed to upload logo to storage. Run supabase/create_company_assets_bucket.sql and try again."
  };
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
    lsSetOrganizationScoped(LS_KEYS.company_profile, toPersist);
    lsSetUserScoped(LS_KEYS.company_profile, toPersist);
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    toPersist = trimHeavyProfileFields(profile);
    try {
      lsSetOrganizationScoped(LS_KEYS.company_profile, toPersist);
      lsSetUserScoped(LS_KEYS.company_profile, toPersist);
    } catch (retryError) {
      if (!isQuotaExceededError(retryError)) throw retryError;
      throw new Error("Storage is full. Remove old local data and try again.");
    }
  }

  lsSetOrganizationScoped(LS_KEYS.companyProfileCompleted, !!completedStatus);
  lsSetUserScoped(LS_KEYS.companyProfileCompleted, !!completedStatus);
  lsSet(LS_KEYS.companyProfileCompleted, !!completedStatus);
  ssSet(LS_KEYS.companyProfileCompleted, !!completedStatus);
  return toPersist;
}

async function upsertMembershipDirectly({ organizationId, userId, role, supabaseClient = null }) {
  const client = supabaseClient || supabase;
  const { error: memberError } = await client.from("organization_members").upsert(
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

async function getCurrentUserId(supabaseClient = null) {
  const client = supabaseClient || supabase;
  if (!isSupabaseConfigured || !client) return "";
  const {
    data: { user }
  } = await client.auth.getUser();
  return user?.id || "";
}

export function companyIsCompleted() {
  const sessionValue = ssGet(LS_KEYS.companyProfileCompleted, null);
  if (typeof sessionValue === "boolean") return sessionValue;
  const orgScoped = lsGetOrganizationScoped(LS_KEYS.companyProfileCompleted, null);
  if (typeof orgScoped === "boolean") return orgScoped;
  return !!lsGetUserScoped(LS_KEYS.companyProfileCompleted, false);
}

export function companySetCompleted(status) {
  lsSetOrganizationScoped(LS_KEYS.companyProfileCompleted, !!status);
  lsSetUserScoped(LS_KEYS.companyProfileCompleted, !!status);
  lsSet(LS_KEYS.companyProfileCompleted, !!status);
  ssSet(LS_KEYS.companyProfileCompleted, !!status);
  emitOrganizationUpdated();
}

export function companyGetProfile() {
  const orgScoped = lsGetOrganizationScoped(LS_KEYS.company_profile, null);
  if (orgScoped) return orgScoped;
  return lsGetUserScoped(LS_KEYS.company_profile, null);
}

export function companySaveProfile(profile) {
  const normalizedCountry = normalizeProfileCountry(profile || {});
  const { settings: sanitizedSettings } = sanitizeSettingsPayload(profile?.settings || {});
  const normalizedProfile = {
    ...(profile || {}),
    country: normalizedCountry.country,
    countryCode: normalizedCountry.countryCode,
    settings: sanitizedSettings
  };
  const savedProfile = persistProfileLocal(normalizedProfile, { completedStatus: true });
  emitOrganizationUpdated(normalizedProfile);
  return savedProfile;
}

export function companyUpdateProfile(partial) {
  const prev = companyGetProfile() || {};
  const merged = { ...prev, ...partial, updated_at: new Date().toISOString() };
  const normalizedCountry = normalizeProfileCountry(merged);
  const { settings: sanitizedSettings } = sanitizeSettingsPayload(merged?.settings || {});
  const next = {
    ...merged,
    country: normalizedCountry.country,
    countryCode: normalizedCountry.countryCode,
    settings: sanitizedSettings
  };
  const savedProfile = persistProfileLocal(next, { completedStatus: companyIsCompleted() });
  emitOrganizationUpdated(next);
  return savedProfile;
}

export function companyPeekDocumentNumber(documentType) {
  const key = normalizeDocumentType(documentType);
  if (!key) return "";
  const profile = companyGetProfile() || {};
  const settings = profile?.settings && typeof profile.settings === "object" ? profile.settings : {};
  const numberingBase = settings?.numbering && typeof settings.numbering === "object" ? settings.numbering : {};
  const numbering = nextNumberingStateForYear(numberingBase);
  const prefixes = numbering?.prefixes && typeof numbering.prefixes === "object" ? numbering.prefixes : {};
  const counters = numbering?.counters && typeof numbering.counters === "object" ? numbering.counters : {};
  const prefix = String(prefixes[key] || buildDefaultDocumentPrefix(key, profile?.country || "India"));
  const counter = toPositiveCounter(counters[key], 1);
  return formatDocumentNumber(prefix, counter);
}

export function companyConsumeDocumentNumber(documentType) {
  const key = normalizeDocumentType(documentType);
  if (!key) return "";
  const profile = companyGetProfile() || {};
  const settings = profile?.settings && typeof profile.settings === "object" ? profile.settings : {};
  const numberingBase = settings?.numbering && typeof settings.numbering === "object" ? settings.numbering : {};
  const numbering = nextNumberingStateForYear(numberingBase);
  const prefixes = numbering?.prefixes && typeof numbering.prefixes === "object" ? numbering.prefixes : {};
  const counters = numbering?.counters && typeof numbering.counters === "object" ? numbering.counters : {};
  const prefix = String(prefixes[key] || buildDefaultDocumentPrefix(key, profile?.country || "India"));
  const currentCounter = toPositiveCounter(counters[key], 1);
  const currentNumber = formatDocumentNumber(prefix, currentCounter);

  if (numbering.autoIncrement === false) {
    return currentNumber;
  }

  const nextCounters = {
    ...counters,
    [key]: currentCounter + 1
  };
  const nextSettings = {
    ...settings,
    numbering: {
      ...numbering,
      prefixes: {
        ...prefixes,
        [key]: prefix
      },
      counters: nextCounters
    }
  };
  companyUpdateProfile({ settings: nextSettings });
  return currentNumber;
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

async function fetchCompanySettingsRow(organizationId, supabaseClient = null) {
  const client = supabaseClient || supabase;
  if (!isSupabaseConfigured || !client || !organizationId) return null;
  const { data, error } = await client
    .from(COMPANY_SETTINGS_TABLE)
    .select("settings")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw new Error(normalizeSupabaseError(error, "Failed to load company settings"));
  }
  return data?.settings && typeof data.settings === "object" ? data.settings : null;
}

async function upsertCompanySettingsRow({ organizationId, settings, updatedBy, supabaseClient = null }) {
  const client = supabaseClient || supabase;
  if (!isSupabaseConfigured || !client || !organizationId) return;
  const payload = settings && typeof settings === "object" ? settings : {};
  const { error } = await client.from(COMPANY_SETTINGS_TABLE).upsert(
    {
      organization_id: organizationId,
      settings: payload,
      updated_by: updatedBy || null
    },
    { onConflict: "organization_id" }
  );

  if (error) {
    if (isMissingRelationError(error)) return;
    throw new Error(normalizeSupabaseError(error, "Failed to save company settings"));
  }
}

function mapDocumentSequencesRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    numbering: {
      resetYearly: !!row.reset_yearly,
      prefixes: {
        invoice: row.invoice_prefix || "INV",
        purchase: row.purchase_prefix || "BILL",
        creditNote: row.credit_note_prefix || "CN",
        debitNote: row.debit_note_prefix || "DN",
        paymentIn: row.payment_in_prefix || "RCPT",
        paymentOut: row.payment_out_prefix || "PAY"
      },
      counters: {
        invoice: Number(row.invoice_next_no || 1),
        purchase: Number(row.purchase_next_no || 1),
        creditNote: Number(row.credit_note_next_no || 1),
        debitNote: Number(row.debit_note_next_no || 1),
        paymentIn: Number(row.payment_in_next_no || 1),
        paymentOut: Number(row.payment_out_next_no || 1)
      }
    }
  };
}

function toPositiveCounter(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return Math.max(1, Number(fallback) || 1);
  return Math.trunc(numeric);
}

async function fetchDocumentSequences(organizationId, supabaseClient = null) {
  const client = supabaseClient || supabase;
  if (!isSupabaseConfigured || !client || !organizationId) return null;
  const { data, error } = await client
    .from("organization_document_sequences")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw new Error(normalizeSupabaseError(error, "Failed to load document numbering"));
  }
  return mapDocumentSequencesRow(data);
}

async function upsertDocumentSequences(organizationId, numbering = {}, supabaseClient = null) {
  const client = supabaseClient || supabase;
  if (!isSupabaseConfigured || !client || !organizationId) return;
  const prefixes = numbering?.prefixes || {};
  const counters = numbering?.counters || {};
  const payload = {
    organization_id: organizationId,
    invoice_prefix: String(prefixes.invoice || "INV"),
    invoice_next_no: toPositiveCounter(counters.invoice, 1),
    purchase_prefix: String(prefixes.purchase || "BILL"),
    purchase_next_no: toPositiveCounter(counters.purchase, 1),
    credit_note_prefix: String(prefixes.creditNote || "CN"),
    credit_note_next_no: toPositiveCounter(counters.creditNote, 1),
    debit_note_prefix: String(prefixes.debitNote || "DN"),
    debit_note_next_no: toPositiveCounter(counters.debitNote, 1),
    payment_in_prefix: String(prefixes.paymentIn || "RCPT"),
    payment_in_next_no: toPositiveCounter(counters.paymentIn, 1),
    payment_out_prefix: String(prefixes.paymentOut || "PAY"),
    payment_out_next_no: toPositiveCounter(counters.paymentOut, 1),
    reset_yearly: !!numbering?.resetYearly,
    updated_at: new Date().toISOString()
  };

  const { error } = await client
    .from("organization_document_sequences")
    .upsert(payload, { onConflict: "organization_id" });

  if (error) {
    if (isMissingRelationError(error)) return;
    throw new Error(normalizeSupabaseError(error, "Failed to save document numbering"));
  }
}

async function fetchOrganizationMembersDetailed(organizationId, supabaseClient = null) {
  const client = supabaseClient || supabase;
  if (!isSupabaseConfigured || !client || !organizationId) return [];

  const { data: members, error: memberError } = await client
    .from("organization_members")
    .select("id, user_id, role, status, joined_at, created_at")
    .eq("organization_id", organizationId)
    .order("joined_at", { ascending: true });

  if (memberError || !Array.isArray(members)) {
    if (isMissingRelationError(memberError)) return [];
    throw new Error(normalizeSupabaseError(memberError, "Failed to load organization users"));
  }

  const userIds = members.map((entry) => entry?.user_id).filter(Boolean);
  let profilesById = {};
  if (userIds.length) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    profilesById = (Array.isArray(profiles) ? profiles : []).reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});
  }

  return members.map((entry) => {
    const profile = profilesById[entry.user_id] || {};
    const email = profile?.email || "";
    const fallbackName = email ? email.split("@")[0] : String(entry.user_id || "User").slice(0, 8);
    return {
      id: entry?.id || entry?.user_id || `member_${Date.now().toString(16)}`,
      userId: entry?.user_id || "",
      name: profile?.full_name || fallbackName,
      email,
      role: fromDbRole(entry?.role),
      status: normalizeMemberStatus(entry?.status),
      joinedAt: entry?.joined_at || entry?.created_at || ""
    };
  });
}

function withMergedSettings(baseProfile, settingsPatch = null, sequencePatch = null) {
  const base = baseProfile || {};
  const baseSettings = base?.settings && typeof base.settings === "object" ? base.settings : {};
  const merged = {
    ...baseSettings,
    ...(settingsPatch && typeof settingsPatch === "object" ? settingsPatch : {})
  };

  if (sequencePatch?.numbering) {
    merged.numbering = {
      ...(merged.numbering || {}),
      ...sequencePatch.numbering,
      prefixes: {
        ...(merged.numbering?.prefixes || {}),
        ...(sequencePatch.numbering?.prefixes || {})
      },
      counters: {
        ...(merged.numbering?.counters || {}),
        ...(sequencePatch.numbering?.counters || {})
      }
    };
  }

  if (merged?.users?.roles) {
    merged.users = {
      ...(merged.users || {}),
      roles: normalizeRolePermissions(merged.users.roles)
    };
  }
  const { settings: sanitizedSettings } = sanitizeSettingsPayload(merged);

  return {
    ...base,
    settings: sanitizedSettings
  };
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
  let profile = mapOrganizationToProfile(organization, taxProfile);
  if (!profile) return companyGetProfile();
  let settingsRow = null;

  try {
    const [fetchedSettingsRow, sequenceSettings] = await Promise.all([
      fetchCompanySettingsRow(activeOrganizationId),
      fetchDocumentSequences(activeOrganizationId)
    ]);
    settingsRow = fetchedSettingsRow;
    profile = withMergedSettings(profile, settingsRow, sequenceSettings);
  } catch {
    // Use organization payload as fallback when optional settings tables/functions are unavailable.
  }

  const deprecatedInOrgSettings = sanitizeSettingsPayload(organization?.settings || {}).changed;
  const deprecatedInSettingsRow = sanitizeSettingsPayload(settingsRow || {}).changed;
  if (deprecatedInOrgSettings || deprecatedInSettingsRow) {
    try {
      const cleanedSettings =
        profile?.settings && typeof profile.settings === "object" ? profile.settings : {};
      await upsertCompanySettingsRow({
        organizationId: activeOrganizationId,
        settings: cleanedSettings,
        updatedBy: userId || null,
        supabaseClient: supabase
      });
      await supabase
        .from("organizations")
        .update({
          settings: cleanedSettings,
          updated_at: new Date().toISOString()
        })
        .eq("id", activeOrganizationId);
    } catch {
      // Keep load flow resilient; cleanup will retry on next load.
    }
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", activeOrganizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  lsSet(LS_KEYS.organization_id, activeOrganizationId);
  ssSet(LS_KEYS.organization_id, activeOrganizationId);
  lsSetUserScoped(LS_KEYS.organization_id, activeOrganizationId, authGetUser()?.id);
  if (membership?.role) {
    lsSet(LS_KEYS.role, fromDbRole(membership.role));
    ssSet(LS_KEYS.role, fromDbRole(membership.role));
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
  emitOrganizationUpdated(profile);
  return profile;
}

export async function companySaveProfileRemote(profile, options = {}) {
  const forceCreate = !!options?.forceCreate;
  const logoFile = options?.logoFile || null;
  const accessToken = String(options?.accessToken || "").trim();
  const supabaseClient = resolveSupabaseClient(accessToken);
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
  const { settings: sanitizedSettings } = sanitizeSettingsPayload(mergedProfile?.settings || {});
  mergedProfile.settings = sanitizedSettings;

  if (!isSupabaseConfigured || !supabaseClient) {
    companySaveProfile(mergedProfile);
    const localOrganizationId = forceCreate
      ? `org_${Date.now().toString(16)}`
      : authGetOrganizationId() || "";
    lsSet(LS_KEYS.organization_id, localOrganizationId);
    ssSet(LS_KEYS.organization_id, localOrganizationId);
    lsSetUserScoped(LS_KEYS.organization_id, localOrganizationId, authGetUser()?.id);
    if (forceCreate) {
      setInvoiceTemplateCompleted(false);
      lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, false, authGetUser()?.id);
      lsSet(LS_KEYS.invoiceTemplateCompleted, false);
      ssSet(LS_KEYS.invoiceTemplateCompleted, false);
    }
    return { profile: mergedProfile, organizationId: localOrganizationId, logoUrl: mergedProfile.logoBase64 };
  }

  const userId = await getCurrentUserId(supabaseClient);
  if (!userId) {
    throw new Error("Login required before organization setup");
  }

  const existingOrgId = forceCreate ? "" : authGetOrganizationId();
  const targetOrganizationId = existingOrgId || crypto.randomUUID();
  const warnings = [];

  const uploadedLogo = await uploadCompanyLogoToStorage({
    logoValue: mergedProfile.logoBase64,
    logoFile,
    organizationId: targetOrganizationId,
    userId,
    supabaseClient
  });
  if (uploadedLogo.warning) {
    warnings.push(uploadedLogo.warning);
  }
  mergedProfile.logoBase64 = uploadedLogo.logoValue || mergedProfile.logoBase64 || "";

  companySaveProfile(mergedProfile);
  const payload = mapProfileToOrganizationPayload(mergedProfile, userId, targetOrganizationId);

  let organizationId = targetOrganizationId;

  if (existingOrgId) {
    const { error } = await supabaseClient.from("organizations").update(payload).eq("id", existingOrgId);
    if (error?.code === "42501") {
      throw new Error(
        "Supabase RLS denied organization update. Run supabase/fix_organizations_rls.sql in SQL Editor."
      );
    }
    if (error) throw new Error(error.message || "Failed to update organization");
  } else {
    const generatedOrgId = payload.id || crypto.randomUUID();
    const { error } = await supabaseClient
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
    organizationId = generatedOrgId || targetOrganizationId;
  }

  const ownerMode = isOwnerRole(authGetRole()) || toDbRole(authGetRole()) === "owner";
  if (ownerMode) {
    const { error: ownerMembershipError } = await supabaseClient.rpc("ensure_owner_membership", {
      p_organization_id: organizationId
    });
    if (ownerMembershipError?.code === "PGRST202") {
      await upsertMembershipDirectly({ organizationId, userId, role: "owner", supabaseClient });
    } else if (ownerMembershipError) {
      throw new Error(
        ownerMembershipError?.message ||
          "Failed to create owner membership. Run supabase/fix_organizations_rls.sql in SQL Editor."
      );
    }
  } else {
    const memberRole = toDbRole(authGetRole());
    await upsertMembershipDirectly({ organizationId, userId, role: memberRole, supabaseClient });
  }

  const taxPayload = mapProfileToTaxPayload(mergedProfile, organizationId);
  const { error: taxError } = await supabaseClient
    .from("organization_tax_profiles")
    .upsert(taxPayload, { onConflict: "organization_id" });

  if (taxError) throw new Error(taxError.message || "Failed to save tax settings");

  try {
    await upsertCompanySettingsRow({
      organizationId,
      settings: mergedProfile?.settings || {},
      updatedBy: userId,
      supabaseClient
    });
    await upsertDocumentSequences(organizationId, mergedProfile?.settings?.numbering || {}, supabaseClient);
  } catch (settingsError) {
    warnings.push(settingsError?.message || "Failed to sync company settings table.");
  }

  lsSet(LS_KEYS.organization_id, organizationId);
  ssSet(LS_KEYS.organization_id, organizationId);
  lsSetUserScoped(LS_KEYS.organization_id, organizationId, authGetUser()?.id);
  lsSetUserScoped(LS_KEYS.companyProfileCompleted, true, authGetUser()?.id);
  lsSet(LS_KEYS.companyProfileCompleted, true);
  ssSet(LS_KEYS.companyProfileCompleted, true);
  if (forceCreate || !existingOrgId) {
    setInvoiceTemplateCompleted(false);
    lsSetUserScoped(LS_KEYS.invoiceTemplateCompleted, false, authGetUser()?.id);
    lsSet(LS_KEYS.invoiceTemplateCompleted, false);
    ssSet(LS_KEYS.invoiceTemplateCompleted, false);
  }

  return {
    profile: mergedProfile,
    organizationId,
    logoUrl: mergedProfile.logoBase64 || "",
    warnings
  };
}

export async function organizationListUsers(options = {}) {
  const accessToken = String(options?.accessToken || "").trim();
  const supabaseClient = options?.supabaseClient || resolveSupabaseClient(accessToken);
  const organizationId = authGetOrganizationId();
  if (!organizationId) return [];
  return fetchOrganizationMembersDetailed(organizationId, supabaseClient);
}

export async function organizationUpdateUser({ userId, role, status }, options = {}) {
  const organizationId = authGetOrganizationId();
  const accessToken = String(options?.accessToken || "").trim();
  const supabaseClient = options?.supabaseClient || resolveSupabaseClient(accessToken);
  if (!organizationId || !userId) {
    throw new Error("Organization and user are required.");
  }
  if (!isOwnerRole(authGetRole())) {
    throw new Error("Only Owner can change user roles.");
  }
  if (!isSupabaseConfigured || !supabaseClient) {
    return {
      userId,
      role: fromDbRole(toDbRole(role)),
      status: normalizeMemberStatus(status)
    };
  }

  const payload = {};
  if (role) payload.role = toDbRole(role);
  if (status) payload.status = toDbMemberStatus(status);
  if (!Object.keys(payload).length) return null;
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabaseClient
    .from("organization_members")
    .update(payload)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .select("user_id, role, status")
    .maybeSingle();

  if (error) {
    throw new Error(normalizeSupabaseError(error, "Failed to update user role"));
  }

  if (String(userId) === String(authGetUser()?.id) && data?.role) {
    const roleLabel = fromDbRole(data.role);
    lsSet(LS_KEYS.role, roleLabel);
    ssSet(LS_KEYS.role, roleLabel);
  }

  return {
    userId: data?.user_id || userId,
    role: fromDbRole(data?.role || payload.role),
    status: normalizeMemberStatus(data?.status || payload.status)
  };
}

export async function settingsGetCompany() {
  const loadedProfile =
    (await companyLoadMyOrganization().catch(() => companyGetProfile())) || companyGetProfile() || {};
  const initialSanitize = sanitizeSettingsPayload(loadedProfile?.settings || {});
  const profile = initialSanitize.changed
    ? { ...loadedProfile, settings: initialSanitize.settings }
    : loadedProfile;
  if (initialSanitize.changed) {
    companySaveProfile(profile);
  }
  const organizationId = authGetOrganizationId();
  if (!organizationId || !isSupabaseConfigured || !supabase) {
    return {
      profile,
      users: Array.isArray(profile?.settings?.users?.members) ? profile.settings.users.members : []
    };
  }

  let mergedProfile = profile;
  try {
    const [settingsRow, sequenceSettings, users] = await Promise.all([
      fetchCompanySettingsRow(organizationId),
      fetchDocumentSequences(organizationId),
      fetchOrganizationMembersDetailed(organizationId)
    ]);

    mergedProfile = withMergedSettings(mergedProfile, settingsRow, sequenceSettings);
    mergedProfile = {
      ...mergedProfile,
      settings: {
        ...(mergedProfile.settings || {}),
        users: {
          ...(mergedProfile.settings?.users || {}),
          roles: normalizeRolePermissions(mergedProfile.settings?.users?.roles || {}),
          members: users
        }
      }
    };
    const mergedSanitize = sanitizeSettingsPayload(mergedProfile?.settings || {});
    if (mergedSanitize.changed) {
      mergedProfile = { ...mergedProfile, settings: mergedSanitize.settings };
      const actorUserId = authGetUser()?.id || null;
      try {
        await upsertCompanySettingsRow({
          organizationId,
          settings: mergedProfile.settings,
          updatedBy: actorUserId,
          supabaseClient: supabase
        });
        await supabase
          .from("organizations")
          .update({
            settings: mergedProfile.settings,
            updated_at: new Date().toISOString()
          })
          .eq("id", organizationId);
      } catch {
        // Non-blocking cleanup retry on next settings load.
      }
    }
    companySaveProfile(mergedProfile);
    return { profile: mergedProfile, users };
  } catch (error) {
    throw new Error(error?.message || "Failed to load company settings");
  }
}

export async function settingsPutCompany(profile, options = {}) {
  const result = await companySaveProfileRemote(profile, options);
  const accessToken = String(options?.accessToken || "").trim();
  const supabaseClient = resolveSupabaseClient(accessToken);
  const organizationId = result?.organizationId || authGetOrganizationId();
  const savedProfile = result?.profile || profile || {};

  if (organizationId && isSupabaseConfigured && supabaseClient) {
    const actorUserId = authGetUser()?.id || (await getCurrentUserId(supabaseClient)) || null;
    const settingsPayload = sanitizeSettingsPayload(savedProfile?.settings || {}).settings;
    await upsertCompanySettingsRow({
      organizationId,
      settings: {
        ...settingsPayload,
        users: {
          ...(settingsPayload.users || {}),
          roles: normalizeRolePermissions(settingsPayload?.users?.roles || {})
        }
      },
      updatedBy: actorUserId,
      supabaseClient
    });
    await upsertDocumentSequences(organizationId, settingsPayload?.numbering || {}, supabaseClient);
  }

  const users = await organizationListUsers({ accessToken, supabaseClient }).catch(() => []);
  const profileWithUsers = {
    ...savedProfile,
    settings: {
      ...(savedProfile?.settings || {}),
      users: {
        ...(savedProfile?.settings?.users || {}),
        roles: normalizeRolePermissions(savedProfile?.settings?.users?.roles || {}),
        members: users.length ? users : savedProfile?.settings?.users?.members || []
      }
    }
  };
  companySaveProfile(profileWithUsers);

  return {
    ...result,
    profile: profileWithUsers,
    users
  };
}

export async function settingsLogoUpload({ logoBase64 = "", logoFile = null } = {}) {
  const current = companyGetProfile() || {};
  const next = {
    ...current,
    logoBase64: logoBase64 || current.logoBase64 || ""
  };
  return settingsPutCompany(next, { logoFile });
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
      created_by: authGetUser()?.id || null,
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
