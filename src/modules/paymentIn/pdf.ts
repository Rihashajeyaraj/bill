import { jsPDF } from "jspdf";
import { COUNTRY_CONFIG } from "./countryConfig";
import type { CountryCode } from "./countryConfig";
import type { PaymentInRecord } from "./store";
import { formatDateTimeByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

function money(value: number, country: CountryCode) {
  void country;
  return formatNumberByPreference(Number(value || 0), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function drawSummaryRow(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  emphasized = false
) {
  doc.roundedRect(x, y, width, height, 2, 2);
  doc.line(x + width - 34, y, x + width - 34, y + height);
  doc.setFontSize(emphasized ? 11 : 10);
  doc.text(label, x + 3, y + height / 2 + 1);
  doc.text(value, x + width - 3, y + height / 2 + 1, { align: "right" });
}

function downloadBlob(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportPaymentInCsv(records: PaymentInRecord[], country: CountryCode) {
  const rows = [
    [
      "Receipt No",
      "Date",
      "Customer",
      "Payment Mode",
      "Reference No",
      "Amount Received",
      "Applied Amount",
      "Unapplied Amount",
      "Status",
      "Currency"
    ],
    ...records.map((entry) => [
      entry.receiptNo,
      entry.paymentDate,
      entry.customerName,
      entry.paymentMode,
      entry.referenceNo || entry.transactionId || "",
      entry.totals.amountReceived.toFixed(2),
      entry.totals.amountApplied.toFixed(2),
      entry.totals.unappliedAmount.toFixed(2),
      entry.status,
      COUNTRY_CONFIG[country].currency
    ])
  ];

  const csv = rows
    .map((row) =>
      row
        .map((cell) => String(cell).replace(/"/g, "\"\""))
        .map((cell) => `"${cell}"`)
        .join(",")
    )
    .join("\n");

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `payment-in-${country}.csv`);
}

export function exportPaymentInSummaryPdf(records: PaymentInRecord[], country: CountryCode) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const cfg = COUNTRY_CONFIG[country];
  let y = 14;
  doc.setFontSize(16);
  doc.text(`${cfg.receiptLabel} Summary`, 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Country: ${cfg.name}`, 14, y);
  y += 5;
  doc.text(`Generated: ${formatDateTimeByPreference(new Date())}`, 14, y);
  y += 8;

  doc.setFontSize(9);
  doc.text("Receipt", 14, y);
  doc.text("Date", 48, y);
  doc.text("Customer", 74, y);
  doc.text("Status", 140, y);
  doc.text("Received", 170, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  records.slice(0, 28).forEach((entry) => {
    doc.text(entry.receiptNo, 14, y);
    doc.text(entry.paymentDate, 48, y);
    doc.text(entry.customerName.slice(0, 30), 74, y);
    doc.text(entry.status, 140, y);
    doc.text(money(entry.totals.amountReceived, country), 170, y, { align: "right" });
    y += 6;
  });

  const total = records.reduce((sum, entry) => sum + entry.totals.amountReceived, 0);
  y += 4;
  doc.line(14, y, 196, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Total Received: ${money(total, country)}`, 14, y);

  doc.save(`payment-in-summary-${country}.pdf`);
}

export function exportSinglePaymentInPdf(note: PaymentInRecord) {
  const cfg = COUNTRY_CONFIG[note.country];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const appliedAllocations = (Array.isArray(note.allocations) ? note.allocations : []).filter(
    (line) => Number(line?.applyAmount || 0) > 0
  );
  let y = 14;

  doc.setFontSize(15);
  doc.text(cfg.receiptLabel, 14, y);
  doc.setFontSize(10);
  y += 7;
  doc.text(`Receipt No: ${note.receiptNo}`, 14, y);
  doc.text(`Date: ${note.paymentDate}`, 110, y);
  y += 6;
  doc.text(`Customer: ${note.customerName}`, 14, y);
  doc.text(`Payment Mode: ${note.paymentMode}`, 110, y);
  y += 6;
  doc.text(`Reference: ${note.referenceNo || note.transactionId || "-"}`, 14, y);
  doc.text(`${cfg.registrationLabel}: ${note.registrationNumber || "-"}`, 110, y);
  y += 6;
  doc.text(`Status: ${note.status}`, 14, y);
  y += 6;
  doc.text(cfg.legalWording, 14, y);
  y += 8;

  doc.setFontSize(9);
  doc.text("Invoice", 14, y);
  doc.text("Date", 58, y);
  doc.text("Balance", 110, y, { align: "right" });
  doc.text("Applied", 170, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  if (appliedAllocations.length) {
    appliedAllocations.slice(0, 16).forEach((line) => {
      doc.text(String(line?.invoiceNo || "-").slice(0, 20), 14, y);
      doc.text(String(line?.invoiceDate || "-"), 58, y);
      doc.text(money(Number(line?.balanceDue || 0), note.country), 110, y, { align: "right" });
      doc.text(money(Number(line?.applyAmount || 0), note.country), 170, y, { align: "right" });
      y += 6;
    });
  } else {
    doc.setTextColor(100, 116, 139);
    doc.text("No invoice applied", 14, y);
    doc.text("-", 58, y);
    doc.text("0.00", 110, y, { align: "right" });
    doc.text("0.00", 170, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
    y += 6;
  }

  y += 4;
  drawSummaryRow(doc, "Amount Received", money(note.totals.amountReceived, note.country), 124, y, 72, 9);
  y += 11;
  drawSummaryRow(doc, "Amount Applied", money(note.totals.amountApplied, note.country), 124, y, 72, 9);
  y += 11;
  drawSummaryRow(doc, "Unapplied Amount", money(note.totals.unappliedAmount, note.country), 124, y, 72, 10, true);

  y += 14;
  doc.setFontSize(9);
  const unappliedHelp = note.totals.unappliedAmount > 0
    ? "Unapplied Amount is the extra payment received that is not yet linked to any invoice."
    : "Unapplied Amount is zero because the full receipt is linked to invoice balances.";
  const legalLines = doc.splitTextToSize(cfg.legalFooter, 182);
  const helpLines = doc.splitTextToSize(unappliedHelp, 182);
  const noteLines = doc.splitTextToSize(`Customer Note: ${note.customerNotes || "-"}`, 182);
  doc.text(legalLines, 14, y);
  y += legalLines.length * 4 + 2;
  doc.text(helpLines, 14, y);
  y += helpLines.length * 4 + 2;
  doc.text(noteLines, 14, y);

  doc.save(`${note.receiptNo}.pdf`);
}
