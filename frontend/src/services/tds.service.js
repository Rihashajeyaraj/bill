import { listPaymentOut } from "../modules/paymentOut/store";
import { listNotifications, pushNotification } from "./activity.service";
import { companyGetProfile } from "./company.service";

function parseNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return toIsoDate(date).slice(0, 7);
}

function quarterKey(date) {
  const current = date ? new Date(date) : new Date();
  const month = current.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  return `${current.getFullYear()}-Q${quarter}`;
}

function nextMonthlyDepositDue(date) {
  const current = date ? new Date(date) : new Date();
  const due = new Date(current.getFullYear(), current.getMonth() + 1, 7);
  return toIsoDate(due);
}

function nextQuarterlyFilingDue(date) {
  const current = date ? new Date(date) : new Date();
  const quarter = Math.floor(current.getMonth() / 3);
  const quarterEndMonth = quarter * 3 + 2;
  const due = new Date(current.getFullYear(), quarterEndMonth + 2, 31);
  return toIsoDate(due);
}

function reminderExists(kind, periodKey) {
  return listNotifications().some(
    (entry) =>
      String(entry?.meta?.kind || "") === kind &&
      String(entry?.meta?.periodKey || "") === String(periodKey || "")
  );
}

function isIndiaCompany() {
  const profile = companyGetProfile() || {};
  const country = String(profile?.country || profile?.countryCode || "").trim().toLowerCase();
  return country === "india" || country === "in";
}

export function syncTdsComplianceReminders(referenceDate = new Date()) {
  if (!isIndiaCompany()) return;

  const monthPeriodKey = monthKey(referenceDate);
  const quarterPeriodKey = quarterKey(referenceDate);
  const payments = listPaymentOut().filter((entry) => parseNumber(entry?.totals?.tdsAmount) > 0);

  const monthPayments = payments.filter((entry) => monthKey(entry?.paymentDate || referenceDate) === monthPeriodKey);
  if (monthPayments.length && !reminderExists("tds_deposit", monthPeriodKey)) {
    const totalTds = monthPayments.reduce((sum, entry) => sum + parseNumber(entry?.totals?.tdsAmount), 0);
    pushNotification({
      title: "Monthly TDS Deposit Reminder",
      description: `Deposit ${totalTds.toFixed(2)} TDS for ${monthPeriodKey} by ${nextMonthlyDepositDue(referenceDate)}.`,
      tone: "warning",
      link: "/app/reports?report=tds-report",
      meta: {
        kind: "tds_deposit",
        periodKey: monthPeriodKey,
        amount: totalTds
      }
    });
  }

  const quarterPayments = payments.filter((entry) => quarterKey(entry?.paymentDate || referenceDate) === quarterPeriodKey);
  if (quarterPayments.length && !reminderExists("tds_filing", quarterPeriodKey)) {
    const totalTds = quarterPayments.reduce((sum, entry) => sum + parseNumber(entry?.totals?.tdsAmount), 0);
    pushNotification({
      title: "Quarterly TDS Filing Reminder",
      description: `Prepare quarterly TDS filing for ${quarterPeriodKey}. Total deducted: ${totalTds.toFixed(2)}. Due by ${nextQuarterlyFilingDue(referenceDate)}.`,
      tone: "info",
      link: "/app/reports?report=tds-report",
      meta: {
        kind: "tds_filing",
        periodKey: quarterPeriodKey,
        amount: totalTds
      }
    });
  }
}
