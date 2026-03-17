import { jsPDF } from "jspdf";
import { COUNTRY_CONFIG } from "./countryConfig";
import type { CountryCode } from "./countryConfig";
import type { PaymentInRecord } from "./store";
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
      date: 82,
      total: 118,
      receivable: 152,
      balance: pageWidth - margin
    };
    const totalAmount = allocations.reduce((sum, line) => sum + Number(line?.invoiceAmount || 0), 0);
    const totalReceivable = allocations.reduce((sum, line) => sum + Number(line?.balanceDue || 0), 0);
    const totalBalance = allocations.reduce(
      (sum, line) => sum + Math.max(0, Number(line?.balanceDue || 0) - Number(line?.applyAmount || 0)),
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
    doc.text("Amount Receivable", colX.receivable, y, { align: "right" });
    doc.text("Amount Balance", colX.balance, y, { align: "right" });
    y += 3;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    allocations.forEach((line) => {
      doc.text(documentLabel(line).slice(0, 34), colX.document, y);
      doc.text(safeText(line?.invoiceDate), colX.date, y);
      doc.text(money(Number(line?.invoiceAmount || 0), note.country), colX.total, y, { align: "right" });
      doc.text(money(Number(line?.balanceDue || 0), note.country), colX.receivable, y, { align: "right" });
      doc.text(
        money(Math.max(0, Number(line?.balanceDue || 0) - Number(line?.applyAmount || 0)), note.country),
        colX.balance,
        y,
        { align: "right" }
      );
      y += 6;
    });

    y += 2;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    drawSummaryRow(doc, "Total Amount", money(totalAmount, note.country), margin, y, 54, 9);
    drawSummaryRow(doc, "Amount Receivable", money(totalReceivable, note.country), margin + 58, y, 64, 9);
    drawSummaryRow(doc, "Amount Balance", money(totalBalance, note.country), margin + 126, y, 56, 9, true);
    y += 14;
  } else {
    const totalAmount = Number(note.totals.amountReceived || 0);
    const totalReceivable = Math.max(0, Number(note.totals.amountApplied || 0));
    const totalBalance = Math.max(0, Number(note.totals.unappliedAmount || 0));
    y += 10;
    drawSummaryRow(doc, "Total Amount", money(totalAmount, note.country), margin, y, 54, 9);
    drawSummaryRow(doc, "Amount Receivable", money(totalReceivable, note.country), margin + 58, y, 64, 9);
    drawSummaryRow(doc, "Amount Balance", money(totalBalance, note.country), margin + 126, y, 56, 9, true);
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
