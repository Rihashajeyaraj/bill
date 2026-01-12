import React from "react";
import clsx from "clsx";

const VARIANTS = {
  compact: {
    padding: "p-4",
    title: "text-lg",
    label: "text-[10px]",
    value: "text-xs",
    tableHead: "text-[10px]",
    total: "text-sm",
    divider: "border-t border-slate-100"
  },
  standard: {
    padding: "p-6",
    title: "text-xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-base",
    divider: "border-t border-slate-100"
  },
  modern: {
    padding: "p-7",
    title: "text-2xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-lg",
    divider: "border-t-2 border-slate-200"
  },
  minimal: {
    padding: "p-6",
    title: "text-xl",
    label: "text-xs",
    value: "text-sm",
    tableHead: "text-xs",
    total: "text-base",
    divider: "border-t border-slate-50"
  }
};

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function InvoicePreview({ templateId, styleConfig, invoiceData }) {
  const variant = VARIANTS[templateId] || VARIANTS.standard;
  const { primaryColor, bgColor, fontFamily, logoUrl } = styleConfig || {};
  const font = `${fontFamily || "Inter"}, "Helvetica Neue", Arial, sans-serif`;

  return (
    <div
      className={clsx("rounded-3xl border border-slate-100 shadow-soft", variant.padding)}
      style={{ backgroundColor: bgColor || "#ffffff", fontFamily: font }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
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
        <div className="text-right">
          <p className={clsx("font-semibold text-slate-900", variant.title)} style={{ color: primaryColor }}>
            Invoice
          </p>
          <p className={clsx("text-slate-500", variant.label)}>No: {invoiceData.invoiceNo}</p>
          <p className={clsx("text-slate-500", variant.label)}>Date: {invoiceData.invoiceDate}</p>
        </div>
      </div>

      <div className={clsx("mt-4", variant.divider)} />

      <div className="mt-4 grid grid-cols-2 gap-6">
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
              <span className={clsx("col-span-2 text-right", variant.value)}>{money(item.rate)}</span>
              <span className={clsx("col-span-2 text-right font-semibold", variant.value)}>
                {money(item.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={clsx("mt-5", variant.divider)} />

      <div className="mt-4 grid grid-cols-2 gap-6">
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
              {money(invoiceData.totals.subTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Tax</span>
            <span className={clsx("text-slate-900 font-semibold", variant.value)}>
              {money(invoiceData.totals.tax)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Total</span>
            <span className={clsx("font-semibold", variant.total)} style={{ color: primaryColor }}>
              {money(invoiceData.totals.total)}
            </span>
          </div>
          <div className={clsx("pt-2", variant.divider)} />
          <div className="flex items-center justify-between">
            <span className={clsx("text-slate-500", variant.label)}>Balance Due</span>
            <span className={clsx("font-semibold", variant.total)} style={{ color: primaryColor }}>
              {money(invoiceData.totals.balance)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
