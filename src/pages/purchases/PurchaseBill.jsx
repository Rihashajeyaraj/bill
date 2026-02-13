import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, Save, Share2, Trash2, Upload } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import { partiesByType } from "../../services/parties.service";
import { itemsList } from "../../services/items.service";
import { purchasesCreate } from "../../services/purchases.service";

const TAX_RATES = [0, 5, 12, 18, 28];
const PRICE_TAX_MODES = [
  { value: "WITHOUT_TAX", label: "Without Tax" },
  { value: "WITH_TAX", label: "With Tax" }
];
const DEFAULT_UNITS = ["pcs", "kg", "box", "ltr", "set", "hr"];
const BLOCKED_UNITS = ["job"];

function normalizeUnit(unit) {
  const value = String(unit || "").trim();
  if (!value) return "pcs";
  return BLOCKED_UNITS.includes(value.toLowerCase()) ? "pcs" : value;
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function generateBillNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rnd = String(Math.floor(100 + Math.random() * 900));
  return `PB-${yy}${mm}${dd}-${rnd}`;
}

function createLine(items) {
  const item = items[0];
  const purchaseRate = Number(item?.metadata?.purchasePrice || item?.price || 0);
  return {
    id: `line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    itemId: item?.id || "",
    itemName: item?.name || "",
    qty: 1,
    unit: normalizeUnit(item?.unit),
    rate: purchaseRate,
    priceTaxMode: "WITHOUT_TAX",
    tax: item?.taxRate || 0
  };
}

export default function PurchaseBill() {
  const suppliers = partiesByType("Supplier");
  const items = itemsList();
  const [partyId, setPartyId] = useState(suppliers[0]?.id || "");
  const party = useMemo(() => suppliers.find((x) => x.id === partyId) || null, [suppliers, partyId]);

  const [phone, setPhone] = useState(party?.phone || "");
  const [billNumber, setBillNumber] = useState("");
  const [autoBillNumber] = useState(() => generateBillNumber());
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState(() => [createLine(items)]);
  const [roundOffEnabled, setRoundOffEnabled] = useState(false);
  const [roundOffValue, setRoundOffValue] = useState("0");
  const [paymentType, setPaymentType] = useState("Cash");
  const [shareOpen, setShareOpen] = useState(false);
  const [billFileName, setBillFileName] = useState("");

  useEffect(() => {
    setPhone(party?.phone || "");
  }, [party?.phone]);

  const unitOptions = useMemo(() => {
    const itemUnits = items
      .map((item) => normalizeUnit(item.unit))
      .filter((unit) => unit && !BLOCKED_UNITS.includes(unit.toLowerCase()));
    return Array.from(new Set([...DEFAULT_UNITS, ...itemUnits]));
  }, [items]);

  function updateLine(id, patch) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const nextPatch = typeof patch === "function" ? patch(line) : patch;
        return { ...line, ...nextPatch };
      })
    );
  }

  function handleItemNameChange(id, value) {
    const match = items.find((item) => item.name?.toLowerCase() === value.toLowerCase());
    updateLine(id, (line) => {
      if (!match) return { ...line, itemName: value, itemId: "" };
      const purchaseRate = Number(match?.metadata?.purchasePrice || match?.price || 0);
      return {
        ...line,
        itemName: match.name,
        itemId: match.id,
        unit: normalizeUnit(match.unit || line.unit),
        rate: purchaseRate,
        tax: match.taxRate ?? line.tax
      };
    });
  }

  function addLine() {
    setLines((prev) => [...prev, createLine(items)]);
  }

  function removeLine(id) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  const computed = useMemo(() => {
    const detailed = lines.map((line) => {
      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const taxRate = Number(line.tax || 0);
      const base = qty * rate;
      if (line.priceTaxMode === "WITH_TAX") {
        const divisor = 1 + taxRate / 100;
        const subTotal = divisor > 0 ? base / divisor : base;
        const lineTax = base - subTotal;
        return { ...line, lineSubTotal: subTotal, lineTax, amount: base };
      }
      const lineTax = (base * taxRate) / 100;
      return { ...line, lineSubTotal: base, lineTax, amount: base + lineTax };
    });

    const totalQty = detailed.reduce((sum, line) => sum + Number(line.qty || 0), 0);
    const subTotal = detailed.reduce((sum, line) => sum + line.lineSubTotal, 0);
    const taxTotal = detailed.reduce((sum, line) => sum + line.lineTax, 0);
    const grandTotal = subTotal + taxTotal;
    const roundOff = roundOffEnabled ? Number(roundOffValue || 0) : 0;
    const finalTotal = grandTotal + roundOff;
    return { detailed, totalQty, subTotal, taxTotal, grandTotal, roundOff, finalTotal };
  }, [lines, roundOffEnabled, roundOffValue]);

  function save() {
    const effectiveBillNumber = billNumber || autoBillNumber;
    purchasesCreate({
      partyId,
      partyName: party?.name || "",
      phone,
      billNumber: effectiveBillNumber,
      billDate,
      paymentType,
      lines: computed.detailed,
      totals: {
        totalQty: computed.totalQty,
        subTotal: computed.subTotal,
        taxTotal: computed.taxTotal,
        roundOff: computed.roundOff,
        grandTotal: computed.finalTotal
      }
    });
    alert("Purchase Bill saved (localStorage).");
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Purchase" subtitle="Create a purchase invoice for suppliers" />

      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Party *">
              <select
                required
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
              >
                <option value="">Select supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Phone Number">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                placeholder="Enter phone number"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            <FormField label="Bill Number">
              <div className="flex items-center gap-2">
                <input
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder={autoBillNumber}
                />
                <button
                  type="button"
                  onClick={() => setBillNumber(autoBillNumber)}
                  className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  Auto
                </button>
              </div>
            </FormField>

            <FormField label="Bill Date">
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
              />
            </FormField>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Items</h2>
            <p className="text-xs text-slate-500">Add items, quantity, taxes, and prices.</p>
          </div>
          <button
            type="button"
            onClick={addLine}
            className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Row
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Item</th>
                <th className="px-3 py-3 font-semibold">Qty</th>
                <th className="px-3 py-3 font-semibold">Unit</th>
                <th className="px-3 py-3 font-semibold">Price/Unit</th>
                <th className="px-3 py-3 font-semibold">Tax %</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold text-right"></th>
              </tr>
            </thead>
            <tbody>
              {computed.detailed.map((line, index) => (
                <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-3">
                    <input
                      list="purchase-item-options"
                      value={line.itemName}
                      onChange={(e) => handleItemNameChange(line.id, e.target.value)}
                      className="w-48 rounded-xl border border-slate-100 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Search item"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      value={line.qty}
                      onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                      className="w-20 rounded-xl border border-slate-100 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={line.unit}
                      onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                      className="w-24 rounded-xl border border-slate-100 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {unitOptions.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-2">
                      <input
                        type="number"
                        min="0"
                        value={line.rate}
                        onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                        className="w-28 rounded-xl border border-slate-100 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      />
                      <select
                        value={line.priceTaxMode}
                        onChange={(e) => updateLine(line.id, { priceTaxMode: e.target.value })}
                        className="w-28 rounded-xl border border-slate-100 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        {PRICE_TAX_MODES.map((mode) => (
                          <option key={mode.value} value={mode.value}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={line.tax}
                      onChange={(e) => updateLine(line.id, { tax: e.target.value })}
                      className="w-24 rounded-xl border border-slate-100 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    >
                      {TAX_RATES.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-900">
                    {money(line.amount)}
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
              ))}
            </tbody>
          </table>
          <datalist id="purchase-item-options">
            {items.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Payment</h2>
          <p className="text-xs text-slate-500 mt-1">Choose payment mode for this bill.</p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Payment Type">
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value)}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
              >
                <option>Cash</option>
                <option>Bank Transfer</option>
                <option>Card</option>
                <option>UPI</option>
              </select>
            </FormField>
          </div>

          <button type="button" className="mt-2 text-sm font-semibold text-blue-600 flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add payment type
          </button>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">Summary</h2>
          <p className="text-xs text-slate-500 mt-1">Auto-calculated totals.</p>

          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Total Quantity</span>
              <span className="font-semibold text-slate-900">{money(computed.totalQty)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-semibold text-slate-900">{money(computed.subTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Tax Total</span>
              <span className="font-semibold text-slate-900">{money(computed.taxTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={roundOffEnabled}
                  onChange={(e) => setRoundOffEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Round Off
              </label>
              <input
                type="number"
                value={roundOffValue}
                onChange={(e) => setRoundOffValue(e.target.value)}
                disabled={!roundOffEnabled}
                className="w-24 rounded-xl border border-slate-100 px-2 py-1.5 text-sm outline-none disabled:bg-slate-50"
              />
            </div>
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-base">
              <span className="font-semibold text-slate-900">Final Total</span>
              <span className="font-semibold text-slate-900">{money(computed.finalTotal)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              onChange={(e) => setBillFileName(e.target.files?.[0]?.name || "")}
            />
            <span className="inline-flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Upload className="h-4 w-4" />
              Upload Bill
            </span>
          </label>
          {billFileName ? <span className="text-xs text-slate-500">{billFileName}</span> : null}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShareOpen((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Share2 className="h-4 w-4" />
              Share
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            {shareOpen ? (
              <div className="absolute right-0 mt-2 w-40 rounded-2xl border border-slate-100 bg-white shadow-soft p-2 text-sm">
                {["Email", "WhatsApp", "Copy Link"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setShareOpen(false)}
                    className="w-full rounded-xl px-2 py-2 text-left text-slate-600 hover:bg-slate-50"
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
