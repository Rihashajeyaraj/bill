import { jsPDF } from "jspdf";
import { COUNTRY_CONFIG } from "./countryConfig";
import type { CountryCode } from "./countryConfig";
import type { PaymentInRecord } from "./store";

function money(value: number, country: CountryCode) {
  const currency = COUNTRY_CONFIG[country].currency;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
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
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y);
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

  note.allocations.filter((line) => line.applyAmount > 0).slice(0, 16).forEach((line) => {
    doc.text(line.invoiceNo.slice(0, 20), 14, y);
    doc.text(line.invoiceDate, 58, y);
    doc.text(money(line.balanceDue, note.country), 110, y, { align: "right" });
    doc.text(money(line.applyAmount, note.country), 170, y, { align: "right" });
    y += 6;
  });

  y += 2;
  doc.line(120, y, 196, y);
  y += 6;
  doc.text("Amount Received", 132, y);
  doc.text(money(note.totals.amountReceived, note.country), 196, y, { align: "right" });
  y += 6;
  doc.text("Amount Applied", 132, y);
  doc.text(money(note.totals.amountApplied, note.country), 196, y, { align: "right" });
  y += 6;
  doc.setFontSize(11);
  doc.text("Unapplied Amount", 132, y);
  doc.text(money(note.totals.unappliedAmount, note.country), 196, y, { align: "right" });

  y += 10;
  doc.setFontSize(9);
  doc.text(cfg.legalFooter, 14, y);
  y += 5;
  doc.text(`Customer Note: ${note.customerNotes || "-"}`, 14, y);

  doc.save(`${note.receiptNo}.pdf`);
}
