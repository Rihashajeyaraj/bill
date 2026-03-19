import { jsPDF } from "jspdf";

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
  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <h2>${safeText(report?.title || "Report")}</h2>
        <p>${safeText(report?.subtitle || "", "")}</p>
        ${htmlSummary(report)}
        ${htmlSections(report)}
      </body>
    </html>
  `;

  downloadBlob(
    new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" }),
    `${getFileName(report)}.xls`
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
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
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

  function drawTable(section) {
    const columns = Array.isArray(section?.columns) ? section.columns : [];
    const rows = Array.isArray(section?.rows) ? section.rows : [];
    if (!columns.length) return;

    ensureSpace(12);
    doc.setFontSize(10);
    doc.text(safeText(section?.title || "Report Data"), margins.left, y);
    y += 5;

    const usableWidth = pageWidth - margins.left - margins.right;
    const colWidth = usableWidth / columns.length;

    ensureSpace(8);
    doc.setFontSize(8.5);
    doc.setFillColor(241, 245, 249);
    doc.rect(margins.left, y - 4.5, usableWidth, 7, "F");
    columns.forEach((column, index) => {
      doc.text(safeText(column?.label), margins.left + index * colWidth + 1.5, y);
    });
    y += 6;

    doc.setFontSize(8);
    rows.forEach((row, rowIndex) => {
      ensureSpace(7);
      if (rowIndex % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margins.left, y - 4.5, usableWidth, 6.5, "F");
      }
      row.forEach((cell, index) => {
        const text = safeText(cell, "");
        doc.text(text.slice(0, 28), margins.left + index * colWidth + 1.5, y);
      });
      y += 6;
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
