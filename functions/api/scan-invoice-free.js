import { parseInvoiceScan, validateInvoiceScan } from "../../src/lib/invoiceScanParser.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();
    const file = formData.get("file");
    const extractedText = String(formData.get("extractedText") || "").trim();
    const extractionMethod = String(formData.get("extractionMethod") || "").trim();

    if (!file) {
      return json({ error: "Invoice file is required." }, 400);
    }

    const parsed = parseInvoiceScan(extractedText);
    const validation = validateInvoiceScan(parsed);

    return json({
      invoiceNumber: parsed.invoiceNumber || "",
      date: parsed.date || "",
      supplier: parsed.supplier || "",
      supplierPhone: parsed.supplierPhone || "",
      city: parsed.city || "",
      state: parsed.state || "",
      address: parsed.address || "",
      country: parsed.country || "",
      items: Array.isArray(parsed.items) ? parsed.items : [],
      total: parsed.total || "",
      confidence: parsed.confidence || 0,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      validation,
      meta: {
        fileName: String(file?.name || ""),
        fileType: String(file?.type || ""),
        extractionMethod: extractionMethod || "unknown",
        vendorParser: parsed.vendorParser || ""
      }
    });
  } catch (error) {
    return json(
      {
        invoiceNumber: "",
        date: "",
        supplier: "",
        supplierPhone: "",
        city: "",
        state: "",
        address: "",
        country: "",
        items: [],
        total: "",
        confidence: 0,
        warnings: [String(error?.message || "Invoice scan failed.")],
        validation: {
          valid: false,
          issues: ["invoiceNumber", "date", "supplier", "total"]
        }
      },
      200
    );
  }
}
