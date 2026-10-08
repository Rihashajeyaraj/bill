import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { formatCurrencyByPreference, formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

function safeText(value, fallback = "-") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function money(value, currency) {
  return formatCurrencyByPreference(Number(value || 0), currency, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function plainNumber(value) {
  return formatNumberByPreference(Number(value || 0), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function reportFileStem(report) {
  const partyName = safeText(report?.party?.name || `${report?.party_type || "party"}-report`, `${report?.party_type || "party"}-report`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const fromDate = safeText(report?.period?.from_date || "all");
  const toDate = safeText(report?.period?.to_date || report?.period?.as_of_date || "all");
  return `${partyName || "party-report"}-${fromDate}-${toDate}`;
}

function downloadBlob(content, filename) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statementRows(report, currency) {
  return (Array.isArray(report?.transactions) ? report.transactions : []).map((row) => [
    formatDateByPreference(row?.date, "-"),
    safeText(row?.transaction_type),
    safeText(row?.reference_number),
    row?.debit ? money(row.debit, currency) : "-",
    row?.credit ? money(row.credit, currency) : "-",
    money(row?.running_balance, currency)
  ]);
}

function agingRows(report, currency) {
  return (Array.isArray(report?.aging_summary) ? report.aging_summary : []).map((row) => [
    safeText(row?.party_name),
    money(row?.total_outstanding, currency),
    money(row?.current, currency),
    money(row?.bucket_0_30, currency),
    money(row?.bucket_31_60, currency),
    money(row?.bucket_61_90, currency),
    money(row?.bucket_above_90, currency)
  ]);
}

function walletRows(report, currency) {
  return (Array.isArray(report?.wallet_history) ? report.wallet_history : []).map((row) => [
    formatDateByPreference(row?.date, "-"),
    safeText(row?.receiptNo),
    safeText(row?.invoiceNo || "-"),
    row?.amountAdded ? money(row.amountAdded, currency) : "-",
    row?.amountUsed ? money(row.amountUsed, currency) : "-",
    money(row?.remainingBalance, currency)
  ]);
}

export function exportPartyReportExcel(report, currency) {
  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["Party", safeText(report?.party?.name || `${report?.party_type || "Party"} Report`)],
    ["From Date", safeText(report?.period?.from_date || "All")],
    ["To Date", safeText(report?.period?.to_date || report?.period?.as_of_date || "Today")],
    ["Opening Balance", safeText(money(report?.opening_balance, currency))],
    ["Closing Balance", safeText(money(report?.closing_balance, currency))],
    ["Advance Wallet", safeText(money(report?.advance_wallet, currency))]
  ]);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const statementSheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Transaction Type", "Reference Number", "Debit", "Credit", "Running Balance"],
    ...statementRows(report, currency)
  ]);
  statementSheet["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(workbook, statementSheet, "Statement");

  const walletSheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Receipt", "Invoice", "Advance Added", "Advance Used", "Remaining Balance"],
    ...walletRows(report, currency)
  ]);
  walletSheet["!cols"] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, walletSheet, "Advance Wallet");

  const agingSheet = XLSX.utils.aoa_to_sheet([
    ["Party Name", "Total Outstanding", "Current", "0-30 Days", "31-60 Days", "61-90 Days", "90+ Days"],
    ...agingRows(report, currency)
  ]);
  agingSheet["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, agingSheet, "Aging Summary");

  const content = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${reportFileStem(report)}.xlsx`
  );
}

export function exportPartyReportPdf(report, currency) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margins = { left: 12, right: 12, top: 14, bottom: 12 };
  const statementWidths = [24, 30, 42, 24, 24, 32];
  const walletWidths = [24, 28, 34, 28, 28, 34];
  const agingWidths = [38, 28, 22, 22, 22, 22, 22];
  let y = margins.top;

  function ensureSpace(minHeight) {
    if (y + minHeight <= pageHeight - margins.bottom) return;
    doc.addPage();
    y = margins.top;
  }

  function drawTable(headers, rows, columnWidths) {
    ensureSpace(12);
    const tableWidth = columnWidths.reduce((sum, value) => sum + value, 0);
    doc.setFontSize(8.5);
    doc.setFillColor(241, 245, 249);
    doc.rect(margins.left, y - 4.5, tableWidth, 7, "F");
    let x = margins.left + 1.5;
    headers.forEach((label, index) => {
      const width = columnWidths[index];
      const isStatement = headers.length === 6;
      const isRightAligned = isStatement ? index >= 3 : index >= 1;
      doc.text(label, isRightAligned ? x + width - 2 : x, y, { align: isRightAligned ? "right" : "left" });
      x += width;
    });
    y += 6;

    doc.setFontSize(8);
    rows.forEach((row, rowIndex) => {
      ensureSpace(7);
      if (rowIndex % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margins.left, y - 4.5, tableWidth, 6.5, "F");
      }
      let rowX = margins.left + 1.5;
      row.forEach((value, index) => {
        const width = columnWidths[index];
        const isStatement = headers.length === 6;
        const isRightAligned = isStatement ? index >= 3 : index >= 1;
        doc.text(String(value), isRightAligned ? rowX + width - 2 : rowX, y, { align: isRightAligned ? "right" : "left" });
        rowX += width;
      });
      y += 6;
    });
  }

  doc.setFontSize(14);
  doc.text(safeText(report?.party?.name || `${report?.party_type || "Party"} Report`), margins.left, y);
  y += 7;
  doc.setFontSize(9);
  doc.text(
    `Period: ${safeText(report?.period?.from_date || "All")} to ${safeText(report?.period?.to_date || report?.period?.as_of_date || "Today")}`,
    margins.left,
    y
  );
  y += 5;
  doc.text(`Opening Balance: ${money(report?.opening_balance, currency)}`, margins.left, y);
  doc.text(`Closing Balance: ${money(report?.closing_balance, currency)}`, pageWidth - margins.right, y, {
    align: "right"
  });
  y += 8;
  doc.text(`Available Advance Balance: ${money(report?.advance_wallet, currency)}`, margins.left, y);
  y += 8;

  doc.setFontSize(10);
  doc.text("Statement", margins.left, y);
  y += 5;
  drawTable(
    ["Date", "Type", "Reference", "Debit", "Credit", "Balance"],
    statementRows(report, currency).map((row) => row.map((value) => safeText(value, ""))),
    statementWidths
  );

  y += 4;
  ensureSpace(12);
  doc.setFontSize(10);
  doc.text("Advance Wallet History", margins.left, y);
  y += 5;
  drawTable(
    ["Date", "Receipt", "Invoice", "Added", "Used", "Balance"],
    walletRows(report, currency).map((row) => row.map((value) => safeText(value, ""))),
    walletWidths
  );

  y += 4;
  ensureSpace(12);
  doc.setFontSize(10);
  doc.text("Aging Summary", margins.left, y);
  y += 5;
  drawTable(
    ["Party", "Outstanding", "Current", "0-30", "31-60", "61-90", "90+"],
    agingRows(report, currency).map((row) => row.map((value) => safeText(value, ""))),
    agingWidths
  );

  doc.save(`${reportFileStem(report)}.pdf`);
}

export function printPartyReport(report, currency) {
  const statementHtml = statementRows(report, currency)
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td style="padding:8px;border:1px solid #cbd5e1;text-align:${index >= 3 ? "right" : "left"}">${safeText(cell, "")}</td>`)
          .join("")}</tr>`
    )
    .join("");

  const agingHtml = agingRows(report, currency)
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td style="padding:8px;border:1px solid #cbd5e1;text-align:${index >= 1 ? "right" : "left"}">${safeText(cell, "")}</td>`)
          .join("")}</tr>`
    )
    .join("");

  const markup = `
    <html>
      <head>
        <title>${safeText(report?.party?.name || `${report?.party_type || "Party"} Report`)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
          h1 { margin: 0 0 4px; font-size: 20px; }
          h2 { margin: 18px 0 8px; font-size: 15px; }
          p { margin: 0 0 6px; font-size: 12px; color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
          th { padding: 8px; border: 1px solid #cbd5e1; background: #f8fafc; text-align: left; }
          .right { text-align: right; }
          .summary { display: flex; gap: 20px; margin-top: 12px; }
        </style>
      </head>
      <body>
        <h1>${safeText(report?.party?.name || `${report?.party_type || "Party"} Report`)}</h1>
        <p>Statement Period: ${safeText(report?.period?.from_date || "All")} to ${safeText(report?.period?.to_date || report?.period?.as_of_date || "Today")}</p>
        <div class="summary">
          <p>Opening Balance: ${safeText(money(report?.opening_balance, currency))}</p>
          <p>Closing Balance: ${safeText(money(report?.closing_balance, currency))}</p>
          <p>Available Advance Balance: ${safeText(money(report?.advance_wallet, currency))}</p>
        </div>
        <h2>Statement</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Transaction Type</th>
              <th>Reference Number</th>
              <th class="right">Debit</th>
              <th class="right">Credit</th>
              <th class="right">Running Balance</th>
            </tr>
          </thead>
          <tbody>${statementHtml}</tbody>
        </table>
        <h2>Advance Wallet History</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Receipt</th>
              <th>Invoice</th>
              <th class="right">Advance Added</th>
              <th class="right">Advance Used</th>
              <th class="right">Remaining Balance</th>
            </tr>
          </thead>
          <tbody>${walletRows(report, currency)
            .map(
              (row) =>
                `<tr>${row
                  .map((cell, index) => `<td style="padding:8px;border:1px solid #cbd5e1;text-align:${index >= 3 ? "right" : "left"}">${safeText(cell, "")}</td>`)
                  .join("")}</tr>`
            )
            .join("")}</tbody>
        </table>
        <h2>Aging Summary</h2>
        <table>
          <thead>
            <tr>
              <th>Party Name</th>
              <th class="right">Total Outstanding</th>
              <th class="right">Current</th>
              <th class="right">0-30 Days</th>
              <th class="right">31-60 Days</th>
              <th class="right">61-90 Days</th>
              <th class="right">90+ Days</th>
            </tr>
          </thead>
          <tbody>${agingHtml}</tbody>
        </table>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(markup);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export const exportCustomerStatementExcel = exportPartyReportExcel;
export const exportCustomerStatementPdf = exportPartyReportPdf;
export const printCustomerStatement = printPartyReport;
