import { authGetOrganizationId, authGetToken } from "./auth.service";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

function normalizeRole(value) {
  const safe = String(value || "")
    .trim()
    .toLowerCase();
  if (safe === "owner") return "Owner";
  if (safe === "accounter" || safe === "accountant") return "Accounter";
  return "Staff";
}

export function buildRegisterInviteLink({ baseUrl, email, role, registerCode, name } = {}) {
  const safeBaseUrl = String(baseUrl || "").trim();
  const safeEmail = String(email || "").trim();
  const safeCode = String(registerCode || "").trim().toUpperCase();
  if (!safeBaseUrl || !safeEmail || !safeCode) return "";

  const url = new URL("/login", safeBaseUrl);
  url.searchParams.set("mode", "signup");
  url.searchParams.set("email", safeEmail);
  url.searchParams.set("role", normalizeRole(role));
  url.searchParams.set("registerCode", safeCode);

  const safeName = String(name || "").trim();
  if (safeName) {
    url.searchParams.set("name", safeName);
  }

  return url.toString();
}

export async function sendRegisterInviteEmail({
  email,
  name = "",
  role = "Staff",
  organizationName = "",
  registerCode = "",
  link = "",
  from = ""
} = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }

  const safeEmail = String(email || "").trim();
  if (!safeEmail) {
    throw new Error("Recipient email is required.");
  }

  const organizationId = authGetOrganizationId();
  if (!organizationId) {
    throw new Error("Organization is not available.");
  }

  const fullName = String(name || "").trim();
  const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
  const lastName = rest.join(" ");
  const safeToken = authGetToken();
  const invokeOptions = {
    body: {
      organization_id: organizationId,
      email: safeEmail,
      first_name: firstName || "",
      last_name: lastName || "",
      role: normalizeRole(role),
      organization_name: String(organizationName || "").trim(),
      register_code: String(registerCode || "").trim().toUpperCase(),
      link: String(link || "").trim(),
      from: String(from || "").trim()
    }
  };
  if (safeToken) {
    invokeOptions.headers = { Authorization: `Bearer ${safeToken}` };
  }

  const { data, error } = await supabase.functions.invoke("send-register-invite", invokeOptions);
  if (error) {
    throw new Error(error.message || "Failed to send register invite.");
  }
  if (!data?.delivered) {
    throw new Error(data?.reason || "Invite email was not delivered.");
  }
  return data;
}
