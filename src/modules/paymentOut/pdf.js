import { jsPDF } from "jspdf";
import { formatMoney } from "./utils";

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
