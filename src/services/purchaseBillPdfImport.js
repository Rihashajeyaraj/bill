let pdfJsModulePromise = null;
let tesseractModulePromise = null;
let xlsxModulePromise = null;
const PDF_WORKER_PATH = "/pdfjs/pdf.worker.min.mjs";
const OCR_WORKER_PATH = "/tesseract/worker.min.js";
const OCR_CORE_PATH = "/tesseract-core";
const OCR_LANG_PATH = "/tessdata";

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanLine(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/[|]/g, " ")
      .replace(/[*]/g, " ")
      .replace(/\t/g, " ")
  );
}

function normalizeKey(value) {
  return cleanLine(value).toLowerCase();
}

function extractNumber(value) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateCandidate(value) {
  const text = cleanLine(value);
  if (!text) return "";

  const parts = text.match(/^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})$/);
  if (parts) {
    let a = Number(parts[1]);
    let b = Number(parts[2]);
    let c = Number(parts[3]);
    if (![a, b, c].every(Number.isFinite)) return "";

    let year = c;
    let month = b;
    let day = a;

    if (String(parts[1]).length === 4 || a > 31) {
      year = a;
      month = b;
      day = c;
    } else if (c < 100) {
      year = c >= 70 ? 1900 + c : 2000 + c;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const monthDate = Date.parse(text);
  if (Number.isFinite(monthDate)) {
    return new Date(monthDate).toISOString().slice(0, 10);
  }

  return "";
}

function extractLabeledValue(lines, labels) {
  for (let index = 0; index < lines.length; index += 1) {
    const current = cleanLine(lines[index]);
    const normalized = normalizeKey(current);
    const matchedLabel = labels.find((label) => normalized.includes(label));
    if (!matchedLabel) continue;

    const labelPattern = new RegExp(`^.*?${matchedLabel}\\s*[:#-]?\\s*`, "i");
    const inlineValue = cleanLine(current.replace(labelPattern, ""));
    if (inlineValue && normalizeKey(inlineValue) !== matchedLabel) {
      return inlineValue;
    }

    for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 4); nextIndex += 1) {
      const nextLine = cleanLine(lines[nextIndex]);
      if (!nextLine) continue;
      const nextKey = normalizeKey(nextLine);
      if (labels.some((label) => nextKey.includes(label))) continue;
      return nextLine;
    }
  }
  return "";
}

function lineLooksLikeSummary(value) {
  const normalized = normalizeKey(value);
  return [
    "subtotal",
    "sub total",
    "grand total",
    "total amount",
    "total",
    "net total",
    "discount",
    "tax",
    "cgst",
    "sgst",
    "igst",
    "vat",
    "balance",
    "paid",
    "amount due",
    "round off"
  ].some((label) => normalized.includes(label));
}

function lineLooksLikeHeader(value) {
  const normalized = normalizeKey(value);
  const hasDescription = normalized.includes("description") || normalized.includes("item");
  const hasQty = normalized.includes("qty") || normalized.includes("quantity");
  const hasRate = normalized.includes("rate") || normalized.includes("price");
  return hasDescription && hasQty && hasRate;
}

function findBestItemShape(tokens, amountIndex, amountValue) {
  const numericEntries = tokens
    .map((token, index) => ({ index, value: extractNumber(token) }))
    .filter((entry) => entry.value !== null && entry.index < amountIndex);

  let best = null;
  for (const qtyEntry of numericEntries) {
    if (qtyEntry.value <= 0) continue;
    for (const rateEntry of numericEntries) {
      if (rateEntry.index <= qtyEntry.index || rateEntry.value < 0) continue;
      const estimated = qtyEntry.value * rateEntry.value;
      const distance = Math.abs(amountValue - estimated);
      const relativeDistance = distance / Math.max(Math.abs(amountValue), 1);
      const descriptionTokens = tokens.slice(0, qtyEntry.index).filter(Boolean);
      const descriptionScore = descriptionTokens.length > 0 ? 0 : 1;
      const score = relativeDistance + descriptionScore;
      if (!best || score < best.score) {
        best = {
          qtyIndex: qtyEntry.index,
          qty: qtyEntry.value,
          rateIndex: rateEntry.index,
          rate: rateEntry.value,
          score
        };
      }
    }
  }

  return best;
}

function parseItemLine(value) {
  const line = cleanLine(value);
  if (!line || lineLooksLikeSummary(line) || lineLooksLikeHeader(line)) return null;
  if (
    ["mobile", "phone", "invoice", "bill no", "bill date", "supplier", "vendor"].some((label) =>
      normalizeKey(line).includes(label)
    )
  ) {
    return null;
  }

  const tokens = line.split(" ").filter(Boolean);
  if (tokens.length < 3) return null;

  const numericEntries = tokens
    .map((token, index) => ({ index, value: extractNumber(token) }))
    .filter((entry) => entry.value !== null);
  if (numericEntries.length < 2) return null;

  const amountEntry = [...numericEntries].reverse().find((entry) => entry.value > 0);
  if (!amountEntry) return null;

  const bestShape = findBestItemShape(tokens, amountEntry.index, amountEntry.value);
  if (!bestShape) return null;

  const descriptionTokens = tokens.slice(0, bestShape.qtyIndex).filter(Boolean);
  if (descriptionTokens.length > 1 && extractNumber(descriptionTokens[0]) !== null) {
    descriptionTokens.shift();
  }
  const description = cleanLine(descriptionTokens.join(" "));
  if (!description || description.length < 2) return null;

  let unit = "";
  for (let index = bestShape.qtyIndex + 1; index < bestShape.rateIndex; index += 1) {
    const token = String(tokens[index] || "").trim();
    if (!token || extractNumber(token) !== null) continue;
    if (/^[a-zA-Z]{1,12}$/.test(token)) {
      unit = token.toLowerCase();
      break;
    }
  }

  let tax = null;
  for (let index = bestShape.rateIndex + 1; index < amountEntry.index; index += 1) {
    const numericValue = extractNumber(tokens[index]);
    if (numericValue === null) continue;
    if (numericValue >= 0 && numericValue <= 100) {
      tax = numericValue;
      break;
    }
  }

  const fallbackRate =
    bestShape.qty > 0 ? round2(amountEntry.value / Math.max(bestShape.qty, 1)) : amountEntry.value;
  const rate = bestShape.rate > 0 ? bestShape.rate : fallbackRate;
  if (bestShape.qty <= 0 || rate < 0) return null;

  return {
    description,
    qty: bestShape.qty,
    unit,
    rate: round2(rate),
    amount: round2(amountEntry.value),
    tax
  };
}

function dedupeLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    const key = JSON.stringify([
      line.description,
      line.qty,
      line.unit,
      line.rate,
      line.amount,
      line.tax
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseItemLines(lines) {
  const collected = [];
  const hasTableHeader = lines.some((line) => lineLooksLikeHeader(line));
  let tableStarted = false;

  for (const line of lines) {
    if (!line) continue;
    if (lineLooksLikeHeader(line)) {
      tableStarted = true;
      continue;
    }
    if (hasTableHeader && !tableStarted) {
      continue;
    }
    if (tableStarted && lineLooksLikeSummary(line)) {
      break;
    }
    const parsed = parseItemLine(line);
    if (!parsed) continue;
    collected.push(parsed);
  }

  if (collected.length) return dedupeLines(collected);
  return dedupeLines(lines.map(parseItemLine).filter(Boolean));
}

function extractBillNumber(lines) {
  const labels = [
    "invoice no",
    "invoice number",
    "invoice #",
    "bill no",
    "bill number",
    "bill id"
  ];
  const rawValue = extractLabeledValue(lines, labels);
  if (!rawValue) return "";
  const match = rawValue.match(/[A-Z0-9][A-Z0-9/_-]*/i);
  return match ? match[0] : rawValue;
}

function extractBillDate(lines) {
  const labels = ["invoice date", "bill date", "date"];
  const inlineValue = extractLabeledValue(lines, labels);
  if (inlineValue) {
    const parsed = parseDateCandidate(inlineValue);
    if (parsed) return parsed;
  }

  for (const line of lines) {
    const parsed = parseDateCandidate(line);
    if (parsed) return parsed;
  }

  const match = cleanLine(lines.join(" ")).match(
    /\b(\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}|[A-Za-z]{3,12}\s+\d{1,2},?\s+\d{4})\b/
  );
  return match ? parseDateCandidate(match[1]) : "";
}

function extractSupplierName(lines) {
  const labels = ["supplier", "vendor", "bill from", "from"];
  const direct = extractLabeledValue(lines, labels);
  if (direct) return direct;

  const firstUseful = lines.find((line) => {
    const normalized = normalizeKey(line);
    if (!normalized) return false;
    if (normalized.length < 3) return false;
    if (lineLooksLikeSummary(normalized) || lineLooksLikeHeader(normalized)) return false;
    if (normalized.includes("invoice") || normalized.includes("bill")) return false;
    if (extractNumber(normalized) !== null) return false;
    return true;
  });
  return firstUseful || "";
}

function extractPhone(text) {
  const match = String(text || "").match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,6}/);
  return match ? cleanLine(match[0]) : "";
}

function excelSerialDateToIso(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 0) return "";
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const parsed = new Date(utcValue * 1000);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function pickFirstValue(record, keys) {
  if (!record || typeof record !== "object") return "";
  for (const key of keys) {
    const matchedKey = Object.keys(record).find((entry) => normalizeKey(entry) === normalizeKey(key));
    if (!matchedKey) continue;
    const value = record[matchedKey];
    if (value === null || value === undefined) continue;
    const text = cleanLine(value);
    if (text) return text;
    if (typeof value === "number") return String(value);
  }
  return "";
}

function parseSpreadsheetDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const numericDate = excelSerialDateToIso(value);
  if (numericDate) return numericDate;
  return parseDateCandidate(value);
}

function normalizeSpreadsheetCell(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (value === null || value === undefined) return "";
  return cleanLine(value);
}

function rowToCells(row) {
  if (Array.isArray(row)) {
    return row.map(normalizeSpreadsheetCell);
  }
  if (row && typeof row === "object") {
    return Object.values(row).map(normalizeSpreadsheetCell);
  }
  return [normalizeSpreadsheetCell(row)];
}

function objectRowToMatrixRow(row) {
  const entries = Object.entries(row || {});
  const keys = entries.map(([key]) => normalizeKey(key));
  const hasMeaningfulKeys = keys.some(
    (key) => key && !/^[a-z]{1,3}$/.test(key) && !/^\d+$/.test(key)
  );

  if (!hasMeaningfulKeys) {
    return Object.values(row || {}).map(normalizeSpreadsheetCell);
  }

  return entries.flatMap(([key, value]) => [normalizeSpreadsheetCell(key), normalizeSpreadsheetCell(value)]);
}

function matrixToLines(matrix) {
  return matrix
    .map((row) => rowToCells(row).filter(Boolean).join(" "))
    .map(cleanLine)
    .filter(Boolean);
}

function normalizeSpreadsheetItem(row) {
  const description = pickFirstValue(row, [
    "item",
    "item name",
    "product",
    "product name",
    "description",
    "service"
  ]);
  if (!description) return null;

  const qty = extractNumber(
    pickFirstValue(row, ["qty", "quantity", "qnty", "purchase qty", "bill qty"])
  );
  const rate = extractNumber(
    pickFirstValue(row, ["rate", "price", "unit price", "purchase rate", "cost"])
  );
  const amount = extractNumber(
    pickFirstValue(row, ["amount", "line total", "total", "net amount", "value"])
  );
  const unit = pickFirstValue(row, ["unit", "uom"]);
  const tax = extractNumber(
    pickFirstValue(row, ["tax", "tax %", "tax rate", "gst", "vat"])
  );

  const safeQty = qty && qty > 0 ? qty : 1;
  const safeRate = rate !== null && rate >= 0 ? rate : amount !== null ? round2(amount / safeQty) : 0;
  const safeAmount = amount !== null ? amount : round2(safeQty * safeRate);
  if (safeRate <= 0 && safeAmount <= 0) return null;

  return {
    description,
    qty: safeQty,
    unit: unit.toLowerCase() || "",
    rate: safeRate,
    amount: safeAmount,
    tax
  };
}

export function parsePurchaseBillSpreadsheetRows(rows) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  const headerRecord = list.find((row) => {
    const keys = Object.keys(row).map((entry) => normalizeKey(entry));
    return keys.some((key) =>
      ["supplier", "vendor", "bill no", "invoice no", "bill date", "invoice date"].includes(key)
    );
  }) || {};

  const items = dedupeLines(list.map(normalizeSpreadsheetItem).filter(Boolean));
  const warnings = [];
  if (!items.length) {
    warnings.push("No item rows were confidently extracted from the spreadsheet.");
  }

  const supplierName = pickFirstValue(headerRecord, ["supplier", "supplier name", "vendor", "vendor name"]);
  const supplierPhone = pickFirstValue(headerRecord, ["phone", "mobile", "supplier phone", "vendor phone"]);
  const billNumber = pickFirstValue(headerRecord, ["bill no", "bill number", "invoice no", "invoice number"]);
  const billDate = parseSpreadsheetDate(
    pickFirstValue(headerRecord, ["bill date", "invoice date", "date"])
  );

  if (!supplierName) {
    warnings.push("Supplier name could not be identified automatically.");
  }
  if (!billNumber) {
    warnings.push("Bill number could not be identified automatically.");
  }
  if (!billDate) {
    warnings.push("Bill date could not be identified automatically.");
  }

  const parsed = {
    supplierName,
    supplierPhone,
    billNumber,
    billDate,
    items,
    warnings,
    rawText: JSON.stringify(list)
  };

  if (hasUsefulPurchaseData(parsed) && items.length) {
    return parsed;
  }

  const matrixParsed = parsePurchaseBillSpreadsheetMatrix(
    list.map((row) => (Array.isArray(row) ? row : objectRowToMatrixRow(row)))
  );
  return hasUsefulPurchaseData(matrixParsed) ? matrixParsed : parsed;
}

function classifySpreadsheetColumn(value) {
  const normalized = normalizeKey(value);
  if (!normalized) return "";
  if (
    [
      "item",
      "item name",
      "description",
      "product",
      "product name",
      "particulars",
      "service"
    ].includes(normalized)
  ) {
    return "description";
  }
  if (["qty", "quantity", "qnty", "purchase qty", "bill qty"].includes(normalized)) {
    return "qty";
  }
  if (["unit", "uom", "unit type"].includes(normalized)) {
    return "unit";
  }
  if (["rate", "price", "unit price", "purchase rate", "cost", "unit cost"].includes(normalized)) {
    return "rate";
  }
  if (["amount", "line total", "total", "net amount", "value", "line amount"].includes(normalized)) {
    return "amount";
  }
  if (["tax", "tax %", "tax rate", "gst", "vat"].includes(normalized)) {
    return "tax";
  }
  return "";
}

function detectSpreadsheetTable(matrix) {
  let best = null;

  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    const row = rowToCells(matrix[rowIndex]);
    const columnMap = {};
    row.forEach((cell, columnIndex) => {
      const field = classifySpreadsheetColumn(cell);
      if (field && columnMap[field] === undefined) {
        columnMap[field] = columnIndex;
      }
    });

    const recognizedCount = Object.keys(columnMap).length;
    if (
      columnMap.description === undefined ||
      (columnMap.qty === undefined && columnMap.amount === undefined && columnMap.rate === undefined) ||
      recognizedCount < 2
    ) {
      continue;
    }

    let itemCount = 0;
    const items = [];
    for (let nextIndex = rowIndex + 1; nextIndex < matrix.length; nextIndex += 1) {
      const nextRow = rowToCells(matrix[nextIndex]);
      const joined = cleanLine(nextRow.join(" "));
      if (!joined) {
        if (itemCount > 0) break;
        continue;
      }
      if (lineLooksLikeSummary(joined)) {
        if (itemCount > 0) break;
        continue;
      }

      const description = cleanLine(nextRow[columnMap.description] || "");
      if (!description || classifySpreadsheetColumn(description)) continue;

      const qty =
        columnMap.qty !== undefined ? extractNumber(nextRow[columnMap.qty]) : null;
      const rate =
        columnMap.rate !== undefined ? extractNumber(nextRow[columnMap.rate]) : null;
      const amount =
        columnMap.amount !== undefined ? extractNumber(nextRow[columnMap.amount]) : null;
      const unit =
        columnMap.unit !== undefined ? cleanLine(nextRow[columnMap.unit] || "").toLowerCase() : "";
      const tax =
        columnMap.tax !== undefined ? extractNumber(nextRow[columnMap.tax]) : null;

      const safeQty = qty && qty > 0 ? qty : 1;
      const safeRate = rate !== null && rate >= 0 ? rate : amount !== null ? round2(amount / safeQty) : 0;
      const safeAmount = amount !== null ? amount : round2(safeQty * safeRate);
      if (safeRate <= 0 && safeAmount <= 0) continue;

      items.push({
        description,
        qty: safeQty,
        unit,
        rate: safeRate,
        amount: safeAmount,
        tax
      });
      itemCount += 1;
    }

    if (!itemCount) continue;

    const candidate = {
      rowIndex,
      columnMap,
      items: dedupeLines(items)
    };

    if (!best || candidate.items.length > best.items.length) {
      best = candidate;
    }
  }

  return best;
}

function extractSpreadsheetMetadataFromMatrix(matrix) {
  const lines = matrixToLines(matrix);
  let supplierName = "";
  let supplierPhone = "";
  let billNumber = "";
  let billDate = "";

  for (const row of matrix) {
    const cells = rowToCells(row).filter(Boolean);
    if (cells.length < 2) continue;

    for (let index = 0; index < cells.length - 1; index += 1) {
      const label = normalizeKey(cells[index]);
      const value = cleanLine(cells[index + 1]);
      if (!value) continue;

      if (!supplierName && ["supplier", "supplier name", "vendor", "vendor name", "party"].includes(label)) {
        supplierName = value;
      }
      if (!supplierPhone && ["phone", "mobile", "supplier phone", "vendor phone"].includes(label)) {
        supplierPhone = value;
      }
      if (!billNumber && ["bill no", "bill number", "invoice no", "invoice number", "bill id"].includes(label)) {
        billNumber = value;
      }
      if (!billDate && ["bill date", "invoice date", "date"].includes(label)) {
        billDate = parseSpreadsheetDate(value);
      }
    }
  }

  if (!supplierName) supplierName = extractSupplierName(lines);
  if (!supplierPhone) supplierPhone = extractPhone(lines.join(" "));
  if (!billNumber) billNumber = extractBillNumber(lines);
  if (!billDate) billDate = extractBillDate(lines);

  return {
    supplierName,
    supplierPhone,
    billNumber,
    billDate
  };
}

function parsePurchaseBillSpreadsheetMatrix(matrix) {
  const normalizedMatrix = Array.isArray(matrix)
    ? matrix.map((row) => rowToCells(row)).filter((row) => row.some(Boolean))
    : [];
  const table = detectSpreadsheetTable(normalizedMatrix);
  const metadata = extractSpreadsheetMetadataFromMatrix(normalizedMatrix);
  const warnings = [];
  const items = table?.items || [];

  if (!items.length) {
    warnings.push("No item rows were confidently extracted from the spreadsheet.");
  }
  if (!metadata.supplierName) {
    warnings.push("Supplier name could not be identified automatically.");
  }
  if (!metadata.billNumber) {
    warnings.push("Bill number could not be identified automatically.");
  }
  if (!metadata.billDate) {
    warnings.push("Bill date could not be identified automatically.");
  }

  return {
    supplierName: metadata.supplierName,
    supplierPhone: metadata.supplierPhone,
    billNumber: metadata.billNumber,
    billDate: metadata.billDate,
    items,
    warnings,
    rawText: matrixToLines(normalizedMatrix).join("\n")
  };
}

export function parsePurchaseBillText(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  const items = parseItemLines(lines);
  const warnings = [];
  if (!items.length) {
    warnings.push("No item rows were confidently extracted from the PDF.");
  }

  const supplierName = extractSupplierName(lines);
  if (!supplierName) {
    warnings.push("Supplier name could not be identified automatically.");
  }

  const billNumber = extractBillNumber(lines);
  if (!billNumber) {
    warnings.push("Bill number could not be identified automatically.");
  }

  const billDate = extractBillDate(lines);
  if (!billDate) {
    warnings.push("Bill date could not be identified automatically.");
  }

  return {
    supplierName,
    supplierPhone: extractPhone(lines.join(" ")),
    billNumber,
    billDate,
    items,
    warnings,
    rawText: lines.join("\n")
  };
}

function hasUsefulPurchaseData(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  return Boolean(
    String(parsed.billNumber || "").trim() ||
      String(parsed.billDate || "").trim() ||
      String(parsed.supplierName || "").trim() ||
      (Array.isArray(parsed.items) && parsed.items.length)
  );
}

function rebuildPageLines(textContent) {
  const rawItems = Array.isArray(textContent?.items) ? textContent.items : [];
  const positioned = rawItems
    .map((item) => ({
      text: cleanLine(item?.str),
      x: Number(item?.transform?.[4] || 0),
      y: Number(item?.transform?.[5] || 0)
    }))
    .filter((item) => item.text);

  positioned.sort((left, right) => {
    if (Math.abs(right.y - left.y) > 2) return right.y - left.y;
    return left.x - right.x;
  });

  const lines = [];
  for (const item of positioned) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine || Math.abs(lastLine.y - item.y) > 3) {
      lines.push({ y: item.y, parts: [item] });
      continue;
    }
    lastLine.parts.push(item);
  }

  return lines
    .map((line) =>
      line.parts
        .sort((left, right) => left.x - right.x)
        .map((part) => part.text)
        .join(" ")
    )
    .map(cleanLine)
    .filter(Boolean);
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/build/pdf.mjs").then((module) => {
      if (module?.GlobalWorkerOptions) {
        module.GlobalWorkerOptions.workerSrc = PDF_WORKER_PATH;
      }
      return module;
    });
  }
  return pdfJsModulePromise;
}

async function loadTesseractModule() {
  if (!tesseractModulePromise) {
    tesseractModulePromise = import("tesseract.js");
  }
  return tesseractModulePromise;
}

async function loadXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx");
  }
  return xlsxModulePromise;
}

async function extractTextFromPdf(file) {
  const pdfjs = await loadPdfJsModule();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pages.push(rebuildPageLines(textContent).join("\n"));
  }

  return pages.filter(Boolean).join("\n");
}

function prepareCanvasForOcr(canvas, context) {
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const gray = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
    const contrasted = gray > 185 ? 255 : 0;
    pixels[index] = contrasted;
    pixels[index + 1] = contrasted;
    pixels[index + 2] = contrasted;
  }

  context.putImageData(imageData, 0, 0);
}

function cloneCanvas(sourceCanvas) {
  const clonedCanvas = document.createElement("canvas");
  clonedCanvas.width = sourceCanvas.width;
  clonedCanvas.height = sourceCanvas.height;
  const clonedContext = clonedCanvas.getContext("2d", { willReadFrequently: true });
  if (!clonedContext) {
    throw new Error("Could not clone OCR canvas.");
  }
  clonedContext.drawImage(sourceCanvas, 0, 0);
  return { canvas: clonedCanvas, context: clonedContext };
}

function enhanceCanvasForOcr(canvas, context, mode) {
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    const baseRed = alpha === 0 ? 255 : pixels[index];
    const baseGreen = alpha === 0 ? 255 : pixels[index + 1];
    const baseBlue = alpha === 0 ? 255 : pixels[index + 2];
    const gray = Math.round(baseRed * 0.299 + baseGreen * 0.587 + baseBlue * 0.114);

    let nextGray = gray;
    if (mode === "contrast") {
      nextGray = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.7 + 128)));
    } else if (mode === "threshold") {
      nextGray = gray > 175 ? 255 : 0;
    }

    pixels[index] = nextGray;
    pixels[index + 1] = nextGray;
    pixels[index + 2] = nextGray;
    pixels[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
}

function scoreOcrText(result) {
  const text = String(result?.data?.text || "");
  const confidence = Number(result?.data?.confidence || 0);
  const alnumCount = (text.match(/[A-Za-z0-9]/g) || []).length;
  const lineCount = text
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter(Boolean).length;
  return confidence + alnumCount * 0.2 + lineCount * 2;
}

function buildPageOcrVariants(page, documentObject) {
  const baseScale = 3;
  const viewport = page.getViewport({ scale: baseScale });
  const baseCanvas = documentObject.createElement("canvas");
  const baseContext = baseCanvas.getContext("2d", { willReadFrequently: true });
  if (!baseContext) {
    throw new Error("Could not create OCR canvas.");
  }

  baseCanvas.width = Math.ceil(viewport.width);
  baseCanvas.height = Math.ceil(viewport.height);

  return page
    .render({
      canvasContext: baseContext,
      viewport
    })
    .promise.then(() => {
      prepareCanvasForOcr(baseCanvas, baseContext);

      const original = cloneCanvas(baseCanvas);
      const contrast = cloneCanvas(baseCanvas);
      const threshold = cloneCanvas(baseCanvas);

      enhanceCanvasForOcr(contrast.canvas, contrast.context, "contrast");
      enhanceCanvasForOcr(threshold.canvas, threshold.context, "threshold");

      return [
        { canvas: original.canvas, mode: "original" },
        { canvas: contrast.canvas, mode: "contrast" },
        { canvas: threshold.canvas, mode: "threshold" }
      ];
    });
}

async function recognizeBestOcrResult(worker, psmModes, canvasVariants) {
  let bestResult = null;

  for (const psmMode of psmModes) {
    await worker.setParameters({
      tessedit_pageseg_mode: String(psmMode),
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    });

    for (const variant of canvasVariants) {
      const result = await worker.recognize(variant.canvas);
      const text = cleanLine(result?.data?.text || "");
      if (!text) continue;
      const score = scoreOcrText(result);
      if (!bestResult || score > bestResult.score) {
        bestResult = {
          score,
          text: String(result?.data?.text || "").trim(),
          mode: variant.mode,
          psmMode
        };
      }
    }
  }

  return bestResult;
}

async function extractTextFromPdfUsingOcr(file) {
  if (typeof document === "undefined") {
    throw new Error("OCR is only available in the browser.");
  }

  const pdfjs = await loadPdfJsModule();
  const tesseractModule = await loadTesseractModule();
  const createWorker =
    tesseractModule?.createWorker || tesseractModule?.default?.createWorker;
  const PSM = tesseractModule?.PSM || tesseractModule?.default?.PSM || {};
  if (typeof createWorker !== "function") {
    throw new Error("OCR engine failed to load.");
  }

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  const pageLimit = Math.min(pdf.numPages, 4);
  let lastOcrError = "";
  const worker = await createWorker("eng", 1, {
    workerPath: OCR_WORKER_PATH,
    corePath: OCR_CORE_PATH,
    langPath: OCR_LANG_PATH,
    gzip: true,
    workerBlobURL: false,
    logger: () => {},
    errorHandler: (error) => {
      lastOcrError = String(error?.message || error || "");
    }
  });

  try {
    const psmModes = [
      PSM.SPARSE_TEXT ?? "11",
      PSM.SINGLE_BLOCK ?? "6",
      PSM.SINGLE_COLUMN ?? "4"
    ];

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const canvasVariants = await buildPageOcrVariants(page, document);
      const bestResult = await recognizeBestOcrResult(worker, psmModes, canvasVariants);
      if (bestResult?.text) {
        pages.push(bestResult.text);
      }
    }
  } catch (error) {
    const reason = String(error?.message || lastOcrError || error || "").trim();
    throw new Error(reason || "OCR failed.");
  } finally {
    await worker.terminate();
  }

  return pages.join("\n");
}

export async function extractPurchaseBillFromPdf(file) {
  if (!file) {
    throw new Error("PDF file is required.");
  }
  if (!/\.pdf$/i.test(String(file.name || "")) && file.type !== "application/pdf") {
    throw new Error("Please select a PDF file.");
  }

  try {
    const text = await extractTextFromPdf(file);
    if (cleanLine(text)) {
      const parsed = parsePurchaseBillText(text);
      if (hasUsefulPurchaseData(parsed)) {
        return {
          ...parsed,
          importSource: "text"
        };
      }
    }

    const ocrText = await extractTextFromPdfUsingOcr(file);
    if (!cleanLine(ocrText)) {
      throw new Error("OCR could not read this PDF.");
    }

    const parsed = parsePurchaseBillText(ocrText);
    return {
      ...parsed,
      importSource: "ocr",
      warnings: [
        "Scanned PDF was read with OCR. Review the imported values carefully.",
        ...(Array.isArray(parsed.warnings) ? parsed.warnings : [])
      ]
    };
  } catch (error) {
    const message = String(error?.message || "").trim();
    if (message.toLowerCase().includes("invalid pdf")) {
      throw new Error("This file could not be parsed as a valid PDF.");
    }
    if (message.includes("OCR could not read this PDF")) {
      throw new Error("Could not read this PDF even after OCR. Try a clearer scan or a text-based PDF.");
    }
    if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
      throw new Error("OCR assets could not be loaded. Refresh the page and try again.");
    }
    throw new Error(
      `Could not read this PDF. ${message || "Try a clearer scan or a text-based PDF."}`
    );
  }
}

async function extractPurchaseBillFromSpreadsheet(file) {
  const xlsx = await loadXlsxModule();
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, {
    type: "array",
    cellDates: true
  });

  let bestParsed = null;
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet) continue;
    const matrix = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true
    });
    const parsed = parsePurchaseBillSpreadsheetMatrix(matrix);
    if (
      !bestParsed ||
      (Array.isArray(parsed.items) ? parsed.items.length : 0) >
        (Array.isArray(bestParsed.items) ? bestParsed.items.length : 0)
    ) {
      bestParsed = parsed;
    }
  }

  const parsed = bestParsed || parsePurchaseBillSpreadsheetRows([]);
  return {
    ...parsed,
    importSource: "excel"
  };
}

export async function extractPurchaseBillFromFile(file) {
  if (!file) {
    throw new Error("File is required.");
  }

  const fileName = String(file.name || "").toLowerCase();
  if (fileName.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPurchaseBillFromPdf(file);
  }
  if (
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls") ||
    fileName.endsWith(".csv") ||
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv"
    ].includes(file.type)
  ) {
    return extractPurchaseBillFromSpreadsheet(file);
  }

  throw new Error("Please select a PDF, Excel, or CSV file.");
}
