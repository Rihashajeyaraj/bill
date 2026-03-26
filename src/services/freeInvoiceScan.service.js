import { api } from "../lib/api.js";
import { parseInvoiceScan, validateInvoiceScan } from "../lib/invoiceScanParser.js";
import {
  parsePurchaseBillSpreadsheetMatrix,
  parsePurchaseBillSpreadsheetRows
} from "./purchaseBillPdfImport.js";

let pdfJsModulePromise = null;
let tesseractModulePromise = null;
let xlsxModulePromise = null;

const PDF_WORKER_PATH = "/pdfjs/pdf.worker.min.mjs";
const OCR_WORKER_PATH = "/tesseract/worker.min.js";
const OCR_CORE_PATH = "/tesseract-core";
const OCR_LANG_PATH = "/tessdata";

function cleanLine(value) {
  return String(value || "").replace(/[|]/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
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
    const currentLine = lines[lines.length - 1];
    if (!currentLine || Math.abs(currentLine.y - item.y) > 3) {
      lines.push({ y: item.y, parts: [item] });
      continue;
    }
    currentLine.parts.push(item);
  }

  return lines
    .map((line) => line.parts.sort((left, right) => left.x - right.x).map((part) => part.text).join(" "))
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

async function extractTextFromImage(file) {
  const tesseractModule = await loadTesseractModule();
  const createWorker = tesseractModule?.createWorker || tesseractModule?.default?.createWorker;
  if (typeof createWorker !== "function") {
    throw new Error("OCR engine failed to load.");
  }

  const worker = await createWorker("eng", 1, {
    workerPath: OCR_WORKER_PATH,
    corePath: OCR_CORE_PATH,
    langPath: OCR_LANG_PATH,
    gzip: true,
    workerBlobURL: false,
    logger: () => {}
  });

  try {
    const result = await worker.recognize(file);
    return String(result?.data?.text || "").trim();
  } finally {
    await worker.terminate();
  }
}

async function extractSpreadsheetData(file) {
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
    extractedText: String(parsed?.rawText || "").trim(),
    extractionMethod: "excel",
    preParsed: {
      invoiceNumber: parsed?.billNumber || "",
      date: parsed?.billDate || "",
      supplier: parsed?.supplierName || "",
      supplierPhone: parsed?.supplierPhone || "",
      city: "",
      state: "",
      address: "",
      country: "",
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      total: "",
      confidence: 85,
      warnings: Array.isArray(parsed?.warnings) ? parsed.warnings : [],
      vendorParser: "spreadsheet"
    }
  };
}

async function extractTextFromFile(file) {
  const fileName = String(file?.name || "").toLowerCase();
  const mimeType = String(file?.type || "").toLowerCase();

  if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
    return {
      extractedText: await extractTextFromPdf(file),
      extractionMethod: "pdf-text"
    };
  }

  if (
    [".jpg", ".jpeg", ".png"].some((extension) => fileName.endsWith(extension)) ||
    ["image/jpeg", "image/png"].includes(mimeType)
  ) {
    return {
      extractedText: await extractTextFromImage(file),
      extractionMethod: "image-ocr"
    };
  }

  if (
    [".xlsx", ".xls", ".csv"].some((extension) => fileName.endsWith(extension)) ||
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv"
    ].includes(mimeType)
  ) {
    return extractSpreadsheetData(file);
  }

  if ([".docx", ".doc"].some((extension) => fileName.endsWith(extension))) {
    throw new Error("Word invoice scan is not available yet in this build. PDF, image, Excel, and CSV are supported.");
  }

  throw new Error("Please select a PDF, JPG, PNG, Excel, or CSV invoice.");
}

export async function scanInvoiceFree(file) {
  if (!file) {
    throw new Error("Invoice file is required.");
  }

  const { extractedText, extractionMethod, preParsed } = await extractTextFromFile(file);
  const localParsed = preParsed || parseInvoiceScan(extractedText);
  const localValidation = validateInvoiceScan(localParsed);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("extractedText", extractedText);
  formData.append("extractionMethod", extractionMethod);

  try {
    const response = await api.post("/api/scan-invoice-free", formData, {
      headers: {
        "Content-Type": "multipart/form-data"
      }
    });

    return response?.data || {};
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    const shouldFallback =
      status === 404 ||
      status === 405 ||
      status === 0 ||
      String(error?.message || "").toLowerCase().includes("network");

    if (!shouldFallback) {
      throw error;
    }

    return {
      invoiceNumber: localParsed.invoiceNumber || "",
      date: localParsed.date || "",
      supplier: localParsed.supplier || "",
      supplierPhone: localParsed.supplierPhone || "",
      city: localParsed.city || "",
      state: localParsed.state || "",
      address: localParsed.address || "",
      country: localParsed.country || "",
      items: Array.isArray(localParsed.items) ? localParsed.items : [],
      total: localParsed.total || "",
      confidence: localParsed.confidence || 0,
      warnings: [
        "Local scan mode is active because the /api/scan-invoice-free route is not available in this dev server.",
        ...(Array.isArray(localParsed.warnings) ? localParsed.warnings : [])
      ],
      validation: localValidation,
      meta: {
        fileName: String(file?.name || ""),
        fileType: String(file?.type || ""),
        extractionMethod,
        vendorParser: localParsed.vendorParser || "",
        localFallback: true
      }
    };
  }
}
