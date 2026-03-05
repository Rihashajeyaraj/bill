import { jsPDF } from "jspdf";
import { formatDateTimeByPreference } from "../../lib/formatPreferences";
import { countryCodeFromName, formatMoney, parseNumber } from "./utils";

function downloadBlob(content, filename) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportPaymentOutCsv(records, currency = "", country = "") {
  const safeRecords = Array.isArray(records) ? records : [];
  const resolvedCountry = country || safeRecords[0]?.country || "GLOBAL";
  const resolvedCurrency = currency || safeRecords[0]?.currency || "";
  const rows = [
    [
      "Payment No",
      "Date",
      "Supplier",
      "Payment Mode",
      "Reference No",
      "Amount Paid",
      "Applied Amount",
      "Unapplied Amount",
      "Status",
      "Currency"
    ],
    ...safeRecords.map((entry) => [
      entry?.paymentNo || "",
      entry?.paymentDate || "",
      entry?.supplierName || "",
      entry?.paymentMode || "",
      entry?.referenceNo || "",
      parseNumber(entry?.totals?.amountPaid).toFixed(2),
      parseNumber(entry?.totals?.amountApplied).toFixed(2),
      parseNumber(entry?.totals?.unappliedAmount).toFixed(2),
      entry?.status || "",
      entry?.currency || resolvedCurrency
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

  const code = countryCodeFromName(resolvedCountry);
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `payment-out-${code}.csv`);
}

export function exportPaymentOutSummaryPdf(records, country = "", currency = "") {
  const safeRecords = Array.isArray(records) ? records : [];
  const resolvedCountry = country || safeRecords[0]?.country || "Global";
  const resolvedCurrency = currency || safeRecords[0]?.currency || "";
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  doc.setFontSize(16);
  doc.text("Payment Out Summary", 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Country: ${resolvedCountry}`, 14, y);
  y += 5;
  doc.text(`Generated: ${formatDateTimeByPreference(new Date())}`, 14, y);
  y += 8;

  doc.setFontSize(9);
  doc.text("Payment", 14, y);
  doc.text("Date", 48, y);
  doc.text("Supplier", 74, y);
  doc.text("Status", 140, y);
  doc.text("Paid", 186, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  safeRecords.slice(0, 28).forEach((entry) => {
    doc.text(String(entry?.paymentNo || "").slice(0, 22), 14, y);
    doc.text(String(entry?.paymentDate || "-"), 48, y);
    doc.text(String(entry?.supplierName || "").slice(0, 30), 74, y);
    doc.text(String(entry?.status || ""), 140, y);
    doc.text(formatMoney(entry?.totals?.amountPaid, entry?.currency || resolvedCurrency), 186, y, { align: "right" });
    y += 6;
  });

  const totalPaid = safeRecords.reduce((sum, entry) => sum + parseNumber(entry?.totals?.amountPaid), 0);
  y += 4;
  doc.line(14, y, 196, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Total Paid: ${formatMoney(totalPaid, resolvedCurrency)}`, 14, y);

  const code = countryCodeFromName(resolvedCountry);
  doc.save(`payment-out-summary-${code}.pdf`);
}

export function exportPaymentOutPdf(record) {
  if (!record) return;
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const margin = 14;
  let y = margin;

  doc.setFontSize(16);
  doc.text("Payment Advice", margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.text(`Payment No: ${record.paymentNo}`, margin, y);
  doc.text(`Date: ${record.paymentDate}`, 120, y);
  y += 6;
  doc.text(`Supplier: ${record.supplierName}`, margin, y);
  y += 6;
  doc.text(`Payment Mode: ${record.paymentMode}`, margin, y);
  if (record.referenceNo) {
    doc.text(`Reference: ${record.referenceNo}`, 120, y);
  }
  y += 8;

  doc.setFontSize(11);
  doc.text("Bills Settled", margin, y);
  y += 5;

  doc.setFontSize(9);
  doc.text("Bill No", margin, y);
  doc.text("Bill Date", 60, y);
  doc.text("Applied", 120, y);
  doc.text("Balance", 160, y);
  y += 4;
  doc.line(margin, y, 200 - margin, y);
  y += 4;

  const allocations = record.allocations || [];
  allocations.forEach((line) => {
    if (y > 270) {
      doc.addPage();
      y = margin;
    }
    doc.text(String(line.billNo || "-"), margin, y);
    doc.text(String(line.billDate || "-"), 60, y);
    doc.text(formatMoney(line.applyAmount, record.currency), 120, y);
    doc.text(formatMoney(line.balanceDue, record.currency), 160, y);
    y += 5;
  });

  y += 6;
  doc.setFontSize(10);
  doc.text(`Amount Paid: ${formatMoney(record.totals.amountPaid, record.currency)}`, margin, y);
  y += 5;
  doc.text(`Amount Applied: ${formatMoney(record.totals.amountApplied, record.currency)}`, margin, y);
  y += 5;
  doc.text(`Advance: ${formatMoney(record.totals.unappliedAmount, record.currency)}`, margin, y);
  y += 8;

  doc.setFontSize(8);
  doc.text("This payment advice is system generated and valid without signature.", margin, y);

  doc.save(`PaymentAdvice_${record.paymentNo}.pdf`);
}
