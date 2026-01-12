import React, { useEffect, useMemo, useState } from "react";
import { Plus, Printer, Send, Save } from "lucide-react";

import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import FormField from "../../components/FormField";
import DataTable from "../../components/DataTable";
import Badge from "../../components/Badge";

import { companyGetProfile } from "../../services/company.service";
import { partiesByType } from "../../services/parties.service";
import { itemsList } from "../../services/items.service";
import { invoicesCreate } from "../../services/invoices.service";
import { computeIndiaGST, computeVAT } from "../../services/tax";
import { UI } from "../../theme/tokens";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const GST_RATES = [0, 5, 12, 18, 28];
const VAT_RATES = { "Sri Lanka": 18, "United Kingdom": 20, UK: 20, Ireland: 23 };

function getVatRate(country, company) {
  return company?.tax?.vatRate || VAT_RATES[country] || 0;
}

function parseRateInput(value) {
  const match = String(value || "").match(/[\d.]+/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function InvoiceCreate() {
  const company = companyGetProfile();
  const country = company?.country || "Sri Lanka";
  const isIndia = country === "India";

  const customers = partiesByType("Customer");
  const items = itemsList();

  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [partyId, setPartyId] = useState(customers[0]?.id || "");
  const party = useMemo(() => customers.find((c) => c.id === partyId) || null, [customers, partyId]);

  const [lines, setLines] = useState([
    { id: "l1", itemId: items[0]?.id || "", qty: 1, rate: items[0]?.price || 0, discount: 0, tax: 0 }
  ]);

  const companyState = company?.address?.state || "";
  const customerState = party?.state || "";
  const defaultRate = isIndia ? 18 : getVatRate(country, company);
  const [taxRate, setTaxRate] = useState(defaultRate);
  const [vatInput, setVatInput] = useState(
    isIndia ? "" : `VAT ${Number.isFinite(defaultRate) ? defaultRate : 0}%`
  );

  useEffect(() => {
    const rate = isIndia ? 18 : getVatRate(country, company);
    setTaxRate(rate);
    if (!isIndia) {
      setVatInput(`VAT ${Number.isFinite(rate) ? rate : 0}%`);
    }
  }, [country, isIndia, company]);

  function addLine() {
    setLines((p) => [
      ...p,
      {
        id: `l_${Date.now()}`,
        itemId: items[0]?.id || "",
        qty: 1,
        rate: items[0]?.price || 0,
        discount: 0,
        tax: 0
      }
    ]);
  }

  function updateLine(id, patch) {
    setLines((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeLine(id) {
    setLines((p) => p.filter((x) => x.id !== id));
  }

  const computed = useMemo(() => {
    const enriched = lines.map((l) => {
      const item = items.find((it) => it.id === l.itemId);
      const qty = Number(l.qty || 0);
      const rate = Number(l.rate || 0);
      const discount = Number(l.discount || 0);
      const taxRatePerLine = Number(l.tax || 0);

      const gross = qty * rate;
      const net = Math.max(0, gross - discount);
      const lineTax = net > 0 && taxRatePerLine > 0 ? (net * taxRatePerLine) / 100 : 0;
      return { ...l, itemName: item?.name || "-", gross, net, lineTax };
    });

    const subTotal = enriched.reduce((a, x) => a + x.net, 0);
    const manualTaxTotal = enriched.reduce((a, x) => a + x.lineTax, 0);

    let tax = { type: "VAT", totalTax: 0, vat: 0 };
    if (manualTaxTotal > 0) {
      tax = { type: "Line Tax", totalTax: manualTaxTotal, mode: "manual" };
    } else if (isIndia) {
      tax = computeIndiaGST({ taxRate, companyState, customerState, taxableAmount: subTotal });
    } else {
      tax = computeVAT({ vatRate: taxRate, taxableAmount: subTotal });
    }

    const grandTotal = subTotal + (tax.totalTax || 0);

    return { enriched, subTotal, tax, grandTotal };
  }, [lines, items, isIndia, companyState, customerState, taxRate]);
  const isManualTax = computed.tax?.mode === "manual";

  function mockPrint() {
    alert("Mock print: connect real print later.");
  }
  function mockEmail() {
    alert("Mock send email: integrate later.");
  }

  function saveInvoice() {
    const payload = {
      invoiceDate,
      partyId,
      partyName: party?.name || "",
      country,
      taxRate,
      companySnapshot: company,
      lines: computed.enriched,
      totals: {
        subTotal: computed.subTotal,
        tax: computed.tax,
        grandTotal: computed.grandTotal
      }
    };
    invoicesCreate(payload);
    alert("Saved (localStorage).");
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Sales - Invoice"
        subtitle="Create invoice - line items - country tax breakdown - preview panel"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={mockPrint}
              className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <button
              onClick={mockEmail}
              className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
            <GradientButton onClick={saveInvoice}>
              <Save className="h-4 w-4" />
              Save
            </GradientButton>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Invoice Form</p>
              <p className="text-xs text-slate-500">Country: {country}</p>
            </div>
            {isIndia ? <Badge tone="warning">GST</Badge> : <Badge tone="success">VAT</Badge>}
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Invoice Date">
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
              />
            </FormField>

            <FormField label="Customer">
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              label={isIndia ? "GST Rate" : "VAT Rate"}
              hint={isIndia ? "Select GST %" : "Auto VAT % / Type custom"}
            >
              {isIndia ? (
                <select
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                  className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                  style={{ "--tw-ring-color": UI.COLORS.ring }}
                >
                  {GST_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {`GST ${rate}%`}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    list="vat-presets"
                    value={vatInput}
                    onChange={(e) => {
                      const next = e.target.value;
                      setVatInput(next);
                      setTaxRate(parseRateInput(next));
                    }}
                    onBlur={() => {
                      const parsed = parseRateInput(vatInput);
                      setVatInput(`VAT ${parsed}%`);
                    }}
                    className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder="VAT 20%"
                  />
                  <datalist id="vat-presets">
                    {[getVatRate(country, company), 0]
                      .filter((rate, idx, arr) => arr.indexOf(rate) === idx)
                      .map((rate) => (
                        <option key={`vat_${rate}`} value={`VAT ${rate}%`} />
                      ))}
                  </datalist>
                </>
              )}
            </FormField>

            {isIndia ? (
              <>
                <FormField label="Company State (from Company Profile)">
                  <input
                    value={companyState}
                    readOnly
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                  />
                </FormField>
                <FormField label="Customer State (from Party)">
                  <input
                    value={customerState}
                    readOnly
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
                  />
                </FormField>
              </>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Line Items</p>
            <button
              onClick={addLine}
              className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add line
            </button>
          </div>

          <div className="mt-3">
            <DataTable
              columns={[
                {
                  key: "itemId",
                  header: "Item",
                  render: (r) => (
                    <select
                      value={r.itemId}
                      onChange={(e) => {
                        const it = items.find((x) => x.id === e.target.value);
                        updateLine(r.id, { itemId: e.target.value, rate: it?.price || 0 });
                      }}
                      className="rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-sm outline-none"
                    >
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name}
                        </option>
                      ))}
                    </select>
                  )
                },
                {
                  key: "qty",
                  header: "Qty",
                  render: (r) => (
                    <input
                      value={r.qty}
                      onChange={(e) => updateLine(r.id, { qty: e.target.value })}
                      className="w-20 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                    />
                  )
                },
                {
                  key: "rate",
                  header: "Rate",
                  render: (r) => (
                    <input
                      value={r.rate}
                      onChange={(e) => updateLine(r.id, { rate: e.target.value })}
                      className="w-28 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                    />
                  )
                },
                {
                  key: "discount",
                  header: "Discount",
                  render: (r) => (
                    <input
                      value={r.discount}
                      onChange={(e) => updateLine(r.id, { discount: e.target.value })}
                      className="w-28 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                    />
                  )
                },
                {
                  key: "tax",
                  header: "Tax %",
                  render: (r) => (
                    <input
                      value={r.tax}
                      onChange={(e) => updateLine(r.id, { tax: e.target.value })}
                      className="w-20 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                    />
                  )
                },
                { key: "net", header: "Net", render: (r) => money(r.net) },
                {
                  key: "rm",
                  header: "",
                  render: (r) => (
                    <button
                      onClick={() => removeLine(r.id)}
                      className="rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-xs font-semibold hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  )
                }
              ]}
              rows={computed.enriched}
              emptyText="Add items to invoice"
            />
          </div>
        </Card>

        <Card className="p-5 lg:col-span-1">
          <p className="text-sm font-semibold text-slate-900">Invoice Preview</p>
          <p className="text-xs text-slate-500 mt-1">Frontend-only preview panel</p>

          <div className="mt-4 rounded-2xl border border-slate-100 p-4 bg-slate-50/50">
            <p className="text-xs text-slate-500">Billed To</p>
            <p className="text-sm font-semibold text-slate-900">{party?.name || "Select customer"}</p>
            <p className="text-xs text-slate-500">{party?.phone || ""}</p>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Sub Total</span>
              <span className="font-semibold text-slate-900">{money(computed.subTotal)}</span>
            </div>

            <div className="mt-2 rounded-2xl border border-slate-100 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  {computed.tax.type}
                  {isManualTax ? "" : ` (${taxRate}%)`}
                </span>
                <span className="font-semibold text-slate-900">{money(computed.tax.totalTax)}</span>
              </div>

              {isManualTax ? (
                <div className="mt-2 text-xs text-slate-600 flex justify-between">
                  <span>Line tax total</span>
                  <span>{money(computed.tax.totalTax)}</span>
                </div>
              ) : isIndia ? (
                <div className="mt-2 text-xs text-slate-600 space-y-1">
                  <div className="flex justify-between">
                    <span>CGST</span>
                    <span>{money(computed.tax.cgst)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SGST</span>
                    <span>{money(computed.tax.sgst)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IGST</span>
                    <span>{money(computed.tax.igst)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-100 flex justify-between">
                    <span>Rule</span>
                    <span className="font-semibold">
                      {computed.tax.sameState ? "Same-state (CGST+SGST)" : "Inter-state (IGST)"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-600 flex justify-between">
                  <span>VAT</span>
                  <span>{money(computed.tax.vat)}</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-base">
              <span className="font-semibold text-slate-900">Grand Total</span>
              <span className="font-semibold text-slate-900">{money(computed.grandTotal)}</span>
            </div>
          </div>

          <div className="mt-5">
            <GradientButton className="w-full justify-center" onClick={saveInvoice}>
              <Save className="h-4 w-4" />
              Save Invoice
            </GradientButton>
          </div>
        </Card>
      </div>
    </div>
  );
}
