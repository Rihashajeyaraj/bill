import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { BufReader, BufWriter } from "https://deno.land/std@0.150.0/io/bufio.ts";
import { TextProtoReader } from "https://deno.land/std@0.150.0/textproto/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Payload = {
  action?: "request" | "validate" | "reset";
  email?: string;
  token?: string;
  password?: string;
  base_url?: string;
};

type SmtpMode = "tls" | "starttls" | "plain";
type Command = {
  code: number;
  args: string;
  continuation: boolean;
};

const smtpHost = Deno.env.get("SMTP_HOST")?.trim() || "smtp.gmail.com";
const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? 465);
const smtpSecureEnv = Deno.env.get("SMTP_SECURE")?.trim().toLowerCase();
const smtpUser = Deno.env.get("SMTP_USER")?.trim() || "";
const smtpPass = Deno.env.get("SMTP_PASS")?.trim() || "";
const configuredFromEmail = Deno.env.get("RESET_FROM_EMAIL")?.trim() || smtpUser;
const appBaseUrl = Deno.env.get("APP_BASE_URL")?.trim() || "";
const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const encoder = new TextEncoder();
const SMTP_CODES = {
  READY: 220,
  AUTH_SUCCESS: 235,
  OK: 250,
  BEGIN_DATA: 354
};

class SimpleSmtpClient {
  private conn: Deno.Conn | null = null;
  private reader: TextProtoReader | null = null;
  private writer: BufWriter | null = null;

  async connect() {
    if (smtpMode === "tls") {
      this.conn = await Deno.connectTls({ hostname: smtpHost, port: smtpPort });
    } else {
      this.conn = await Deno.connect({ hostname: smtpHost, port: smtpPort });
    }
    this.resetReaders();
    this.assertCode(await this.readCmd(), SMTP_CODES.READY, "SMTP server did not send a greeting.");
    await this.ehlo();
    if (smtpMode === "starttls") {
      if (!this.conn) throw new Error("SMTP connection was not established.");
      await this.writeLine("STARTTLS");
      this.assertCode(await this.readCmd(), SMTP_CODES.READY, "SMTP server rejected STARTTLS.");
      this.conn = await Deno.startTls(this.conn, { hostname: smtpHost });
      this.resetReaders();
      await this.ehlo();
    }
    if (smtpUser && smtpPass) {
      await this.authLogin();
    }
  }

  async send({ to, subject, content, html }: { to: string; subject: string; content: string; html: string }) {
    const fromValue = configuredFromEmail.includes("@") ? configuredFromEmail : smtpUser;
    await this.writeLine("MAIL", "FROM:", `<${fromValue}>`);
    this.assertCode(await this.readCmd(), SMTP_CODES.OK);
    await this.writeLine("RCPT", "TO:", `<${to}>`);
    this.assertCode(await this.readCmd(), SMTP_CODES.OK);
    await this.writeLine("DATA");
    this.assertCode(await this.readCmd(), SMTP_CODES.BEGIN_DATA);

    const boundary = `ResetBoundary_${Date.now().toString(16)}`;
    await this.writeLine("Subject:", subject);
    await this.writeLine("From:", `<${fromValue}>`);
    await this.writeLine("To:", `<${to}>`);
    await this.writeLine("Date:", new Date().toUTCString());
    await this.writeLine("MIME-Version:", "1.0");
    await this.writeLine("Content-Type:", `multipart/alternative; boundary="${boundary}"`);
    await this.writeLine("");
    await this.writeLine(`--${boundary}`);
    await this.writeLine("Content-Type:", "text/plain; charset=\"utf-8\"");
    await this.writeLine("");
    await this.writeRaw(content.replace(/\r?\n/g, "\r\n") + "\r\n");
    await this.writeLine(`--${boundary}`);
    await this.writeLine("Content-Type:", "text/html; charset=\"utf-8\"");
    await this.writeLine("");
    await this.writeRaw(html.replace(/\r?\n/g, "\r\n") + "\r\n");
    await this.writeLine(`--${boundary}--`);
    await this.writeRaw("\r\n.\r\n");
    this.assertCode(await this.readCmd(), SMTP_CODES.OK);
  }

  async close() {
    if (!this.conn) return;
    try {
      await this.writeLine("QUIT");
    } catch {
      // ignore
    }
    try {
      this.conn.close();
    } catch {
      // ignore
    } finally {
      this.conn = null;
      this.reader = null;
      this.writer = null;
    }
  }

  private resetReaders() {
    if (!this.conn) return;
    this.reader = new TextProtoReader(new BufReader(this.conn));
    this.writer = new BufWriter(this.conn);
  }

  private async ehlo() {
    await this.writeLine("EHLO", smtpHost);
    const first = await this.readCmd();
    this.assertCode(first, SMTP_CODES.OK, "SMTP EHLO failed.");
    while (first?.continuation) {
      const next = await this.readCmd();
      if (!next?.continuation) break;
    }
  }

  private async authLogin() {
    await this.writeLine("AUTH", "LOGIN");
    this.assertCode(await this.readCmd(), 334, "SMTP server rejected AUTH LOGIN.");
    await this.writeLine(btoa(smtpUser));
    this.assertCode(await this.readCmd(), 334, "SMTP server rejected SMTP username.");
    await this.writeLine(btoa(smtpPass));
    this.assertCode(await this.readCmd(), SMTP_CODES.AUTH_SUCCESS, "SMTP server rejected SMTP password.");
  }

  private async readCmd(): Promise<Command | null> {
    if (!this.reader) return null;
    const line = await this.reader.readLine();
    if (line === null) return null;
    return {
      code: parseInt(line.slice(0, 3).trim(), 10),
      args: line.length > 4 ? line.slice(4).trim() : "",
      continuation: line[3] === "-"
    };
  }

  private async writeLine(...parts: string[]) {
    if (!this.writer) return;
    await this.writer.write(encoder.encode(`${parts.join(" ")}\r\n`));
    await this.writer.flush();
  }

  private async writeRaw(value: string) {
    if (!this.writer) return;
    await this.writer.write(encoder.encode(value));
    await this.writer.flush();
  }

  private assertCode(cmd: Command | null, code: number, message = "SMTP error.") {
    if (!cmd) throw new Error(message);
    if (cmd.code !== code) {
      throw new Error(`${message} (${cmd.code}: ${cmd.args})`);
    }
  }
}

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(JSON.stringify(body), { ...init, headers });
}

function normalizeEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sha256Hex(value: string) {
  return crypto.subtle.digest("SHA-256", encoder.encode(value)).then((buffer) =>
    Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  );
}

function createSecureToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildResetLink(token: string, baseUrl = "") {
  const safeBaseUrl = String(baseUrl || "").trim() || appBaseUrl;
  if (!safeBaseUrl) return "";
  const url = new URL("/reset-password", safeBaseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function ensureAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase environment keys are missing.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function findProfileByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id,email,full_name")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message || "Unable to find user profile.");
  return data || null;
}

async function createResetToken(adminClient: ReturnType<typeof createClient>, profile: { id: string; email: string }) {
  const rawToken = createSecureToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await adminClient
    .from("password_reset_tokens")
    .delete()
    .eq("user_id", profile.id)
    .is("used_at", null);

  const { error } = await adminClient.from("password_reset_tokens").insert({
    user_id: profile.id,
    email: normalizeEmail(profile.email),
    token_hash: tokenHash,
    expires_at: expiresAt
  });
  if (error) throw new Error(error.message || "Unable to save reset token.");

  return { rawToken, expiresAt };
}

async function lookupToken(adminClient: ReturnType<typeof createClient>, token: string) {
  const tokenHash = await sha256Hex(String(token || "").trim());
  const { data, error } = await adminClient
    .from("password_reset_tokens")
    .select("id,user_id,email,expires_at,used_at,created_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw new Error(error.message || "Unable to validate reset token.");
  if (!data) throw new Error("Reset link is invalid or expired.");
  if (data.used_at) throw new Error("Reset link is already used.");
  const expiresAt = new Date(data.expires_at || "").getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw new Error("Reset link has expired.");
  }
  return data;
}

async function sendResetEmail(recipientEmail: string, resetLink: string) {
  if (!smtpUser || !smtpPass || !configuredFromEmail) {
    return;
  }
  const safeLink = escapeHtml(resetLink);
  const subject = "Reset your password";
  const textBody = [
    "We received a request to reset your password.",
    "",
    "Use the link below to set a new password:",
    resetLink,
    "",
    "If you did not request this, you can ignore this email."
  ].join("\n");
  const htmlBody = `
    <p>We received a request to reset your password.</p>
    <p><a href="${safeLink}" target="_blank" rel="noopener noreferrer">Click here to reset your password</a>.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  const smtpClient = new SimpleSmtpClient();
  try {
    await smtpClient.connect();
    await smtpClient.send({
      to: recipientEmail,
      subject,
      content: textBody,
      html: htmlBody
    });
  } finally {
    await smtpClient.close();
  }
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload." }, { status: 400 });
  }

  let adminClient;
  try {
    adminClient = ensureAdminClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server configuration missing.";
    return jsonResponse({ error: message }, { status: 500 });
  }

  try {
    if (payload.action === "request") {
      const safeEmail = normalizeEmail(payload.email);
      if (!safeEmail) {
        return jsonResponse({ error: "Email is required." }, { status: 400 });
      }
      const profile = await findProfileByEmail(adminClient, safeEmail);
      if (!profile?.id) {
        return jsonResponse({ delivered: true });
      }

      const { rawToken } = await createResetToken(adminClient, profile);
      const resetLink = buildResetLink(rawToken, payload.base_url);
      if (!resetLink) {
        return jsonResponse({ error: "Reset link base URL is missing." }, { status: 400 });
      }

      await sendResetEmail(safeEmail, resetLink);
      return jsonResponse({ delivered: true });
    }

    if (payload.action === "validate") {
      const safeToken = String(payload.token || "").trim();
      if (!safeToken) {
        return jsonResponse({ error: "Token is required." }, { status: 400 });
      }
      const row = await lookupToken(adminClient, safeToken);
      return jsonResponse({
        valid: true,
        email: row.email || ""
      });
    }

    if (payload.action === "reset") {
      const safeToken = String(payload.token || "").trim();
      const safePassword = String(payload.password || "");
      if (!safeToken) {
        return jsonResponse({ error: "Token is required." }, { status: 400 });
      }
      if (!safePassword) {
        return jsonResponse({ error: "Password is required." }, { status: 400 });
      }

      const row = await lookupToken(adminClient, safeToken);
      const { error: updateError } = await adminClient.auth.admin.updateUserById(row.user_id, {
        password: safePassword
      });
      if (updateError) {
        throw new Error(updateError.message || "Unable to update password.");
      }

      const { error: markUsedError } = await adminClient
        .from("password_reset_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", row.id);
      if (markUsedError) {
        throw new Error(markUsedError.message || "Unable to finalize password reset.");
      }

      return jsonResponse({ updated: true });
    }

    return jsonResponse({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password reset failed.";
    return jsonResponse({ error: message }, { status: 400 });
  }
});
