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
import { formatMoney } from "../../modules/parties/utils";
import { getPartyCreditStatus } from "../../modules/parties/store";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function generateInvoiceNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rnd = String(Math.floor(100 + Math.random() * 900));
  return `INV-${yy}${mm}${dd}-${rnd}`;
}

function formatAddress(address) {
  if (!address) return "";
  const parts = [address.line1, address.line2, address.city, address.state, address.postalCode]
    .map((part) => (part ? String(part).trim() : ""))
    .filter(Boolean);
  return parts.join(", ");
}

const GST_RATES = [0, 5, 12, 18, 28];
const INDIA_STATES = [
  "Andhra Pradesh",
  "Delhi",
  "Gujarat",
  "Karnataka",
  "Kerala",
  "Maharashtra",
  "Tamil Nadu",
  "Telangana",
  "West Bengal"
];
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
  const country = company?.country || "";
  const isIndia = country === "India";
  const currency = company?.currency || company?.tax?.currency || "";

  const customers = partiesByType("Customer");
  const items = itemsList();
  const [itemSearch, setItemSearch] = useState("");

  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState("");
  const [partyId, setPartyId] = useState("");
  const party = useMemo(() => customers.find((c) => c.id === partyId) || null, [customers, partyId]);
  const [placeOfSupply, setPlaceOfSupply] = useState("");

  const [lines, setLines] = useState([]);

  const companyState = company?.address?.state || "";
  const customerState = isIndia ? placeOfSupply || "" : party?.state || "";
  const companyVatRate = company?.tax?.vatRate;
  const defaultRate = isIndia ? 18 : getVatRate(country, company);
  const [taxRate, setTaxRate] = useState(defaultRate);
  const [vatInput, setVatInput] = useState(
    isIndia ? "" : `VAT ${Number.isFinite(defaultRate) ? defaultRate : 0}%`
  );

  const creditStatus = useMemo(() => getPartyCreditStatus(partyId), [partyId]);

  useEffect(() => {
    const rate = isIndia ? 18 : getVatRate(country, company);
    setTaxRate(rate);
    if (!isIndia) {
      setVatInput(`VAT ${Number.isFinite(rate) ? rate : 0}%`);
    }
  }, [country, isIndia, companyVatRate]);

  useEffect(() => {
    if (!isIndia) return;
    const candidate = party?.state || "";
    const normalizedCandidate = INDIA_STATES.find(
      (state) => state.toLowerCase() === candidate.trim().toLowerCase()
    );
    if (normalizedCandidate) {
      setPlaceOfSupply(normalizedCandidate);
      return;
    }
    const normalizedCompany = INDIA_STATES.find(
      (state) => state.toLowerCase() === companyState.trim().toLowerCase()
    );
    setPlaceOfSupply(normalizedCompany || "");
  }, [party?.state, companyState, isIndia]);

  function addLine() {
    setLines((p) => [
      ...p,
      {
        id: `l_${Date.now()}`,
        itemId: "",
        qty: 1,
        rate: 0,
        discount: 0,
        tax: 0
      }
    ]);
  }

  function addLineWithItem(item) {
    if (!item) return;
    setLines((prev) => {
      const emptyIndex = prev.findIndex((line) => !line.itemId);
      const nextLine = {
        id: `l_${Date.now()}`,
        itemId: item.id,
        qty: 1,
        rate: item.price || 0,
        discount: 0,
        tax: item.taxRate || 0
      };
      if (emptyIndex >= 0) {
        return prev.map((line, idx) => (idx === emptyIndex ? { ...line, ...nextLine, id: line.id } : line));
      }
      return [...prev, nextLine];
    });
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
      return { ...l, itemName: item?.name || "XXX", hsn: item?.hsn || item?.sac || "XX", gross, net, lineTax };
    });

    const subTotal = enriched.reduce((a, x) => a + x.net, 0);
    const lineTaxTotal = enriched.reduce((a, x) => a + x.lineTax, 0);
    const normalizedCompany = (companyState || placeOfSupply || "").trim().toLowerCase();
    const normalizedCustomer = (customerState || placeOfSupply || "").trim().toLowerCase();
    const sameState = normalizedCompany && normalizedCustomer && normalizedCompany === normalizedCustomer;

    let tax = { type: isIndia ? "GST" : "VAT", totalTax: 0 };
    if (isIndia) {
      if (lineTaxTotal > 0) {
        const half = sameState ? lineTaxTotal / 2 : 0;
        const igst = sameState ? 0 : lineTaxTotal;
        tax = {
          type: "GST",
          sameState,
          cgst: half,
          sgst: half,
          igst,
          totalTax: lineTaxTotal,
          mode: "line"
        };
      } else {
        tax = computeIndiaGST({ taxRate, companyState, customerState, taxableAmount: subTotal });
      }
    } else if (lineTaxTotal > 0) {
      tax = { type: "Line Tax", totalTax: lineTaxTotal, mode: "manual" };
    } else {
      tax = computeVAT({ vatRate: taxRate, taxableAmount: subTotal });
    }

    const grandTotal = subTotal + (tax.totalTax || 0);

    return { enriched, subTotal, tax, grandTotal };
  }, [lines, items, isIndia, companyState, customerState, taxRate]);
  const isManualTax = computed.tax?.mode === "manual";

  const creditLimitEnabled =
    !!creditStatus.party?.creditLimitEnabled && creditStatus.creditLimit > 0;
  const projectedOutstanding = creditLimitEnabled
    ? creditStatus.outstanding + computed.grandTotal
    : creditStatus.outstanding;
  const creditWarning = creditLimitEnabled && projectedOutstanding > creditStatus.creditLimit;
  const creditOverBy = creditWarning ? projectedOutstanding - creditStatus.creditLimit : 0;
  const creditBlocked = creditWarning && !!creditStatus.party?.autoBlock;

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    if (!query) return items;
    const startsWith = items.filter((item) => item.name?.toLowerCase().startsWith(query));
    if (startsWith.length) return startsWith;
    return items.filter((item) => item.name?.toLowerCase().includes(query));
  }, [items, itemSearch]);

  function getItemOptions(currentId) {
    const selected = items.find((item) => item.id === currentId);
    if (!selected) return filteredItems;
    if (filteredItems.some((item) => item.id === currentId)) return filteredItems;
    return [selected, ...filteredItems];
  }

  function mockPrint() {
    alert("Print not connected yet.");
  }
  function mockEmail() {
    alert("Send not connected yet.");
  }

  function saveInvoice() {
    if (creditBlocked) {
      alert("Credit limit exceeded. Invoice creation is blocked for this party.");
      return;
    }
    const seller = {
      name: company?.companyName || "",
      address: formatAddress(company?.address),
      gstin: company?.tax?.gstin || "",
      phone: company?.phone || "",
      email: company?.email || "",
      state: company?.address?.state || ""
    };
    const buyer = {
      name: party?.name || "",
      address: party?.address || "",
      gstin: party?.gstin || "",
      phone: party?.phone || "",
      state: party?.state || ""
    };
    const payload = {
      invoiceDate,
      invoiceNo,
      partyId,
      partyName: party?.name || "",
      placeOfSupply: placeOfSupply || buyer.state,
      country,
      taxRate,
      companySnapshot: company,
      seller,
      buyer,
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
            <GradientButton onClick={saveInvoice} disabled={creditBlocked} className="disabled:cursor-not-allowed disabled:opacity-60">
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
              <p className="text-xs text-slate-500">Country: {country || "—"}</p>
            </div>
            {isIndia ? (
              <Badge tone="warning">GST</Badge>
            ) : country ? (
              <Badge tone="success">VAT</Badge>
            ) : (
              <Badge tone="neutral">TAX</Badge>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Invoice No">
              <input
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
                placeholder="INV-XXXX"
              />
            </FormField>

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

            {isIndia ? (
              <FormField label="Place of Supply (State)">
                <>
                  <input
                    list="india-states-invoice"
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder="Select or type state"
                  />
                  <datalist id="india-states-invoice">
                    {INDIA_STATES.map((state) => (
                      <option key={state} value={state} />
                    ))}
                  </datalist>
                </>
              </FormField>
            ) : null}

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

          {party && creditLimitEnabled ? (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                creditWarning ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              <p className="font-semibold">Credit Limit</p>
              <p className="text-xs">
                Limit: {formatMoney(creditStatus.creditLimit, currency)} | Outstanding:{" "}
                {formatMoney(projectedOutstanding, currency)}
              </p>
              {creditWarning ? (
                <p className="mt-1 text-xs">
                  Limit exceeded by {formatMoney(creditOverBy, currency)}.{" "}
                  {creditBlocked ? "Invoice creation is blocked." : "Invoice creation allowed."}
                </p>
              ) : (
                <p className="mt-1 text-xs">Within approved credit limit.</p>
              )}
            </div>
          ) : null}

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

          <div className="mt-3 flex items-center gap-3">
            <div className="relative w-full max-w-sm">
              <input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
                placeholder="Search items..."
              />
              {itemSearch.trim().length ? (
                <div className="absolute z-10 mt-2 w-full rounded-2xl border border-slate-100 bg-white shadow-soft p-2 max-h-52 overflow-auto">
                  {filteredItems.length ? (
                    filteredItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={() => {
                          addLineWithItem(item);
                          setItemSearch("");
                        }}
                        className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      >
                        {item.name}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-slate-500">No items found</div>
                  )}
                </div>
              ) : null}
            </div>
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
                        updateLine(r.id, {
                          itemId: e.target.value,
                          rate: it?.price || 0,
                          tax: it?.taxRate || 0
                        });
                      }}
                      className="rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-sm outline-none"
                    >
                      {getItemOptions(r.itemId).map((it) => (
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
            <p className="text-sm font-semibold text-slate-900">{party?.name || "XXX"}</p>
            <p className="text-xs text-slate-500">{party?.phone || "XX"}</p>
            <p className="text-xs text-slate-500">{party?.address || "XX"}</p>
            {party?.gstin ? <p className="text-xs text-slate-500">GSTIN: {party.gstin}</p> : null}
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
                    {isManualTax
                      ? ""
                      : computed.tax?.mode === "line"
                        ? " (Line items)"
                        : ` (${taxRate}%)`}
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
            <GradientButton className="w-full justify-center disabled:cursor-not-allowed disabled:opacity-60" onClick={saveInvoice} disabled={creditBlocked}>
              <Save className="h-4 w-4" />
              Save Invoice
            </GradientButton>
          </div>
        </Card>
      </div>
    </div>
  );
}
