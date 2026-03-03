import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X } from "lucide-react";
import Card from "../../components/Card";
import GradientButton from "../../components/GradientButton";
import PageHeader from "../../components/PageHeader";
import { useToast } from "../../context/ToastContext";
import { listParties, syncPartiesFromRemote } from "../../modules/parties/store";
import { listItems, syncItemsFromRemote } from "../../modules/items/store";
import {
  convertPurchaseProforma,
  getPurchaseProformaStatusOptions,
  purchaseProformaComputeTotals,
  purchaseProformaGetByIdRemote,
  purchaseProformaPeekNumber,
  purchaseProformaUpsert
} from "../../services/proformas.service";

function parseNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function lineAmount(line: any) {
  const qty = parseNumber(line?.qty);
  const rate = parseNumber(line?.rate);
  const taxable = Math.max(0, qty * rate);
  const tax = (taxable * parseNumber(line?.taxRate)) / 100;
  return Math.max(0, taxable + tax);
}

function normalizeItemName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getItemSearchIdentifier(item: any) {
  const itemCode = String(item?.itemCode || "").trim();
  if (itemCode) return itemCode;
  return String(item?.id || "").trim();
}

function formatItemSearchLabel(item: any) {
  const identifier = getItemSearchIdentifier(item);
  const name = String(item?.name || "").trim();
  if (identifier && name) return `${identifier} | ${name}`;
  return name || identifier;
}

function findItemBySearchInput(items: any[], value: unknown) {
  const normalizedValue = normalizeItemName(value);
  if (!normalizedValue) return null;
  return (
    items.find((item) => {
      const name = normalizeItemName(item?.name);
      const itemCode = normalizeItemName(item?.itemCode);
      const id = normalizeItemName(item?.id);
      const label = normalizeItemName(formatItemSearchLabel(item));
      return (
        normalizedValue === name ||
        normalizedValue === itemCode ||
        normalizedValue === id ||
        normalizedValue === label
      );
    }) || null
  );
}

function itemMatchesSearchQuery(item: any, query: unknown) {
  const normalizedQuery = normalizeItemName(query);
  if (!normalizedQuery) return true;
  const name = normalizeItemName(item?.name);
  const itemCode = normalizeItemName(item?.itemCode);
  const id = normalizeItemName(item?.id);
  const label = normalizeItemName(formatItemSearchLabel(item));
  return (
    name.includes(normalizedQuery) ||
    itemCode.includes(normalizedQuery) ||
    id.includes(normalizedQuery) ||
    label.includes(normalizedQuery)
  );
}

function createEmptyLine() {
  return {
    id: `ppf_line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    itemId: "",
    itemCode: "",
    itemInput: "",
    description: "",
    qty: 1,
    rate: 0,
    taxRate: 0
  };
}

const PURCHASE_STATUS_OPTIONS = getPurchaseProformaStatusOptions();

export default function PurchaseProformaEditor() {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = String(id || "") === "new";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [activeLineItemSearchId, setActiveLineItemSearchId] = useState("");
  const [form, setForm] = useState<any>({
    id: "",
    proformaNo: "",
    proformaDate: new Date().toISOString().slice(0, 10),
    validTill: "",
    dueDate: "",
    supplierId: "",
    partyName: "",
    partyAddress: "",
    phone: "",
    country: "",
    paymentType: "Unpaid",
    taxMode: "",
    supplyType: "",
    status: "DRAFT",
    lines: [createEmptyLine()]
  });

  const selectedSupplier = useMemo(
    () => suppliers.find((entry) => String(entry?.id || "") === String(form.supplierId || "")) || null,
    [suppliers, form.supplierId]
  );
  const locked = String(form?.status || "").toUpperCase() === "CONVERTED";
  const totals = useMemo(() => purchaseProformaComputeTotals(form.lines || []), [form.lines]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        await Promise.all([syncPartiesFromRemote(), syncItemsFromRemote()]);
        if (!mounted) return;
        const partyRows = listParties().filter((entry) => {
          const partyType = String(entry?.type || "").toLowerCase();
          return partyType === "supplier" || partyType === "both";
        });
        const itemRows = listItems().filter((entry) => entry?.status !== "Inactive");
        setSuppliers(partyRows);
        setItems(itemRows);

        if (isNew) {
          const nextNo = await purchaseProformaPeekNumber(new Date().toISOString().slice(0, 10));
          if (!mounted) return;
          setForm((prev: any) => ({
            ...prev,
            proformaNo: nextNo || prev.proformaNo
          }));
        } else {
          const found = await purchaseProformaGetByIdRemote(id);
          if (!mounted) return;
          if (!found) {
            toast.warning("Not found", "Purchase proforma does not exist.");
            navigate("/app/purchase/proformas", { replace: true });
            return;
          }
          setForm({
            id: found.id || "",
            proformaNo: found.proformaNo || "",
            proformaDate: found.proformaDate || new Date().toISOString().slice(0, 10),
            validTill: found.validTill || "",
            dueDate: found.dueDate || "",
            supplierId: found.supplierId || "",
            partyName: found.partyName || "",
            partyAddress: found.partyAddress || "",
            phone: found.phone || "",
            country: found.country || "",
            paymentType: found.paymentType || "Unpaid",
            taxMode: found.taxMode || "",
            supplyType: found.supplyType || "",
            status: found.status || "DRAFT",
            lines:
              Array.isArray(found.lines) && found.lines.length
                ? found.lines.map((line: any) => ({
                    id: line?.id || createEmptyLine().id,
                    itemId: line?.itemId || "",
                    itemCode: line?.itemCode || "",
                    itemInput: line?.itemName || line?.description || "",
                    description: line?.description || "",
                    qty: parseNumber(line?.qty) || 1,
                    rate: parseNumber(line?.rate),
                    taxRate: parseNumber(line?.taxRate)
                  }))
                : [createEmptyLine()]
          });
        }
      } catch (error: any) {
        if (!mounted) return;
        toast.error("Failed to load purchase proforma", error?.message || "Please retry.");
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
      lines: (prev.lines || []).map((line: any) => {
        if (line.id !== lineId) return line;
        const nextPatch = typeof patch === "function" ? patch(line) : patch;
        return { ...line, ...nextPatch };
      })
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

  function selectLineItem(line: any, item: any) {
    if (!line || !item) return;
    updateLine(line.id, {
      itemId: item?.id || "",
      itemCode: item?.itemCode || "",
      itemInput: item?.name || "",
      description: item?.name || "",
      rate: parseNumber(item?.purchaseRate ?? item?.metadata?.purchasePrice ?? item?.purchase_price ?? line?.rate),
      taxRate: parseNumber(item?.taxRate ?? item?.metadata?.taxRate ?? item?.tax_rate ?? line?.taxRate)
    });
  }

  function handleItemInput(lineId: string, inputValue: string) {
    const match = findItemBySearchInput(items, inputValue);
    updateLine(lineId, (line: any) => {
      if (!match) {
        return {
          ...line,
          itemInput: inputValue,
          itemId: "",
          itemCode: "",
          description: String(inputValue || "").trim()
        };
      }
      return {
        ...line,
        itemInput: match?.name || inputValue,
        itemId: match?.id || "",
        itemCode: match?.itemCode || "",
        description: match?.name || "",
        rate: parseNumber(match?.purchaseRate ?? match?.metadata?.purchasePrice ?? match?.purchase_price ?? line?.rate),
        taxRate: parseNumber(match?.taxRate ?? match?.metadata?.taxRate ?? match?.tax_rate ?? line?.taxRate)
      };
    });
  }

  function clearLineItemSelection(lineId: string) {
    updateLine(lineId, {
      itemId: "",
      itemCode: "",
      itemInput: "",
      description: ""
    });
  }

  function getLineItemSearchResults(line: any) {
    const query = normalizeItemName(line?.itemInput);
    if (!query) return [];
    return (items || []).filter((item) => itemMatchesSearchQuery(item, query)).slice(0, 8);
  }

  const activeLineForSearch = useMemo(
    () => (form.lines || []).find((line: any) => String(line?.id || "") === String(activeLineItemSearchId || "")) || null,
    [form.lines, activeLineItemSearchId]
  );
  const activeLineSearchResults = useMemo(() => {
    if (!activeLineForSearch) return [];
    return getLineItemSearchResults(activeLineForSearch);
  }, [activeLineForSearch, items]);

  async function onSave() {
    if (locked) return;
    if (!form.supplierId) {
      toast.warning("Supplier required", "Select a supplier before saving.");
      return;
    }
    setSaving(true);
    try {
      const cleanedLines = (form.lines || [])
        .map((line: any, index: number) => ({
          ...line,
          description: String(line?.itemInput || line?.description || "").trim(),
          qty: parseNumber(line?.qty),
          rate: parseNumber(line?.rate),
          taxRate: parseNumber(line?.taxRate),
          taxInclusive: false,
          lineNo: index + 1
        }))
        .filter((line: any) => line.qty > 0 && (line.itemId || line.itemInput || line.description));
      if (!cleanedLines.length) {
        toast.warning("Line items required", "Add at least one line item before saving.");
        return;
      }

      const result = await purchaseProformaUpsert({
        ...form,
        partyName: selectedSupplier?.name || selectedSupplier?.displayName || form.partyName || "",
        partyAddress: selectedSupplier?.address || form.partyAddress || "",
        phone: selectedSupplier?.phone || form.phone || "",
        lines: cleanedLines,
        totals
      });
      toast.success("Purchase proforma saved", result?.proformaNo || "Saved successfully.");
      if (isNew && result?.id) {
        navigate(`/app/purchase/proformas/${encodeURIComponent(result.id)}`, { replace: true });
      } else {
        const refreshed = await purchaseProformaGetByIdRemote(result?.id || form.id);
        if (refreshed) {
          updateForm({
            id: refreshed.id || form.id,
            proformaNo: refreshed.proformaNo || form.proformaNo,
            status: refreshed.status || form.status
          });
        }
      }
    } catch (error: any) {
      toast.error("Save failed", error?.message || "Could not save purchase proforma.");
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
      const result = await convertPurchaseProforma(form.id);
      toast.success(
        "Converted to purchase bill",
        result?.billNo ? `Created bill ${result.billNo}.` : "Purchase bill created successfully."
      );
      navigate(`/app/purchase/history${result?.billId ? `?billId=${encodeURIComponent(result.billId)}` : ""}`);
    } catch (error: any) {
      toast.error("Conversion failed", error?.message || "Could not convert purchase proforma.");
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Purchase Proforma"
        subtitle="Draft purchase intent until converted to final bill"
        right={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate("/app/purchase/proformas")}
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
                {converting ? "Converting..." : "Convert to Bill"}
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
                Supplier
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.supplierId || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ supplierId: event.target.value })}
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((entry) => (
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
                  {PURCHASE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-600">
                Payment Type
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={form.paymentType || ""}
                  disabled={locked}
                  onChange={(event) => updateForm({ paymentType: event.target.value })}
                />
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Line Items</p>
                  <p className="text-xs text-slate-500">Use the same pricing flow as Purchase Bill (tax exclusive only).</p>
                </div>
                <button
                  type="button"
                  onClick={addLine}
                  disabled={locked}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add Line
                </button>
              </div>

              <div className="space-y-3">
                {(form.lines || []).map((line: any, index: number) => (
                  <div key={line.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-600">Row {index + 1}</p>
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={locked}
                        className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <label className="text-xs text-slate-600 xl:col-span-2">
                        Item
                        <div className="relative">
                          <input
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 pr-8 text-sm"
                            value={line.itemInput || ""}
                            disabled={locked}
                            placeholder="Search by item name or code"
                            onFocus={() => setActiveLineItemSearchId(line.id)}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setActiveLineItemSearchId((current) => (current === line.id ? "" : current));
                              }, 120);
                            }}
                            onChange={(event) => {
                              setActiveLineItemSearchId(line.id);
                              handleItemInput(line.id, event.target.value);
                            }}
                          />
                          {(line.itemId || line.itemInput) ? (
                            <button
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                clearLineItemSelection(line.id);
                                setActiveLineItemSearchId(line.id);
                              }}
                              className="absolute right-1.5 top-[9px] inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              title="Clear selected item"
                              aria-label="Clear selected item"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                          {activeLineItemSearchId === line.id && normalizeItemName(line.itemInput).length ? (
                            <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-100 bg-white p-1.5 shadow-soft">
                              {activeLineSearchResults.length ? (
                                activeLineSearchResults.map((item) => (
                                  <button
                                    key={`proforma-line-${line.id}-${item.id}`}
                                    type="button"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      selectLineItem(line, item);
                                      setActiveLineItemSearchId("");
                                    }}
                                    className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                                  >
                                    {formatItemSearchLabel(item)}
                                  </button>
                                ))
                              ) : (
                                <div className="px-2 py-1.5 text-xs text-slate-500">No items found</div>
                              )}
                            </div>
                          ) : null}
                        </div>
                        {line.itemCode ? (
                          <p className="mt-1 text-[11px] text-slate-500">Code: {line.itemCode}</p>
                        ) : null}
                      </label>

                      <label className="text-xs text-slate-600">
                        Qty
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-sm"
                          value={line.qty}
                          disabled={locked}
                          onChange={(event) => updateLine(line.id, { qty: parseNumber(event.target.value) })}
                        />
                      </label>

                      <label className="text-xs text-slate-600">
                        Rate
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-sm"
                          value={line.rate}
                          disabled={locked}
                          onChange={(event) => updateLine(line.id, { rate: parseNumber(event.target.value) })}
                        />
                      </label>

                      <label className="text-xs text-slate-600">
                        Tax %
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-sm"
                          value={line.taxRate}
                          disabled={locked}
                          onChange={(event) => updateLine(line.id, { taxRate: parseNumber(event.target.value) })}
                        />
                      </label>
                    </div>

                    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-right">
                      <p className="text-[11px] text-slate-500">Line Amount</p>
                      <p className="text-sm font-semibold text-slate-900">{lineAmount(line).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
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
          </div>
        )}
      </Card>
    </div>
  );
}
