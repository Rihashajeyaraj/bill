import React from "react";
import clsx from "clsx";
import { formatDecimalByPreference, formatNumberByPreference } from "../lib/formatPreferences";
import { getCustomTemplateByKey } from "../services/templateService";

function money(n, currencySymbol) {
  const formatted = formatDecimalByPreference(Number(n || 0));
  if (!currencySymbol) return formatted;
  return `${currencySymbol}${formatted}`;
}

function qty(n) {
  return formatNumberByPreference(Number(n || 0), { maximumFractionDigits: 3 });
}

function formatDayMonthYear(value) {
  if (!value) return "-";
  const text = String(value).trim();
  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

function renderCustomHtmlTemplate(htmlContent, invoiceData) {
  if (!htmlContent) return "";

  const seller = invoiceData.seller || invoiceData.company || {};
  const buyer = invoiceData.buyer || invoiceData.customer || {};
  const items = Array.isArray(invoiceData.items) ? invoiceData.items : [];
  const totals = invoiceData.totals || {};
  const currencySymbol = invoiceData.currencySymbol || (invoiceData.currencyCode === "EUR" ? "€" : invoiceData.currencyCode === "GBP" ? "£" : invoiceData.currencyCode === "USD" ? "$" : "₹");

  const totalBeforeTax = totals.subTotal ?? totals.taxable_total ?? invoiceData.taxable_total ?? 0;
  const cgstTotal = totals.cgstTotal ?? totals.cgst_total ?? invoiceData.cgst_total ?? 0;
  const sgstTotal = totals.sgstTotal ?? totals.sgst_total ?? invoiceData.sgst_total ?? 0;
  const igstTotal = totals.igstTotal ?? totals.igst_total ?? invoiceData.igst_total ?? 0;
  const totalAfterTax = totals.total ?? totals.grand_total ?? invoiceData.grand_total ?? 0;
  const grandTotalInWords = invoiceData.grand_total_in_words || invoiceData.grandTotalInWords || "";

  let processedHtml = htmlContent;

  // 1. Process items block {{#items}}...{{/items}}
  const itemsBlockRegex = /\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/gi;
  if (itemsBlockRegex.test(processedHtml)) {
    processedHtml = processedHtml.replace(itemsBlockRegex, (_, rowTemplate) => {
      if (items.length === 0) {
        return `<tr><td colSpan="10" style="text-align:center; padding: 12px; color: #94a3b8;">No line items added yet.</td></tr>`;
      }
      return items.map((item, idx) => {
        const qtyVal = Number(item.qty || 0);
        const rateVal = Number(item.rate || item.unit_price || 0);
        const taxableVal = Number(item.taxableValue || item.taxable_amount || (qtyVal * rateVal));
        const amountVal = Number(item.amountInr || item.net || (qtyVal * rateVal));

        return rowTemplate
          .replace(/\{\{index\}\}/g, String(idx + 1))
          .replace(/\{\{description\}\}/g, String(item.name || item.description || ""))
          .replace(/\{\{hsn\}\}/g, String(item.hsn || item.hsn_sac || "-"))
          .replace(/\{\{qty\}\}/g, String(qtyVal))
          .replace(/\{\{rate\}\}/g, formatDecimalByPreference(rateVal))
          .replace(/\{\{taxableValue\}\}/g, formatDecimalByPreference(taxableVal))
          .replace(/\{\{cgstRate\}\}/g, `${item.cgstRate || item.cgst_rate || "0"}%`)
          .replace(/\{\{sgstRate\}\}/g, `${item.sgstRate || item.sgst_rate || "0"}%`)
          .replace(/\{\{igstRate\}\}/g, `${item.igstRate || item.igst_rate || "0"}%`)
          .replace(/\{\{amount\}\}/g, formatDecimalByPreference(amountVal));
      }).join("\n");
    });
  }

  // 2. Map standard placeholder tags
  const replacements = {
    "seller.name": seller.name || "",
    "company_name": seller.name || "",
    "seller_name": seller.name || "",
    "seller.address": seller.address || "",
    "company_address": seller.address || "",
    "seller_address": seller.address || "",
    "seller.gstin": seller.gstin || "",
    "company_gstin": seller.gstin || "",
    "seller_gstin": seller.gstin || "",
    "seller.state": seller.state || "",
    "company_state": seller.state || "",
    "seller.country": seller.country || "",
    "company_country": seller.country || "",

    "buyer.name": buyer.name || "",
    "customer_name": buyer.name || "",
    "buyer_name": buyer.name || "",
    "buyer.address": buyer.address || "",
    "customer_address": buyer.address || "",
    "buyer_address": buyer.address || "",
    "buyer.gstin": buyer.gstin || "",
    "customer_gstin": buyer.gstin || "",
    "buyer_gstin": buyer.gstin || "",
    "buyer.state": buyer.state || "",
    "customer_state": buyer.state || "",
    "buyer.country": buyer.country || "",
    "customer_country": buyer.country || "",

    "invoiceNo": invoiceData.invoiceNo || invoiceData.proformaNo || "",
    "proforma_no": invoiceData.invoiceNo || invoiceData.proformaNo || "",
    "invoice_number": invoiceData.invoiceNo || invoiceData.proformaNo || "",
    "invoiceDate": formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate),
    "proforma_date": formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate),
    "invoice_date": formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate),
    "validTill": formatDayMonthYear(invoiceData.validTill || invoiceData.valid_till),
    "valid_till": formatDayMonthYear(invoiceData.validTill || invoiceData.valid_till),
    "dueDate": formatDayMonthYear(invoiceData.dueDate || invoiceData.due_date),
    "due_date": formatDayMonthYear(invoiceData.dueDate || invoiceData.due_date),
    "customerRef": invoiceData.customerRef || invoiceData.customer_ref || "",
    "customer_ref": invoiceData.customerRef || invoiceData.customer_ref || "",
    "placeOfSupply": invoiceData.placeOfSupply || invoiceData.place_of_supply || buyer.state || "",
    "place_of_supply": invoiceData.placeOfSupply || invoiceData.place_of_supply || buyer.state || "",
    "currencySymbol": currencySymbol,
    "currencyCode": invoiceData.currencyCode || "INR",
    "exchangeRate": invoiceData.exchangeRate || invoiceData.exchange_rate || invoiceData.roe || "1.00",
    "roe": invoiceData.exchangeRate || invoiceData.exchange_rate || invoiceData.roe || "1.00",

    "shipperName": invoiceData.shipperName || invoiceData.shipper_name || "",
    "shipper_name": invoiceData.shipperName || invoiceData.shipper_name || "",
    "consigneeName": invoiceData.consigneeName || invoiceData.consignee_name || "",
    "consignee_name": invoiceData.consigneeName || invoiceData.consignee_name || "",
    "origin": invoiceData.origin || "",
    "destination": invoiceData.destination || "",
    "packsQty": invoiceData.packsQty || invoiceData.packs_qty || "",
    "packs_qty": invoiceData.packsQty || invoiceData.packs_qty || "",
    "weightKgs": invoiceData.weightKgs || invoiceData.weight_kgs || "",
    "weight_kgs": invoiceData.weightKgs || invoiceData.weight_kgs || "",
    "volumeCbm": invoiceData.volumeCbm || invoiceData.volume_cbm || "",
    "volume_cbm": invoiceData.volumeCbm || invoiceData.volume_cbm || "",
    "freightTerms": invoiceData.freightTerms || invoiceData.freight_terms || "",
    "freight_terms": invoiceData.freightTerms || invoiceData.freight_terms || "",

    "blNumber": invoiceData.blNumber || invoiceData.bl_number || "",
    "bl_number": invoiceData.blNumber || invoiceData.bl_number || "",
    "thblNumber": invoiceData.thblNumber || invoiceData.thbl_number || "",
    "thbl_number": invoiceData.thblNumber || invoiceData.thbl_number || "",
    "mblNumber": invoiceData.mblNumber || invoiceData.mbl_number || "",
    "mbl_number": invoiceData.mblNumber || invoiceData.mbl_number || "",
    "oceanBlNo": invoiceData.oceanBlNo || invoiceData.ocean_bl_no || "",
    "ocean_bl_no": invoiceData.oceanBlNo || invoiceData.ocean_bl_no || "",
    "vesselName": invoiceData.vesselName || invoiceData.vessel_name || "",
    "vessel_name": invoiceData.vesselName || invoiceData.vessel_name || "",
    "voyageNo": invoiceData.voyageNo || invoiceData.voyage_no || "",
    "voyage_no": invoiceData.voyageNo || invoiceData.voyage_no || "",
    "etdDate": formatDayMonthYear(invoiceData.etdDate || invoiceData.etd_date),
    "etd_date": formatDayMonthYear(invoiceData.etdDate || invoiceData.etd_date),
    "etaDate": formatDayMonthYear(invoiceData.etaDate || invoiceData.eta_date),
    "eta_date": formatDayMonthYear(invoiceData.etaDate || invoiceData.eta_date),

    "igmNo": invoiceData.igmNo || invoiceData.igm_no || "",
    "igm_no": invoiceData.igmNo || invoiceData.igm_no || "",
    "igmItemNo": invoiceData.igmItemNo || invoiceData.igm_item_no || "",
    "igm_item_no": invoiceData.igmItemNo || invoiceData.igm_item_no || "",
    "fileNo": invoiceData.fileNo || invoiceData.file_no || "",
    "file_no": invoiceData.fileNo || invoiceData.file_no || "",
    "salesRep": invoiceData.salesRep || invoiceData.sales_rep || "",
    "sales_rep": invoiceData.salesRep || invoiceData.sales_rep || "",
    "containerDetails": invoiceData.containerDetails || invoiceData.container_details || "",
    "container_details": invoiceData.containerDetails || invoiceData.container_details || "",
    "rcmApplicable": invoiceData.rcmApplicable || invoiceData.rcm_applicable ? "YES" : "NO",
    "rcm_applicable": invoiceData.rcmApplicable || invoiceData.rcm_applicable ? "YES" : "NO",

    "terms": invoiceData.terms || invoiceData.paymentTerms || "",
    "notes": invoiceData.notes || "",

    "totalBeforeTax": formatDecimalByPreference(totalBeforeTax),
    "subtotal": formatDecimalByPreference(totalBeforeTax),
    "taxable_amount": formatDecimalByPreference(totalBeforeTax),
    "cgstTotal": formatDecimalByPreference(cgstTotal),
    "cgst_total": formatDecimalByPreference(cgstTotal),
    "sgstTotal": formatDecimalByPreference(sgstTotal),
    "sgst_total": formatDecimalByPreference(sgstTotal),
    "igstTotal": formatDecimalByPreference(igstTotal),
    "igst_total": formatDecimalByPreference(igstTotal),
    "totalAfterTax": formatDecimalByPreference(totalAfterTax),
    "grandTotal": formatDecimalByPreference(totalAfterTax),
    "grand_total": formatDecimalByPreference(totalAfterTax),
    "grandTotalInWords": grandTotalInWords,
    "grand_total_in_words": grandTotalInWords
  };

  Object.entries(replacements).forEach(([key, value]) => {
    const escapedKey = key.replace(".", "\\.");
    const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "gi");
    processedHtml = processedHtml.replace(regex, value);
  });

  return processedHtml;
}

function LogisticsMetadataGrid({ data }) {
  if (!data) return null;
  const items = [
    { label: "Shipper", val: data.shipperName || data.shipper_name },
    { label: "Consignee", val: data.consigneeName || data.consignee_name },
    { label: "POL (Origin)", val: data.origin },
    { label: "POD (Destination)", val: data.destination },
    { label: "Packages", val: data.packsQty || data.packs_qty },
    { label: "Gross Wt (KGS)", val: data.weightKgs || data.weight_kgs },
    { label: "Volume (CBM)", val: data.volumeCbm || data.volume_cbm },
    { label: "Freight Terms", val: data.freightTerms || data.freight_terms },
    { label: "MBL No", val: data.mblNumber || data.mbl_number },
    { label: "HBL No", val: data.blNumber || data.bl_number },
    { label: "THBL No", val: data.thblNumber || data.thbl_number },
    { label: "Ocean BL No", val: data.oceanBlNo || data.ocean_bl_no },
    { label: "Vessel & Voyage", val: [data.vesselName || data.vessel_name, data.voyageNo || data.voyage_no].filter(Boolean).join(" / ") },
    { label: "ETD", val: formatDayMonthYear(data.etdDate || data.etd_date) },
    { label: "ETA", val: formatDayMonthYear(data.etaDate || data.eta_date) },
    { label: "IGM No & Item", val: [data.igmNo || data.igm_no, data.igmItemNo || data.igm_item_no].filter(Boolean).join(" / ") },
    { label: "File No", val: data.fileNo || data.file_no },
    { label: "Sales Rep", val: data.salesRep || data.sales_rep },
    { label: "Container / Vehicle", val: data.containerDetails || data.container_details },
    { label: "RCM Applicable", val: (data.rcmApplicable || data.rcm_applicable) ? "YES" : "" },
    { label: "Place of Supply", val: data.placeOfSupply || data.place_of_supply },
    { label: "ROE", val: (data.exchangeRate || data.exchange_rate) && (data.exchangeRate || data.exchange_rate) !== "1.00" && (data.exchangeRate || data.exchange_rate) !== "1" ? data.exchangeRate || data.exchange_rate : "" }
  ].filter(f => Boolean(f.val) && f.val !== "-");

  if (items.length === 0) return null;

  return (
    <div className="my-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px]">
      <span className="font-bold text-slate-800 uppercase block mb-1 tracking-wide">LOGISTICS & SHIPMENT DETAILS</span>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1">
        {items.map((it, idx) => (
          <div key={idx}>
            <span className="text-slate-500">{it.label}: </span>
            <strong className="text-slate-900">{it.val}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InvoicePreview({ templateId = "new_globe_export", styleConfig, invoiceData = {} }) {
  const { primaryColor, bgColor, fontFamily, logoUrl } = styleConfig || {};
  const resolvedLogoUrl =
    logoUrl || invoiceData?.companyLogoUrl || invoiceData?.seller?.logoUrl || invoiceData?.logoUrl || "";
  const font = fontFamily
    ? `"${fontFamily}", "Helvetica Neue", Arial, sans-serif`
    : "var(--invoice-font-family, var(--app-font-family))";

  const rawTitle = invoiceData.title || (invoiceData.isProforma ? "PRO FORMA INVOICE" : "TAX INVOICE");
  const isProforma = rawTitle.toUpperCase().includes("PRO FORMA");
  const currencySymbol = invoiceData.currencySymbol || (invoiceData.currencyCode === "EUR" ? "€" : invoiceData.currencyCode === "GBP" ? "£" : invoiceData.currencyCode === "USD" ? "$" : "₹");
  const normTemplateKey = String(templateId || "").toLowerCase();

  const seller = invoiceData.seller || invoiceData.company || {
    name: invoiceData.companyName || invoiceData.company_name || "",
    address: invoiceData.companyAddress || invoiceData.company_address || "",
    pan: invoiceData.companyPan || invoiceData.company_pan || "",
    iec: invoiceData.companyIec || invoiceData.company_iec || "",
    gstin: invoiceData.companyGstin || invoiceData.company_gstin || "",
    state: invoiceData.companyState || invoiceData.company_state || "",
    country: invoiceData.companyCountry || invoiceData.company_country || "",
    phone: invoiceData.companyPhone || invoiceData.company_phone || "",
    cin: invoiceData.companyCin || invoiceData.company_cin || ""
  };

  const buyer = invoiceData.buyer || invoiceData.customer || {
    name: invoiceData.customerName || invoiceData.customer_name || "",
    address: invoiceData.customerAddress || invoiceData.customer_address || "",
    state: invoiceData.customerState || invoiceData.customer_state || "",
    country: invoiceData.customerCountry || invoiceData.customer_country || "",
    gstin: invoiceData.customerGstin || invoiceData.customer_gstin || ""
  };

  const bankDetails = invoiceData.bankDetails || {
    accountName: seller.name || "",
    bankName: invoiceData.bankName || seller.bankName || "",
    address: invoiceData.bankAddress || seller.bankAddress || "",
    accountNo: invoiceData.accountNo || seller.accountNo || "",
    ifsc: invoiceData.ifsc || seller.ifsc || "",
    swift: invoiceData.swift || seller.swift || "",
    iban: invoiceData.iban || seller.iban || ""
  };

  const items = Array.isArray(invoiceData.items) ? invoiceData.items : [];
  const totals = invoiceData.totals || {};

  const totalBeforeTax = totals.subTotal ?? totals.taxable_total ?? invoiceData.taxable_total ?? 0;
  const cgstTotal = totals.cgstTotal ?? totals.cgst_total ?? invoiceData.cgst_total ?? 0;
  const sgstTotal = totals.sgstTotal ?? totals.sgst_total ?? invoiceData.sgst_total ?? 0;
  const igstTotal = totals.igstTotal ?? totals.igst_total ?? invoiceData.igst_total ?? 0;
  const totalAfterTax = totals.total ?? totals.grand_total ?? invoiceData.grand_total ?? 0;
  const grandTotalInWords = invoiceData.grand_total_in_words || invoiceData.grandTotalInWords || "";

  const notes = invoiceData.notes || "";
  const terms = invoiceData.terms || invoiceData.paymentTerms || "";
  const placeOfSupply = invoiceData.placeOfSupply || invoiceData.place_of_supply || buyer.state || "";
  const validTill = invoiceData.validTill || invoiceData.valid_till || "";
  const dueDate = invoiceData.dueDate || invoiceData.due_date || "";
  const customerRef = invoiceData.customerRef || invoiceData.customer_ref || "";
  const roe = invoiceData.exchangeRate || invoiceData.exchange_rate || invoiceData.roe || "1.00";
  const rcmApplicable = invoiceData.rcmApplicable || invoiceData.rcm_applicable;

  // Template Variant Matching
  const isNewGlobe = normTemplateKey.includes("new_globe");
  const isAnvase = normTemplateKey.includes("anvase");
  const isUprichard = normTemplateKey.includes("uprichard");
  const isPga = normTemplateKey.includes("pga");
  const isClassic = normTemplateKey.includes("classic");
  const isProfessional = normTemplateKey.includes("professional");
  const isCompact = normTemplateKey.includes("compact");
  const isExportStd = normTemplateKey.includes("export") && !isNewGlobe;
  const isCustom = normTemplateKey.startsWith("custom_") || normTemplateKey.includes("custom");

  // ---------------------------------------------------------------------------
  // TEMPLATE 5: CUSTOM UPLOADED INVOICE TEMPLATE
  // ---------------------------------------------------------------------------
  if (isCustom) {
    const customTpl = invoiceData.customTemplate || getCustomTemplateByKey(templateId);
    if (customTpl && customTpl.file_content) {
      const isHtmlType = customTpl.template_type === "html" || (customTpl.file_name && (customTpl.file_name.endsWith(".html") || customTpl.file_name.endsWith(".htm")));
      const isPdfType = customTpl.template_type === "pdf" || (customTpl.file_name && customTpl.file_name.endsWith(".pdf"));

      if (isHtmlType) {
        const renderedHtml = renderCustomHtmlTemplate(customTpl.file_content, invoiceData);
        return (
          <div
            className="invoice-master-template bg-white rounded-2xl p-4 sm:p-6 border border-slate-300 shadow-xl overflow-hidden text-xs transition-all"
            style={{ fontFamily: font, backgroundColor: bgColor || "#ffffff" }}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        );
      }

      if (isPdfType) {
        return (
          <div className="invoice-master-template bg-white rounded-2xl p-6 border-2 border-indigo-200 shadow-lg text-xs">
            <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-xl mb-4 font-medium flex items-center justify-between">
              <div>
                <strong>PDF Template Uploaded: {customTpl.name || customTpl.file_name}</strong>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Static Reference Layout (Dynamic placeholder data binding requires HTML template format).
                </p>
              </div>
              <span className="bg-amber-200 text-amber-900 font-bold text-[10px] px-2 py-0.5 rounded-full uppercase">
                PDF Reference
              </span>
            </div>
            {customTpl.file_content && customTpl.file_content.startsWith("data:application/pdf") ? (
              <iframe
                src={customTpl.file_content}
                title={customTpl.name || "PDF Template"}
                className="w-full h-[600px] border border-slate-300 rounded-xl"
              />
            ) : (
              <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-slate-600">
                <p className="font-semibold text-slate-800">{customTpl.name || customTpl.file_name}</p>
                <p className="text-xs text-slate-500 mt-1">Uploaded PDF template reference layout preview.</p>
              </div>
            )}
          </div>
        );
      }
    }

    return (
      <div
        className="invoice-master-template bg-white rounded-2xl p-6 sm:p-8 border-2 border-indigo-600/40 shadow-xl text-slate-800 text-xs leading-relaxed transition-all"
        style={{ fontFamily: font, backgroundColor: bgColor || "#ffffff" }}
      >
        {/* Custom Header Bar */}
        <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-purple-900 text-white p-4 rounded-t-xl flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            {resolvedLogoUrl ? (
              <img src={resolvedLogoUrl} alt="Company Logo" className="max-h-12 bg-white p-1.5 rounded-lg object-contain" />
            ) : (
              <div className="h-10 w-10 bg-indigo-700 rounded-lg flex items-center justify-center font-bold text-white text-base">
                {seller.name?.slice(0, 2).toUpperCase() || "CST"}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-wider uppercase text-white">{seller.name}</h1>
                <span className="bg-indigo-700 text-indigo-100 text-[9px] font-extrabold px-2 py-0.5 rounded-full border border-indigo-500">
                  CUSTOM TEMPLATE
                </span>
              </div>
              <p className="text-[10px] text-indigo-200">{seller.address}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block px-3 py-1 bg-indigo-950 text-indigo-100 rounded-md text-[10px] font-bold tracking-widest uppercase border border-indigo-700">
              {rawTitle}
            </span>
            <p className="mt-1 text-sm font-bold text-white">{invoiceData.invoiceNo || invoiceData.proformaNo || "INV-CUSTOM-001"}</p>
            <p className="text-[10px] text-indigo-200">Date: {formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate)}</p>
          </div>
        </div>

        {/* Dynamic Seller Identifiers */}
        <div className="bg-indigo-50 px-4 py-2 border-x border-b border-indigo-200 text-[10px] grid grid-cols-4 gap-2 text-indigo-950 font-medium">
          <div>GSTIN: <strong>{seller.gstin || "-"}</strong></div>
          <div>PAN: <strong>{seller.pan || "-"}</strong></div>
          <div>State: <strong>{seller.state || "-"}</strong></div>
          <div>Country: <strong>{seller.country || "INDIA"}</strong></div>
        </div>

        {/* Customer & Billing Metadata Block */}
        <div className="my-3 grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-[10px]">
          <div>
            <span className="font-bold text-slate-900 uppercase block mb-0.5">BILLED TO:</span>
            <p className="font-bold text-slate-900 text-[11px]">{buyer.name}</p>
            <p className="text-slate-600">{buyer.address}</p>
            <p className="mt-0.5 font-medium">GSTIN: {buyer.gstin || "-"}</p>
          </div>
          <div>
            <span className="font-bold text-slate-900 uppercase block mb-0.5">INVOICE METADATA:</span>
            <p><span className="text-slate-500">Customer Ref:</span> <strong>{invoiceData.customerRef || "-"}</strong></p>
            <p><span className="text-slate-500">Currency:</span> <strong>{invoiceData.currencyCode || "INR"}</strong></p>
            <p><span className="text-slate-500">Place of Supply:</span> <strong>{buyer.state || "-"}</strong></p>
          </div>
        </div>

        {/* Dynamic Item Table */}
        <div className="my-3 overflow-x-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-indigo-900 text-white font-bold">
                <th className="py-2 px-2 text-center w-8">#</th>
                <th className="py-2 px-2">Description</th>
                <th className="py-2 px-1 text-center">HSN/SAC</th>
                <th className="py-2 px-1 text-center">Qty</th>
                <th className="py-2 px-1 text-right">Rate ({currencySymbol})</th>
                <th className="py-2 px-1 text-right">Taxable Amt</th>
                <th className="py-2 px-1 text-center">CGST</th>
                <th className="py-2 px-1 text-center">SGST</th>
                <th className="py-2 px-1 text-center">IGST</th>
                <th className="py-2 px-2 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-300">
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-indigo-50/20">
                    <td className="py-2 px-2 text-center font-medium">{idx + 1}</td>
                    <td className="py-2 px-2 font-semibold text-slate-900">{item.name || item.description || "-"}</td>
                    <td className="py-2 px-1 text-center">{item.hsn || item.hsn_sac || "-"}</td>
                    <td className="py-2 px-1 text-center">{qty(item.qty)}</td>
                    <td className="py-2 px-1 text-right tabular-nums">{money(item.rate || item.unit_price, "")}</td>
                    <td className="py-2 px-1 text-right tabular-nums font-medium">{money(item.taxableValue || item.taxable_amount || (item.qty * item.rate), "")}</td>
                    <td className="py-2 px-1 text-center">{item.cgstRate || "0.00"}%</td>
                    <td className="py-2 px-1 text-center">{item.sgstRate || "0.00"}%</td>
                    <td className="py-2 px-1 text-center">{item.igstRate || "0.00"}%</td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold text-indigo-950">{money(item.amountInr || item.net || (item.qty * item.rate), "")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-slate-400 italic">No line items added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Dynamic Financial Totals */}
        <div className="grid grid-cols-12 gap-4 py-2 border-t border-slate-300">
          <div className="col-span-7 space-y-2">
            <div className="bg-indigo-50 p-2.5 rounded-xl border border-indigo-200 text-[10px]">
              <span className="font-bold text-indigo-900 block uppercase">Amount in Words:</span>
              <span className="font-black text-indigo-950 text-[11px] block mt-0.5">{grandTotalInWords}</span>
            </div>
          </div>

          <div className="col-span-5 text-[11px] space-y-1.5 border-l border-slate-200 pl-3">
            <div className="flex justify-between text-slate-600"><span>Taxable Subtotal:</span><span>{money(totalBeforeTax, currencySymbol)}</span></div>
            <div className="flex justify-between text-slate-600"><span>CGST Total:</span><span>{money(cgstTotal, currencySymbol)}</span></div>
            <div className="flex justify-between text-slate-600"><span>SGST Total:</span><span>{money(sgstTotal, currencySymbol)}</span></div>
            <div className="flex justify-between text-slate-600"><span>IGST Total:</span><span>{money(igstTotal, currencySymbol)}</span></div>
            <div className="pt-2 flex justify-between border-t border-indigo-900 text-sm font-black text-indigo-950">
              <span>Grand Total:</span><span>{money(totalAfterTax, currencySymbol)}</span>
            </div>
          </div>
        </div>

        {/* Bank Details & Authorised Signatory */}
        <div className="mt-4 pt-3 border-t border-slate-300 text-[9px] grid grid-cols-12 gap-3 text-slate-700">
          <div className="col-span-7">
            <p className="font-bold text-indigo-950 uppercase">Bank Wire Instructions:</p>
            <p>Bank: <strong>{bankDetails.bankName}</strong> | A/C: <strong>{bankDetails.accountNo}</strong> | IFSC: <strong>{bankDetails.ifsc}</strong></p>
          </div>
          <div className="col-span-5 text-right flex flex-col justify-between">
            <p className="font-bold text-indigo-950 uppercase">For {seller.name}</p>
            <div className="mt-6 pt-1 border-t border-dashed border-slate-400 font-bold text-slate-800">
              Authorised Signatory
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TEMPLATE 1: NEW GLOBE – EXPORT TAX INVOICE
  // ---------------------------------------------------------------------------
  if (isNewGlobe) {
    return (
      <div
        className="invoice-master-template bg-white rounded-2xl p-6 sm:p-8 border-2 border-blue-900/40 shadow-xl text-slate-800 text-xs leading-relaxed transition-all"
        style={{ fontFamily: font, backgroundColor: bgColor || "#ffffff" }}
      >
        {/* Top Header Bar */}
        <div className="bg-blue-950 text-white p-4 rounded-t-xl flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            {resolvedLogoUrl ? (
              <img src={resolvedLogoUrl} alt="Logo" className="max-h-12 bg-white p-1.5 rounded-lg" />
            ) : (
              <div className="h-10 w-10 bg-blue-800 rounded-lg flex items-center justify-center font-bold text-white text-base">
                NG
              </div>
            )}
            <div>
              <h1 className="text-base font-extrabold tracking-wider uppercase text-white">{seller.name}</h1>
              <p className="text-[10px] text-blue-200">{seller.address}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block px-3 py-1 bg-blue-800 text-blue-100 rounded-md text-[10px] font-bold tracking-widest uppercase border border-blue-700">
              {isProforma ? "PRO FORMA EXPORT" : "EXPORT TAX INVOICE"}
            </span>
            <p className="mt-1 text-sm font-bold text-white">{invoiceData.invoiceNo || invoiceData.proformaNo || "-"}</p>
            <p className="text-[10px] text-blue-200">Date: {formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate)} {validTill ? `| Valid Till: ${formatDayMonthYear(validTill)}` : ""}</p>
            {(customerRef || placeOfSupply || (roe && roe !== "1.00" && roe !== "1")) && (
              <p className="text-[9px] text-blue-300">
                {[customerRef && `Ref: ${customerRef}`, placeOfSupply && `POS: ${placeOfSupply}`, roe && roe !== "1.00" && roe !== "1" && `ROE: ${roe}`].filter(Boolean).join(" | ")}
              </p>
            )}
          </div>
        </div>

        {/* Company Tax Identifiers Grid */}
        <div className="bg-blue-50/80 px-4 py-2 border-x border-b border-blue-200 text-[10px] grid grid-cols-4 gap-2 text-blue-950 font-medium">
          <div>GSTIN: <strong>{seller.gstin || "-"}</strong></div>
          <div>PAN: <strong>{seller.pan || "-"}</strong></div>
          <div>IE Code: <strong>{seller.iec || "-"}</strong></div>
          <div>CIN: <strong>{seller.cin || "-"}</strong></div>
        </div>

        {/* Logistics & Shipping Metadata Box */}
        <div className="mt-3 border border-slate-300 rounded-xl p-3 bg-slate-50/50 space-y-2 text-[10px]">
          <div className="grid grid-cols-2 gap-3 pb-2 border-b border-slate-200">
            <div>
              <span className="font-bold text-slate-900 uppercase block mb-0.5">EXPORTER / SHIPPER:</span>
              <p className="font-semibold text-slate-800">{invoiceData.shipperName || invoiceData.shipper_name || "-"}</p>
              {buyer.address ? <p className="text-slate-600">{buyer.address}</p> : null}
              <p className="mt-0.5 font-medium">GSTIN: {buyer.gstin || "-"}</p>
            </div>
            <div>
              <span className="font-bold text-slate-900 uppercase block mb-0.5">CONSIGNEE / OVERSEAS BUYER:</span>
              <p className="font-semibold text-slate-800">{invoiceData.consigneeName || invoiceData.consignee_name || "-"}</p>
              {invoiceData.consigneeAddress || invoiceData.consignee_address ? (
                <p className="text-slate-600">{invoiceData.consigneeAddress || invoiceData.consignee_address}</p>
              ) : null}
              <p className="mt-0.5 font-medium">Country: {buyer.country || invoiceData.customerCountry || invoiceData.customer_country || "-"}</p>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <div><span className="text-slate-500">MAWB / MBL:</span> <strong>{invoiceData.mawbNo || invoiceData.mawb_no || invoiceData.mblNumber || invoiceData.mbl_number || "-"}</strong></div>
            <div><span className="text-slate-500">HAWB / HBL:</span> <strong>{invoiceData.hawbNo || invoiceData.hawb_no || invoiceData.blNumber || invoiceData.bl_number || "-"}</strong></div>
            <div><span className="text-slate-500">POL (Origin):</span> <strong>{invoiceData.origin || "-"}</strong></div>
            <div><span className="text-slate-500">POD (Discharge):</span> <strong>{invoiceData.destination || "-"}</strong></div>
            <div><span className="text-slate-500">Gross Wt (KGS):</span> <strong>{invoiceData.weightKgs || invoiceData.weight_kgs || "-"}</strong></div>
            <div><span className="text-slate-500">Chg Wt (KGS):</span> <strong>{invoiceData.chargeableWeightKgs || invoiceData.chargeable_weight_kgs || invoiceData.weightKgs || invoiceData.weight_kgs || "-"}</strong></div>
            <div><span className="text-slate-500">Volume (CBM):</span> <strong>{invoiceData.volumeCbm || invoiceData.volume_cbm || "-"}</strong></div>
            <div><span className="text-slate-500">Packages:</span> <strong>{invoiceData.packsQty || invoiceData.packs_qty || "-"}</strong></div>
          </div>
        </div>

        <LogisticsMetadataGrid data={invoiceData} />

        {/* Item Table */}
        <div className="my-3 overflow-x-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-blue-900 text-white font-bold">
                <th className="py-2 px-2 text-center w-8">Sr</th>
                <th className="py-2 px-2">Description of Services / Export Charges</th>
                <th className="py-2 px-1 text-center">SAC/HSN</th>
                <th className="py-2 px-1 text-center">Qty</th>
                <th className="py-2 px-1 text-right">Rate ({currencySymbol})</th>
                <th className="py-2 px-1 text-right">Taxable Amt</th>
                <th className="py-2 px-1 text-center">IGST %</th>
                <th className="py-2 px-1 text-right">IGST Amt</th>
                <th className="py-2 px-[10px] text-right">Total ({currencySymbol})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-300">
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-blue-50/30">
                    <td className="py-2 px-2 text-center font-medium">{idx + 1}</td>
                    <td className="py-2 px-2 font-semibold text-slate-900">{item.name || item.description || "-"}</td>
                    <td className="py-2 px-1 text-center">{item.hsn || item.hsn_sac || "-"}</td>
                    <td className="py-2 px-1 text-center">{qty(item.qty)}</td>
                    <td className="py-2 px-1 text-right tabular-nums">{money(item.rate || item.unit_price, "")}</td>
                    <td className="py-2 px-1 text-right tabular-nums font-medium">{money(item.taxableValue || item.taxable_amount || (item.qty * item.rate), "")}</td>
                    <td className="py-2 px-1 text-center font-medium">{item.igstRate ?? item.igst_rate ?? "0.00"}%</td>
                    <td className="py-2 px-1 text-right tabular-nums">{money(item.igstAmount || item.igst_amount || 0, "")}</td>
                    <td className="py-2 px-[10px] text-right tabular-nums font-bold text-blue-950">{money(item.amountInr || item.net || (item.qty * item.rate), "")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-slate-400 italic">No line items added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals & Word Summary */}
        <div className="grid grid-cols-12 gap-4 py-2 border-t border-slate-300">
          <div className="col-span-7 space-y-2">
            <div className="bg-blue-50 p-2.5 rounded-xl border border-blue-200 text-[10px]">
              <span className="font-bold text-blue-900 block uppercase tracking-wide">Amount in Words:</span>
              <span className="font-extrabold text-blue-950 text-[11px] block mt-0.5">{grandTotalInWords}</span>
            </div>
            <p className="text-[9px] text-slate-500 italic">* Supply Meant For Export Under LUT / Bond Without Payment of Integrated Tax (IGST).</p>
          </div>

          <div className="col-span-5 text-[11px] space-y-1.5 border-l border-slate-200 pl-3">
            <div className="flex justify-between text-slate-600"><span>Taxable Value:</span><span>{money(totalBeforeTax, currencySymbol)}</span></div>
            <div className="flex justify-between text-slate-600"><span>IGST Total:</span><span>{money(igstTotal, currencySymbol)}</span></div>
            <div className="pt-2 flex justify-between border-t border-blue-900 text-sm font-black text-blue-950">
              <span>Grand Total:</span><span>{money(totalAfterTax, currencySymbol)}</span>
            </div>
          </div>
        </div>

        {/* Bank & Signatory Footer */}
        <div className="mt-4 pt-3 border-t border-slate-300 text-[9px] grid grid-cols-12 gap-3 text-slate-700">
          <div className="col-span-7 space-y-1">
            <p className="font-bold text-blue-950 uppercase">Bank Remittance Details:</p>
            <p>Bank: <strong>{bankDetails.bankName}</strong> | Account No: <strong>{bankDetails.accountNo}</strong></p>
            <p>IFSC: <strong>{bankDetails.ifsc}</strong> | SWIFT Code: <strong>{bankDetails.swift}</strong></p>
            {terms ? <p className="text-slate-600 mt-1"><strong>Terms:</strong> {terms}</p> : <p className="text-slate-500 mt-1">Terms: Payment due within 15 days of invoice date.</p>}
            {rcmApplicable && <p className="text-blue-900 font-bold">Reverse Charge Mechanism (RCM): Applicable</p>}
          </div>
          <div className="col-span-5 text-right flex flex-col justify-between">
            <p className="font-bold text-blue-950 uppercase">For {seller.name}</p>
            <div className="mt-6 pt-1 border-t border-dashed border-slate-400 font-bold text-slate-800">
              Authorised Signatory
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TEMPLATE 2: ANVASE EXIM – IMPORT TAX INVOICE
  // ---------------------------------------------------------------------------
  if (isAnvase) {
    return (
      <div
        className="invoice-master-template bg-white rounded-2xl p-6 sm:p-8 border-2 border-red-900/40 shadow-xl text-slate-800 text-xs leading-relaxed transition-all"
        style={{ fontFamily: font, backgroundColor: bgColor || "#ffffff" }}
      >
        {/* Header */}
        <div className="border-b-2 border-red-900 pb-3 flex justify-between items-start">
          <div>
            <h1 className="text-lg font-black tracking-tight text-red-950 uppercase">{seller.name}</h1>
            <p className="text-[10px] text-slate-600 max-w-lg">{seller.address}</p>
            <p className="text-[10px] font-semibold text-red-900 mt-1">{seller.customsBrokerRegNo ? `CUSTOMS BROKER REGN NO: ${seller.customsBrokerRegNo} | ` : ""}GSTIN: {seller.gstin || "-"}</p>
          </div>
          <div className="text-right bg-red-900 text-white p-3 rounded-xl min-w-[150px]">
            <span className="text-[9px] font-extrabold tracking-wider uppercase block text-red-200">IMPORT & CUSTOMS</span>
            <p className="text-sm font-black text-white">{invoiceData.invoiceNo || invoiceData.proformaNo || "-"}</p>
            <p className="text-[10px] text-red-100">Date: {formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate)}</p>
          </div>
        </div>

        {/* Customs & BE Metadata Block */}
        <div className="my-3 bg-red-50/60 border border-red-200 rounded-xl p-3 text-[10px] grid grid-cols-4 gap-2 text-red-950">
          <div>Job No & Date: <strong>{invoiceData.jobNo || invoiceData.job_no || "-"}</strong></div>
          <div>BE No & Date: <strong>{invoiceData.beNo || invoiceData.be_no || "-"}</strong></div>
          <div>BE Type: <strong>{invoiceData.beType || invoiceData.be_type || "-"}</strong></div>
          <div>MBL / HBL: <strong>{[invoiceData.mblNumber || invoiceData.mbl_number, invoiceData.blNumber || invoiceData.bl_number].filter(Boolean).join(" / ") || "-"}</strong></div>
          <div>CIF Value: <strong>{invoiceData.cifValue || invoiceData.cif_value ? money(invoiceData.cifValue || invoiceData.cif_value, "₹") : "-"}</strong></div>
          <div>Assessable Value: <strong>{invoiceData.assessableValue || invoiceData.assessable_value ? money(invoiceData.assessableValue || invoiceData.assessable_value, "₹") : "-"}</strong></div>
          <div>Total Duty Paid: <strong>{invoiceData.customsDutyPaid || invoiceData.customs_duty_paid ? money(invoiceData.customsDutyPaid || invoiceData.customs_duty_paid, "₹") : "-"}</strong></div>
          <div>Overseas Shipper: <strong>{invoiceData.shipperName || invoiceData.shipper_name || "-"}</strong></div>
        </div>

        {/* Importer Party Info */}
        <div className="mb-3 p-3 border border-slate-200 rounded-xl bg-slate-50 text-[10px] grid grid-cols-2 gap-3">
          <div>
            <span className="font-bold text-slate-900 uppercase">IMPORTER / CUSTOMER:</span>
            <p className="font-bold text-slate-900 text-[11px]">{buyer.name || "-"}</p>
            {buyer.address ? <p className="text-slate-600">{buyer.address}</p> : null}
            <p className="font-medium mt-0.5">GSTIN: {buyer.gstin || "-"}</p>
            {customerRef ? <p className="text-slate-600">Cust Ref: <strong>{customerRef}</strong></p> : null}
            {placeOfSupply ? <p className="text-slate-600">Place of Supply: <strong>{placeOfSupply}</strong></p> : null}
          </div>
          <div>
            <span className="font-bold text-slate-900 uppercase">PORT OF DISCHARGE & CLEARANCE:</span>
            <p className="font-semibold text-slate-800">{invoiceData.destination || "-"}</p>
            <p className="text-slate-600">Container Details: {invoiceData.containerDetails || invoiceData.container_details || "-"}</p>
            {validTill ? <p className="text-slate-600">Valid Till: <strong>{formatDayMonthYear(validTill)}</strong></p> : null}
          </div>
        </div>

        <LogisticsMetadataGrid data={invoiceData} />

        {/* Charges Table */}
        <div className="my-3 overflow-x-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-red-900 text-white font-bold">
                <th className="py-2 px-1 text-center w-8">Sl</th>
                <th className="py-2 px-2">Customs Clearance & Logistics Charges</th>
                <th className="py-2 px-1 text-center">HSN/SAC</th>
                <th className="py-2 px-1 text-right">Taxable Value</th>
                <th className="py-2 px-1 text-center">CGST</th>
                <th className="py-2 px-1 text-center">SGST</th>
                <th className="py-2 px-1 text-center">IGST</th>
                <th className="py-2 px-2 text-right">Total Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-300">
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-red-50/30">
                    <td className="py-2 px-1 text-center font-medium">{idx + 1}</td>
                    <td className="py-2 px-2 font-semibold text-slate-900">{item.name || item.description || "-"}</td>
                    <td className="py-2 px-1 text-center">{item.hsn || item.hsn_sac || "-"}</td>
                    <td className="py-2 px-1 text-right tabular-nums">{money(item.taxableValue || item.taxable_amount || (item.qty * item.rate), "")}</td>
                    <td className="py-2 px-1 text-center">{item.cgstRate != null ? `${item.cgstRate}%` : "0%"}</td>
                    <td className="py-2 px-1 text-center">{item.sgstRate != null ? `${item.sgstRate}%` : "0%"}</td>
                    <td className="py-2 px-1 text-center">{item.igstRate != null ? `${item.igstRate}%` : "0%"}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold text-red-950">{money(item.amountInr || item.net || (item.qty * item.rate), "")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-slate-400 italic">No charges added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-12 gap-4 py-2 border-t border-slate-300">
          <div className="col-span-7 space-y-2">
            <div className="bg-red-50 p-2.5 rounded-xl border border-red-200 text-[10px]">
              <span className="font-bold text-red-900 block uppercase">Total Invoice Value in Words:</span>
              <span className="font-black text-red-950 text-[11px] block mt-0.5">{grandTotalInWords}</span>
            </div>
          </div>

          <div className="col-span-5 text-[11px] space-y-1.5 border-l border-slate-200 pl-3">
            <div className="flex justify-between text-slate-600"><span>Taxable Subtotal:</span><span>{money(totalBeforeTax, "₹")}</span></div>
            <div className="flex justify-between text-slate-600"><span>CGST Total:</span><span>{money(cgstTotal, "₹")}</span></div>
            <div className="flex justify-between text-slate-600"><span>SGST Total:</span><span>{money(sgstTotal, "₹")}</span></div>
            <div className="flex justify-between text-slate-600"><span>IGST Total:</span><span>{money(igstTotal, "₹")}</span></div>
            <div className="pt-2 flex justify-between border-t border-red-900 text-sm font-black text-red-950">
              <span>Grand Total:</span><span>{money(totalAfterTax, "₹")}</span>
            </div>
          </div>
        </div>

        {/* Declaration & Signatory */}
        <div className="mt-4 pt-3 border-t border-slate-300 text-[9px] grid grid-cols-12 gap-3 text-slate-700">
          <div className="col-span-7">
            <p className="font-bold text-red-950 uppercase">Statutory GST Declaration & Bank Details:</p>
            {bankDetails.bankName && <p>Bank: <strong>{bankDetails.bankName}</strong> | Account No: <strong>{bankDetails.accountNo}</strong> | IFSC: <strong>{bankDetails.ifsc}</strong></p>}
            <p className="text-slate-600 leading-tight mt-1">We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.</p>
            {terms && <p className="text-slate-600 mt-1"><strong>Terms:</strong> {terms}</p>}
            {notes && <p className="text-slate-600"><strong>Notes:</strong> {notes}</p>}
            {rcmApplicable && <p className="text-red-900 font-bold">Reverse Charge (RCM): Applicable</p>}
          </div>
          <div className="col-span-5 text-right flex flex-col justify-between">
            <p className="font-bold text-red-950 uppercase">For {seller.name}</p>
            <div className="mt-6 pt-1 border-t border-dashed border-slate-400 font-bold text-slate-800">
              Authorised Signatory
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TEMPLATE 3: UPRICHARD – INTERNATIONAL INVOICE
  // ---------------------------------------------------------------------------
  if (isUprichard) {
    return (
      <div
        className="invoice-master-template bg-white rounded-2xl p-6 sm:p-8 border border-slate-300 shadow-lg text-slate-800 text-xs leading-relaxed transition-all"
        style={{ fontFamily: font, backgroundColor: bgColor || "#ffffff" }}
      >
        {/* Minimal Clean Header */}
        <div className="flex justify-between items-start pb-6 border-b border-slate-200">
          <div>
            <h1 className="text-2xl font-light tracking-tight text-slate-900 uppercase font-sans">{seller.name}</h1>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">{seller.address}</p>
            <p className="text-xs text-slate-500">VAT / Tax ID: {seller.gstin || "-"}</p>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold tracking-widest text-teal-800 uppercase">{isProforma ? "PRO FORMA" : "INVOICE"}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-900"># {invoiceData.invoiceNo || invoiceData.proformaNo || "-"}</p>
            <p className="text-xs text-slate-500">Date: {formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate)} {validTill ? `| Valid Till: ${formatDayMonthYear(validTill)}` : ""}</p>
          </div>
        </div>

        {/* Bill To & Ship To Grid */}
        <div className="grid grid-cols-2 gap-6 my-6 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-900 block mb-2">BILL TO:</span>
            <p className="font-bold text-slate-900">{buyer.name || "-"}</p>
            {buyer.address ? <p className="text-slate-600 mt-1">{buyer.address}</p> : null}
            {buyer.country ? <p className="text-slate-600 mt-1">{buyer.country}</p> : null}
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-900 block mb-2">DETAILS:</span>
            <p><span className="text-slate-500">Customer Ref / PO:</span> <strong>{customerRef || "-"}</strong></p>
            <p className="mt-1"><span className="text-slate-500">Currency:</span> <strong className="uppercase">{invoiceData.currencyCode || "INR"}</strong> {roe && roe !== "1.00" && roe !== "1" ? `(ROE: ${roe})` : ""}</p>
            <p className="mt-1"><span className="text-slate-500">Payment Terms:</span> <strong>{terms || invoiceData.paymentTerms || "-"}</strong></p>
            {placeOfSupply ? <p className="mt-1"><span className="text-slate-500">Place of Supply:</span> <strong>{placeOfSupply}</strong></p> : null}
          </div>
        </div>

        <LogisticsMetadataGrid data={invoiceData} />

        {/* Minimal Item Table */}
        <div className="my-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-slate-900 font-semibold text-slate-900">
                <th className="py-3 px-2">Description</th>
                <th className="py-3 px-2 text-center w-16">Qty</th>
                <th className="py-3 px-2 text-right">Unit Price</th>
                <th className="py-3 px-2 text-right">VAT %</th>
                <th className="py-3 px-2 text-right">Net Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 border-b border-slate-200">
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="py-3 px-2 font-medium text-slate-900">{item.name || item.description || "-"}</td>
                    <td className="py-3 px-2 text-center">{qty(item.qty)}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{money(item.rate || item.unit_price, currencySymbol)}</td>
                    <td className="py-3 px-2 text-right tabular-nums">{item.taxRate ?? item.vatRate ?? "0"}%</td>
                    <td className="py-3 px-2 text-right tabular-nums font-bold text-slate-900">{money(item.amountInr || item.net || (item.qty * item.rate), currencySymbol)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400 italic">No line items added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* International Currency Totals */}
        <div className="flex justify-end my-6">
          <div className="w-72 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600"><span>Subtotal Net:</span><span>{money(totalBeforeTax, currencySymbol)}</span></div>
            <div className="flex justify-between text-slate-600"><span>VAT Total:</span><span>{money(igstTotal || cgstTotal + sgstTotal, currencySymbol)}</span></div>
            <div className="pt-2 flex justify-between border-t-2 border-slate-900 text-base font-bold text-slate-900">
              <span>Total Payable:</span><span>{money(totalAfterTax, currencySymbol)}</span>
            </div>
          </div>
        </div>

        {/* Wire & Bank Instructions */}
        <div className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-600 grid grid-cols-2 gap-6">
          <div>
            <p className="font-bold text-slate-900 uppercase mb-1">WIRE TRANSFER DETAILS:</p>
            <p>Bank: <strong>{bankDetails.bankName}</strong></p>
            <p>Account No: <strong>{bankDetails.accountNo}</strong> {bankDetails.ifsc ? `| IFSC: ${bankDetails.ifsc}` : ""}</p>
            {bankDetails.iban ? <p>IBAN: <strong>{bankDetails.iban}</strong></p> : null}
            {bankDetails.swift ? <p>SWIFT/BIC: <strong>{bankDetails.swift}</strong></p> : null}
            {notes ? <p className="mt-2 text-slate-500"><strong>Notes:</strong> {notes}</p> : null}
          </div>
          <div className="text-right flex flex-col justify-end">
            <p className="text-slate-400 text-[10px]">Thank you for your business!</p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TEMPLATE 4: PGA SHIPPING – DRAFT TAX INVOICE
  // ---------------------------------------------------------------------------
  if (isPga) {
    return (
      <div
        className="invoice-master-template bg-white rounded-2xl p-6 sm:p-8 border-2 border-slate-700/40 shadow-xl text-slate-800 text-xs leading-relaxed transition-all"
        style={{ fontFamily: font, backgroundColor: bgColor || "#ffffff" }}
      >
        {/* Header */}
        <div className="bg-slate-900 text-white p-4 rounded-xl flex justify-between items-center">
          <div>
            <h1 className="text-lg font-black tracking-wide text-white uppercase">{seller.name}</h1>
            <p className="text-[10px] text-slate-300">{seller.address}</p>
          </div>
          <div className="text-right border-l border-slate-700 pl-4">
            <span className="inline-block px-3 py-1 bg-amber-500 text-slate-950 font-black rounded text-[10px] tracking-wider uppercase">
              {isProforma ? "DRAFT PRO FORMA" : "DRAFT TAX INVOICE"}
            </span>
            <p className="mt-1 text-sm font-bold text-white">{invoiceData.invoiceNo || invoiceData.proformaNo || "-"}</p>
            <p className="text-[10px] text-slate-300">Date: {formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate)} {validTill ? `| Valid Till: ${formatDayMonthYear(validTill)}` : ""}</p>
          </div>
        </div>

        {/* Routing & Container Grid */}
        <div className="my-3 p-3 bg-slate-100 border border-slate-300 rounded-xl text-[10px] grid grid-cols-3 gap-3">
          <div><span className="text-slate-500 block">CUSTOMER / BILL TO:</span><strong className="text-slate-900 text-[11px]">{buyer.name || "-"}</strong></div>
          <div><span className="text-slate-500 block">SHIPPER:</span><strong className="text-slate-900">{invoiceData.shipperName || invoiceData.shipper_name || "-"}</strong></div>
          <div><span className="text-slate-500 block">CONSIGNEE:</span><strong className="text-slate-900">{invoiceData.consigneeName || invoiceData.consignee_name || "-"}</strong></div>
          <div><span className="text-slate-500 block">PORT OF ORIGIN:</span><strong className="text-slate-900">{invoiceData.origin || "-"}</strong></div>
          <div><span className="text-slate-500 block">FINAL DESTINATION:</span><strong className="text-slate-900">{invoiceData.destination || "-"}</strong></div>
          <div><span className="text-slate-500 block">VESSEL & VOYAGE:</span><strong className="text-slate-900">{[invoiceData.vesselName || invoiceData.vessel_name, invoiceData.voyageNo || invoiceData.voyage_no].filter(Boolean).join(" / ") || "-"}</strong></div>
          <div><span className="text-slate-500 block">CONTAINER NO:</span><strong className="text-slate-900">{invoiceData.containerDetails || invoiceData.container_details || "-"}</strong></div>
          <div><span className="text-slate-500 block">FREIGHT TERMS:</span><strong className="text-slate-900">{invoiceData.freightTerms || invoiceData.freight_terms || "-"}</strong></div>
          <div><span className="text-slate-500 block">RATE OF EXCHANGE (ROE):</span><strong className="text-slate-900">{invoiceData.exchangeRate || invoiceData.exchange_rate || invoiceData.roe || "-"}</strong></div>
        </div>

        <LogisticsMetadataGrid data={invoiceData} />

        {/* Charges Table */}
        <div className="my-3 overflow-x-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead>
              <tr className="bg-slate-800 text-white font-bold">
                <th className="py-2 px-1 text-center w-8">Sl</th>
                <th className="py-2 px-2">Freight & Logistics Charges</th>
                <th className="py-2 px-1 text-center">HSN/SAC</th>
                <th className="py-2 px-1 text-center">Qty</th>
                <th className="py-2 px-1 text-right">Rate</th>
                <th className="py-2 px-1 text-right">Taxable Amt</th>
                <th className="py-2 px-1 text-center">CGST</th>
                <th className="py-2 px-1 text-center">SGST</th>
                <th className="py-2 px-1 text-center">IGST</th>
                <th className="py-2 px-2 text-right">Total Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-300">
              {items.length > 0 ? (
                items.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-100">
                    <td className="py-2 px-1 text-center font-medium">{idx + 1}</td>
                    <td className="py-2 px-2 font-semibold text-slate-900">{item.name || item.description || "-"}</td>
                    <td className="py-2 px-1 text-center">{item.hsn || item.hsn_sac || "-"}</td>
                    <td className="py-2 px-1 text-center">{qty(item.qty)}</td>
                    <td className="py-2 px-1 text-right tabular-nums">{money(item.rate || item.unit_price, "")}</td>
                    <td className="py-2 px-1 text-right tabular-nums font-medium">{money(item.taxableValue || item.taxable_amount || (item.qty * item.rate), "")}</td>
                    <td className="py-2 px-1 text-center">{item.cgstRate != null ? `${item.cgstRate}%` : "0%"}</td>
                    <td className="py-2 px-1 text-center">{item.sgstRate != null ? `${item.sgstRate}%` : "0%"}</td>
                    <td className="py-2 px-1 text-center">{item.igstRate != null ? `${item.igstRate}%` : "0%"}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-bold text-slate-950">{money(item.amountInr || item.net || (item.qty * item.rate), "")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-slate-400 italic">No line items added yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div className="grid grid-cols-12 gap-4 py-2 border-t border-slate-300">
          <div className="col-span-7 space-y-2">
            <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-300 text-[10px]">
              <span className="font-bold text-slate-800 block uppercase">Grand Total in Words:</span>
              <span className="font-black text-slate-950 text-[11px] block mt-0.5">{grandTotalInWords}</span>
            </div>
          </div>

          <div className="col-span-5 text-[11px] space-y-1.5 border-l border-slate-200 pl-3">
            <div className="flex justify-between text-slate-600"><span>Taxable Value:</span><span>{money(totalBeforeTax, "₹")}</span></div>
            <div className="flex justify-between text-slate-600"><span>CGST Total:</span><span>{money(cgstTotal, "₹")}</span></div>
            <div className="flex justify-between text-slate-600"><span>SGST Total:</span><span>{money(sgstTotal, "₹")}</span></div>
            <div className="flex justify-between text-slate-600"><span>IGST Total:</span><span>{money(igstTotal, "₹")}</span></div>
            <div className="pt-2 flex justify-between border-t border-slate-900 text-sm font-black text-slate-950">
              <span>Grand Total:</span><span>{money(totalAfterTax, "₹")}</span>
            </div>
          </div>
        </div>

        {/* Bank & Signatory */}
        <div className="mt-4 pt-3 border-t border-slate-300 text-[9px] grid grid-cols-12 gap-3 text-slate-700">
          <div className="col-span-7 space-y-1">
            <p className="font-bold text-slate-900 uppercase">Bank Details for Wire Payment:</p>
            <p>Bank: <strong>{bankDetails.bankName}</strong> | Account No: <strong>{bankDetails.accountNo}</strong> | IFSC: <strong>{bankDetails.ifsc}</strong></p>
            {terms ? <p className="text-slate-600 mt-1"><strong>Terms:</strong> {terms}</p> : null}
            {notes ? <p className="text-slate-600"><strong>Notes:</strong> {notes}</p> : null}
            {rcmApplicable && <p className="text-slate-900 font-bold">Reverse Charge (RCM): Applicable</p>}
          </div>
          <div className="col-span-5 text-right flex flex-col justify-between">
            <p className="font-bold text-slate-900 uppercase">For {seller.name}</p>
            <div className="mt-6 pt-1 border-t border-dashed border-slate-400 font-bold text-slate-800">
              Authorised Signatory
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // DEFAULT / FALLBACK TEMPLATES (Modern GST, Classic, Professional, Compact, Export Standard)
  // ---------------------------------------------------------------------------
  return (
    <div
      className={clsx(
        "invoice-master-template bg-white rounded-2xl text-slate-800 text-xs leading-relaxed transition-all",
        isCompact ? "p-4 sm:p-5 text-[10px]" : "p-6 sm:p-8",
        isClassic ? "border-4 border-double border-slate-800 shadow-lg font-serif" : "border border-slate-300 shadow-md"
      )}
      style={{ fontFamily: font, backgroundColor: bgColor || "#ffffff" }}
    >
      {/* ACCENT BARS */}
      {isExportStd && <div className="h-2 rounded-t-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-400 mb-4 -mt-2 -mx-2" />}
      {!isClassic && !isProfessional && !isExportStd && (
        <div className="h-2 rounded-t-xl bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400 mb-4 -mt-2 -mx-2" />
      )}

      {/* HEADER BANNER FOR PROFESSIONAL */}
      {isProfessional ? (
        <div className="bg-slate-900 text-white p-5 rounded-2xl mb-5 flex flex-wrap items-center justify-between gap-4 shadow-md">
          <div className="flex items-center gap-4">
            {resolvedLogoUrl ? (
              <img src={resolvedLogoUrl} alt="Logo" className="max-h-16 max-w-[140px] object-contain bg-white p-2 rounded-xl" />
            ) : (
              <div className="h-14 w-28 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white font-bold tracking-wider text-sm">
                {seller.name?.slice(0, 8).toUpperCase() || "LOGO"}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold tracking-tight uppercase text-white">{seller.name}</h1>
              <p className="text-xs text-slate-300 max-w-md">{seller.address}</p>
            </div>
          </div>
          <div className="text-right border-l border-slate-700 pl-4">
            <span className="inline-block px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider border border-blue-400/30">
              {rawTitle}
            </span>
            <p className="mt-2 text-sm font-bold text-white">{invoiceData.invoiceNo || invoiceData.proformaNo || "-"}</p>
            <p className="text-xs text-slate-300">Date: {formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate)} {validTill ? `| Valid Till: ${formatDayMonthYear(validTill)}` : ""}</p>
          </div>
        </div>
      ) : (
        /* STANDARD HEADER */
        <div className="grid grid-cols-12 gap-4 pb-4 border-b border-slate-300">
          <div className="col-span-3 flex items-center justify-center border-r border-slate-200 pr-3">
            {resolvedLogoUrl ? (
              <img src={resolvedLogoUrl} alt="Company Logo" className="max-h-20 max-w-full object-contain" />
            ) : (
              <div className="h-16 w-full rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 font-bold tracking-wider">
                {seller.name?.slice(0, 8).toUpperCase() || "LOGO"}
              </div>
            )}
          </div>
          <div className="col-span-7 px-2">
            <h1 className={clsx("font-bold tracking-tight uppercase text-slate-900", isClassic ? "text-xl font-serif" : "text-lg")}>
              {seller.name}
            </h1>
            <p className="text-[11px] text-slate-600">{seller.address}</p>
            <div className="mt-1 grid grid-cols-2 gap-x-2 text-[11px] text-slate-700 font-medium">
              <p>PAN NO: <span className="font-semibold text-slate-900">{seller.pan || "-"}</span></p>
              <p>CIN No: <span className="font-semibold text-slate-900">{seller.cin || "-"}</span></p>
              <p>IEC NO: <span className="font-semibold text-slate-900">{seller.iec || "-"}</span></p>
              <p>GSTN: <span className="font-semibold text-slate-900">{seller.gstin || "-"}</span></p>
              <p>State: <span className="font-semibold text-slate-900">{seller.state || "-"}</span></p>
              <p>Phone: <span className="font-semibold text-slate-900">{seller.phone || "-"}</span></p>
            </div>
          </div>
          <div className="col-span-2 flex flex-col items-center justify-center pl-2">
            <div className="h-20 w-20 border border-emerald-300 bg-emerald-50 text-emerald-700 flex items-center justify-center text-[9px] text-center font-semibold rounded-lg">
              {isProforma ? "PRO FORMA" : "OFFICIAL"}
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT TITLE */}
      {!isProfessional && (
        <div className="my-3 text-center">
          <span className={clsx("uppercase tracking-wider font-extrabold text-slate-900", isClassic ? "text-lg font-serif border-y-2 border-slate-800 py-1 inline-block px-8" : "text-base underline decoration-2 underline-offset-4")}>
            {rawTitle}
          </span>
        </div>
      )}

      {/* METADATA GRID */}
      <div className="grid grid-cols-12 gap-3 pb-3 border-b border-slate-300 text-[11px]">
        <div className="col-span-6 pr-2">
          <p className="font-bold text-slate-900 uppercase">TO : {buyer.name}</p>
          <p className="text-slate-600 leading-tight">{buyer.address}</p>
          <p className="mt-1 font-medium text-slate-800">{buyer.state} {buyer.country ? `, ${buyer.country}` : ""}</p>
          <p className="font-bold text-slate-900">GSTN NO. : {buyer.gstin || "-"}</p>
        </div>
        <div className="col-span-6 space-y-0.5 border-l border-slate-200 pl-3">
          <div className="flex justify-between">
            <span className="font-semibold text-slate-700">{isProforma ? "Pro Forma No:" : "Invoice No:"}</span>
            <span className="font-bold text-slate-900">{invoiceData.invoiceNo || invoiceData.proformaNo || "-"}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold text-slate-700">Date:</span>
            <span className="font-medium text-slate-900">{formatDayMonthYear(invoiceData.invoiceDate || invoiceData.proformaDate)}</span>
          </div>
          {validTill && (
            <div className="flex justify-between">
              <span className="font-semibold text-slate-700">Valid Till:</span>
              <span className="font-medium text-slate-900">{formatDayMonthYear(validTill)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="font-semibold text-slate-700">Cust. Ref:</span>
            <span className="font-medium text-slate-900">{customerRef || "-"}</span>
          </div>
          {placeOfSupply && (
            <div className="flex justify-between">
              <span className="font-semibold text-slate-700">Place of Supply:</span>
              <span className="font-medium text-slate-900">{placeOfSupply}</span>
            </div>
          )}
          {roe && roe !== "1.00" && roe !== "1" && (
            <div className="flex justify-between">
              <span className="font-semibold text-slate-700">ROE:</span>
              <span className="font-medium text-slate-900">{roe} ({currencySymbol})</span>
            </div>
          )}
        </div>
      </div>

      <LogisticsMetadataGrid data={invoiceData} />

      {/* ITEM TABLE */}
      <div className="my-3 overflow-x-auto">
        <table className="w-full text-left border-collapse text-[10px]">
          <thead>
            <tr className="font-bold border-y bg-teal-700 text-white border-teal-800">
              <th className="py-1.5 px-1 w-6 text-center">No</th>
              <th className="py-1.5 px-2">Description</th>
              <th className="py-1.5 px-1 text-center">SAC/HSN</th>
              <th className="py-1.5 px-1 text-center">CGST %</th>
              <th className="py-1.5 px-1 text-center">SGST %</th>
              <th className="py-1.5 px-1 text-center">IGST %</th>
              <th className="py-1.5 px-1 text-right">Per Unit</th>
              <th className="py-1.5 px-1 text-right">Unit</th>
              <th className="py-1.5 px-1 text-right">Amount ({currencySymbol})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {items.length > 0 ? (
              items.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="py-1.5 px-1 text-center font-medium">{idx + 1}</td>
                  <td className="py-1.5 px-2 font-medium text-slate-900">{item.name || item.description || "-"}</td>
                  <td className="py-1.5 px-1 text-center">{item.hsn || item.hsn_sac || "-"}</td>
                  <td className="py-1.5 px-1 text-center">{item.cgstRate || "0.00"}%</td>
                  <td className="py-1.5 px-1 text-center">{item.sgstRate || "0.00"}%</td>
                  <td className="py-1.5 px-1 text-center">{item.igstRate || "0.00"}%</td>
                  <td className="py-1.5 px-1 text-right tabular-nums">{money(item.rate || item.unit_price, "")}</td>
                  <td className="py-1.5 px-1 text-right tabular-nums">{qty(item.qty)}</td>
                  <td className="py-1.5 px-1 text-right tabular-nums font-semibold">{money(item.taxableValue || item.taxable_amount || (item.qty * item.rate), "")}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="py-4 text-center text-slate-400 italic">No line items added yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* SUMMARY */}
      <div className="grid grid-cols-12 gap-4 py-3 border-t-2 border-slate-300">
        <div className="col-span-7 text-[10px] space-y-2 pr-2">
          <div className="p-2 rounded-lg border bg-emerald-50 border-emerald-200">
            <span className="font-bold text-slate-700 block uppercase text-[9px]">Total in Words:</span>
            <span className="font-extrabold text-slate-900 text-[11px] block mt-0.5">{grandTotalInWords}</span>
          </div>
          {bankDetails.bankName && (
            <div className="text-[9px] text-slate-600">
              <span className="font-bold block uppercase">Bank Details:</span>
              <p>Bank: {bankDetails.bankName} | A/C: {bankDetails.accountNo} | IFSC: {bankDetails.ifsc}</p>
            </div>
          )}
          {terms && <p className="text-[9px] text-slate-600"><strong>Terms:</strong> {terms}</p>}
          {notes && <p className="text-[9px] text-slate-600"><strong>Notes:</strong> {notes}</p>}
          {rcmApplicable && <p className="text-[9px] text-emerald-900 font-bold">Reverse Charge (RCM): Applicable</p>}
        </div>
        <div className="col-span-5 text-[11px] space-y-1 border-l border-slate-200 pl-3">
          <div className="flex justify-between"><span className="text-slate-600 font-medium">Subtotal:</span><span className="font-semibold text-slate-900">{money(totalBeforeTax, currencySymbol)}</span></div>
          <div className="flex justify-between"><span className="text-slate-600 font-medium">CGST:</span><span className="font-semibold text-slate-900">{money(cgstTotal, currencySymbol)}</span></div>
          <div className="flex justify-between"><span className="text-slate-600 font-medium">SGST:</span><span className="font-semibold text-slate-900">{money(sgstTotal, currencySymbol)}</span></div>
          <div className="flex justify-between"><span className="text-slate-600 font-medium">IGST:</span><span className="font-semibold text-slate-900">{money(igstTotal, currencySymbol)}</span></div>
          <div className="pt-1.5 flex justify-between border-t border-slate-300 text-sm font-bold text-teal-800">
            <span>Grand Total:</span><span>{money(totalAfterTax, currencySymbol)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
