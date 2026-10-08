import { paymentsList, paymentsSyncFromRemote } from "./payments.service";
import { expensesList, expensesSyncFromRemote } from "./expenses.service";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";

function parseNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMode(mode) {
  return String(mode || "").trim();
}

function resolveChannel(mode) {
  const normalized = normalizeMode(mode).toLowerCase();
  if (!normalized) return "Bank";
  if (normalized.includes("cash") || normalized.includes("petty")) return "Cash";
  if (
    normalized.includes("bank") ||
    normalized.includes("transfer") ||
    normalized.includes("cheque") ||
    normalized.includes("check") ||
    normalized.includes("card") ||
    normalized.includes("online") ||
    normalized.includes("upi") ||
    normalized.includes("wire")
  ) {
    return "Bank";
  }
  return "Bank";
}

function entryDate(value, fallback = "") {
  return String(value || fallback || "").slice(0, 10);
}

function toTime(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortLedger(list) {
  return [...list].sort((a, b) => {
    const aTime = toTime(a.date || a.created_at);
    const bTime = toTime(b.date || b.created_at);
    if (aTime === bTime) return toTime(b.created_at) - toTime(a.created_at);
    return bTime - aTime;
  });
}

function isCurrentMonth(isoDate) {
  if (!isoDate) return false;
  const parsed = new Date(isoDate);
  if (!Number.isFinite(parsed.getTime())) return false;

  const now = new Date();
  return parsed.getMonth() === now.getMonth() && parsed.getFullYear() === now.getFullYear();
}

function buildSummary(ledger) {
  let totalIn = 0;
  let totalOut = 0;
  let cashIn = 0;
  let cashOut = 0;
  let bankIn = 0;
  let bankOut = 0;
  let monthIn = 0;
  let monthOut = 0;

  ledger.forEach((entry) => {
    const inflow = parseNumber(entry.inflow);
    const outflow = parseNumber(entry.outflow);
    totalIn += inflow;
    totalOut += outflow;

    if (entry.channel === "Cash") {
      cashIn += inflow;
      cashOut += outflow;
    } else {
      bankIn += inflow;
      bankOut += outflow;
    }

    if (isCurrentMonth(entry.date)) {
      monthIn += inflow;
      monthOut += outflow;
    }
  });

  return {
    totalIn,
    totalOut,
    netFlow: totalIn - totalOut,
    cashIn,
    cashOut,
    cashBalance: cashIn - cashOut,
    bankIn,
    bankOut,
    bankBalance: bankIn - bankOut,
    monthIn,
    monthOut,
    monthNet: monthIn - monthOut,
    transactionCount: ledger.length
  };
}

function mapPartyNames() {
  const parties = listParties();
  const map = new Map();
  parties.forEach((party) => {
    if (!party?.id) return;
    map.set(String(party.id), party.name || "-");
  });
  return map;
}

export async function loadCashBankSnapshot(options = {}) {
  if (options.syncRemote !== false) {
    await Promise.allSettled([
      syncPartiesFromRemote(),
      paymentsSyncFromRemote(),
      expensesSyncFromRemote()
    ]);
  }

  const partiesById = mapPartyNames();
  const paymentEntries = paymentsList().map((entry) => {
    const amount = Math.max(0, parseNumber(entry.amount));
    const isIn = String(entry.direction || "").toUpperCase() === "IN";
    return {
      id: entry.id,
      date: entryDate(entry.date, entry.created_at),
      created_at: entry.created_at || "",
      type: isIn ? "Payment In" : "Payment Out",
      channel: resolveChannel(entry.mode),
      mode: normalizeMode(entry.mode) || "-",
      reference: entry.paymentNo || entry.referenceNo || entry.id || "-",
      counterparty: partiesById.get(String(entry.partyId || "")) || "-",
      inflow: isIn ? amount : 0,
      outflow: isIn ? 0 : amount,
      status: entry.status || "posted",
      source: "payments"
    };
  });

  const expenseEntries = expensesList().map((entry) => {
    const amount = Math.max(
      0,
      parseNumber(entry.totalAmount) ||
        parseNumber(entry.amount) + parseNumber(entry.taxAmount)
    );
    return {
      id: entry.id,
      date: entryDate(entry.date, entry.created_at),
      created_at: entry.created_at || "",
      type: "Expense",
      channel: resolveChannel(entry.paymentMode),
      mode: normalizeMode(entry.paymentMode) || "-",
      reference: entry.expenseNo || entry.category || entry.id || "-",
      counterparty: partiesById.get(String(entry.partyId || "")) || "-",
      inflow: 0,
      outflow: amount,
      status: entry.status || "posted",
      source: "expenses"
    };
  });

  const ledger = sortLedger([...paymentEntries, ...expenseEntries]);
  return {
    ledger,
    summary: buildSummary(ledger),
    syncedAt: new Date().toISOString()
  };
}
