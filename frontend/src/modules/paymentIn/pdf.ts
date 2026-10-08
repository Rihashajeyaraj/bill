import { jsPDF } from "jspdf";
import { COUNTRY_CONFIG } from "./countryConfig";
import type { CountryCode } from "./countryConfig";
import { paymentInAllocationSettledAmount, paymentInAllocationTdsShare, type PaymentInRecord } from "./store";
import { formatDateTimeByPreference, formatNumberByPreference } from "../../lib/formatPreferences";
import { drawPdfPartyDetails } from "../reports/pdfPartyDetails";

function money(value: number, country: CountryCode) {
  void country;
  return formatNumberByPreference(Number(value || 0), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function safeText(value: unknown, fallback = "-") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function documentLabel(line: PaymentInRecord["allocations"][number]) {
  const prefix = String(line?.documentType || "").toLowerCase() === "proforma" ? "Proforma" : "Invoice";
  return `${prefix} - ${safeText(line?.invoiceNo)}`;
}

function lineRemainingAmount(line: PaymentInRecord["allocations"][number]) {
  return Math.max(0, Number(line?.balanceDue || 0));
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
  const valueFontSize = emphasized ? 10 : 9;
  let labelFontSize = 8;
  let valueWidth = Math.max(26, doc.getTextWidth(value) + 8);
  valueWidth = Math.min(width * 0.48, valueWidth);
  let dividerX = x + width - valueWidth;
  if (dividerX < x + 22) {
    dividerX = x + 22;
  }

  doc.setFontSize(labelFontSize);
  while (labelFontSize > 6.5 && doc.getTextWidth(label) > dividerX - x - 6) {
    labelFontSize -= 0.5;
    doc.setFontSize(labelFontSize);
  }

  doc.roundedRect(x, y, width, height, 2, 2);
  doc.line(dividerX, y, dividerX, y + height);
  doc.text(label, x + 3, y + height / 2 + 1);
  doc.setFontSize(valueFontSize);
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
      "TDS Amount",
      "Total Settled",
      "Advance Amount",
      "Available Balance",
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
      entry.totals.tdsAmount.toFixed(2),
      entry.totals.totalSettled.toFixed(2),
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
  const colX = {
    receipt: 14,
    date: 48,
    customer: 74,
    status: 136,
    received: 174,
    tds: 194
  };
  let y = 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);
  doc.text(safeText(`${cfg.receiptLabel} Summary`), 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Country: ${safeText(cfg.name)}`, 14, y);
  y += 5;
  doc.text(`Generated: ${safeText(formatDateTimeByPreference(new Date()))}`, 14, y);
  y += 8;

  doc.setFontSize(9);
  doc.text("Receipt", colX.receipt, y);
  doc.text("Date", colX.date, y);
  doc.text("Customer", colX.customer, y);
  doc.text("Status", colX.status, y);
  doc.text("Received", colX.received, y, { align: "right" });
  doc.text("TDS", colX.tds, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  records.slice(0, 28).forEach((entry) => {
    doc.text(safeText(entry.receiptNo), colX.receipt, y);
    doc.text(safeText(entry.paymentDate), colX.date, y);
    doc.text(safeText(entry.customerName, "").slice(0, 28) || "-", colX.customer, y);
    doc.text(safeText(entry.status), colX.status, y);
    doc.text(money(entry.totals.amountReceived, country), colX.received, y, { align: "right" });
    doc.text(money(entry.totals.tdsAmount, country), colX.tds, y, { align: "right" });
    y += 6;
  });

  const total = records.reduce((sum, entry) => sum + entry.totals.amountReceived, 0);
  const totalTds = records.reduce((sum, entry) => sum + entry.totals.tdsAmount, 0);
  y += 4;
  doc.line(14, y, 196, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Total Received: ${money(total, country)}`, 14, y);
  doc.text(`Total TDS: ${money(totalTds, country)}`, 196, y, { align: "right" });

  doc.save(`payment-in-summary-${country}.pdf`);
}

export function exportSinglePaymentInPdf(note: PaymentInRecord) {
  const cfg = COUNTRY_CONFIG[note.country];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setFontSize(15);
  doc.text(cfg.receiptLabel, 14, y);
  doc.setFontSize(10);
  y += 7;
  doc.text(`Receipt No: ${note.receiptNo}`, 14, y);
  doc.text(`Date: ${note.paymentDate}`, 110, y);
  y += 6;
  const partyBlockBottom = drawPdfPartyDetails(
    doc,
    {
      partyId: note.customerId,
      customerName: note.customerName,
      address: (note as PaymentInRecord & { address?: string })?.address,
      phone: (note as PaymentInRecord & { phone?: string })?.phone,
      email: (note as PaymentInRecord & { email?: string })?.email
    },
    {
      x: 14,
      y,
      maxWidth: 82,
      title: "Party Details",
      nameLabel: "Name"
    }
  );
  doc.text(`Payment Mode: ${note.paymentMode}`, 110, y);
  y = Math.max(partyBlockBottom, y + 6);
  doc.text(`Reference: ${note.referenceNo || note.transactionId || "-"}`, 14, y);
  doc.text(`${cfg.registrationLabel}: ${note.registrationNumber || "-"}`, 110, y);
  y += 6;
  doc.text(`Status: ${note.status}`, 14, y);
  y += 6;
  doc.text(cfg.legalWording, 14, y);
  y += 8;

  const allocations = Array.isArray(note.allocations) ? note.allocations : [];
  if (allocations.length) {
    const tableTop = y + 10;
    const colX = {
      document: margin,
      date: 58,
      total: 90,
      paid: 122,
      tds: 148,
      settled: 170,
      balance: pageWidth - margin
    };
    const totalAmount = allocations.reduce((sum, line) => sum + Number(line?.invoiceAmount || 0), 0);
    const totalPaid = allocations.reduce((sum, line) => sum + Math.max(0, Number(line?.applyAmount || 0)), 0);
    const totalTds = allocations.reduce((sum, line) => sum + paymentInAllocationTdsShare(note, line), 0);
    const totalSettled = allocations.reduce((sum, line) => sum + paymentInAllocationSettledAmount(note, line), 0);
    const totalBalance = allocations.reduce(
      (sum, line) => sum + Math.max(0, lineRemainingAmount(line) - paymentInAllocationSettledAmount(note, line)),
      0
    );

    y = tableTop;
    doc.setFontSize(11);
    doc.text("Invoice Details", margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.text("Invoice Number", colX.document, y);
    doc.text("Date", colX.date, y);
    doc.text("Total Amount", colX.total, y, { align: "right" });
    doc.text("Amount Paid", colX.paid, y, { align: "right" });
    doc.text("TDS Amount", colX.tds, y, { align: "right" });
    doc.text("Total Settled", colX.settled, y, { align: "right" });
    doc.text("Amount Balance", colX.balance, y, { align: "right" });
    y += 3;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    allocations.forEach((line) => {
      const tdsAmount = paymentInAllocationTdsShare(note, line);
      const paidAmount = Math.max(0, Number(line?.applyAmount || 0));
      const settledAmount = paymentInAllocationSettledAmount(note, line);
      const remainingAmount = Math.max(0, lineRemainingAmount(line) - settledAmount);
      doc.text(documentLabel(line).slice(0, 34), colX.document, y);
      doc.text(safeText(line?.invoiceDate), colX.date, y);
      doc.text(money(Number(line?.invoiceAmount || 0), note.country), colX.total, y, { align: "right" });
      doc.text(money(paidAmount, note.country), colX.paid, y, { align: "right" });
      doc.text(money(tdsAmount, note.country), colX.tds, y, { align: "right" });
      doc.text(money(settledAmount, note.country), colX.settled, y, { align: "right" });
      doc.text(money(remainingAmount, note.country), colX.balance, y, { align: "right" });
      y += 6;
    });

    y += 2;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    drawSummaryRow(doc, "Total Amount", money(totalAmount, note.country), margin, y, 42, 9);
    drawSummaryRow(doc, "Amount Paid", money(totalPaid, note.country), margin + 46, y, 40, 9);
    drawSummaryRow(doc, "TDS Amount", money(totalTds, note.country), margin + 90, y, 40, 9);
    drawSummaryRow(doc, "Total Settled", money(totalSettled, note.country), margin + 134, y, 40, 9);
    y += 12;
    drawSummaryRow(doc, "Amount Balance", money(totalBalance, note.country), margin + 92, y, 90, 9, true);
    y += 14;
  } else {
    const totalAmount = Number(note.totals.amountReceived || 0);
    const totalPaid = Math.max(0, Number(note.totals.amountReceived || 0));
    const totalTds = Math.max(0, Number(note.totals.tdsAmount || 0));
    const totalSettled = Math.max(0, Number(note.totals.totalSettled || 0));
    const totalBalance = Math.max(0, Number(note.totals.unappliedAmount || 0));
    y += 10;
    drawSummaryRow(doc, "Total Amount", money(totalAmount, note.country), margin, y, 42, 9);
    drawSummaryRow(doc, "Amount Paid", money(totalPaid, note.country), margin + 46, y, 40, 9);
    drawSummaryRow(doc, "TDS Amount", money(totalTds, note.country), margin + 90, y, 40, 9);
    drawSummaryRow(doc, "Total Settled", money(totalSettled, note.country), margin + 134, y, 40, 9);
    y += 12;
    drawSummaryRow(doc, "Amount Balance", money(totalBalance, note.country), margin + 92, y, 90, 9, true);
    y += 14;
  }

  doc.setFontSize(9);
  const legalLines = doc.splitTextToSize(cfg.legalFooter, 182);
  const noteLines = doc.splitTextToSize(`Customer Note: ${note.customerNotes || "-"}`, 182);
  doc.text(legalLines, 14, y);
  y += legalLines.length * 4 + 2;
  doc.text(noteLines, 14, y);

  doc.save(`${note.receiptNo}.pdf`);
}
