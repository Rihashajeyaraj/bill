import { jsPDF } from "jspdf";
import { COUNTRY_CONFIG } from "./countryConfig";
import type { CountryCode } from "./countryConfig";
import type { CreditNoteRecord } from "./store";

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

export function exportCreditNotesCsv(notes: CreditNoteRecord[], country: CountryCode) {
  const rows = [
    [
      "Credit Note No",
      "Date",
      "Customer",
      "Invoice",
      "Reason",
      "Status",
      "Credit Type",
      "Total Amount",
      "Tax",
      "Currency"
    ],
    ...notes.map((note) => [
      note.creditNoteNo,
      note.creditNoteDate,
      note.customerName,
      note.linkedInvoiceNo,
      note.reason,
      note.status,
      note.creditType,
      note.totals.total.toFixed(2),
      note.totals.taxTotal.toFixed(2),
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

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `credit-notes-${country}.csv`);
}

export function exportCreditNoteSummaryPdf(notes: CreditNoteRecord[], country: CountryCode) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const cfg = COUNTRY_CONFIG[country];
  let y = 14;
  doc.setFontSize(16);
  doc.text(`${cfg.label} Summary`, 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Country: ${cfg.name}`, 14, y);
  y += 5;
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y);
  y += 8;

  doc.setFontSize(9);
  doc.text("No", 14, y);
  doc.text("Date", 48, y);
  doc.text("Customer", 74, y);
  doc.text("Status", 140, y);
  doc.text("Amount", 170, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  notes.slice(0, 28).forEach((note) => {
    doc.text(note.creditNoteNo, 14, y);
    doc.text(note.creditNoteDate, 48, y);
    doc.text(note.customerName.slice(0, 30), 74, y);
    doc.text(note.status, 140, y);
    doc.text(money(note.totals.total, country), 170, y, { align: "right" });
    y += 6;
  });

  const total = notes.reduce((sum, note) => sum + note.totals.total, 0);
  y += 4;
  doc.line(14, y, 196, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Total Credits: ${money(total, country)}`, 14, y);

  doc.save(`credit-note-summary-${country}.pdf`);
}

export function exportSingleCreditNotePdf(note: CreditNoteRecord) {
  const cfg = COUNTRY_CONFIG[note.country];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  doc.setFontSize(15);
  doc.text(cfg.label, 14, y);
  doc.setFontSize(10);
  y += 7;
  doc.text(`Credit Note No: ${note.creditNoteNo}`, 14, y);
  doc.text(`Date: ${note.creditNoteDate}`, 110, y);
  y += 6;
  doc.text(`Customer: ${note.customerName}`, 14, y);
  doc.text(`Invoice: ${note.linkedInvoiceNo}`, 110, y);
  y += 6;
  doc.text(`${cfg.taxLabel} Reg: ${note.registrationNumber || "-"}`, 14, y);
  doc.text(`Status: ${note.status}`, 110, y);
  y += 6;
  doc.text(`Legal: ${cfg.legalWording}`, 14, y);
  y += 8;

  doc.setFontSize(9);
  doc.text("Item", 14, y);
  doc.text("Qty", 88, y);
  doc.text("Rate", 106, y);
  doc.text("Tax %", 132, y);
  doc.text("Credit", 170, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  note.lines.slice(0, 16).forEach((line) => {
    doc.text(line.itemName.slice(0, 35), 14, y);
    doc.text(String(line.quantity), 88, y);
    doc.text(line.rate.toFixed(2), 106, y);
    doc.text(line.taxRate.toFixed(2), 132, y);
    doc.text(money(line.creditAmount, note.country), 170, y, { align: "right" });
    y += 6;
  });

  y += 2;
  doc.line(120, y, 196, y);
  y += 6;
  doc.text("Subtotal", 132, y);
  doc.text(money(note.totals.subtotal, note.country), 196, y, { align: "right" });
  y += 6;
  doc.text(`${cfg.taxLabel}`, 132, y);
  doc.text(money(note.totals.taxTotal, note.country), 196, y, { align: "right" });
  y += 6;
  doc.setFontSize(11);
  doc.text("Total Credit", 132, y);
  doc.text(money(note.totals.total, note.country), 196, y, { align: "right" });

  y += 10;
  doc.setFontSize(9);
  doc.text(cfg.legalFooter, 14, y);
  y += 5;
  doc.text(`Customer Note: ${note.customerNotes || "-"}`, 14, y);

  doc.save(`${note.creditNoteNo}.pdf`);
}

