import React, { useEffect, useMemo, useState } from "react";
import { Download, Plus, Printer, Save, Trash2 } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import CreditNotePreview from "../../components/CreditNotePreview";
import { COUNTRIES } from "../../services/company.service";
import { useOrganization } from "../../context/OrganizationContext";
import { invoicesList } from "../../services/invoices.service";
import { itemsList } from "../../services/items.service";
import { partiesByType } from "../../services/parties.service";
import { creditNotesCreate } from "../../services/creditNotes.service";
import { UI } from "../../theme/tokens";
import { getInvoiceTemplateConfig } from "../../lib/templateStore";

const GST_RATES = [0, 5, 12, 18, 28];
const VAT_RATES = {
  "Sri Lanka": [18],
  "United Kingdom": [20, 5, 0],
  Ireland: [23, 13.5, 9, 0]
};
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
const REASONS = ["Sales Return", "Price Adjustment", "Discount", "Damaged Goods", "Other"];
const CURRENCY_BY_COUNTRY = {
  India: "INR",
  "Sri Lanka": "LKR",
  "United Kingdom": "GBP",
  Ireland: "EUR"
};

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function generateCreditNoteNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rnd = String(Math.floor(100 + Math.random() * 900));
  return `CRN-${yy}${mm}${dd}-${rnd}`;
}

function formatAddress(address) {
  if (!address) return "";
  const parts = [address.line1, address.line2, address.city, address.state, address.postalCode]
    .map((part) => (part ? String(part).trim() : ""))
    .filter(Boolean);
  return parts.join(", ");
}

function mapInvoiceLines(invoice, items) {
  const source = Array.isArray(invoice?.lines) ? invoice.lines : [];
  return source.map((line) => {
    const item = items.find((it) => it.id === line.itemId);
    return {
      id: `cr_${line.id || Math.random().toString(16).slice(2)}`,
      itemId: line.itemId || "",
      name: line.itemName || line.name || item?.name || "",
      hsn: line.hsn || line.sac || item?.hsn || item?.sac || "",
      qty: Number(line.qty || 0),
      rate: Number(line.rate || 0),
      taxRate: Number(line.tax ?? line.taxRate ?? item?.taxRate ?? 0),
      taxableOverride: line.net ?? line.taxableValue ?? null
    };
  });
}

export default function CreditNote() {
  const { profile: company = {}, country: organizationCountry = "India", currency: organizationCurrency = "" } = useOrganization();
  const invoices = invoicesList();
  const items = itemsList();
  const customers = partiesByType("Customer");
  const templateConfig = getInvoiceTemplateConfig();

  const [country, setCountry] = useState(organizationCountry || "India");
  const [creditNoteNo] = useState(() => generateCreditNoteNumber());
  const [creditDate, setCreditDate] = useState(new Date().toISOString().slice(0, 10));
  const [pdfLoading, setPdfLoading] = useState(false);
  const [referenceInvoiceId, setReferenceInvoiceId] = useState(invoices[0]?.id || "");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [reasonNote, setReasonNote] = useState("");
  const [returnToStock, setReturnToStock] = useState(false);
  const [markGstr1, setMarkGstr1] = useState(true);
  const [markGstr3b, setMarkGstr3b] = useState(true);
  const [lines, setLines] = useState([]);

  const referenceInvoice = useMemo(
    () => invoices.find((inv) => inv.id === referenceInvoiceId) || null,
    [invoices, referenceInvoiceId]
  );

  useEffect(() => {
    if (!referenceInvoice) {
      setLines([]);
      return;
    }
    setCountry(referenceInvoice.country || organizationCountry || "India");
    setLines(mapInvoiceLines(referenceInvoice, items));
    setPlaceOfSupply(referenceInvoice.placeOfSupply || referenceInvoice?.buyer?.state || "");
  }, [referenceInvoice, items, organizationCountry]);

  const seller = useMemo(
    () => ({
      name: company?.companyName || "",
      address: formatAddress(company?.address),
      gstin: company?.tax?.gstin || "",
      vatNumber: company?.tax?.vatNumber || "",
      phone: company?.phone || "",
      email: company?.email || "",
      state: company?.address?.state || ""
    }),
    [company]
  );

  const buyer = useMemo(() => {
    if (referenceInvoice?.buyer) return referenceInvoice.buyer;
    const party = customers.find((c) => c.id === referenceInvoice?.partyId);
    return {
      name: party?.name || referenceInvoice?.partyName || "",
      address: party?.address || "",
      gstin: party?.gstin || "",
      phone: party?.phone || "",
      state: party?.state || ""
    };
  }, [referenceInvoice, customers]);

  const isIndia = country === "India";
  const vatRateOptions = VAT_RATES[country] || [];

  function updateLine(id, patch) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    const item = items[0];
    setLines((prev) => [
      ...prev,
      {
        id: `cr_${Date.now()}`,
        itemId: item?.id || "",
        name: item?.name || "",
        hsn: item?.hsn || item?.sac || "",
        qty: 1,
        rate: item?.price || 0,
        taxRate: item?.taxRate || (vatRateOptions[0] ?? 0),
        taxableOverride: null
      }
    ]);
  }

  function removeLine(id) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  const computed = useMemo(() => {
    const detailed = lines.map((line) => {
      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const taxRate = Number(line.taxRate || 0);
      const taxableValue =
        line.taxableOverride === null || line.taxableOverride === undefined || line.taxableOverride === ""
          ? qty * rate
          : Number(line.taxableOverride || 0);
      const taxAmount = (taxableValue * taxRate) / 100;
      const total = taxableValue + taxAmount;
      return { ...line, qty, rate, taxRate, taxableValue, taxAmount, total };
    });

    const taxableTotal = detailed.reduce((sum, line) => sum + line.taxableValue, 0);
    const taxTotal = detailed.reduce((sum, line) => sum + line.taxAmount, 0);
    const grandTotal = taxableTotal + taxTotal;
    const sellerState = (seller.state || "").trim().toLowerCase();
    const buyerState = (placeOfSupply || buyer.state || "").trim().toLowerCase();
    const sameState = sellerState && buyerState ? sellerState === buyerState : false;
    const cgst = isIndia && sameState ? taxTotal / 2 : 0;
    const sgst = isIndia && sameState ? taxTotal / 2 : 0;
    const igst = isIndia && !sameState ? taxTotal : 0;
    const uniqueVat = Array.from(new Set(detailed.map((line) => line.taxRate).filter((rate) => rate > 0)));
    const taxLabel =
      uniqueVat.length === 1 ? `VAT ${uniqueVat[0]}%` : uniqueVat.length ? "VAT (mixed rates)" : "VAT";
    return { detailed, taxableTotal, taxTotal, grandTotal, sameState, cgst, sgst, igst, taxLabel };
  }, [lines, seller.state, buyer.state, placeOfSupply, isIndia]);

  const canSave = referenceInvoiceId && computed.detailed.length;
  const currency = organizationCurrency || CURRENCY_BY_COUNTRY[country] || "";

  function saveNote() {
    if (!canSave) return;
    creditNotesCreate({
      country,
      partyId: referenceInvoice?.partyId || "",
      creditNoteNo,
      creditDate,
      referenceInvoiceId,
      referenceInvoiceNo: referenceInvoice?.invoiceNo || referenceInvoice?.id || "",
      referenceInvoiceDate: referenceInvoice?.invoiceDate || "",
      placeOfSupply,
      reason,
      reasonNote,
      seller,
      buyer,
      returnToStock,
      gstReturns: isIndia ? { gstr1: markGstr1, gstr3b: markGstr3b } : null,
      lines: computed.detailed,
      totals: {
        taxableTotal: computed.taxableTotal,
        taxTotal: computed.taxTotal,
        grandTotal: computed.grandTotal
      },
      tax: {
        type: isIndia ? "GST" : "VAT",
        sameState: computed.sameState,
        cgst: computed.cgst,
        sgst: computed.sgst,
        igst: computed.igst
      }
    });
    alert("Credit Note saved (localStorage).");
  }

  function handlePrint() {
    window.print();
  }

  async function handlePdf() {
    const target = document.querySelector(".credit-note-preview");
    if (!target) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = margin;

      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
      while (heightLeft > 0) {
        pdf.addPage();
        position = margin - (imgHeight - heightLeft);
        pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
        heightLeft -= pageHeight - margin * 2;
      }

      pdf.save(`CreditNote_${creditNoteNo}.pdf`);
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="print-hide">
        <PageHeader
          title="Sales - Credit Note"
          subtitle="Create credit notes linked to invoices with GST/VAT adjustments"
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
              >
                <Printer className="h-4 w-4" />
                Print
              </button>
            <button
              onClick={handlePdf}
              disabled={pdfLoading}
              className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {pdfLoading ? "Generating..." : "PDF"}
            </button>
              <GradientButton onClick={saveNote} disabled={!canSave}>
                <Save className="h-4 w-4" />
                Save
              </GradientButton>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2 space-y-4 print-hide">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Country">
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                disabled={!!referenceInvoice}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Original Invoice">
              <select
                value={referenceInvoiceId}
                onChange={(e) => setReferenceInvoiceId(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
              >
                <option value="">Select invoice</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNo ? `${inv.invoiceNo} - ${inv.partyName || inv.buyer?.name || "Customer"}` : inv.id}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Credit Note No">
              <input
                value={creditNoteNo}
                readOnly
                className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="Credit Note Date">
              <input
                type="date"
                value={creditDate}
                onChange={(e) => setCreditDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
              />
            </FormField>

            {isIndia ? (
              <FormField label="Place of Supply (State)">
                <>
                  <input
                    list="credit-note-india-states"
                    value={placeOfSupply}
                    onChange={(e) => setPlaceOfSupply(e.target.value)}
                    className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
                    style={{ "--tw-ring-color": UI.COLORS.ring }}
                    placeholder="Select or type state"
                  />
                  <datalist id="credit-note-india-states">
                    {INDIA_STATES.map((state) => (
                      <option key={state} value={state} />
                    ))}
                  </datalist>
                </>
              </FormField>
            ) : null}

            <FormField label="Reason">
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4"
                style={{ "--tw-ring-color": UI.COLORS.ring }}
              >
                {REASONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Reason Details">
            <textarea
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4"
              style={{ "--tw-ring-color": UI.COLORS.ring }}
              rows={2}
              placeholder="Add short explanation"
            />
          </FormField>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={returnToStock}
                onChange={(e) => setReturnToStock(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Return to stock
            </label>
            {isIndia ? (
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={markGstr1}
                    onChange={(e) => setMarkGstr1(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Mark for GSTR-1
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={markGstr3b}
                    onChange={(e) => setMarkGstr3b(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Mark for GSTR-3B
                </label>
              </div>
            ) : null}
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Credit Items</p>
              <button
                type="button"
                onClick={addLine}
                className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add line
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[960px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Item</th>
                    <th className="px-3 py-3 font-semibold">Qty</th>
                    <th className="px-3 py-3 font-semibold">Rate</th>
                    <th className="px-3 py-3 font-semibold">Taxable</th>
                    <th className="px-3 py-3 font-semibold">Tax %</th>
                    <th className="px-3 py-3 font-semibold text-right">Tax</th>
                    <th className="px-3 py-3 font-semibold text-right">Total</th>
                    <th className="px-3 py-3 font-semibold text-right" />
                  </tr>
                </thead>
                <tbody>
                  {computed.detailed.length ? (
                    computed.detailed.map((line) => (
                      <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-3">
                          <select
                            value={line.itemId}
                            onChange={(e) => {
                              const item = items.find((it) => it.id === e.target.value);
                              updateLine(line.id, {
                                itemId: e.target.value,
                                name: item?.name || "",
                                hsn: item?.hsn || item?.sac || "",
                                rate: item?.price || 0,
                                taxRate: item?.taxRate || line.taxRate
                              });
                            }}
                            className="rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-sm outline-none"
                          >
                            <option value="">Select item</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3">
                          <input
                            value={line.qty}
                            onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                            className="w-20 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            value={line.rate}
                            onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                            className="w-24 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            value={
                              line.taxableOverride === null || line.taxableOverride === undefined
                                ? line.qty * line.rate
                                : line.taxableOverride
                            }
                            onChange={(e) => {
                              const value = e.target.value;
                              updateLine(line.id, { taxableOverride: value === "" ? null : value });
                            }}
                            className="w-28 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          {isIndia ? (
                            <select
                              value={line.taxRate}
                              onChange={(e) => updateLine(line.id, { taxRate: e.target.value })}
                              className="w-20 rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-sm outline-none"
                            >
                              {GST_RATES.map((rate) => (
                                <option key={rate} value={rate}>
                                  {rate}%
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              list="vat-rate-options"
                              value={line.taxRate}
                              onChange={(e) => updateLine(line.id, { taxRate: e.target.value })}
                              className="w-20 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none"
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-700">
                          {money(line.taxAmount)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">
                          {money(line.total)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="h-8 w-8 rounded-full border border-slate-100 bg-white hover:bg-rose-50 flex items-center justify-center"
                            title="Delete row"
                          >
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-6 text-slate-500" colSpan={8}>
                        Select an invoice to load items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {!isIndia ? (
                <datalist id="vat-rate-options">
                  {vatRateOptions.map((rate) => (
                    <option key={`vat_${rate}`} value={rate} />
                  ))}
                </datalist>
              ) : null}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-100 p-4 bg-slate-50/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Taxable Amount</span>
              <span className="font-semibold text-slate-900">{money(computed.taxableTotal)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-600">{isIndia ? "Total GST" : computed.taxLabel}</span>
              <span className="font-semibold text-slate-900">{money(computed.taxTotal)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-base">
              <span className="font-semibold text-slate-900">Credit Note Total</span>
              <span className="font-semibold text-slate-900">{money(computed.grandTotal)}</span>
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-1 print-sheet">
          <div className="print-hide">
            <p className="text-sm font-semibold text-slate-900">Credit Note Preview</p>
            <p className="text-xs text-slate-500 mt-1">Print/PDF ready document</p>
          </div>

          <div className="mt-4">
            <CreditNotePreview
              templateId={templateConfig.templateId}
              styleConfig={{
                primaryColor: templateConfig.primaryColor,
                bgColor: templateConfig.bgColor,
                fontFamily: templateConfig.fontFamily,
                logoUrl: templateConfig.logoUrl,
                logoPosition: templateConfig.logoPosition
              }}
              noteData={{
                title: "Credit Note",
                country,
                currency,
                creditNoteNo,
                creditDate,
                referenceInvoiceNo: referenceInvoice?.invoiceNo || referenceInvoice?.id || "",
                referenceInvoiceDate: referenceInvoice?.invoiceDate || "",
                placeOfSupply,
                reason,
                reasonNote,
                seller,
                buyer,
                lines: computed.detailed,
                totals: {
                  taxableTotal: computed.taxableTotal,
                  taxTotal: computed.taxTotal,
                  grandTotal: computed.grandTotal
                },
                tax: {
                  sameState: computed.sameState,
                  cgst: computed.cgst,
                  sgst: computed.sgst,
                  igst: computed.igst
                },
                taxLabel: computed.taxLabel,
                taxSystem: isIndia ? "GST" : "VAT"
              }}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
