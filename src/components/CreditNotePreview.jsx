import React from "react";
import clsx from "clsx";

const VARIANTS = {
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

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine"
];
const TEENS = [
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function chunkToWords(num) {
  const parts = [];
  const hundred = Math.floor(num / 100);
  const rest = num % 100;
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest >= 10 && rest <= 19) {
    parts.push(TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) parts.push(TENS[tens]);
    if (ones) parts.push(ONES[ones]);
  }
  return parts.join(" ");
}

function numberToWords(num) {
  if (!num) return "Zero";
  const chunks = [
    { value: 1_000_000_000, label: "Billion" },
    { value: 1_000_000, label: "Million" },
    { value: 1_000, label: "Thousand" },
    { value: 1, label: "" }
  ];
  let remaining = num;
  const words = [];
  chunks.forEach((chunk) => {
    if (remaining >= chunk.value) {
      const part = Math.floor(remaining / chunk.value);
      remaining %= chunk.value;
      const label = chunk.label ? ` ${chunk.label}` : "";
      words.push(`${chunkToWords(part)}${label}`.trim());
    }
  });
  return words.join(" ");
}

function amountInWords(total, currency) {
  const whole = Math.floor(total);
  const fraction = Math.round((Number(total || 0) - whole) * 100);
  const words = numberToWords(whole);
  const suffix = currency ? ` ${currency}` : "";
  if (fraction > 0) {
    return `${words}${suffix} and ${fraction}/100`;
  }
  return `${words}${suffix} only`;
}

export default function CreditNotePreview({ templateId, styleConfig, noteData }) {
  const variant = VARIANTS[templateId] || VARIANTS.standard;
  const { primaryColor, bgColor, fontFamily, logoUrl, logoPosition } = styleConfig || {};
  const font = `${fontFamily || "Inter"}, "Helvetica Neue", Arial, sans-serif`;
  const title = noteData.title || "Credit Note";
  const logoPos = logoPosition || "left";
  const headerLayout =
    logoPos === "center" ? "flex flex-col items-center text-center" : "flex items-start justify-between";
  const invoiceAlign = logoPos === "right" ? "text-left" : "text-right";
  const companyAlign = logoPos === "right" ? "flex-row-reverse text-right" : "text-left";

  const seller = noteData.seller || {};
  const buyer = noteData.buyer || {};
  const lines = noteData.lines || [];
  const isIndia = noteData.country === "India";
  const isVat = !isIndia;
  const sameState = noteData.tax?.sameState;
  const currency = noteData.currency || "";
  const totalWords = noteData.amountInWords || amountInWords(noteData.totals?.grandTotal || 0, currency);

  return (
    <div
      className={clsx("credit-note-preview rounded-3xl border border-slate-100 shadow-soft", variant.padding)}
      style={{ backgroundColor: bgColor || "#ffffff", fontFamily: font }}
    >
      <div className={clsx(headerLayout, variant.header)}>
        {logoPos === "center" ? (
          <>
            <div className="flex flex-col items-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl border border-slate-200 object-cover" />
              ) : (
                <div className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-50" />
              )}
              <div>
                <p className={clsx("font-semibold text-slate-900", variant.value)}>{seller.name || "-"}</p>
                <p className={clsx("text-slate-500", variant.label)}>{seller.address || ""}</p>
              </div>
            </div>
            <div className="mt-3">
              <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
                {title}
              </p>
              <p className={clsx("text-slate-500", variant.label)}>No: {noteData.creditNoteNo || "-"}</p>
              <p className={clsx("text-slate-500", variant.label)}>Date: {noteData.creditDate || "-"}</p>
            </div>
          </>
        ) : (
          <>
            {logoPos === "right" ? (
              <div className={clsx(invoiceAlign)}>
                <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
                  {title}
                </p>
                <p className={clsx("text-slate-500", variant.label)}>No: {noteData.creditNoteNo || "-"}</p>
                <p className={clsx("text-slate-500", variant.label)}>Date: {noteData.creditDate || "-"}</p>
              </div>
            ) : null}

            <div className={clsx("flex items-center gap-3", companyAlign)}>
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-12 w-12 rounded-xl border border-slate-200 object-cover" />
              ) : (
                <div className="h-12 w-12 rounded-xl border border-slate-200 bg-slate-50" />
              )}
              <div>
                <p className={clsx("font-semibold text-slate-900", variant.value)}>{seller.name || "-"}</p>
                <p className={clsx("text-slate-500", variant.label)}>{seller.address || ""}</p>
              </div>
            </div>

            {logoPos !== "right" ? (
              <div className={clsx(invoiceAlign)}>
                <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
                  {title}
                </p>
                <p className={clsx("text-slate-500", variant.label)}>No: {noteData.creditNoteNo || "-"}</p>
                <p className={clsx("text-slate-500", variant.label)}>Date: {noteData.creditDate || "-"}</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className={clsx("mt-4", variant.divider)} />

      <div className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Seller</p>
          <p className={clsx("mt-2 font-semibold text-slate-900", variant.value)}>{seller.name || "-"}</p>
          {seller.address ? <p className={clsx("text-slate-500", variant.label)}>{seller.address}</p> : null}
          {isIndia && seller.gstin ? (
            <p className={clsx("text-slate-500", variant.label)}>GSTIN: {seller.gstin}</p>
          ) : null}
          {isVat && seller.vatNumber ? (
            <p className={clsx("text-slate-500", variant.label)}>VAT No: {seller.vatNumber}</p>
          ) : null}
          {seller.phone ? <p className={clsx("text-slate-500", variant.label)}>Phone: {seller.phone}</p> : null}
          {seller.email ? <p className={clsx("text-slate-500", variant.label)}>Email: {seller.email}</p> : null}
        </div>
        <div>
          <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Buyer</p>
          <p className={clsx("mt-2 font-semibold text-slate-900", variant.value)}>{buyer.name || "-"}</p>
          {buyer.address ? <p className={clsx("text-slate-500", variant.label)}>{buyer.address}</p> : null}
          {isIndia && buyer.gstin ? (
            <p className={clsx("text-slate-500", variant.label)}>GSTIN: {buyer.gstin}</p>
          ) : null}
          {buyer.phone ? <p className={clsx("text-slate-500", variant.label)}>Phone: {buyer.phone}</p> : null}
          {noteData.placeOfSupply ? (
            <p className={clsx("text-slate-500", variant.label)}>
              Place of Supply: {noteData.placeOfSupply}
            </p>
          ) : null}
        </div>
      </div>

      <div className={clsx("mt-5", variant.divider)} />

      <div className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Reference Invoice</p>
          <p className={clsx("mt-2 text-slate-600", variant.value)}>
            No: {noteData.referenceInvoiceNo || "-"}
          </p>
          <p className={clsx("text-slate-500", variant.label)}>
            Date: {noteData.referenceInvoiceDate || "-"}
          </p>
          {noteData.reason ? (
            <p className={clsx("text-slate-500", variant.label)}>Reason: {noteData.reason}</p>
          ) : null}
          {noteData.reasonNote ? (
            <p className={clsx("text-slate-500", variant.label)}>{noteData.reasonNote}</p>
          ) : null}
        </div>
        <div>
          <p className={clsx("uppercase tracking-widest text-slate-400", variant.label)}>Tax Summary</p>
          <p className={clsx("mt-2 text-slate-500", variant.label)}>
            Tax System: {noteData.taxSystem || (isIndia ? "GST" : "VAT")}
          </p>
          {isIndia ? (
            <p className={clsx("text-slate-500", variant.label)}>
              Rule: {sameState ? "CGST + SGST" : "IGST"}
            </p>
          ) : null}
        </div>
      </div>

      <div className={clsx("mt-5", variant.divider)} />

      <div className="mt-4">
        <div className={clsx("grid grid-cols-12 gap-2 text-slate-500", variant.tableHead)}>
          <span className="col-span-3">Item</span>
          <span className="col-span-2">HSN/SAC</span>
          <span className="col-span-1 text-right">Qty</span>
          <span className="col-span-2 text-right">Rate</span>
          <span className="col-span-2 text-right">Taxable</span>
          <span className="col-span-1 text-right">Tax</span>
          <span className="col-span-1 text-right">Total</span>
        </div>
        <div className="mt-2 space-y-2">
          {lines.map((line) => (
            <div key={line.id} className="grid grid-cols-12 gap-2 text-slate-700">
              <span className={clsx("col-span-3", variant.value)}>{line.name}</span>
              <span className={clsx("col-span-2", variant.value)}>{line.hsn || "-"}</span>
              <span className={clsx("col-span-1 text-right", variant.value)}>{line.qty}</span>
              <span className={clsx("col-span-2 text-right", variant.value)}>{money(line.rate)}</span>
              <span className={clsx("col-span-2 text-right", variant.value)}>{money(line.taxableValue)}</span>
              <span className={clsx("col-span-1 text-right", variant.value)}>{money(line.taxAmount)}</span>
              <span className={clsx("col-span-1 text-right font-semibold", variant.value)}>
                {money(line.total)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={clsx("mt-5", variant.divider)} />

      <div className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className={clsx("text-slate-500", variant.label)}>Amount in Words</p>
          <p className={clsx("mt-2 text-slate-600", variant.value)}>{totalWords}</p>
          <p className={clsx("mt-4 text-slate-500", variant.label)}>Authorized Signature</p>
          <div className="mt-8 h-10 border-b border-slate-200" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Total Taxable Amount</span>
            <span className={clsx("text-slate-900 font-semibold", variant.value)}>
              {money(noteData.totals.taxableTotal)}
            </span>
          </div>
          {isIndia ? (
            sameState ? (
              <>
                <div className="flex items-center justify-between">
                  <span className={clsx("text-slate-500", variant.label)}>CGST</span>
                  <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                    {money(noteData.tax.cgst)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={clsx("text-slate-500", variant.label)}>SGST</span>
                  <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                    {money(noteData.tax.sgst)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className={clsx("text-slate-500", variant.label)}>IGST</span>
                <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                  {money(noteData.tax.igst)}
                </span>
              </div>
            )
          ) : (
            <div className="flex items-center justify-between">
              <span className={clsx("text-slate-500", variant.label)}>{noteData.taxLabel || "VAT"}</span>
              <span className={clsx("text-slate-900 font-semibold", variant.value)}>
                {money(noteData.totals.taxTotal)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>
              {isIndia ? "Total GST" : "Total Tax"}
            </span>
            <span className={clsx("text-slate-900 font-semibold", variant.value)}>
              {money(noteData.totals.taxTotal)}
            </span>
          </div>
          <div className={clsx("pt-2", variant.divider)} />
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Credit Note Total</span>
            <span className={clsx("font-semibold", variant.total)} style={{ color: primaryColor }}>
              {money(noteData.totals.grandTotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
