import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { BufReader, BufWriter } from "https://deno.land/std@0.150.0/io/bufio.ts";
import { TextProtoReader } from "https://deno.land/std@0.150.0/textproto/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type InvitePayload = {
  organization_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  organization_name?: string | null;
  register_code?: string;
  link?: string;
  from?: string;
};

type SmtpMode = "tls" | "starttls" | "plain";
type SmtpAuthMethod = "auto" | "login" | "plain";

type Command = {
  code: number;
  args: string;
  continuation: boolean;
};

type SmtpConnectConfig = {
  hostname: string;
  port: number;
  mode: SmtpMode;
  username?: string | null;
  password?: string | null;
  authMethod?: SmtpAuthMethod;
};

type SmtpSendConfig = {
  from: string;
  to: string;
  subject: string;
  content: string;
  html?: string;
};

const smtpHost = Deno.env.get("SMTP_HOST")?.trim() || "smtp.gmail.com";
const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? 465);
const smtpSecureEnv = Deno.env.get("SMTP_SECURE")?.trim().toLowerCase();
const smtpAuthEnv = Deno.env.get("SMTP_AUTH_METHOD")?.trim().toLowerCase();
const smtpUser = Deno.env.get("SMTP_USER")?.trim() || null;
const smtpPass = Deno.env.get("SMTP_PASS")?.trim() || null;
const configuredFromEmail = Deno.env.get("INVITE_FROM_EMAIL")?.trim() || smtpUser;
const appBaseUrl = Deno.env.get("APP_BASE_URL")?.trim() || "";

const smtpMode: SmtpMode =
  smtpSecureEnv === "starttls"
    ? "starttls"
    : smtpSecureEnv === "true" || smtpSecureEnv === "tls" || smtpSecureEnv === "ssl"
      ? "tls"
      : smtpSecureEnv === "false" || smtpSecureEnv === "plain"
        ? "plain"
        : smtpPort === 465
          ? "tls"
          : smtpPort === 587
            ? "starttls"
            : "plain";

const smtpAuthMethod: SmtpAuthMethod =
  smtpAuthEnv === "login" ? "login" : smtpAuthEnv === "plain" ? "plain" : "auto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SMTP_CODES = {
  READY: 220,
  AUTH_SUCCESS: 235,
  OK: 250,
  BEGIN_DATA: 354
};

const encoder = new TextEncoder();

class SimpleSmtpClient {
  private conn: Deno.Conn | null = null;
  private reader: TextProtoReader | null = null;
  private writer: BufWriter | null = null;

  async connect(config: SmtpConnectConfig) {
    if (config.mode === "tls") {
      this.conn = await Deno.connectTls({
        hostname: config.hostname,
        port: config.port
      });
    } else {
      this.conn = await Deno.connect({
        hostname: config.hostname,
        port: config.port
      });
    }

    this.resetReaders();
    const greeting = await this.readResponse();
    this.assertCode(lastCommand(greeting), SMTP_CODES.READY, "SMTP server did not send a greeting.");
    const authMethods = await this.ehlo(config.hostname);

    if (config.mode === "starttls") {
      if (!this.conn) throw new Error("SMTP connection was not established.");
      await this.writeLine("STARTTLS");
      const startTlsResponse = await this.readResponse();
      this.assertCode(lastCommand(startTlsResponse), SMTP_CODES.READY, "SMTP server rejected STARTTLS.");
      this.conn = await Deno.startTls(this.conn, { hostname: config.hostname });
      this.resetReaders();
      const tlsAuthMethods = await this.ehlo(config.hostname);
      authMethods.splice(0, authMethods.length, ...tlsAuthMethods);
    }

    if (config.username && config.password) {
      await this.authenticate(config.username, config.password, authMethods, config.authMethod ?? "auto");
    }
  }

  async close() {
    if (!this.conn) return;
    try {
      await this.writeLine("QUIT");
    } catch {
      // Ignore SMTP QUIT failures.
    }
    try {
      this.conn.close();
    } catch {
      // Ignore close failures.
    } finally {
      this.conn = null;
      this.reader = null;
      this.writer = null;
    }
  }

  async send(config: SmtpSendConfig) {
    const [from, fromData] = this.parseAddress(config.from);
    const [to, toData] = this.parseAddress(config.to);

    await this.writeLine("MAIL", "FROM:", from);
    this.assertCode(await this.readCmd(), SMTP_CODES.OK);
    await this.writeLine("RCPT", "TO:", to);
    this.assertCode(await this.readCmd(), SMTP_CODES.OK);
    await this.writeLine("DATA");
    this.assertCode(await this.readCmd(), SMTP_CODES.BEGIN_DATA);

    await this.writeLine("Subject:", config.subject);
    await this.writeLine("From:", fromData);
    await this.writeLine("To:", toData);
    await this.writeLine("Date:", new Date().toUTCString());

    if (config.html) {
      const boundary = `InviteBoundary_${Date.now().toString(16)}`;
      await this.writeLine("MIME-Version:", "1.0");
      await this.writeLine("Content-Type:", `multipart/alternative; boundary="${boundary}"`);
      await this.writeLine("");
      await this.writeLine(`--${boundary}`);
      await this.writeLine("Content-Type:", "text/plain; charset=\"utf-8\"");
      await this.writeLine("Content-Transfer-Encoding:", "7bit");
      await this.writeLine("");
      await this.writeRaw(normalizeEol(config.content) + "\r\n");
      await this.writeLine(`--${boundary}`);
      await this.writeLine("Content-Type:", "text/html; charset=\"utf-8\"");
      await this.writeLine("Content-Transfer-Encoding:", "7bit");
      await this.writeLine("");
      await this.writeRaw(normalizeEol(config.html) + "\r\n");
      await this.writeLine(`--${boundary}--`);
    } else {
      await this.writeLine("MIME-Version:", "1.0");
      await this.writeLine("Content-Type:", "text/plain; charset=\"utf-8\"");
      await this.writeLine("Content-Transfer-Encoding:", "7bit");
      await this.writeLine("");
      await this.writeRaw(normalizeEol(config.content) + "\r\n");
    }

    await this.writeRaw("\r\n.\r\n");
    this.assertCode(await this.readCmd(), SMTP_CODES.OK);
  }

  private resetReaders() {
    if (!this.conn) return;
    const reader = new BufReader(this.conn);
    this.reader = new TextProtoReader(reader);
    this.writer = new BufWriter(this.conn);
  }

  private async authenticate(
    username: string,
    password: string,
    authMethods: string[],
    method: SmtpAuthMethod
  ) {
    const available = authMethods.map((value) => value.toUpperCase());
    const canLogin = available.length === 0 || available.includes("LOGIN");
    const canPlain = available.length === 0 || available.includes("PLAIN");
    const errors: string[] = [];
    const tryLogin = method === "login" || method === "auto";
    const tryPlain = method === "plain" || method === "auto";

    if (tryLogin && canLogin) {
      try {
        await this.authLogin(username, password);
        return;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "AUTH LOGIN failed.");
      }
    }

    if (tryPlain && canPlain) {
      try {
        await this.authPlain(username, password);
        return;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "AUTH PLAIN failed.");
      }
    }

    if (errors.length > 0) throw new Error(errors[0]);
    throw new Error("SMTP server did not advertise supported AUTH methods.");
  }

  private async authLogin(username: string, password: string) {
    try {
      await this.writeLine("AUTH", "LOGIN");
      const challenge = await this.readCmd();
      if (challenge?.code === SMTP_CODES.AUTH_SUCCESS) return;
      this.assertCode(challenge, 334, "SMTP server rejected AUTH LOGIN.");
      await this.writeLine(btoa(username));
      const userResp = await this.readCmd();
      if (userResp?.code === SMTP_CODES.AUTH_SUCCESS) return;
      this.assertCode(userResp, 334, "SMTP server rejected the username.");
      await this.writeLine(btoa(password));
      this.assertCode(await this.readCmd(), SMTP_CODES.AUTH_SUCCESS, "SMTP server rejected the password.");
      return;
    } catch {
      // Try inline AUTH LOGIN below.
    }

    await this.writeLine("AUTH", "LOGIN", btoa(username));
    const response = await this.readCmd();
    if (response?.code === SMTP_CODES.AUTH_SUCCESS) return;
    this.assertCode(response, 334, "SMTP server rejected AUTH LOGIN.");
    await this.writeLine(btoa(password));
    this.assertCode(await this.readCmd(), SMTP_CODES.AUTH_SUCCESS, "SMTP server rejected the password.");
  }

  private async authPlain(username: string, password: string) {
    const token = btoa(`\u0000${username}\u0000${password}`);
    await this.writeLine("AUTH", "PLAIN", token);
    const response = await this.readCmd();
    if (response?.code === SMTP_CODES.AUTH_SUCCESS) return;

    if (response?.code === 334) {
      await this.writeLine(token);
      this.assertCode(await this.readCmd(), SMTP_CODES.AUTH_SUCCESS, "SMTP server rejected AUTH PLAIN.");
      return;
    }

    await this.writeLine("AUTH", "PLAIN");
    const challenge = await this.readCmd();
    this.assertCode(challenge, 334, "SMTP server rejected AUTH PLAIN.");
    await this.writeLine(token);
    this.assertCode(await this.readCmd(), SMTP_CODES.AUTH_SUCCESS, "SMTP server rejected AUTH PLAIN.");
  }

  private async ehlo(hostname: string) {
    await this.writeLine("EHLO", hostname);
    const responses = await this.readResponse();
    if (responses.length === 0) throw new Error("SMTP server closed the connection during EHLO.");

    const authMethods: string[] = [];
    for (const cmd of responses) {
      const match = cmd.args.match(/AUTH(?:=|\s+)(.+)$/i);
      if (!match) continue;
      const methods = match[1]
        .trim()
        .split(/\s+/)
        .map((method) => method.toUpperCase());
      authMethods.push(...methods);
    }

    return Array.from(new Set(authMethods));
  }

  private parseAddress(email: string): [string, string] {
    const match = email.toString().match(/(.*)\s<(.*)>/);
    return match?.length === 3 ? [`<${match[2]}>`, email] : [`<${email}>`, `<${email}>`];
  }

  private async readCmd(): Promise<Command | null> {
    if (!this.reader) return null;
    const result = await this.reader.readLine();
    if (result === null) return null;
    const code = parseInt(result.slice(0, 3).trim(), 10);
    const separator = result.length > 3 ? result[3] : " ";
    const args = result.length > 4 ? result.slice(4).trim() : "";
    return { code, args, continuation: separator === "-" };
  }

  private async readResponse(): Promise<Command[]> {
    const first = await this.readCmd();
    if (!first) return [];
    const lines = [first];
    while (lines[lines.length - 1].continuation) {
      const next = await this.readCmd();
      if (!next) break;
      lines.push(next);
    }
    return lines;
  }

  private async writeLine(...parts: string[]) {
    if (!this.writer) return;
    const data = encoder.encode(`${parts.join(" ")}\r\n`);
    await this.writer.write(data);
    await this.writer.flush();
  }

  private async writeRaw(value: string) {
    if (!this.writer) return;
    const data = encoder.encode(value);
    await this.writer.write(data);
    await this.writer.flush();
  }

  private assertCode(cmd: Command | null, code: number, msg?: string) {
    if (!cmd) throw new Error(msg ?? "SMTP server closed the connection unexpectedly.");
    if (cmd.code !== code) {
      const detail = `${cmd.code}: ${cmd.args}`;
      throw new Error(msg ? `${msg} (${detail})` : detail);
    }
  }
}

function lastCommand(commands: Command[]) {
  return commands.length > 0 ? commands[commands.length - 1] : null;
}

function normalizeEol(value: string) {
  return value.replace(/\r?\n/g, "\r\n");
}

function extractEmailAddress(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const email = (match ? match[1] : trimmed).toLowerCase();
  return email.includes("@") ? email : null;
}

function extractBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function normalizeRole(value?: string | null) {
  const safe = String(value || "")
    .trim()
    .toLowerCase();
  if (safe === "owner") return "owner";
  if (safe === "accounter" || safe === "accountant") return "accounter";
  return "staff";
}

function roleLabel(value?: string | null) {
  const normalized = normalizeRole(value);
  if (normalized === "owner") return "Owner";
  if (normalized === "accounter") return "Accounter";
  return "Staff";
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveFromEmail(candidate?: string | null) {
  if (configuredFromEmail) return configuredFromEmail;
  if (candidate) {
    const candidateEmail = extractEmailAddress(candidate);
    if (candidateEmail) return candidate.trim();
  }
  return null;
}

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(JSON.stringify(body), { ...init, headers });
}

function resolveRegistrationLink(payload: InvitePayload, recipientEmail: string) {
  const explicit = String(payload.link || "").trim();
  if (explicit) return explicit;
  const registerCode = String(payload.register_code || "").trim().toUpperCase();
  if (!registerCode) return "";
  if (!appBaseUrl) return "";

  const url = new URL("/login", appBaseUrl);
  url.searchParams.set("mode", "signup");
  url.searchParams.set("role", roleLabel(payload.role));
  url.searchParams.set("email", recipientEmail);
  url.searchParams.set("registerCode", registerCode);
  const fullName = [payload.first_name, payload.last_name]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fullName) {
    url.searchParams.set("name", fullName);
  }
  return url.toString();
}

async function authorizeInviteSender(request: Request, organizationId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment keys are missing.");
  }

  const bearerToken = extractBearerToken(request);
  if (!bearerToken) {
    return { ok: false as const, status: 401, error: "Missing bearer token." };
  }
  if (bearerToken.startsWith("sb_publishable_") || bearerToken.startsWith("sb_secret_")) {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid auth token. Use Supabase user access_token JWT, not project API key."
    };
  }

  const claims = decodeJwtPayload(bearerToken);
  const userId = String(claims?.sub || "").trim();
  if (!userId) {
    return { ok: false as const, status: 401, error: "Invalid auth token." };
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: membership, error: membershipError } = await adminClient
    .from("organization_members")
    .select("organization_id, user_id, role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    return {
      ok: false as const,
      status: 500,
      error: membershipError.message || "Unable to verify organization membership."
    };
  }

  if (!membership || membership.status !== "active") {
    return { ok: false as const, status: 403, error: "You are not an active member of this organization." };
  }

  if (membership.role !== "owner") {
    return { ok: false as const, status: 403, error: "Only owner can send register invites." };
  }

  return {
    ok: true as const,
    adminClient,
    user: { id: userId }
  };
}

function decodeJwtPayload(token: string) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let payload: InvitePayload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const organizationId = String(payload?.organization_id || "").trim();
  const recipientEmail = extractEmailAddress(payload?.email);
  if (!organizationId) {
    return jsonResponse({ error: "organization_id is required." }, { status: 400 });
  }
  if (!recipientEmail) {
    return jsonResponse({ error: "Valid recipient email is required." }, { status: 400 });
  }

  let authResult:
    | Awaited<ReturnType<typeof authorizeInviteSender>>
    | null = null;
  try {
    authResult = await authorizeInviteSender(request, organizationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify invite sender.";
    return jsonResponse({ error: message }, { status: 500 });
  }
  if (!authResult.ok) {
    return jsonResponse({ error: authResult.error }, { status: authResult.status });
  }
  const adminClient = authResult.adminClient;

  let organizationName = String(payload.organization_name || "").trim();
  if (!organizationName) {
    const { data: organization } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    organizationName = String(organization?.name || "").trim();
  }
  if (!organizationName) organizationName = "BillJoy";

  const registrationLink = resolveRegistrationLink(payload, recipientEmail);
  if (!registrationLink) {
    return jsonResponse(
      {
        error:
          "Registration link is required. Provide link in payload or set APP_BASE_URL secret and pass register_code."
      },
      { status: 400 }
    );
  }

  if (!smtpUser || !smtpPass) {
    return jsonResponse(
      { delivered: false, reason: "SMTP credentials are not configured." },
      { status: 500 }
    );
  }

  const fromEmail = resolveFromEmail(payload.from);
  if (!fromEmail) {
    return jsonResponse(
      { delivered: false, reason: "INVITE_FROM_EMAIL is not configured." },
      { status: 500 }
    );
  }

  const safeRole = roleLabel(payload.role);
  const recipientName =
    [payload.first_name, payload.last_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ") ||
    "there";

  const safeRecipientName = escapeHtml(recipientName);
  const safeOrgName = escapeHtml(organizationName);
  const safeRoleLabel = escapeHtml(safeRole);
  const safeRegistrationLink = escapeHtml(registrationLink);
  const subject = `You're invited to ${organizationName}`;

  const textBody = [
    `Hi ${recipientName},`,
    "",
    `You've been invited to join ${organizationName} as ${safeRole}.`,
    "Use the link below to complete registration:",
    registrationLink,
    "",
    "If you were not expecting this email, you can ignore it."
  ].join("\n");

  const htmlBody = `
    <p>Hi ${safeRecipientName},</p>
    <p>You've been invited to join <strong>${safeOrgName}</strong> as <strong>${safeRoleLabel}</strong>.</p>
    <p><a href="${safeRegistrationLink}" target="_blank" rel="noopener noreferrer">Click here to complete registration</a>.</p>
    <p>If you were not expecting this email, you can ignore it.</p>
  `;

  const smtpClient = new SimpleSmtpClient();
  try {
    await smtpClient.connect({
      hostname: smtpHost,
      port: smtpPort,
      mode: smtpMode,
      username: smtpUser,
      password: smtpPass,
      authMethod: smtpAuthMethod
    });

    await smtpClient.send({
      from: fromEmail,
      to: recipientEmail,
      subject,
      content: textBody,
      html: htmlBody
    });

    return jsonResponse({
      delivered: true,
      register_link: registrationLink
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send invitation email.";
    return jsonResponse({ delivered: false, reason: message }, { status: 502 });
  } finally {
    await smtpClient.close();
  }
});
