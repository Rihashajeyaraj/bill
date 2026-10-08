import { jsPDF } from "jspdf";
import { COUNTRY_CONFIG } from "./countryConfig";
import type { CountryCode } from "./countryConfig";
import type { DebitNoteRecord } from "./store";
import { formatDateTimeByPreference, formatNumberByPreference } from "../../lib/formatPreferences";
import { drawPdfPartyDetails } from "../reports/pdfPartyDetails";

function pdfSafeText(value: unknown, fallback = "-") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function money(value: number, country: CountryCode) {
  const currency = pdfSafeText(COUNTRY_CONFIG[country].currency, "").slice(0, 8);
  const amount = formatNumberByPreference(Number(value || 0), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return currency ? `${currency} ${amount}` : amount;
}

function drawWrappedText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 4.5) {
  const lines = doc.splitTextToSize(pdfSafeText(text), maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
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
  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);
  doc.text(pdfSafeText(`${cfg.label} Summary`), 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Country: ${pdfSafeText(cfg.name)}`, 14, y);
  y += 5;
  doc.text(`Generated: ${pdfSafeText(formatDateTimeByPreference(new Date()))}`, 14, y);
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
    doc.text(pdfSafeText(note.debitNoteNo), 14, y);
    doc.text(pdfSafeText(note.debitNoteDate), 48, y);
    doc.text(pdfSafeText(note.supplierName, "").slice(0, 30) || "-", 74, y);
    doc.text(pdfSafeText(note.status), 140, y);
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
  doc.setFont("helvetica", "normal");

  doc.setFontSize(15);
  doc.text(pdfSafeText(cfg.label), 14, y);
  doc.setFontSize(10);
  y += 7;
  doc.text(`Debit Note No: ${pdfSafeText(note.debitNoteNo)}`, 14, y);
  doc.text(`Date: ${pdfSafeText(note.debitNoteDate)}`, 110, y);
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
  doc.text(`Purchase Invoice: ${pdfSafeText(note.linkedPurchaseInvoiceNo)}`, 110, y);
  y = Math.max(partyBlockBottom, y + 6);
  doc.text(`${pdfSafeText(cfg.taxLabel)} Reg: ${pdfSafeText(note.registrationNumber || "-")}`, 14, y);
  doc.text(`Status: ${pdfSafeText(note.status)}`, 110, y);
  y += 6;
  y = drawWrappedText(doc, `Legal: ${cfg.legalWording}`, 14, y, 182);
  y += 3;

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
    doc.text(pdfSafeText(line.itemName, "").slice(0, 35) || "-", 14, y);
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
  y = drawWrappedText(doc, cfg.legalFooter, 14, y, 182);
  y += 1;
  drawWrappedText(doc, `Supplier Note: ${note.supplierNotes || "-"}`, 14, y, 182);

  doc.save(`${note.debitNoteNo}.pdf`);
}

