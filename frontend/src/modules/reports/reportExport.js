import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";

function safeText(value, fallback = "-") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function downloadBlob(content, filename) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getFileName(report) {
  return String(report?.filename || report?.title || "report")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";
}

function normalizeSections(report) {
  return Array.isArray(report?.sections) ? report.sections : [];
}

function estimateColumnWeight(label = "", columnCount = 0) {
  const key = String(label || "").trim().toLowerCase();
  if (!key) return 1;
  if (key.includes("customer") || key.includes("supplier") || key.includes("party")) return 1.6;
  if (key.includes("invoice") || key.includes("reference") || key.includes("bill")) return 1.35;
  if (key.includes("date")) return 0.95;
  if (key.includes("status")) return 0.95;
  if (key.includes("amount") || key.includes("total") || key.includes("paid") || key.includes("unpaid")) return 1.05;
  return columnCount >= 7 ? 1 : 1.1;
}

function buildColumnWidths(doc, columns, usableWidth) {
  const weights = columns.map((column) => estimateColumnWeight(column?.label, columns.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || columns.length || 1;
  const widths = weights.map((weight) => (usableWidth * weight) / totalWeight);
  const minWidth = columns.length >= 7 ? 20 : 24;
  let deficit = 0;

  const normalized = widths.map((width) => {
    if (width >= minWidth) return width;
    deficit += minWidth - width;
    return minWidth;
  });

  if (deficit > 0) {
    const adjustableIndexes = normalized
      .map((width, index) => ({ width, index }))
      .filter((entry) => entry.width > minWidth);
    const adjustableTotal = adjustableIndexes.reduce((sum, entry) => sum + (entry.width - minWidth), 0);
    if (adjustableTotal > 0) {
      adjustableIndexes.forEach(({ width, index }) => {
        const reducible = width - minWidth;
        const reduction = (reducible / adjustableTotal) * deficit;
        normalized[index] = Math.max(minWidth, width - reduction);
      });
    }
  }

  const totalWidth = normalized.reduce((sum, width) => sum + width, 0) || usableWidth;
  if (!totalWidth) return columns.map(() => usableWidth / Math.max(1, columns.length));
  return normalized.map((width) => (width / totalWidth) * usableWidth);
}

function toSummaryObject(report) {
  return (Array.isArray(report?.summary) ? report.summary : []).reduce((accumulator, item) => {
    const label = safeText(item?.label, "");
    if (!label) return accumulator;
    accumulator[label] = item?.value ?? "";
    return accumulator;
  }, {});
}

function toReadableSections(report) {
  return normalizeSections(report).map((section) => {
    const columns = (Array.isArray(section?.columns) ? section.columns : []).map((column, index) => ({
      key: safeText(column?.key || column?.label || `column_${index + 1}`, `column_${index + 1}`),
      label: safeText(column?.label || column?.key || `Column ${index + 1}`, `Column ${index + 1}`)
    }));

    const rows = (Array.isArray(section?.rows) ? section.rows : []).map((row) =>
      columns.reduce((accumulator, column, index) => {
        accumulator[column.label] = Array.isArray(row) ? row[index] ?? "" : "";
        return accumulator;
      }, {})
    );

    return {
      title: safeText(section?.title || "Report Data"),
      columns: columns.map((column) => column.label),
      rows
    };
  });
}

function toReadableJson(report) {
  return {
    title: report?.title || "Report",
    subtitle: report?.subtitle || "",
    filename: getFileName(report),
    summary: toSummaryObject(report),
    tables: toReadableSections(report)
  };
}

function htmlSummary(report) {
  const items = Array.isArray(report?.summary) ? report.summary : [];
  if (!items.length) return "";
  return `
    <table border="1" style="margin-bottom:16px;border-collapse:collapse;">
      <tbody>
        ${items
          .map(
            (item) =>
              `<tr><th style="padding:8px;background:#f8fafc;text-align:left;">${safeText(item?.label)}</th><td style="padding:8px;">${safeText(item?.value, "")}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function htmlSections(report) {
  return normalizeSections(report)
    .map((section) => {
      const headers = (Array.isArray(section?.columns) ? section.columns : []).map((column) => safeText(column?.label));
      const rows = Array.isArray(section?.rows) ? section.rows : [];
      return `
        <h3 style="margin:20px 0 8px;">${safeText(section?.title || "Report Data")}</h3>
        <table border="1" style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>${headers.map((header) => `<th style="padding:8px;background:#f8fafc;text-align:left;">${header}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${row
                    .map((cell) => `<td style="padding:8px;">${safeText(cell, "")}</td>`)
                    .join("")}</tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;
    })
    .join("");
}

export function exportReportExcel(report) {
  const workbook = XLSX.utils.book_new();

  const summaryRows = [
    ["Title", safeText(report?.title || "Report")],
    ["Subtitle", safeText(report?.subtitle || "", "")]
  ];
  (Array.isArray(report?.summary) ? report.summary : []).forEach((item) => {
    summaryRows.push([safeText(item?.label), safeText(item?.value, "")]);
  });
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  normalizeSections(report).forEach((section, index) => {
    const columns = Array.isArray(section?.columns) ? section.columns : [];
    const rows = Array.isArray(section?.rows) ? section.rows : [];
    const aoa = [
      columns.map((column) => safeText(column?.label || column?.key || `Column ${index + 1}`))
    ];
    rows.forEach((row) => {
      aoa.push((Array.isArray(row) ? row : []).map((cell) => safeText(cell, "")));
    });
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet["!cols"] = columns.map(() => ({ wch: 24 }));
    const sheetName = safeText(section?.title || `Section ${index + 1}`, `Section ${index + 1}`).slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName || `Section${index + 1}`);
  });

  const content = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${getFileName(report)}.xlsx`
  );
}

export function exportReportJson(report) {
  const payload = JSON.stringify(toReadableJson(report), null, 2);
  downloadBlob(
    new Blob([payload], { type: "application/json;charset=utf-8;" }),
    `${getFileName(report)}.json`
  );
}

export function printReport(report) {
  const markup = `
    <html>
      <head>
        <title>${safeText(report?.title || "Report")}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
          h1 { margin: 0 0 4px; font-size: 20px; }
          h3 { margin: 20px 0 8px; font-size: 14px; }
          p { margin: 0 0 8px; font-size: 12px; color: #475569; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { padding: 8px; border: 1px solid #cbd5e1; text-align: left; }
          th { background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>${safeText(report?.title || "Report")}</h1>
        <p>${safeText(report?.subtitle || "", "")}</p>
        ${htmlSummary(report)}
        ${htmlSections(report)}
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

export function exportReportPdf(report) {
  const widestColumnCount = normalizeSections(report).reduce((max, section) => {
    const count = Array.isArray(section?.columns) ? section.columns.length : 0;
    return Math.max(max, count);
  }, 0);
  const doc = new jsPDF({
    orientation: widestColumnCount >= 7 ? "landscape" : "portrait",
    unit: "mm",
    format: "a4"
  });
  const margins = { left: 12, right: 12, top: 14, bottom: 12 };
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = margins.top;

  function ensureSpace(height) {
    if (y + height <= pageHeight - margins.bottom) return;
    doc.addPage();
    y = margins.top;
  }

  function drawTextLine(label, value) {
    ensureSpace(6);
    doc.setFontSize(9);
    doc.text(`${safeText(label)}: ${safeText(value, "")}`, margins.left, y);
    y += 5;
  }

  function drawTableHeader(columns, columnWidths, usableWidth) {
    const baseY = y;
    const headerPaddingX = 1.8;
    const headerPaddingY = 2.2;
    const wrappedHeaders = columns.map((column, index) =>
      doc.splitTextToSize(
        safeText(column?.label),
        Math.max(8, columnWidths[index] - headerPaddingX * 2)
      )
    );
    const headerLineCount = wrappedHeaders.reduce(
      (max, lines) => Math.max(max, Array.isArray(lines) ? lines.length : 1),
      1
    );
    const headerHeight = Math.max(8, headerLineCount * 3.8 + headerPaddingY * 2);

    ensureSpace(headerHeight + 1);
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.rect(margins.left, baseY - 4.5, usableWidth, headerHeight, "FD");

    let x = margins.left;
    wrappedHeaders.forEach((lines, index) => {
      if (index > 0) {
        doc.line(x, baseY - 4.5, x, baseY - 4.5 + headerHeight);
      }
      doc.text(lines, x + headerPaddingX, baseY - 4.5 + headerPaddingY + 3);
      x += columnWidths[index];
    });

    y += headerHeight;
  }

  function drawTable(section) {
    const columns = Array.isArray(section?.columns) ? section.columns : [];
    const rows = Array.isArray(section?.rows) ? section.rows : [];
    if (!columns.length) return;

    ensureSpace(12);
    doc.setFontSize(10);
    doc.text(safeText(section?.title || "Report Data"), margins.left, y);
    y += 5;

    const usableWidth = pageWidth - margins.left - margins.right;
    const columnWidths = buildColumnWidths(doc, columns, usableWidth);
    doc.setFontSize(8.5);
    drawTableHeader(columns, columnWidths, usableWidth);

    doc.setFontSize(8);
    rows.forEach((row, rowIndex) => {
      const wrappedCells = columns.map((_, index) =>
        doc.splitTextToSize(
          safeText(Array.isArray(row) ? row[index] : "", ""),
          Math.max(8, columnWidths[index] - 3.6)
        )
      );
      const maxLines = wrappedCells.reduce(
        (max, lines) => Math.max(max, Array.isArray(lines) ? lines.length : 1),
        1
      );
      const rowHeight = Math.max(7, maxLines * 3.8 + 3.2);
      if (y + rowHeight > pageHeight - margins.bottom) {
        doc.addPage();
        y = margins.top;
        doc.setFontSize(8.5);
        drawTableHeader(columns, columnWidths, usableWidth);
        doc.setFontSize(8);
      }
      const rowTop = y - 4.5;
      doc.setFillColor(rowIndex % 2 === 0 ? 255 : 248, rowIndex % 2 === 0 ? 255 : 250, rowIndex % 2 === 0 ? 255 : 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.rect(margins.left, rowTop, usableWidth, rowHeight, "FD");

      let x = margins.left;
      wrappedCells.forEach((lines, index) => {
        if (index > 0) {
          doc.line(x, rowTop, x, rowTop + rowHeight);
        }
        doc.text(lines, x + 1.8, rowTop + 5);
        x += columnWidths[index];
      });
      y += rowHeight;
    });

    y += 2;
  }

  doc.setFontSize(14);
  doc.text(safeText(report?.title || "Report"), margins.left, y);
  y += 7;

  if (report?.subtitle) {
    doc.setFontSize(9);
    doc.text(safeText(report.subtitle), margins.left, y);
    y += 6;
  }

  (Array.isArray(report?.summary) ? report.summary : []).forEach((item) => {
    drawTextLine(item?.label, item?.value);
  });

  normalizeSections(report).forEach((section) => {
    drawTable(section);
  });

  doc.save(`${getFileName(report)}.pdf`);
}
