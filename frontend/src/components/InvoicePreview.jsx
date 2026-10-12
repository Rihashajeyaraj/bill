import React from "react";
import clsx from "clsx";

export function formatAddress(address) {
  if (!address) return "";
  if (typeof address === "string") return address;
  if (typeof address === "object") {
    const parts = [
      address.line1 || address.billing_address_line1 || address.street || address.address_line1,
      address.line2 || address.billing_address_line2 || address.address_line2,
      address.city,
      address.state || address.state_name,
      address.postalCode || address.postal_code || address.zip || address.pincode,
      address.country || address.country_name
    ].filter(Boolean);
    return parts.join(", ");
  }
  return String(address);
}

function formatDayMonthYear(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (text.includes("1111") || text === "-" || text === "null" || text === "undefined") return "";
  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    const yNum = Number(year);
    if (yNum < 1900 || yNum > 2100) return "";
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  const year = parsed.getFullYear();
  if (year < 1900 || year > 2100) return "";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${year}`;
}

function formatIndianCurrency(n) {
  if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "0.00";
  return Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function numberToWordsINR(num) {
  const val = Number(num || 0);
  if (val <= 0) return "ZERO RUPEES ONLY";

  const rupees = Math.floor(val);
  const paise = Math.round((val - rupees) * 100);

  const a = [
    "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
    "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"
  ];
  const b = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

  function inWords(n) {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? (b[Math.floor(n / 10)] ? "-" : "") + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " HUNDRED" + (n % 100 !== 0 ? " " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + " THOUSAND" + (n % 1000 !== 0 ? " " + inWords(n % 1000) : "");
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + " LAKH" + (n % 100000 !== 0 ? " " + inWords(n % 100000) : "");
    return inWords(Math.floor(n / 10000000)) + " CRORE" + (n % 10000000 !== 0 ? " " + inWords(n % 10000000) : "");
  }

  let result = rupees > 0 ? inWords(rupees) : "";
  if (paise > 0) {
    result = result ? `${result} AND ${inWords(paise)}` : inWords(paise);
  }
  return `${result.trim()} ONLY`;
}

function getStateWithCode(stateName, stateCode, gstin) {
  const code = stateCode || (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : "");
  if (!stateName && !code) return "";
  if (stateName && code) return `${stateName} (${code})`;
  return stateName || code;
}

const InvoicePreview = React.memo(function InvoicePreview({
  templateId,
  styleConfig = {},
  invoiceData = {},
  documentType = ""
}) {
  const { logoUrl, signatureUrl } = styleConfig || {};
  const resolvedLogoUrl =
    logoUrl ||
    invoiceData?.company?.logo_url ||
    invoiceData?.company?.logoBase64 ||
    invoiceData?.company?.logoUrl ||
    invoiceData?.company?.settings?.logoUrl ||
    invoiceData?.company?.settings?.logo_url ||
    invoiceData?.companyLogoUrl ||
    invoiceData?.seller?.logoUrl ||
    invoiceData?.logoUrl ||
    "";

  const resolvedSignatureUrl =
    signatureUrl ||
    invoiceData?.company?.signature_url ||
    invoiceData?.company?.signatureUrl ||
    invoiceData?.company?.signatureBase64 ||
    invoiceData?.company?.settings?.signatureUrl ||
    invoiceData?.company?.settings?.signature_url ||
    invoiceData?.companySignatureUrl ||
    invoiceData?.seller?.signatureUrl ||
    invoiceData?.signatureUrl ||
    "";

  // Determine Title: "EA INVOICE", "TAX INVOICE", or "PRO FORMA INVOICE"
  const isEaInvoice = Boolean(
    invoiceData?.invoice_type === "EA_INVOICE" ||
    invoiceData?.invoiceType === "EA_INVOICE" ||
    (documentType && String(documentType).toUpperCase().includes("EA")) ||
    (invoiceData?.document_type && String(invoiceData.document_type).toUpperCase().includes("EA")) ||
    (invoiceData?.documentType && String(invoiceData.documentType).toUpperCase().includes("EA"))
  );
  const explicitTax = (documentType && String(documentType).toUpperCase().includes("TAX")) ||
    (invoiceData.document_type && String(invoiceData.document_type).toUpperCase().includes("TAX")) ||
    (invoiceData.documentType && String(invoiceData.documentType).toUpperCase().includes("TAX")) ||
    Boolean((invoiceData.invoice_no || invoiceData.invoiceNo) && !invoiceData.isProforma && !documentType?.includes("PRO"));
  const isTaxInvoice = explicitTax || isEaInvoice;
  const documentTitle = isEaInvoice ? "EA INVOICE" : (isTaxInvoice ? "TAX INVOICE" : "PRO FORMA INVOICE");

  const [qrCodeUrl, setQrCodeUrl] = React.useState("");

  React.useEffect(() => {
    if (invoiceData?.qr_code_image) {
      setQrCodeUrl(invoiceData.qr_code_image);
      return;
    }
    const qrPayload = invoiceData?.qr_code_data;
    if (isEaInvoice && qrPayload) {
      import("qrcode")
        .then((QRCode) => {
          QRCode.toDataURL(typeof qrPayload === "string" ? qrPayload : JSON.stringify(qrPayload), {
            width: 160,
            margin: 1,
            color: { dark: "#000000", light: "#ffffff" }
          })
            .then((url) => setQrCodeUrl(url))
            .catch(() => {});
        })
        .catch(() => {});
    }
  }, [invoiceData?.qr_code_image, invoiceData?.qr_code_data, isEaInvoice]);

  // Seller Details
  const rawSeller = invoiceData.company || invoiceData.seller || {};
  const sellerGstin = rawSeller.gstin || invoiceData.companyGstin || invoiceData.company_gstin || "";
  const seller = {
    name: invoiceData.companyName || invoiceData.company_name || rawSeller.legal_name || rawSeller.name || "COMPANY NAME",
    address: formatAddress(rawSeller.address || rawSeller.billing_address_line1 || invoiceData.companyAddress || invoiceData.company_address),
    pan: rawSeller.pan || invoiceData.companyPan || invoiceData.company_pan || "",
    cin: rawSeller.cin || invoiceData.companyCin || invoiceData.company_cin || "",
    iec: rawSeller.iec || invoiceData.companyIec || invoiceData.company_iec || "",
    gstin: sellerGstin,
    stateWithCode: getStateWithCode(
      rawSeller.state_name || rawSeller.state || invoiceData.companyState || invoiceData.company_state,
      rawSeller.state_code || invoiceData.company_state_code,
      sellerGstin
    ),
    country: rawSeller.country_name || rawSeller.country || invoiceData.companyCountry || invoiceData.company_country || "India",
    phone: rawSeller.phone || invoiceData.companyPhone || invoiceData.company_phone || ""
  };

  // Buyer / Customer Details
  const rawBuyer = invoiceData.customer || invoiceData.buyer || {};
  const buyerGstin = invoiceData.bill_gstin || rawBuyer.gstin || invoiceData.customerGstin || invoiceData.customer_gstin || "";
  const buyerAddress = formatAddress(
    invoiceData.bill_address_line1
      ? {
          line1: invoiceData.bill_address_line1,
          line2: invoiceData.bill_address_line2,
          city: invoiceData.bill_city,
          state: invoiceData.bill_state,
          pincode: invoiceData.bill_pincode || invoiceData.customer_pincode,
          country: invoiceData.bill_country
        }
      : (rawBuyer.billing_address_line1 || rawBuyer.address || invoiceData.customerAddress || invoiceData.customer_address)
  );
  const buyerCity = invoiceData.bill_city || rawBuyer.city || invoiceData.customer_city || "";
  const buyerPincode = invoiceData.bill_pincode || rawBuyer.pincode || invoiceData.customer_pincode || "";
  const buyerState = invoiceData.bill_state || rawBuyer.state || rawBuyer.state_name || invoiceData.customerState || invoiceData.customer_state || "";
  const buyerStateCode = invoiceData.bill_state_code || rawBuyer.state_code || invoiceData.customer_state_code || "";
  const buyerStateWithCode = getStateWithCode(buyerState, buyerStateCode, buyerGstin);
  const buyerCountry = invoiceData.bill_country || rawBuyer.country || rawBuyer.country_name || invoiceData.customerCountry || invoiceData.customer_country || "India";

  const buyer = {
    name: invoiceData.bill_name || invoiceData.customerName || invoiceData.customer_name || rawBuyer.display_name || rawBuyer.legal_name || rawBuyer.name || "CUSTOMER NAME",
    address: buyerAddress,
    city: buyerCity,
    stateWithCode: buyerStateWithCode,
    pincode: buyerPincode,
    country: buyerCountry,
    gstin: buyerGstin
  };

  // Header Reference Fields
  const docNo = isTaxInvoice
    ? (invoiceData.invoice_no || invoiceData.invoiceNo || "-")
    : (invoiceData.proforma_no || invoiceData.proformaNo || invoiceData.invoice_no || invoiceData.invoiceNo || "-");
  const docDate = formatDayMonthYear(
    isTaxInvoice
      ? (invoiceData.invoice_date || invoiceData.invoiceDate)
      : (invoiceData.proforma_date || invoiceData.proformaDate || invoiceData.invoice_date || invoiceData.invoiceDate)
  );
  const blNumber = invoiceData.bl_number || invoiceData.blNumber || invoiceData.hbl_number || invoiceData.hblNumber || "";
  const thblNumber = invoiceData.thbl_number || invoiceData.thblNumber || "";
  const mblNumber = invoiceData.mbl_number || invoiceData.mblNumber || invoiceData.ocean_bl_no || invoiceData.oceanBlNo || "";
  const customerRef = invoiceData.customer_ref || invoiceData.customerRef || invoiceData.cust_ref || "";

  const packsQty = invoiceData.packs_qty || invoiceData.packsQty;
  const weightKgs = invoiceData.weight_kgs || invoiceData.weightKgs;
  const volumeCbm = invoiceData.volume_cbm || invoiceData.volumeCbm;
  const qtyParts = [
    packsQty ? `${packsQty} Packs` : null,
    weightKgs ? `${weightKgs} Kgs` : null,
    volumeCbm ? `${volumeCbm} CBM` : null
  ].filter(Boolean);
  const quantityDisplay = qtyParts.join(" / ");

  const freightTerms = invoiceData.freight_terms || invoiceData.freightTerms || "";
  const roeVal = invoiceData.roe || invoiceData.exchange_rate || invoiceData.exchangeRate;
  const roeCurrency = invoiceData.currency_code || invoiceData.currencyCode || "USD";
  const roeDisplay = roeVal && Number(roeVal) !== 1 ? `${roeCurrency} @ ${formatIndianCurrency(roeVal)}` : (roeVal && roeVal !== "1" ? String(roeVal) : null);

  const igmNo = invoiceData.igm_no || invoiceData.igmNo || "";
  const igmDate = formatDayMonthYear(invoiceData.igm_date || invoiceData.igmDate);
  const igmItemNo = invoiceData.igm_item_no || invoiceData.igmItemNo || "";
  const fileNo = invoiceData.file_no || invoiceData.fileNo || "";
  const salesRep = invoiceData.sales_rep || invoiceData.salesRep || "";
  const rcmApplicable = invoiceData.rcm_applicable ?? invoiceData.rcmApplicable ?? invoiceData.reverse_charge;
  const rcmDisplay = (rcmApplicable === true || rcmApplicable === "Y" || rcmApplicable === "Yes") ? "Yes" : ((rcmApplicable === false || rcmApplicable === "N" || rcmApplicable === "No") ? "No" : null);
  const remarks = invoiceData.remarks || invoiceData.notes || "";

  // Shipment Reference Fields
  const shipperName = invoiceData.shipper_name || invoiceData.shipperName || "";
  const consigneeName = invoiceData.consignee_name || invoiceData.consigneeName || "";
  const origin = invoiceData.origin || "";
  const destination = invoiceData.destination || "";
  const vessel = invoiceData.vessel_name || invoiceData.vesselName || "";
  const voyageNo = invoiceData.voyage_no || invoiceData.voyageNo || "";
  const oceanBlNo = invoiceData.ocean_bl_no || invoiceData.oceanBlNo || "";
  const etd = formatDayMonthYear(invoiceData.etd_date || invoiceData.etdDate);
  const eta = formatDayMonthYear(invoiceData.eta_date || invoiceData.etaDate);

  // Line Items - Robust fallback to lines, line_items, invoice_items, or proforma_items
  const rawItems = (Array.isArray(invoiceData.items) && invoiceData.items.length > 0)
    ? invoiceData.items
    : (Array.isArray(invoiceData.lines) && invoiceData.lines.length > 0)
      ? invoiceData.lines
      : (Array.isArray(invoiceData.line_items) && invoiceData.line_items.length > 0)
        ? invoiceData.line_items
        : (Array.isArray(invoiceData.invoice_items) && invoiceData.invoice_items.length > 0)
          ? invoiceData.invoice_items
          : (Array.isArray(invoiceData.proforma_items) && invoiceData.proforma_items.length > 0)
            ? invoiceData.proforma_items
            : (Array.isArray(invoiceData.items) ? invoiceData.items : []);

  const items = rawItems.map(item => {
    const rate = Number(item.rate ?? item.unit_price ?? item.unitPrice ?? 0);
    const qty = Number(item.qty || item.quantity || 1);
    const amountInr = Number(item.amount_inr ?? item.amountInr ?? item.line_total ?? item.lineTotal ?? item.taxable_amount ?? item.taxable_value ?? item.amount ?? (rate * qty));
    const taxableAmount = Number(item.taxable_amount ?? item.taxableAmount ?? item.taxable_value ?? item.net ?? (rate * qty));
    const taxRate = Number(item.tax_rate ?? item.taxRate ?? item.gst_rate ?? item.gstRate ?? item.tax ?? 0);
    const cgstRate = Number(item.cgst_rate ?? item.cgstRate ?? (taxRate > 0 && !item.igst_rate && !item.igst_amount ? taxRate / 2 : 0));
    const sgstRate = Number(item.sgst_rate ?? item.sgstRate ?? (taxRate > 0 && !item.igst_rate && !item.igst_amount ? taxRate / 2 : 0));
    const igstRate = Number(item.igst_rate ?? item.igstRate ?? (taxRate > 0 && (item.igst_rate || item.igst_amount || !cgstRate) ? taxRate : 0));
    const cgstAmt = Number(item.cgst_amount ?? item.cgstAmount ?? 0);
    const sgstAmt = Number(item.sgst_amount ?? item.sgstAmount ?? 0);
    const igstAmt = Number(item.igst_amount ?? item.igstAmount ?? 0);
    const gstTotal = Number(item.tax_amount ?? item.taxAmount ?? item.line_tax ?? item.lineTax ?? (cgstAmt + sgstAmt + igstAmt));

    return {
      description: item.description || item.name || item.itemName || item.title || "Item",
      sac: item.hsn_sac || item.hsnSac || item.hsn || item.sac || "",
      cgst_rate: cgstRate,
      sgst_rate: sgstRate,
      igst_rate: igstRate,
      place_of_supply: item.place_of_supply || item.placeOfSupply || invoiceData.place_of_supply_state || "",
      currency: item.currency || invoiceData.currency_code || invoiceData.currencyCode || "INR",
      rate,
      qty,
      unit: item.unit || "PCS",
      amount_inr: amountInr,
      taxable_amount: taxableAmount,
      gst_total: gstTotal
    };
  });

  // Totals
  const totals = invoiceData.totals || {};
  const totalAmountInr = items.reduce((acc, it) => acc + it.amount_inr, 0);
  const totalBeforeTax = Number(totals.taxable_total ?? totals.subTotal ?? invoiceData.taxable_total ?? invoiceData.taxable_subtotal ?? items.reduce((acc, it) => acc + it.taxable_amount, 0));
  const cgstTotal = Number(totals.cgst_total ?? totals.cgstTotal ?? invoiceData.cgst_total ?? invoiceData.total_cgst ?? 0);
  const sgstTotal = Number(totals.sgst_total ?? totals.sgstTotal ?? invoiceData.sgst_total ?? invoiceData.total_sgst ?? 0);
  const igstTotal = Number(totals.igst_total ?? totals.igstTotal ?? invoiceData.igst_total ?? invoiceData.total_igst ?? 0);
  const totalGst = Number(cgstTotal + sgstTotal + igstTotal);
  const totalAfterTax = Number(totals.grand_total ?? totals.total ?? invoiceData.grand_total ?? (totalBeforeTax + totalGst));
  const advanceReceived = Number(
    invoiceData.advance_received ??
    invoiceData.advanceReceived ??
    totals.advanceReceived ??
    invoiceData.amount_paid ??
    invoiceData.amountPaid ??
    totals.amountPaid ??
    0
  );
  const balancePayable = Math.max(0, totalAfterTax - advanceReceived);

  const amountInWords = invoiceData.grand_total_in_words || invoiceData.grandTotalInWords || numberToWordsINR(totalAfterTax);
  const tdsNote = invoiceData.tds_note || invoiceData.tdsNote || "* Kindly deduct T.D.S on Invoice amount excluding GST amount.";

  // Settings & Footer
  const sgstHeaderLabel = invoiceData.sgst_label || invoiceData.sgstLabel || "SGST Rate %";
  const containerDetails = invoiceData.container_details || invoiceData.containerDetails || invoiceData.container_vehicle_no || "";
  const rawTerms = invoiceData.terms || invoiceData.payment_terms || invoiceData.paymentTerms || "";
  const termsList = rawTerms
    ? (Array.isArray(rawTerms) ? rawTerms : String(rawTerms).split("\n")).map(t => t.trim()).filter(Boolean)
    : [];

  // Bank Details
  const rawBank = invoiceData.bank || invoiceData.bankDetails || rawSeller?.bankDetails || {};
  const bankDetails = {
    accountName: rawBank.account_name || rawBank.accountName || invoiceData.accountName || seller.name || "",
    bankName: rawBank.bank_name || rawBank.bankName || invoiceData.bankName || "",
    branch: rawBank.branch || rawBank.bankAddress || rawBank.address || "",
    accountNo: rawBank.account_no || rawBank.accountNo || rawBank.accountNumber || "",
    ifsc: rawBank.ifsc_code || rawBank.ifsc || ""
  };
  const hasBank = Boolean(bankDetails.bankName || bankDetails.accountNo || bankDetails.ifsc);

  return (
    <div className="invoice-master-template bg-white text-slate-900 text-xs leading-tight p-4 sm:p-6 max-w-[210mm] mx-auto border border-slate-300 shadow-sm print:border-none print:shadow-none print:p-0">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            background: #ffffff !important;
          }
          .invoice-master-template {
            width: 100% !important;
            max-width: 100% !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          thead {
            display: table-header-group !important;
          }
          tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .print-avoid-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      {/* TOP HEADER */}
      <div className="grid grid-cols-12 gap-2 pb-3 border-b border-slate-400 items-start">
        {/* LOGO */}
        <div className="col-span-3 flex items-center justify-start">
          {resolvedLogoUrl ? (
            <img
              src={resolvedLogoUrl}
              alt="Company Logo"
              crossOrigin="anonymous"
              loading="eager"
              className="max-h-20 max-w-[150px] object-contain"
            />
          ) : (
            <div className="h-14 w-28 rounded border border-dashed border-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase">
              {seller.name?.slice(0, 8) || "LOGO"}
            </div>
          )}
        </div>

        {/* SELLER DETAILS (CENTER) */}
        <div className="col-span-6 text-center px-1">
          <h1 className="text-sm sm:text-base font-extrabold uppercase tracking-tight text-slate-950">
            {seller.name}
          </h1>
          {seller.address && <p className="text-[10px] text-slate-700 whitespace-pre-line mt-0.5">{seller.address}</p>}
          <div className="text-[9.5px] text-slate-800 space-y-0.2 mt-0.5">
            {seller.stateWithCode && <span>State: <strong>{seller.stateWithCode}</strong> </span>}
            {seller.country && <span>| Country: <strong>{seller.country}</strong> </span>}
            {seller.phone && <span>| Phone: <strong>{seller.phone}</strong></span>}
          </div>
          <div className="text-[9.5px] text-slate-800 mt-0.5 font-medium">
            {seller.pan && <span>PAN: <strong>{seller.pan}</strong> </span>}
            {seller.iec && <span>| IEC: <strong>{seller.iec}</strong> </span>}
            {seller.gstin && <span>| GSTIN: <strong>{seller.gstin}</strong></span>}
          </div>
        </div>

        {/* SELLER REGISTRATION NUMBERS & QR CODE (RIGHT) */}
        <div className="col-span-3 text-right text-[10px] space-y-0.5 text-slate-800 border-l border-slate-200 pl-2 flex flex-col justify-between">
          <div className="space-y-0.5">
            {seller.cin ? <div>CIN: <span className="font-bold">{seller.cin}</span></div> : null}
            {seller.pan ? <div>PAN: <span className="font-bold">{seller.pan}</span></div> : null}
            {seller.gstin ? <div>GSTN: <span className="font-bold">{seller.gstin}</span></div> : null}
          </div>
          {qrCodeUrl && (
            <div className="pt-1 flex flex-col items-end">
              <img
                src={qrCodeUrl}
                alt="EA Invoice QR Code"
                className="w-16 h-16 sm:w-20 sm:h-20 border border-slate-300 p-0.5 rounded bg-white shadow-2xs object-contain"
              />
              <span className="text-[8px] font-bold text-emerald-800 uppercase tracking-tighter mt-0.5">
                Verified EA QR
              </span>
            </div>
          )}
        </div>
      </div>

      {/* DOCUMENT TITLE */}
      <div className="py-2 text-center">
        <h2 className="text-sm font-extrabold underline underline-offset-4 tracking-widest text-slate-950">
          {documentTitle}
        </h2>
        {isEaInvoice && (
          <p className="text-[9px] font-bold text-emerald-700 tracking-wider uppercase mt-0.5">
            Digitally Authenticated EA Tax Invoice
          </p>
        )}
      </div>

      {/* TWO COLUMNS: CUSTOMER/SHIPMENT (LEFT) & DOCUMENT/HEADER (RIGHT) */}
      <div className="grid grid-cols-12 gap-3 pb-2 text-[10px] border-b border-slate-300">
        {/* LEFT COLUMN: CUSTOMER + SHIPMENT */}
        <div className="col-span-6 space-y-2 pr-2 border-r border-slate-200">
          {/* CUSTOMER (TO) */}
          <div className="space-y-0.5">
            <span className="font-extrabold text-slate-900 block text-[10.5px]">TO:</span>
            <div className="font-bold text-slate-950">{buyer.name}</div>
            {buyer.address && <div className="text-slate-700 whitespace-pre-line">{buyer.address}</div>}
            <div className="text-slate-700">
              {buyer.city ? `${buyer.city}, ` : ""}
              {buyer.stateWithCode}
              {buyer.pincode ? ` - ${buyer.pincode}` : ""}
            </div>
            {buyer.country && <div className="text-slate-700">{buyer.country}</div>}
            {buyer.gstin && <div>GSTIN: <span className="font-bold text-slate-900">{buyer.gstin}</span></div>}
          </div>

          {/* SHIPMENT BLOCK */}
          {(shipperName || consigneeName || origin || destination || vessel || voyageNo || oceanBlNo || etd || eta) ? (
            <div className="pt-2 border-t border-dashed border-slate-200 space-y-0.5 text-[9.5px]">
              <span className="font-bold text-slate-800 uppercase tracking-wider block text-[9px]">Shipment Details</span>
              {shipperName ? <div className="flex justify-between"><span className="text-slate-600">Shipper:</span> <span className="font-medium text-slate-900 text-right">{shipperName}</span></div> : null}
              {consigneeName ? <div className="flex justify-between"><span className="text-slate-600">Consignee:</span> <span className="font-medium text-slate-900 text-right">{consigneeName}</span></div> : null}
              {origin ? <div className="flex justify-between"><span className="text-slate-600">Origin:</span> <span className="font-medium text-slate-900 text-right">{origin}</span></div> : null}
              {destination ? <div className="flex justify-between"><span className="text-slate-600">Destination:</span> <span className="font-medium text-slate-900 text-right">{destination}</span></div> : null}
              {vessel ? <div className="flex justify-between"><span className="text-slate-600">Vessel:</span> <span className="font-medium text-slate-900 text-right">{vessel}</span></div> : null}
              {voyageNo ? <div className="flex justify-between"><span className="text-slate-600">Voyage No:</span> <span className="font-medium text-slate-900 text-right">{voyageNo}</span></div> : null}
              {oceanBlNo ? <div className="flex justify-between"><span className="text-slate-600">Ocean BL No:</span> <span className="font-medium text-slate-900 text-right">{oceanBlNo}</span></div> : null}
              {etd ? <div className="flex justify-between"><span className="text-slate-600">ETD:</span> <span className="font-medium text-slate-900 text-right">{etd}</span></div> : null}
              {eta ? <div className="flex justify-between"><span className="text-slate-600">ETA:</span> <span className="font-medium text-slate-900 text-right">{eta}</span></div> : null}
            </div>
          ) : null}
        </div>

        {/* RIGHT COLUMN: DOCUMENT INFO + HEADER REFS */}
        <div className="col-span-6 space-y-0.5 pl-1">
          <div className="flex justify-between">
            <span className="font-semibold text-slate-700">{isTaxInvoice ? "Invoice No:" : "Pro Forma No:"}</span>
            <span className="font-bold text-slate-950">{docNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold text-slate-700">Date:</span>
            <span className="font-medium text-slate-900">{docDate}</span>
          </div>
          {blNumber ? (
            <div className="flex justify-between">
              <span className="text-slate-600">BL No:</span>
              <span className="font-medium text-slate-900">{blNumber}</span>
            </div>
          ) : null}
          {thblNumber ? (
            <div className="flex justify-between">
              <span className="text-slate-600">ThBL:</span>
              <span className="font-medium text-slate-900">{thblNumber}</span>
            </div>
          ) : null}
          {mblNumber ? (
            <div className="flex justify-between">
              <span className="text-slate-600">MBL:</span>
              <span className="font-medium text-slate-900">{mblNumber}</span>
            </div>
          ) : null}
          {customerRef ? (
            <div className="flex justify-between">
              <span className="text-slate-600">Cust. Ref:</span>
              <span className="font-medium text-slate-900">{customerRef}</span>
            </div>
          ) : null}
          {quantityDisplay ? (
            <div className="flex justify-between">
              <span className="text-slate-600">Quantity:</span>
              <span className="font-medium text-slate-900">{quantityDisplay}</span>
            </div>
          ) : null}
          {freightTerms ? (
            <div className="flex justify-between">
              <span className="text-slate-600">Freight Terms:</span>
              <span className="font-medium text-slate-900">{freightTerms}</span>
            </div>
          ) : null}
          {roeDisplay ? (
            <div className="flex justify-between">
              <span className="text-slate-600">ROE:</span>
              <span className="font-medium text-slate-900">{roeDisplay}</span>
            </div>
          ) : null}
          {(igmNo || igmDate) ? (
            <div className="flex justify-between">
              <span className="text-slate-600">IGM No / Date:</span>
              <span className="font-medium text-slate-900">{igmNo}{igmDate ? ` / ${igmDate}` : ""}</span>
            </div>
          ) : null}
          {igmItemNo ? (
            <div className="flex justify-between">
              <span className="text-slate-600">Item No:</span>
              <span className="font-medium text-slate-900">{igmItemNo}</span>
            </div>
          ) : null}
          {fileNo ? (
            <div className="flex justify-between">
              <span className="text-slate-600">File No:</span>
              <span className="font-medium text-slate-900">{fileNo}</span>
            </div>
          ) : null}
          {salesRep ? (
            <div className="flex justify-between">
              <span className="text-slate-600">SalesRep:</span>
              <span className="font-medium text-slate-900">{salesRep}</span>
            </div>
          ) : null}
          {rcmDisplay ? (
            <div className="flex justify-between">
              <span className="text-slate-600">RCM:</span>
              <span className="font-bold text-slate-900">{rcmDisplay}</span>
            </div>
          ) : null}
          {remarks ? (
            <div className="pt-1 border-t border-slate-100">
              <span className="text-slate-600 block font-semibold">Remarks:</span>
              <span className="text-slate-800 italic block">{remarks}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* LINE ITEMS TABLE */}
      <div className="my-2 overflow-x-auto">
        <table className="w-full text-left border-collapse text-[9.5px]">
          <thead>
            <tr className="font-bold border-y-2 border-slate-400 bg-slate-100 text-slate-900">
              <th className="py-1 px-1 w-5 text-center">No</th>
              <th className="py-1 px-1.5">Description</th>
              <th className="py-1 px-1 text-center">SAC</th>
              <th className="py-1 px-1 text-center">CGST Rate %</th>
              <th className="py-1 px-1 text-center">{sgstHeaderLabel}</th>
              <th className="py-1 px-1 text-center">IGST Rate %</th>
              <th className="py-1 px-1 text-center">Place Of Supply</th>
              <th className="py-1 px-1 text-center">Curr.</th>
              <th className="py-1 px-1 text-right">Per Unit</th>
              <th className="py-1 px-1 text-center">Unit</th>
              <th className="py-1 px-1 text-right">Amount in INR</th>
              <th className="py-1 px-1 text-right">Taxable Amount</th>
              <th className="py-1 px-1 text-right">GST Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 border-b border-slate-400">
            {items.length > 0 ? (
              items.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="py-1 px-1 text-center font-medium text-slate-700">{idx + 1}</td>
                  <td className="py-1 px-1.5 font-medium text-slate-900 break-words max-w-[140px]">{item.description}</td>
                  <td className="py-1 px-1 text-center text-slate-700">{item.sac || "-"}</td>
                  <td className="py-1 px-1 text-center text-slate-800">{item.cgst_rate ? `${item.cgst_rate}%` : "0%"}</td>
                  <td className="py-1 px-1 text-center text-slate-800">{item.sgst_rate ? `${item.sgst_rate}%` : "0%"}</td>
                  <td className="py-1 px-1 text-center text-slate-800">{item.igst_rate ? `${item.igst_rate}%` : "0%"}</td>
                  <td className="py-1 px-1 text-center text-slate-700">{item.place_of_supply || "-"}</td>
                  <td className="py-1 px-1 text-center font-semibold text-slate-800">{item.currency}</td>
                  <td className="py-1 px-1 text-right tabular-nums text-slate-900">{formatIndianCurrency(item.rate)}</td>
                  <td className="py-1 px-1 text-center text-slate-700 uppercase">{item.unit}</td>
                  <td className="py-1 px-1 text-right tabular-nums text-slate-900">{formatIndianCurrency(item.amount_inr)}</td>
                  <td className="py-1 px-1 text-right tabular-nums font-medium text-slate-950">{formatIndianCurrency(item.taxable_amount)}</td>
                  <td className="py-1 px-1 text-right tabular-nums font-semibold text-slate-950">{formatIndianCurrency(item.gst_total)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={13} className="py-3 text-center text-slate-400 italic">No line items.</td>
              </tr>
            )}
            {/* TOTAL ROW */}
            <tr className="font-bold border-t border-slate-400 bg-slate-50 text-slate-950">
              <td colSpan={10} className="py-1 px-2 text-right uppercase tracking-wider text-[9px]">Total:</td>
              <td className="py-1 px-1 text-right tabular-nums font-bold">{formatIndianCurrency(totalAmountInr)}</td>
              <td className="py-1 px-1 text-right tabular-nums font-bold">{formatIndianCurrency(totalBeforeTax)}</td>
              <td className="py-1 px-1 text-right tabular-nums font-bold">{formatIndianCurrency(totalGst)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* TOTALS SECTION: TDS / WORDS (LEFT) & TOTALS BOX (RIGHT) */}
      <div className="grid grid-cols-12 gap-3 py-2 border-b border-slate-300 print-avoid-break">
        {/* LEFT: TDS NOTE & AMOUNT IN WORDS */}
        <div className="col-span-7 flex flex-col justify-between pr-2 text-[10px]">
          <div className="space-y-1.5">
            {tdsNote ? (
              <p className="text-slate-700 italic font-medium">{tdsNote}</p>
            ) : null}
            <div className="p-2 rounded bg-slate-50 border border-slate-200">
              <span className="font-bold text-slate-700 uppercase block text-[9px]">Total (Including Taxes) in Words:</span>
              <span className="font-extrabold text-slate-950 text-[10.5px] block mt-0.5 leading-snug">{amountInWords}</span>
            </div>
          </div>
        </div>

        {/* RIGHT: TOTALS BOX */}
        <div className="col-span-5 border-l border-slate-300 pl-3 space-y-1 text-[10.5px]">
          <div className="flex justify-between text-slate-700">
            <span>Total Before Tax:</span>
            <span className="tabular-nums font-semibold">{formatIndianCurrency(totalBeforeTax)}</span>
          </div>
          {cgstTotal > 0 ? (
            <div className="flex justify-between text-slate-700">
              <span>CGST Total:</span>
              <span className="tabular-nums font-semibold">{formatIndianCurrency(cgstTotal)}</span>
            </div>
          ) : null}
          {sgstTotal > 0 ? (
            <div className="flex justify-between text-slate-700">
              <span>SGST Total:</span>
              <span className="tabular-nums font-semibold">{formatIndianCurrency(sgstTotal)}</span>
            </div>
          ) : null}
          {igstTotal > 0 ? (
            <div className="flex justify-between text-slate-700">
              <span>IGST Total:</span>
              <span className="tabular-nums font-semibold">{formatIndianCurrency(igstTotal)}</span>
            </div>
          ) : null}
          <div className="pt-1 flex justify-between border-t border-slate-400 text-xs font-black text-slate-950">
            <span>Total After Tax:</span>
            <span className="tabular-nums">₹{formatIndianCurrency(totalAfterTax)}</span>
          </div>
          {advanceReceived > 0 ? (
            <>
              <div className="flex justify-between text-slate-700 text-[10px]">
                <span>Less: Advance Received:</span>
                <span className="tabular-nums font-semibold text-emerald-700">-₹{formatIndianCurrency(advanceReceived)}</span>
              </div>
              <div className="pt-1 flex justify-between border-t border-slate-300 text-xs font-bold text-slate-900">
                <span>Balance Payable:</span>
                <span className="tabular-nums">₹{formatIndianCurrency(balancePayable)}</span>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* FOOTER DETAILS */}
      <div className="pt-2 space-y-2 text-[9.5px] text-slate-800 print-avoid-break">
        {/* CONTAINER / TYPE / VEHICLE NO */}
        {containerDetails ? (
          <div className="text-slate-800">
            <span className="font-bold">Container No / Type / Vehicle No:</span> {containerDetails}
          </div>
        ) : null}

        {/* NUMBERED TERMS */}
        {termsList.length > 0 ? (
          <div>
            <span className="font-bold block uppercase text-[9px] text-slate-700 mb-0.5">Terms & Conditions:</span>
            <ol className="list-decimal list-inside space-y-0.5 text-slate-600 text-[9px]">
              {termsList.map((term, i) => (
                <li key={i}>{term.replace(/^\d+[\.\)]\s*/, "")}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {/* BANK DETAILS BOX & SIGNATURE */}
        <div className="grid grid-cols-12 gap-3 pt-2 items-end print-avoid-break">
          {/* BANK DETAILS BOX */}
          <div className="col-span-7">
            {hasBank ? (
              <div className="p-2 border border-slate-300 rounded text-[9.5px] bg-slate-50/60 space-y-0.5">
                <span className="font-extrabold uppercase tracking-wider block text-[9px] text-slate-800 border-b border-slate-200 pb-0.5 mb-1">
                  Bank Details
                </span>
                {bankDetails.accountName ? <div><span className="text-slate-600">A/c Name:</span> <strong>{bankDetails.accountName}</strong></div> : null}
                {bankDetails.bankName ? <div><span className="text-slate-600">Bank Name:</span> <strong>{bankDetails.bankName}</strong></div> : null}
                {bankDetails.branch ? <div><span className="text-slate-600">Branch Address:</span> <strong>{bankDetails.branch}</strong></div> : null}
                {bankDetails.accountNo ? <div><span className="text-slate-600">A/c No:</span> <strong>{bankDetails.accountNo}</strong></div> : null}
                {bankDetails.ifsc ? <div><span className="text-slate-600">IFSC Code:</span> <strong>{bankDetails.ifsc}</strong></div> : null}
              </div>
            ) : null}
          </div>

          {/* FOR COMPANY & AUTHORIZED SIGNATORY */}
          <div className="col-span-5 text-right flex flex-col justify-end items-end h-full">
            <div className="font-bold text-slate-900 text-[10px]">For {seller.name}</div>
            {resolvedSignatureUrl ? (
              <div className="py-1 flex items-center justify-end">
                <img
                  src={resolvedSignatureUrl}
                  alt="Authorized Signature"
                  crossOrigin="anonymous"
                  loading="eager"
                  className="max-h-14 max-w-[140px] object-contain ml-auto"
                />
              </div>
            ) : (
              <div className="h-10"></div>
            )}
            <div className="border-t border-slate-400 pt-0.5 font-semibold text-slate-800 text-[9.5px] w-36 text-center">
              Authorized Signatory
            </div>
          </div>
        </div>

        {/* PAYMENT METHODS, E. & O.E, DISCLAIMER */}
        <div className="pt-2 border-t border-slate-200 flex flex-wrap justify-between items-center text-[9px] text-slate-600">
          <div>Payment Modes: RTGS / NEFT / IMPS / Cheque / Bank Transfer</div>
          <div className="font-bold text-slate-800">E. & O.E.</div>
        </div>
        <div className="text-center text-[8.5px] text-slate-500 italic">
          This is a computer generated document.
        </div>
      </div>
    </div>
  );
});

export default InvoicePreview;
