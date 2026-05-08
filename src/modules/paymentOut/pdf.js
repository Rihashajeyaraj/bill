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
  let valueFontSize = emphasized ? 10 : 9;
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

  doc.setFontSize(valueFontSize);
  while (valueFontSize > 7 && doc.getTextWidth(value) > x + width - dividerX - 6) {
    valueFontSize -= 0.5;
    doc.setFontSize(valueFontSize);
  }

  doc.roundedRect(x, y, width, height, 2, 2);
  doc.line(dividerX, y, dividerX, y + height);
  doc.setFontSize(labelFontSize);
  doc.text(label, x + 3, y + height / 2 + 1.2, { baseline: "middle" });
  doc.setFontSize(valueFontSize);
  doc.text(value, x + width - 3, y + height / 2 + 1.2, { align: "right", baseline: "middle" });
}

function ensurePdfSpace(doc, y, requiredHeight, margin = 14) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + requiredHeight <= pageHeight - margin) return y;
  doc.addPage();
  return margin;
}

function drawWrappedLine(doc, label, value, x, y, maxWidth, lineHeight = 4.5) {
  const text = `${label}: ${pdfSafeText(value)}`;
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
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
  const contentRight = pageWidth - margin;
  const contentWidth = contentRight - margin;
  let y = margin;
  doc.setFont("helvetica", "normal");

  doc.setFontSize(15);
  doc.text("Payment Advice", margin, y);
  doc.setFontSize(9);
  doc.text(`Status: ${pdfSafeText(record.status || "Draft")}`, contentRight, y, { align: "right" });
  y += 7;

  doc.setFontSize(10);
  doc.text(`Payment No: ${pdfSafeText(record.paymentNo)}`, margin, y);
  doc.text(`Date: ${pdfSafeText(record.paymentDate)}`, contentRight, y, { align: "right" });
  y += 6;

  const detailsY = y;
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
      y: detailsY,
      maxWidth: 88,
      title: "Supplier Details",
      nameLabel: "Name"
    }
  );

  const metaX = 118;
  let metaY = detailsY;
  doc.setFontSize(10);
  doc.text("Payment Details", metaX, metaY);
  metaY += 5;
  doc.setFontSize(9);
  metaY = drawWrappedLine(doc, "Payment Mode", record.paymentMode, metaX, metaY, contentRight - metaX);
  if (record.referenceNo) {
    metaY = drawWrappedLine(doc, "Reference", record.referenceNo, metaX, metaY, contentRight - metaX);
  }
  if (parseNumber(record?.totals?.tdsAmount) > 0) {
    metaY = drawWrappedLine(
      doc,
      "TDS Deducted",
      pdfMoney(record?.totals?.tdsAmount, record.currency),
      metaX,
      metaY,
      contentRight - metaX
    );
  }
  y = Math.max(partyBlockBottom, metaY) + 8;

  const allocations = Array.isArray(record.allocations) ? record.allocations : [];
  if (allocations.length) {
    y = ensurePdfSpace(doc, y, 38);
    const colX = {
      bill: margin,
      date: 64,
      total: 103,
      paid: 136,
      tds: 164,
      balance: contentRight
    };
    const totalAmount = allocations.reduce((sum, line) => sum + parseNumber(line?.billAmount), 0);
    const totalPaid = allocations.reduce((sum, line) => sum + parseNumber(line?.applyAmount), 0);
    const totalTds = allocations.reduce((sum, line) => sum + paymentOutAllocationTdsShare(record, line), 0);
    const totalBalance = allocations.reduce(
      (sum, line) =>
        sum +
        Math.max(
          0,
          parseNumber(line?.balanceDue) - parseNumber(line?.applyAmount) - paymentOutAllocationTdsShare(record, line)
        ),
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
    doc.text("TDS", colX.tds, y, { align: "right" });
    doc.text("Amount Balance", colX.balance, y, { align: "right" });
    y += 3;
    doc.line(margin, y, contentRight, y);
    y += 5;

    allocations.forEach((line) => {
      y = ensurePdfSpace(doc, y, 10);
      const tdsShare = paymentOutAllocationTdsShare(record, line);
      const billLines = doc.splitTextToSize(pdfSafeText(line?.billNo, "-"), 44);
      doc.text(billLines, colX.bill, y);
      doc.text(pdfSafeText(line?.billDate), colX.date, y);
      doc.text(pdfMoney(line?.billAmount, record.currency), colX.total, y, { align: "right" });
      doc.text(pdfMoney(line?.applyAmount, record.currency), colX.paid, y, { align: "right" });
      doc.text(pdfMoney(tdsShare, record.currency), colX.tds, y, { align: "right" });
      doc.text(
        pdfMoney(
          Math.max(0, parseNumber(line?.balanceDue) - parseNumber(line?.applyAmount) - tdsShare),
          record.currency
        ),
        colX.balance,
        y,
        { align: "right" }
      );
      y += Math.max(6, billLines.length * 4.2);
    });

    y += 2;
    doc.line(margin, y, contentRight, y);
    y += 6;
    const summaryGap = 10;
    const summaryWidth = (contentWidth - summaryGap) / 2;
    y = ensurePdfSpace(doc, y, 36);
    drawSummaryRow(doc, "Total Amount", pdfMoney(totalAmount, record.currency), margin, y, summaryWidth, 9);
    drawSummaryRow(
      doc,
      "Cash Paid",
      pdfMoney(totalPaid, record.currency),
      margin + summaryWidth + summaryGap,
      y,
      summaryWidth,
      9
    );
    y += 12;
    drawSummaryRow(doc, "TDS", pdfMoney(totalTds, record.currency), margin, y, summaryWidth, 9);
    drawSummaryRow(
      doc,
      "Balance",
      pdfMoney(totalBalance, record.currency),
      margin + summaryWidth + summaryGap,
      y,
      summaryWidth,
      9,
      true
    );
    y += 12;
    drawSummaryRow(
      doc,
      "Total Settled",
      pdfMoney(record?.totals?.totalSettled, record.currency),
      margin + summaryWidth + summaryGap,
      y,
      summaryWidth,
      9,
      true
    );
    y += 14;
  } else {
    const summaryGap = 10;
    const summaryWidth = (contentWidth - summaryGap) / 2;
    y = ensurePdfSpace(doc, y, 36);
    const totalAmount = parseNumber(record?.totals?.amountPaid);
    const totalPaid = parseNumber(record?.totals?.amountApplied);
    const totalBalance = parseNumber(record?.totals?.unappliedAmount);
    drawSummaryRow(doc, "Total Amount", pdfMoney(totalAmount, record.currency), margin, y, summaryWidth, 9);
    drawSummaryRow(
      doc,
      "Cash Paid",
      pdfMoney(totalPaid, record.currency),
      margin + summaryWidth + summaryGap,
      y,
      summaryWidth,
      9
    );
    y += 12;
    drawSummaryRow(doc, "TDS Deducted", pdfMoney(record?.totals?.tdsAmount, record.currency), margin, y, summaryWidth, 9);
    drawSummaryRow(
      doc,
      "Total Settled",
      pdfMoney(record?.totals?.totalSettled, record.currency),
      margin + summaryWidth + summaryGap,
      y,
      summaryWidth,
      9,
      true
    );
    y += 12;
    drawSummaryRow(
      doc,
      "Cash Advance",
      pdfMoney(totalBalance, record.currency),
      margin + summaryWidth + summaryGap,
      y,
      summaryWidth,
      9,
      true
    );
    y += 14;
  }

  y = ensurePdfSpace(doc, y, 8);
  doc.setFontSize(8);
  const footerLines = doc.splitTextToSize(
    "This payment advice is system generated and valid without signature.",
    contentWidth
  );
  doc.text(footerLines, margin, y);

  doc.save(`PaymentAdvice_${pdfSafeText(record.paymentNo, "payment")}.pdf`);
}
