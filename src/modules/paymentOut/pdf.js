import { jsPDF } from "jspdf";
import { formatDateTimeByPreference, formatNumberByPreference } from "../../lib/formatPreferences";
import { countryCodeFromName, parseNumber } from "./utils";
import { drawPdfPartyDetails } from "../reports/pdfPartyDetails";
import { paymentOutAllocationTdsShare } from "./store";

function pdfSafeText(value, fallback = "-") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function pdfMoney(value, currency = "") {
  const amount = formatNumberByPreference(parseNumber(value), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const currencyCode = pdfSafeText(String(currency || "").trim().toUpperCase(), "").slice(0, 8);
  return currencyCode ? `${currencyCode} ${amount}` : amount;
}

function drawSummaryRow(doc, label, value, x, y, width, height, emphasized = false) {
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
      "Cash Paid",
      "TDS Amount",
      "Total Settled",
      "Cash Advance",
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
      parseNumber(entry?.totals?.tdsAmount).toFixed(2),
      parseNumber(entry?.totals?.totalSettled).toFixed(2),
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
  doc.setFont("helvetica", "normal");

  doc.setFontSize(16);
  doc.text("Payment Out Summary", 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Country: ${pdfSafeText(resolvedCountry)}`, 14, y);
  y += 5;
  doc.text(`Generated: ${pdfSafeText(formatDateTimeByPreference(new Date()))}`, 14, y);
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
    doc.text(pdfSafeText(entry?.paymentNo, "").slice(0, 22) || "-", 14, y);
    doc.text(pdfSafeText(entry?.paymentDate), 48, y);
    doc.text(pdfSafeText(entry?.supplierName, "").slice(0, 30) || "-", 74, y);
    doc.text(pdfSafeText(entry?.status), 140, y);
    doc.text(pdfMoney(entry?.totals?.amountPaid, entry?.currency || resolvedCurrency), 186, y, { align: "right" });
    y += 6;
  });

  const totalPaid = safeRecords.reduce((sum, entry) => sum + parseNumber(entry?.totals?.amountPaid), 0);
  const totalTds = safeRecords.reduce((sum, entry) => sum + parseNumber(entry?.totals?.tdsAmount), 0);
  const totalSettled = safeRecords.reduce((sum, entry) => sum + parseNumber(entry?.totals?.totalSettled), 0);
  y += 4;
  doc.line(14, y, 196, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Total Paid: ${pdfMoney(totalPaid, resolvedCurrency)}`, 14, y);
  y += 6;
  doc.text(`Total TDS: ${pdfMoney(totalTds, resolvedCurrency)}`, 14, y);
  y += 6;
  doc.text(`Total Settled: ${pdfMoney(totalSettled, resolvedCurrency)}`, 14, y);

  const code = countryCodeFromName(resolvedCountry);
  doc.save(`payment-out-summary-${code}.pdf`);
}

export function exportPaymentOutPdf(record) {
  if (!record) return;
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = margin;
  doc.setFont("helvetica", "normal");

  doc.setFontSize(16);
  doc.text("Payment Advice", margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.text(`Payment No: ${pdfSafeText(record.paymentNo)}`, margin, y);
  doc.text(`Date: ${pdfSafeText(record.paymentDate)}`, 120, y);
  y += 6;
  const partyBlockBottom = drawPdfPartyDetails(
    doc,
    {
      partyId: record.supplierId,
      supplierName: record.supplierName,
      address: record.address,
      phone: record.phone,
      email: record.email
    },
    {
      x: margin,
      y,
      maxWidth: 82,
      title: "Party Details",
      nameLabel: "Name"
    }
  );
  doc.text(`Payment Mode: ${pdfSafeText(record.paymentMode)}`, margin, y);
  if (record.referenceNo) {
    doc.text(`Reference: ${pdfSafeText(record.referenceNo)}`, 120, y);
  }
  if (parseNumber(record?.totals?.tdsAmount) > 0) {
    y += 5;
    doc.text(`TDS Deducted: ${pdfMoney(record?.totals?.tdsAmount, record.currency)}`, margin, y);
  }
  y = Math.max(partyBlockBottom, y + 6);
  y += 2;

  const allocations = Array.isArray(record.allocations) ? record.allocations : [];
  if (allocations.length) {
    const colX = {
      bill: margin,
      date: 82,
      total: 118,
      paid: 152,
      balance: pageWidth - margin
    };
    const totalAmount = allocations.reduce((sum, line) => sum + parseNumber(line?.billAmount), 0);
    const totalPaid = allocations.reduce((sum, line) => sum + parseNumber(line?.applyAmount), 0);
    const totalBalance = allocations.reduce(
      (sum, line) => sum + Math.max(0, parseNumber(line?.balanceDue) - parseNumber(line?.applyAmount)),
      0
    );

    doc.setFontSize(11);
    doc.text("Invoice Details", margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.text("Invoice Number", colX.bill, y);
    doc.text("Date", colX.date, y);
    doc.text("Total Amount", colX.total, y, { align: "right" });
    doc.text("Amount Paid", colX.paid, y, { align: "right" });
    doc.text("Amount Balance", colX.balance, y, { align: "right" });
    y += 3;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    allocations.forEach((line) => {
      const tdsShare = paymentOutAllocationTdsShare(record, line);
      doc.text(pdfSafeText(line?.billNo, "-").slice(0, 34), colX.bill, y);
      doc.text(pdfSafeText(line?.billDate), colX.date, y);
      doc.text(pdfMoney(line?.billAmount, record.currency), colX.total, y, { align: "right" });
      doc.text(pdfMoney(line?.applyAmount, record.currency), colX.paid, y, { align: "right" });
      doc.text(
        pdfMoney(
          Math.max(0, parseNumber(line?.balanceDue) - parseNumber(line?.applyAmount) - tdsShare),
          record.currency
        ),
        colX.balance,
        y,
        { align: "right" }
      );
      y += 6;
    });

    y += 2;
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    drawSummaryRow(doc, "Total Amount", pdfMoney(totalAmount, record.currency), margin, y, 54, 9);
    drawSummaryRow(doc, "Cash Paid", pdfMoney(totalPaid, record.currency), margin + 58, y, 64, 9);
    drawSummaryRow(doc, "Balance", pdfMoney(totalBalance, record.currency), margin + 126, y, 56, 9, true);
    y += 12;
    drawSummaryRow(doc, "TDS Deducted", pdfMoney(record?.totals?.tdsAmount, record.currency), margin, y, 86, 9);
    drawSummaryRow(doc, "Total Settled", pdfMoney(record?.totals?.totalSettled, record.currency), margin + 96, y, 86, 9, true);
    y += 14;
  } else {
    const totalAmount = parseNumber(record?.totals?.amountPaid);
    const totalPaid = parseNumber(record?.totals?.amountApplied);
    const totalBalance = parseNumber(record?.totals?.unappliedAmount);
    drawSummaryRow(doc, "Total Amount", pdfMoney(totalAmount, record.currency), margin, y, 54, 9);
    drawSummaryRow(doc, "Cash Paid", pdfMoney(totalPaid, record.currency), margin + 58, y, 64, 9);
    drawSummaryRow(doc, "Cash Advance", pdfMoney(totalBalance, record.currency), margin + 126, y, 56, 9, true);
    y += 12;
    drawSummaryRow(doc, "TDS Deducted", pdfMoney(record?.totals?.tdsAmount, record.currency), margin, y, 86, 9);
    drawSummaryRow(doc, "Total Settled", pdfMoney(record?.totals?.totalSettled, record.currency), margin + 96, y, 86, 9, true);
    y += 14;
  }

  doc.setFontSize(8);
  doc.text("This payment advice is system generated and valid without signature.", margin, y);

  doc.save(`PaymentAdvice_${pdfSafeText(record.paymentNo, "payment")}.pdf`);
}
