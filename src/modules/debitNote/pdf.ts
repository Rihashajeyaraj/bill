import { jsPDF } from "jspdf";
import { COUNTRY_CONFIG } from "./countryConfig";
import type { CountryCode } from "./countryConfig";
import type { DebitNoteRecord } from "./store";
import { formatCurrencyByPreference, formatDateTimeByPreference } from "../../lib/formatPreferences";
import { drawPdfPartyDetails } from "../reports/pdfPartyDetails";

function money(value: number, country: CountryCode) {
  const currency = COUNTRY_CONFIG[country].currency;
  return formatCurrencyByPreference(Number(value || 0), currency, { maximumFractionDigits: 2 });
}

function downloadBlob(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportDebitNotesCsv(notes: DebitNoteRecord[], country: CountryCode) {
  const rows = [
    [
      "Debit Note No",
      "Date",
      "Supplier",
      "Purchase Invoice",
      "Reason",
      "Status",
      "Debit Type",
      "Total Amount",
      "Tax",
      "Currency"
    ],
    ...notes.map((note) => [
      note.debitNoteNo,
      note.debitNoteDate,
      note.supplierName,
      note.linkedPurchaseInvoiceNo,
      note.reason,
      note.status,
      note.debitType,
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

  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `debit-notes-${country}.csv`);
}

export function exportDebitNoteSummaryPdf(notes: DebitNoteRecord[], country: CountryCode) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const cfg = COUNTRY_CONFIG[country];
  let y = 14;
  doc.setFontSize(16);
  doc.text(`${cfg.label} Summary`, 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Country: ${cfg.name}`, 14, y);
  y += 5;
  doc.text(`Generated: ${formatDateTimeByPreference(new Date())}`, 14, y);
  y += 8;

  doc.setFontSize(9);
  doc.text("No", 14, y);
  doc.text("Date", 48, y);
  doc.text("Supplier", 74, y);
  doc.text("Status", 140, y);
  doc.text("Amount", 170, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  notes.slice(0, 28).forEach((note) => {
    doc.text(note.debitNoteNo, 14, y);
    doc.text(note.debitNoteDate, 48, y);
    doc.text(note.supplierName.slice(0, 30), 74, y);
    doc.text(note.status, 140, y);
    doc.text(money(note.totals.total, country), 170, y, { align: "right" });
    y += 6;
  });

  const total = notes.reduce((sum, note) => sum + note.totals.total, 0);
  y += 4;
  doc.line(14, y, 196, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Total Debits: ${money(total, country)}`, 14, y);

  doc.save(`debit-note-summary-${country}.pdf`);
}

export function exportSingleDebitNotePdf(note: DebitNoteRecord) {
  const cfg = COUNTRY_CONFIG[note.country];
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  doc.setFontSize(15);
  doc.text(cfg.label, 14, y);
  doc.setFontSize(10);
  y += 7;
  doc.text(`Debit Note No: ${note.debitNoteNo}`, 14, y);
  doc.text(`Date: ${note.debitNoteDate}`, 110, y);
  y += 6;
  const partyBlockBottom = drawPdfPartyDetails(
    doc,
    {
      partyId: note.supplierId,
      supplierName: note.supplierName,
      address: (note as DebitNoteRecord & { address?: string })?.address,
      phone: (note as DebitNoteRecord & { phone?: string })?.phone,
      email: (note as DebitNoteRecord & { email?: string })?.email
    },
    {
      x: 14,
      y,
      maxWidth: 82,
      title: "Party Details",
      nameLabel: "Name"
    }
  );
  doc.text(`Purchase Invoice: ${note.linkedPurchaseInvoiceNo}`, 110, y);
  y = Math.max(partyBlockBottom, y + 6);
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
  doc.text("Debit", 170, y, { align: "right" });
  y += 4;
  doc.line(14, y, 196, y);
  y += 5;

  note.lines.slice(0, 16).forEach((line) => {
    doc.text(line.itemName.slice(0, 35), 14, y);
    doc.text(String(line.quantity), 88, y);
    doc.text(line.rate.toFixed(2), 106, y);
    doc.text(line.taxRate.toFixed(2), 132, y);
    doc.text(money(line.debitAmount, note.country), 170, y, { align: "right" });
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
  doc.text("Total Debit", 132, y);
  doc.text(money(note.totals.total, note.country), 196, y, { align: "right" });

  y += 10;
  doc.setFontSize(9);
  doc.text(cfg.legalFooter, 14, y);
  y += 5;
  doc.text(`Supplier Note: ${note.supplierNotes || "-"}`, 14, y);

  doc.save(`${note.debitNoteNo}.pdf`);
}

