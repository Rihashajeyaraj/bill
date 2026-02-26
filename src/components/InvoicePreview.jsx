import React from "react";
import clsx from "clsx";

const VARIANTS = {
  india_triplicate: {
    padding: "p-5",
    title: "text-2xl",
    label: "text-[11px] uppercase tracking-wide",
    value: "text-sm",
    tableHead: "text-[11px] uppercase tracking-wide",
    total: "text-lg",
    header: "border border-slate-300 p-3",
    divider: "border-t border-slate-300"
  },
  india_blue_gst: {
    padding: "p-7",
    title: "text-2xl",
    label: "text-xs uppercase tracking-widest",
    value: "text-sm",
    tableHead: "text-xs uppercase tracking-widest",
    total: "text-lg",
    header: "rounded-2xl border border-sky-200 bg-sky-50/40 p-4",
    divider: "border-t-2 border-sky-200"
  },
  india_gst_sample: {
    padding: "p-6",
    title: "text-2xl",
    label: "text-[11px] uppercase tracking-wider",
    value: "text-sm",
    tableHead: "text-[11px] uppercase tracking-wider",
    total: "text-lg",
    header: "",
    divider: "border-t-2 border-slate-300"
  },
  india_igst_sample: {
    padding: "p-7",
    title: "text-2xl",
    label: "text-xs uppercase tracking-widest",
    value: "text-sm",
    tableHead: "text-xs uppercase tracking-widest",
    total: "text-lg",
    header: "rounded-2xl border border-slate-200 p-4",
    divider: "border-t-2 border-slate-300"
  },
  compact: {
    padding: "p-4",
    title: "text-lg",
    label: "text-[10px]",
    value: "text-xs",
    tableHead: "text-[10px]",
    total: "text-sm",
    header: "",
    divider: "border-t border-slate-100"
  },
  standard: {
    padding: "p-6",
    title: "text-xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-base",
    header: "",
    divider: "border-t border-slate-100"
  },
  modern: {
    padding: "p-7",
    title: "text-2xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-lg",
    header: "rounded-2xl bg-slate-50/70 p-4",
    divider: "border-t-2 border-slate-200"
  },
  minimal: {
    padding: "p-6",
    title: "text-xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-base",
    header: "",
    divider: "border-t border-slate-50"
  },
  classic: {
    padding: "p-6",
    title: "text-xl",
    label: "text-[11px] uppercase tracking-widest",
    value: "text-sm",
    tableHead: "text-[11px] uppercase tracking-widest",
    total: "text-base",
    header: "",
    divider: "border-t border-slate-200"
  },
  bold: {
    padding: "p-7",
    title: "text-2xl",
    label: "text-xs uppercase tracking-wider",
    value: "text-sm",
    tableHead: "text-xs uppercase tracking-wider",
    total: "text-xl",
    header: "rounded-2xl border border-slate-200 p-4",
    divider: "border-t-2 border-slate-300"
  },
  elegant: {
    padding: "p-6",
    title: "text-xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-base",
    header: "border border-slate-100 rounded-2xl p-4",
    divider: "border-t border-slate-200/70"
  },
  mono: {
    padding: "p-6",
    title: "text-xl",
    label: "text-xs uppercase tracking-widest",
    value: "text-sm",
    tableHead: "text-xs uppercase tracking-widest",
    total: "text-base",
    header: "",
    divider: "border-t border-slate-100"
  },
  simple: {
    padding: "p-6",
    title: "text-xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-base",
    header: "",
    divider: "border-t border-slate-100"
  },
  professional: {
    padding: "p-7",
    title: "text-2xl",
    label: "text-xs uppercase tracking-widest",
    value: "text-sm",
    tableHead: "text-xs uppercase tracking-widest",
    total: "text-lg",
    header: "rounded-2xl border border-slate-200 p-4",
    divider: "border-t-2 border-slate-200"
  }
};

function money(n, currencySymbol) {
  const v = Number(n || 0);
  const formatted = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (!currencySymbol) return formatted;
  return `${currencySymbol}${formatted}`;
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

function normalizeCountry(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "in") return "india";
  return normalized;
}

export default function InvoicePreview({ templateId, styleConfig, invoiceData }) {
  const variant = VARIANTS[templateId] || VARIANTS.standard;
  const { primaryColor, bgColor, fontFamily, logoUrl, logoPosition } = styleConfig || {};
  const font = fontFamily
    ? `"${fontFamily}", "Helvetica Neue", Arial, sans-serif`
    : "var(--invoice-font-family, var(--app-font-family))";
  const title = invoiceData.title || "Invoice";
  const currencySymbol = invoiceData.currencySymbol || "";
  const logoPos = logoPosition || "left";
  const headerLayout =
    logoPos === "center" ? "flex flex-col items-center text-center" : "flex items-start justify-between";
  const invoiceAlign = logoPos === "right" ? "text-left" : "text-right";
  const companyAlign = logoPos === "right" ? "flex-row-reverse text-right" : "text-left";
  const totalsTaxObject = invoiceData.totals?.tax && typeof invoiceData.totals.tax === "object" ? invoiceData.totals.tax : {};
  const taxBreakup =
    (invoiceData.taxBreakup && typeof invoiceData.taxBreakup === "object" ? invoiceData.taxBreakup : null) ||
    (invoiceData.totals?.taxBreakup && typeof invoiceData.totals.taxBreakup === "object" ? invoiceData.totals.taxBreakup : null);
  const rawTaxType = String(
    invoiceData.taxMode ||
      invoiceData.tax?.type ||
      totalsTaxObject?.type ||
      (invoiceData.country === "India" ? "GST" : "NORMAL")
  ).toUpperCase();
  const isIndiaGST = rawTaxType === "GST";
  const taxType = rawTaxType;
  const formattedInvoiceDate = formatDayMonthYear(invoiceData.invoiceDate);

  const seller = invoiceData.seller || {
    name: invoiceData.companyName || "",
    address: invoiceData.companyAddress || "",
    gstin: invoiceData.companyGstin || "",
    phone: invoiceData.companyPhone || "",
    email: invoiceData.companyEmail || "",
    country: invoiceData.companyCountry || "",
    state: invoiceData.companyState || ""
  };

  const buyer = invoiceData.buyer || {
    name: invoiceData.customer?.name || "",
    address: invoiceData.customer?.address || "",
    gstin: invoiceData.customer?.gstin || "",
    phone: invoiceData.customer?.phone || "",
    country: invoiceData.customer?.country || "",
    state: invoiceData.customer?.state || ""
  };

  function getTotalTax() {
    if (typeof invoiceData.totals?.tax === "number") return Number(invoiceData.totals.tax || 0);
    if (invoiceData.totals?.tax && typeof invoiceData.totals.tax === "object") {
      return Number(
        invoiceData.totals.tax.totalTax ??
          invoiceData.totals.tax.taxAmount ??
          invoiceData.totals.tax.vat ??
          0
      );
    }
    if (taxBreakup && typeof taxBreakup === "object") {
      return Number(taxBreakup.totalTax ?? taxBreakup.taxAmount ?? 0);
    }
    return Number(invoiceData.tax?.totalTax ?? invoiceData.tax?.taxAmount ?? 0);
  }

  function buildGstLines() {
    const rateFallback = Number(invoiceData.taxRate || 0);
    return (invoiceData.items || []).map((item) => {
      const qty = Number(item.qty || 0);
      const rate = Number(item.rate || 0);
      const taxableValue =
        Number(item.taxableValue || item.net || 0) || Math.max(0, qty * rate - Number(item.discount || 0));
      const taxRate = Number(item.taxRate ?? item.tax ?? rateFallback);
      const taxAmount = (taxableValue * taxRate) / 100;
      return {
        id: item.id || item.name,
        name: item.name || "-",
        hsn: item.hsn || item.sac || item.hsnSac || "-",
        qty,
        rate,
        taxableValue,
        taxRate,
        taxAmount,
        total: taxableValue + taxAmount
      };
    });
  }

  function getSameState() {
    if (typeof invoiceData.tax?.sameState === "boolean") return invoiceData.tax.sameState;
    if (taxBreakup?.supplyType) return taxBreakup.supplyType === "INTRA";
    if (invoiceData.tax?.supplyType) return invoiceData.tax.supplyType !== "INTER";
    const sellerCountry = normalizeCountry(seller.country || invoiceData.country || invoiceData.companyCountry || "");
    const buyerCountry = normalizeCountry(buyer.country || invoiceData.customer?.country || "");
    if (sellerCountry && buyerCountry && sellerCountry !== buyerCountry) return false;
    const sellerState = (seller.state || "").trim().toLowerCase();
    const buyerState = (buyer.state || invoiceData.placeOfSupply || "").trim().toLowerCase();
    return sellerState && buyerState ? sellerState === buyerState : false;
  }

  if (isIndiaGST) {
    const gstLines = buildGstLines();
    const totalTaxable = gstLines.reduce((sum, line) => sum + line.taxableValue, 0) || Number(invoiceData.totals?.subTotal || 0);
    const lineTaxTotal = gstLines.reduce((sum, line) => sum + line.taxAmount, 0);
    const totalTax = lineTaxTotal || getTotalTax();
    const grandTotal = Number(invoiceData.totals?.total ?? invoiceData.totals?.grandTotal ?? totalTaxable + totalTax);
    const sameState = getSameState();
    const supplyType = invoiceData.tax?.supplyType || taxBreakup?.supplyType || (sameState ? "INTRA" : "INTER");
    const cgst = Number(
      invoiceData.tax?.cgst ?? totalsTaxObject?.cgst ?? taxBreakup?.cgst ?? (supplyType === "INTRA" ? totalTax / 2 : 0)
    );
    const sgst = Number(
      invoiceData.tax?.sgst ?? totalsTaxObject?.sgst ?? taxBreakup?.sgst ?? (supplyType === "INTRA" ? totalTax - cgst : 0)
    );
    const igst = Number(
      invoiceData.tax?.igst ?? totalsTaxObject?.igst ?? taxBreakup?.igst ?? (supplyType === "INTER" ? totalTax : 0)
    );
    const amountWords = invoiceData.amountInWords || `Rupees ${money(grandTotal, "")} only`;

    return (
      <div
        className={clsx("invoice-template-scope app-invoice-preview rounded-3xl border shadow-soft", variant.padding)}
        style={{
          backgroundColor: bgColor || "var(--card)",
          "--invoice-font-family": font
        }}
      >
        <div
          className={clsx(
            "gap-6",
            logoPos === "center"
              ? "flex flex-col items-center text-center"
              : logoPos === "right"
                ? "flex items-start justify-between flex-row-reverse"
                : "flex items-start justify-between"
          )}
        >
          <div
            className={clsx(
              "gap-3",
              logoPos === "center"
                ? "flex flex-col items-center"
                : logoPos === "right"
                  ? "flex items-start flex-row-reverse text-right"
                  : "flex items-start text-left"
            )}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl border border-slate-200 object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-50" />
            )}
            <div className="space-y-1">
              <p className={clsx("font-semibold text-slate-900", variant.value)}>{seller.name}</p>
              {seller.address ? <p className={clsx("text-slate-500", variant.label)}>{seller.address}</p> : null}
              {seller.gstin ? <p className={clsx("text-slate-500", variant.label)}>GSTIN: {seller.gstin}</p> : null}
              {seller.phone ? <p className={clsx("text-slate-500", variant.label)}>Phone: {seller.phone}</p> : null}
              {seller.email ? <p className={clsx("text-slate-500", variant.label)}>Email: {seller.email}</p> : null}
            </div>
          </div>
          <div
            className={clsx(
              "space-y-1",
              logoPos === "center" ? "text-center" : logoPos === "right" ? "text-left" : "text-right"
            )}
          >
            <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
              {title.toUpperCase()}
            </p>
            <p className={clsx("text-slate-500", variant.label)}>No: {invoiceData.invoiceNo || "-"}</p>
            <p className={clsx("text-slate-500", variant.label)}>Date: {formattedInvoiceDate}</p>
            <p className={clsx("text-slate-500", variant.label)}>
              Place of Supply: {invoiceData.placeOfSupply || buyer.state || "-"}
            </p>
          </div>
        </div>

        <div className={clsx("mt-4", variant.divider)} />

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <div>
            <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Bill To</p>
            <p className={clsx("mt-2 font-semibold text-slate-900", variant.value)}>{buyer.name || "-"}</p>
            {buyer.address ? <p className={clsx("text-slate-500", variant.label)}>{buyer.address}</p> : null}
            {buyer.gstin ? <p className={clsx("text-slate-500", variant.label)}>GSTIN: {buyer.gstin}</p> : null}
            {buyer.phone ? <p className={clsx("text-slate-500", variant.label)}>Phone: {buyer.phone}</p> : null}
          </div>
          <div>
            <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Invoice Info</p>
            <div className="mt-2 space-y-1">
              <p className={clsx("text-slate-500", variant.label)}>Invoice No: {invoiceData.invoiceNo || "-"}</p>
              <p className={clsx("text-slate-500", variant.label)}>
                Invoice Date: {formattedInvoiceDate}
              </p>
              <p className={clsx("text-slate-500", variant.label)}>
                Place of Supply: {invoiceData.placeOfSupply || buyer.state || "-"}
              </p>
              <p className={clsx("text-slate-500", variant.label)}>
                Tax Rule: {supplyType === "INTER" ? "IGST" : "CGST + SGST"}
              </p>
            </div>
          </div>
        </div>

        <div className={clsx("mt-5", variant.divider)} />

        <div className="mt-4">
          <div className={clsx("grid grid-cols-12 gap-2 text-slate-500", variant.tableHead)}>
            <span className="col-span-4">Item</span>
            <span className="col-span-2">HSN/SAC</span>
            <span className="col-span-1 text-right">Qty</span>
            <span className="col-span-1 text-right">Rate</span>
            <span className="col-span-2 text-right">Taxable</span>
            <span className="col-span-1 text-right">GST %</span>
            <span className="col-span-1 text-right">Total</span>
          </div>
          <div className="mt-2 space-y-2">
            {gstLines.map((line) => (
              <div key={line.id} className="grid grid-cols-12 gap-2 text-slate-700">
                <span className={clsx("col-span-4", variant.value)}>{line.name}</span>
                <span className={clsx("col-span-2", variant.value)}>{line.hsn}</span>
                <span className={clsx("col-span-1 text-right", variant.value)}>{line.qty}</span>
                <span className={clsx("col-span-1 text-right", variant.value)}>{money(line.rate, currencySymbol)}</span>
                <span className={clsx("col-span-2 text-right", variant.value)}>
                  {money(line.taxableValue, currencySymbol)}
                </span>
                <span className={clsx("col-span-1 text-right", variant.value)}>{line.taxRate}%</span>
                <span className={clsx("col-span-1 text-right font-semibold", variant.value)}>
                  {money(line.total, currencySymbol)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={clsx("mt-5", variant.divider)} />

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <div>
            <p className={clsx("text-slate-500", variant.label)}>Amount in Words</p>
            <p className={clsx("mt-2 text-slate-600", variant.value)}>{amountWords}</p>
            <p className={clsx("mt-4 text-slate-500", variant.label)}>Authorized Signature</p>
            <div className="mt-8 h-10 border-b border-slate-200" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={clsx("text-slate-500", variant.label)}>Total Taxable Amount</span>
              <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                {money(totalTaxable, currencySymbol)}
              </span>
            </div>
            {supplyType !== "INTER" ? (
              <>
                <div className="flex items-center justify-between">
                  <span className={clsx("text-slate-500", variant.label)}>CGST</span>
                  <span className={clsx("mr-4 text-slate-900 font-semibold", variant.value)}>
                    {money(cgst, currencySymbol)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={clsx("text-slate-500", variant.label)}>SGST</span>
                  <span className={clsx("mr-4 text-slate-900 font-semibold", variant.value)}>
                    {money(sgst, currencySymbol)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className={clsx("text-slate-500", variant.label)}>IGST</span>
                <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                  {money(igst, currencySymbol)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className={clsx("text-slate-500", variant.label)}>Total GST</span>
              <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                {money(totalTax, currencySymbol)}
              </span>
            </div>
            <div className={clsx("pt-2", variant.divider)} />
            <div className="flex items-center justify-between">
              <span className={clsx("text-slate-500", variant.label)}>Grand Total</span>
              <span className={clsx("font-semibold", variant.total)} style={{ color: primaryColor }}>
                {money(grandTotal, currencySymbol)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const taxRate = Number(invoiceData.taxRate || invoiceData.tax?.rate || taxBreakup?.taxRate || 0);
  const taxLabel =
    invoiceData.tax?.taxLabel ||
    taxBreakup?.taxLabel ||
    (taxType === "VAT" ? "VAT" : taxType === "SALES_TAX" ? "Sales Tax" : "TAX");
  const taxValue = Number(taxBreakup?.taxAmount ?? getTotalTax());
  const showTaxLine = taxType !== "NONE" && taxValue > 0;
  const taxIdLabel = invoiceData.tax?.idLabel || "Tax ID";
  const taxIdValue = invoiceData.tax?.idValue || "";

  return (
    <div
      className={clsx("invoice-template-scope app-invoice-preview rounded-3xl border shadow-soft", variant.padding)}
      style={{
        backgroundColor: bgColor || "var(--card)",
        "--invoice-font-family": font
      }}
    >
      <div className={clsx(headerLayout, variant.header)}>
        {logoPos === "center" ? (
          <>
            <div className="flex flex-col items-center gap-2">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="logo"
                  className="h-12 w-12 rounded-xl border border-slate-200 object-cover"
                />
              ) : (
                <div className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-50" />
              )}
              <div>
                <p className={clsx("font-semibold text-slate-900", variant.value)}>
                  {invoiceData.companyName}
                </p>
                <p className={clsx("text-slate-500", variant.label)}>Billing Address</p>
              </div>
            </div>
            <div className="mt-3">
              <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
                {title}
              </p>
              <p className={clsx("text-slate-500", variant.label)}>No: {invoiceData.invoiceNo}</p>
              <p className={clsx("text-slate-500", variant.label)}>Date: {formattedInvoiceDate}</p>
            </div>
          </>
        ) : (
          <>
            {logoPos === "right" ? (
              <div className={clsx(invoiceAlign)}>
                <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
                  {title}
                </p>
                <p className={clsx("text-slate-500", variant.label)}>No: {invoiceData.invoiceNo}</p>
                <p className={clsx("text-slate-500", variant.label)}>Date: {formattedInvoiceDate}</p>
              </div>
            ) : null}

            <div className={clsx("flex items-center gap-3", companyAlign)}>
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl border border-slate-200 object-cover" />
              ) : (
                <div className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-50" />
              )}
              <div>
                <p className={clsx("font-semibold text-slate-900", variant.value)}>
                  {invoiceData.companyName}
                </p>
                <p className={clsx("text-slate-500", variant.label)}>Billing Address</p>
              </div>
            </div>

            {logoPos !== "right" ? (
              <div className={clsx(invoiceAlign)}>
                <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
                  {title}
                </p>
                <p className={clsx("text-slate-500", variant.label)}>No: {invoiceData.invoiceNo}</p>
                <p className={clsx("text-slate-500", variant.label)}>Date: {formattedInvoiceDate}</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className={clsx("mt-4", variant.divider)} />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <div>
          <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Bill To</p>
          <p className={clsx("mt-2 font-semibold text-slate-900", variant.value)}>{invoiceData.customer.name}</p>
          <p className={clsx("text-slate-500", variant.label)}>{invoiceData.customer.phone}</p>
          <p className={clsx("text-slate-500", variant.label)}>{invoiceData.customer.address}</p>
        </div>
        <div>
          <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Payment</p>
          <div className="mt-2 flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Due date</span>
            <span className={clsx("text-slate-900 font-semibold", variant.value)}>{invoiceData.dueDate}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Terms</span>
            <span className={clsx("text-slate-900", variant.value)}>Net 15</span>
          </div>
          {taxIdValue ? (
            <div className="mt-1 flex items-center justify-between">
              <span className={clsx("text-slate-500", variant.label)}>{taxIdLabel}</span>
              <span className={clsx("text-slate-900", variant.value)}>{taxIdValue}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className={clsx("mt-5", variant.divider)} />

      <div className="mt-4">
        <div className={clsx("grid grid-cols-12 gap-2 text-slate-500", variant.tableHead)}>
          <span className="col-span-6">Item</span>
          <span className="col-span-2 text-right">Qty</span>
          <span className="col-span-2 text-right">Rate</span>
          <span className="col-span-2 text-right">Amount</span>
        </div>
        <div className="mt-2 space-y-2">
          {invoiceData.items.map((item) => (
            <div key={item.id} className="grid grid-cols-12 gap-2 text-slate-700">
              <span className={clsx("col-span-6", variant.value)}>{item.name}</span>
              <span className={clsx("col-span-2 text-right", variant.value)}>{item.qty}</span>
              <span className={clsx("col-span-2 text-right", variant.value)}>
                {money(item.rate, currencySymbol)}
              </span>
              <span className={clsx("col-span-2 text-right font-semibold", variant.value)}>
                {money(item.amount, currencySymbol)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={clsx("mt-5", variant.divider)} />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <div>
          <p className={clsx("text-slate-500", variant.label)}>Notes</p>
          <p className={clsx("mt-2 text-slate-600", variant.value)}>
            Thank you for your business. Payment is due within 15 days.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Subtotal</span>
            <span className={clsx("text-slate-900 font-semibold", variant.value)}>
              {money(invoiceData.totals.subTotal, currencySymbol)}
            </span>
          </div>
          {showTaxLine ? (
            <div className="flex items-center justify-between">
              <span className={clsx("text-slate-500", variant.label)}>{taxLabel}</span>
              <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                {money(taxValue, currencySymbol)}
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Total</span>
            <span className={clsx("font-semibold", variant.total)} style={{ color: primaryColor }}>
              {money(invoiceData.totals.total, currencySymbol)}
            </span>
          </div>
          <div className={clsx("pt-2", variant.divider)} />
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Balance Due</span>
            <span className={clsx("font-semibold", variant.total)} style={{ color: primaryColor }}>
              {money(invoiceData.totals.balance, currencySymbol)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
