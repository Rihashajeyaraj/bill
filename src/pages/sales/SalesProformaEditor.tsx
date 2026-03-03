import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../context/ToastContext";
import { listParties, syncPartiesFromRemote } from "../../modules/parties/store";
import { listItems, syncItemsFromRemote } from "../../modules/items/store";
import {
  convertSalesProforma,
  getSalesProformaStatusOptions,
  salesProformaComputeTotals,
  salesProformaGetByIdRemote,
  salesProformaPeekNumber,
  salesProformaUpsert
} from "../../services/proformas.service";

function parseNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function lineAmount(line: any) {
  const qty = parseNumber(line?.qty);
  const rate = parseNumber(line?.rate);
  const discount = parseNumber(line?.discountAmount);
  const taxable = Math.max(0, qty * rate - discount);
  const tax = (taxable * parseNumber(line?.taxRate)) / 100;
  return Math.max(0, taxable + tax);
}

function createEmptyLine() {
  return {
    id: `spf_line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    itemId: "",
    description: "",
    qty: 1,
    unit: "pcs",
    rate: 0,
    discountAmount: 0,
    discountPercent: 0,
    taxRate: 0
  };
}

const SALES_STATUS_OPTIONS = getSalesProformaStatusOptions();

export default function SalesProformaEditor() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = String(id || "") === "new";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    id: "",
    proformaNo: "",
    proformaDate: new Date().toISOString().slice(0, 10),
    validTill: "",
    dueDate: "",
    partyId: "",
    partyName: "",
    placeOfSupply: "",
    country: "",
    taxMode: "",
    supplyType: "",
    status: "DRAFT",
    notes: "",
    terms: "",
    lines: [createEmptyLine()]
  });

  const selectedParty = useMemo(
    () => customers.find((entry) => String(entry?.id || "") === String(form.partyId || "")) || null,
    [customers, form.partyId]
  );
  const locked = String(form?.status || "").toUpperCase() === "CONVERTED";
  const totals = useMemo(
    () => salesProformaComputeTotals(form.lines || [], 0),
    [form.lines]
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        await Promise.all([syncPartiesFromRemote(), syncItemsFromRemote()]);
        if (!mounted) return;
        const partyRows = listParties().filter((entry) => {
          const partyType = String(entry?.type || "").toLowerCase();
          return partyType === "customer" || partyType === "both";
        });
        const itemRows = listItems().filter((entry) => entry?.status !== "Inactive");
        setCustomers(partyRows);
        setItems(itemRows);

        if (isNew) {
          const nextNo = await salesProformaPeekNumber(new Date().toISOString().slice(0, 10));
          if (!mounted) return;
          setForm((prev: any) => ({
            ...prev,
            proformaNo: nextNo || prev.proformaNo
          }));
        } else {
          const found = await salesProformaGetByIdRemote(id);
          if (!mounted) return;
          if (!found) {
            toast.warning("Not found", "Sales proforma does not exist.");
            navigate("/app/sales/proformas", { replace: true });
            return;
          }
          setForm({
            id: found.id || "",
            proformaNo: found.proformaNo || "",
            proformaDate: found.proformaDate || new Date().toISOString().slice(0, 10),
            validTill: found.validTill || "",
            dueDate: found.dueDate || "",
            partyId: found.partyId || "",
            partyName: found.partyName || "",
            placeOfSupply: found.placeOfSupply || "",
            country: found.country || "",
            taxMode: found.taxMode || "",
            supplyType: found.supplyType || "",
            status: found.status || "DRAFT",
            notes: found.notes || "",
            terms: found.terms || "",
            lines:
              Array.isArray(found.lines) && found.lines.length
                ? found.lines.map((line: any) => ({
                    id: line?.id || createEmptyLine().id,
                    itemId: line?.itemId || "",
                    description: line?.description || "",
                    qty: parseNumber(line?.qty) || 1,
                    unit: line?.unit || "pcs",
                    rate: parseNumber(line?.rate),
                    discountAmount: parseNumber(line?.discountAmount),
                    discountPercent: parseNumber(line?.discountPercent),
                    taxRate: parseNumber(line?.taxRate)
                  }))
                : [createEmptyLine()]
          });
        }
      } catch (error: any) {
        if (!mounted) return;
        toast.error("Failed to load sales proforma", error?.message || "Please retry.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [id, isNew, navigate, toast]);

  function updateForm(patch: any) {
    setForm((prev: any) => ({ ...prev, ...patch }));
  }

  function updateLine(lineId: string, patch: any) {
    setForm((prev: any) => ({
      ...prev,
      lines: (prev.lines || []).map((line: any) => (line.id === lineId ? { ...line, ...patch } : line))
    }));
  }

  function removeLine(lineId: string) {
    setForm((prev: any) => {
      const nextLines = (prev.lines || []).filter((line: any) => line.id !== lineId);
      return {
        ...prev,
        lines: nextLines.length ? nextLines : [createEmptyLine()]
      };
    });
  }

  function addLine() {
    setForm((prev: any) => ({ ...prev, lines: [...(prev.lines || []), createEmptyLine()] }));
  }

  async function onSave() {
    if (locked) return;
    if (!form.partyId) {
      toast.warning("Customer required", "Select a customer before saving.");
      return;
    }
    setSaving(true);
    try {
      const cleanedLines = (form.lines || [])
        .map((line: any, index: number) => ({
          ...line,
          qty: parseNumber(line?.qty),
          rate: parseNumber(line?.rate),
          discountAmount: parseNumber(line?.discountAmount),
          discountPercent: parseNumber(line?.discountPercent),
          taxRate: parseNumber(line?.taxRate),
          lineNo: index + 1
        }))
        .filter((line: any) => line.qty > 0 && (line.itemId || line.description));
      if (!cleanedLines.length) {
        toast.warning("Line items required", "Add at least one line item before saving.");
        return;
      }

      const result = await salesProformaUpsert({
        ...form,
        partyName: selectedParty?.name || selectedParty?.displayName || form.partyName || "",
        lines: cleanedLines,
        totals
      });
      toast.success("Sales proforma saved", result?.proformaNo || "Saved successfully.");
      if (isNew && result?.id) {
        navigate(`/app/sales/proformas/${encodeURIComponent(result.id)}`, { replace: true });
      } else {
        const refreshed = await salesProformaGetByIdRemote(result?.id || form.id);
        if (refreshed) {
          updateForm({
            id: refreshed.id || form.id,
            proformaNo: refreshed.proformaNo || form.proformaNo,
            status: refreshed.status || form.status
          });
        }
      }
    } catch (error: any) {
      toast.error("Save failed", error?.message || "Could not save sales proforma.");
    } finally {
      setSaving(false);
    }
  }

  async function onConvert() {
    const status = String(form?.status || "").toUpperCase();
    if (isNew || !form.id) return;
    if (status === "CONVERTED") {
      toast.warning("Already converted", "This proforma has already been converted.");
      return;
    }
    if (status === "EXPIRED") {
      toast.warning("Expired proforma", "Expired proformas cannot be converted.");
      return;
    }
    setConverting(true);
    try {
      const result = await convertSalesProforma(form.id);
      toast.success(
        "Converted to invoice",
        result?.invoiceNo ? `Created invoice ${result.invoiceNo}.` : "Invoice created successfully."
      );
      navigate(
        `/app/sales/invoice/history${result?.invoiceId ? `?invoiceId=${encodeURIComponent(result.invoiceId)}` : ""}`
      );
    } catch (error: any) {
      toast.error("Conversion failed", error?.message || "Could not convert sales proforma.");
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Sales Proforma"
        subtitle="PROFORMA INVOICE (Not a Tax Invoice)"
        right={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate("/app/sales/proformas")}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            {!isNew ? (
              <button
                type="button"
                onClick={() => void onConvert()}
                disabled={converting || locked || String(form?.status || "").toUpperCase() === "EXPIRED"}
                className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {converting ? "Converting..." : "Convert to Invoice"}
              </button>
            ) : null}
            <GradientButton
              onClick={() => void onSave()}
              disabled={saving || loading || locked}
              className="disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Proforma"}
            </GradientButton>
          </div>
        }
      />

      {locked ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          This proforma is converted and is read-only.
        </div>
      ) : null}

      <Card className="p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading proforma details...</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm text-slate-600">
                Proforma No
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.proformaNo || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ proformaNo: event.target.value })}
                />
              </label>
              <label className="text-sm text-slate-600">
                Proforma Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.proformaDate || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ proformaDate: event.target.value })}
                />
              </label>
              <label className="text-sm text-slate-600">
                Valid Till
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.validTill || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ validTill: event.target.value })}
                />
              </label>
              <label className="text-sm text-slate-600">
                Customer
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.partyId || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ partyId: event.target.value })}
                >
                  <option value="">Select customer</option>
                  {customers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name || entry.displayName || entry.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-600">
                Status
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.status || "DRAFT"}
                  disabled={locked}
                  onChange={(event) => updateForm({ status: event.target.value })}
                >
                  {SALES_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-600">
                Place of Supply
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.placeOfSupply || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ placeOfSupply: event.target.value })}
                />
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Line Items</p>
                <button
                  type="button"
                  onClick={addLine}
                  disabled={locked}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Line
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="min-w-[980px] w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-2 font-semibold">Item</th>
                      <th className="px-2 py-2 font-semibold">Description</th>
                      <th className="px-2 py-2 font-semibold text-right">Qty</th>
                      <th className="px-2 py-2 font-semibold text-right">Rate</th>
                      <th className="px-2 py-2 font-semibold text-right">Tax %</th>
                      <th className="px-2 py-2 font-semibold text-right">Amount</th>
                      <th className="px-2 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.lines || []).map((line: any) => (
                      <tr key={line.id} className="border-t border-slate-100">
                        <td className="px-2 py-2">
                          <select
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                            value={line.itemId || ""}
                            disabled={locked}
                            onChange={(event) => {
                              const itemId = event.target.value;
                              const item = items.find((entry) => String(entry?.id || "") === String(itemId));
                              updateLine(line.id, {
                                itemId,
                                description: item?.name || line.description || "",
                                unit: item?.unit || line.unit || "pcs",
                                rate: parseNumber(item?.salePrice ?? item?.sale_price ?? line.rate),
                                taxRate: parseNumber(item?.taxRate ?? item?.tax_rate ?? line.taxRate)
                              });
                            }}
                          >
                            <option value="">Select item</option>
                            {items.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name || entry.id}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                            value={line.description || ""}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { description: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.001"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.qty}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { qty: parseNumber(event.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.rate}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { rate: parseNumber(event.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm"
                            value={line.taxRate}
                            disabled={locked}
                            onChange={(event) => updateLine(line.id, { taxRate: parseNumber(event.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-semibold text-slate-900">
                          {lineAmount(line).toFixed(2)}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            disabled={locked}
                            className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Sub Total</p>
                <p className="font-semibold text-slate-900">{totals.subTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Tax Total</p>
                <p className="font-semibold text-slate-900">{totals.taxTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Grand Total</p>
                <p className="font-semibold text-slate-900">{totals.grandTotal.toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-500">Status</p>
                <p className="font-semibold text-slate-900">{String(form.status || "DRAFT").toUpperCase()}</p>
              </div>
            </div>

            <label className="block text-sm text-slate-600">
              Notes
              <textarea
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                rows={3}
                value={form.notes || ""}
                disabled={locked}
                onChange={(event) => updateForm({ notes: event.target.value })}
              />
            </label>
          </div>
        )}
      </Card>
    </div>
  );
}
