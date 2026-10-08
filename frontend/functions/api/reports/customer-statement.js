import { createClient } from "@supabase/supabase-js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function parseNumber(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function toIsoDate(value) {
  if (!value) return "";
  const raw = String(value);
  if (raw.length >= 10 && raw[4] === "-" && raw[7] === "-") return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function openingBalanceSigned(customer) {
  const openingBalance = Math.abs(parseNumber(customer?.opening_balance));
  const openingType = String(customer?.opening_balance_type || "receivable").trim().toLowerCase();
  return openingType === "payable" ? -openingBalance : openingBalance;
}

function sortTransactions(left, right) {
  const leftDate = String(left?.date || "");
  const rightDate = String(right?.date || "");
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  const leftKey = `${left?.transaction_type || ""}:${left?.reference_number || ""}:${left?.id || ""}`;
  const rightKey = `${right?.transaction_type || ""}:${right?.reference_number || ""}:${right?.id || ""}`;
  return leftKey.localeCompare(rightKey);
}

function buildStatement(customer, transactions, fromDate, toDate) {
  const safeFrom = toIsoDate(fromDate);
  const safeTo = toIsoDate(toDate);
  let openingBalance = openingBalanceSigned(customer);

  transactions.forEach((row) => {
    if (safeFrom && row.date && row.date < safeFrom) {
      openingBalance += parseNumber(row.debit) - parseNumber(row.credit);
    }
  });

  const filtered = transactions.filter((row) => {
    if (safeFrom && row.date && row.date < safeFrom) return false;
    if (safeTo && row.date && row.date > safeTo) return false;
    return true;
  });

  let runningBalance = openingBalance;
  const reportTransactions = filtered.map((row) => {
    runningBalance += parseNumber(row.debit) - parseNumber(row.credit);
    return {
      id: row.id,
      date: row.date,
      transaction_type: row.transaction_type,
      reference_number: row.reference_number,
      debit: parseNumber(row.debit),
      credit: parseNumber(row.credit),
      running_balance: runningBalance
    };
  });

  return {
    customer: {
      id: String(customer?.id || ""),
      name: String(customer?.display_name || customer?.name || "").trim(),
      phone: String(customer?.phone || "").trim(),
      email: String(customer?.email || "").trim(),
      address: String(customer?.address || "").trim()
    },
    period: {
      from_date: safeFrom,
      to_date: safeTo
    },
    opening_balance: openingBalance,
    transactions: reportTransactions,
    closing_balance: runningBalance
  };
}

function createSupabaseClient(env, authHeader) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: authHeader
      ? {
          headers: {
            Authorization: authHeader
          }
        }
      : undefined
  });
}

async function ensureAuthorized(client, customer) {
  const authHeader = client?.supabaseUrl ? null : null;
  void authHeader;
  const { data: userResult, error: userError } = await client.auth.getUser();
  if (userError || !userResult?.user?.id) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  const { data: membership } = await client
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", customer.organization_id)
    .eq("user_id", userResult.user.id)
    .eq("status", "active")
    .maybeSingle();

  const role = String(membership?.role || "").trim().toLowerCase();
  if (role && role !== "owner" && role !== "accounter" && role !== "accountant") {
    return { ok: false, response: json({ error: "Forbidden" }, 403) };
  }

  return { ok: true };
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const customerId = String(url.searchParams.get("customer_id") || "").trim();
    const fromDate = toIsoDate(url.searchParams.get("from_date") || "");
    const toDate = toIsoDate(url.searchParams.get("to_date") || "");

    if (!customerId) {
      return json({ error: "customer_id is required." }, 400);
    }
    if (fromDate && toDate && fromDate > toDate) {
      return json({ error: "from_date cannot be after to_date." }, 400);
    }

    const authHeader = request.headers.get("Authorization") || "";
    const client = createSupabaseClient(env, authHeader);

    const { data: customer, error: customerError } = await client
      .from("parties")
      .select("id,organization_id,display_name,name,phone,email,address,opening_balance,opening_balance_type,party_type,is_active")
      .eq("id", customerId)
      .eq("is_active", true)
      .maybeSingle();

    if (customerError) {
      return json({ error: customerError.message || "Failed to load customer." }, 500);
    }
    if (!customer || String(customer?.party_type || "").trim().toLowerCase() !== "customer") {
      return json({ error: "Customer not found." }, 404);
    }

    const authResult = await ensureAuthorized(client, customer);
    if (!authResult.ok) return authResult.response;

    const organizationId = customer.organization_id;
    const [invoiceResult, paymentResult, creditResult] = await Promise.all([
      client
        .from("invoices")
        .select("id,invoice_no,invoice_date,grand_total,status,created_at")
        .eq("organization_id", organizationId)
        .eq("party_id", customerId)
        .neq("status", "cancelled"),
      client
        .from("payments")
        .select("id,payment_no,payment_date,amount,reference_no,status,direction,created_at")
        .eq("organization_id", organizationId)
        .eq("party_id", customerId)
        .eq("direction", "in")
        .neq("status", "cancelled"),
      client
        .from("credit_notes")
        .select("id,credit_note_no,credit_note_date,grand_total,status,created_at")
        .eq("organization_id", organizationId)
        .eq("party_id", customerId)
        .eq("status", "applied")
    ]);

    if (invoiceResult.error) {
      return json({ error: invoiceResult.error.message || "Failed to load invoices." }, 500);
    }
    if (paymentResult.error) {
      return json({ error: paymentResult.error.message || "Failed to load payments." }, 500);
    }
    if (creditResult.error) {
      return json({ error: creditResult.error.message || "Failed to load credit notes." }, 500);
    }

    const transactions = [
      ...(Array.isArray(invoiceResult.data) ? invoiceResult.data : []).map((row) => ({
        id: `invoice_${row?.id || row?.invoice_no || ""}`,
        date: toIsoDate(row?.invoice_date || row?.created_at),
        transaction_type: "Invoice",
        reference_number: String(row?.invoice_no || row?.id || "").trim(),
        debit: parseNumber(row?.grand_total),
        credit: 0
      })),
      ...(Array.isArray(paymentResult.data) ? paymentResult.data : []).map((row) => ({
        id: `payment_${row?.id || row?.payment_no || ""}`,
        date: toIsoDate(row?.payment_date || row?.created_at),
        transaction_type: "Payment",
        reference_number: String(row?.payment_no || row?.reference_no || row?.id || "").trim(),
        debit: 0,
        credit: parseNumber(row?.amount)
      })),
      ...(Array.isArray(creditResult.data) ? creditResult.data : []).map((row) => ({
        id: `credit_${row?.id || row?.credit_note_no || ""}`,
        date: toIsoDate(row?.credit_note_date || row?.created_at),
        transaction_type: "Credit Note",
        reference_number: String(row?.credit_note_no || row?.id || "").trim(),
        debit: 0,
        credit: parseNumber(row?.grand_total)
      }))
    ].sort(sortTransactions);

    return json(buildStatement(customer, transactions, fromDate, toDate));
  } catch (error) {
    return json({ error: error?.message || "Failed to generate customer statement." }, 500);
  }
}
