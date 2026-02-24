import React, { useEffect, useMemo, useState } from "react";
import { Plus, Save, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import { useToast } from "../../context/ToastContext";
import { listParties, syncPartiesFromRemote } from "../../modules/parties/store";
import { listItems, syncItemsFromRemote, upsertItemRemote } from "../../modules/items/store";
import {
  fetchSupplierAddress,
  purchasesCreate
} from "../../services/purchases.service";
import { useOrganization } from "../../context/OrganizationContext";
import { calculateTaxes } from "../../services/tax";
import { authGetUser } from "../../services/auth.service";
import { syncPaymentOutRemote } from "../../services/payments.service";
import { outstandingBySupplier, savePaymentOut } from "../../modules/paymentOut/store";

const TAX_RATES = [0, 5, 12, 18, 28];
const DEFAULT_UNITS = ["pcs", "kg", "box", "ltr", "set", "hr"];
const BLOCKED_UNITS = ["job"];
const ITEM_DATALIST_ID = "purchase-item-options";
const UNIT_DATALIST_ID = "purchase-unit-options";

function normalizeUnit(unit) {
  const value = String(unit || "").trim();
  if (!value) return "pcs";
  return BLOCKED_UNITS.includes(value.toLowerCase()) ? "pcs" : value;
}

function normalizeItemName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhoneForLookup(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function extractCity(address) {
  const firstSegment = String(address || "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)[0];
  return firstSegment || "";
}

function supplierAddressSummary(supplier) {
  return [supplier?.address, supplier?.state, supplier?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
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
  const item = items.find((entry) => entry?.type === "Product") || items[0];
  const purchaseRate = Number(
    item?.purchaseRate ?? item?.metadata?.purchasePrice ?? item?.price ?? 0
  );
  return {
    id: `line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    itemId: item?.id || "",
    itemCode: item?.itemCode || "",
    itemName: item?.name || "",
    qty: 1,
    unit: normalizeUnit(item?.unit),
    rate: purchaseRate,
    priceTaxMode: "WITHOUT_TAX",
    tax: item?.taxRate || 0
  };
}

export default function PurchaseBill() {
  const navigate = useNavigate();
  const { country = "", currency = "", profile: company = {} } = useOrganization();
  const isIndiaOrg = country === "India";
  const toast = useToast();
  const [suppliers, setSuppliers] = useState(() =>
    listParties().filter((party) => party.type === "Supplier")
  );
  const [items, setItems] = useState(() => listItems());
  const [partyId, setPartyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const party = useMemo(() => suppliers.find((x) => x.id === partyId) || null, [suppliers, partyId]);

  const [phone, setPhone] = useState(party?.phone || "");
  const [supplierSearchPhone, setSupplierSearchPhone] = useState("");
  const [supplierLookupQuery, setSupplierLookupQuery] = useState("");
  const [supplierSearchError, setSupplierSearchError] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [autoBillNumber, setAutoBillNumber] = useState(() => generateBillNumber());
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState(() => [createLine([])]);
  const [roundOffEnabled, setRoundOffEnabled] = useState(false);
  const [roundOffValue, setRoundOffValue] = useState("0");
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [paymentType, setPaymentType] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const purchasableItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item &&
          item.status !== "Inactive" &&
          (item.type === "Product" || item.type === "Service")
      ),
    [items]
  );

  useEffect(() => {
    let mounted = true;
    async function loadLookups() {
      setLoading(true);
      try {
        await Promise.all([
          syncPartiesFromRemote(),
          syncItemsFromRemote()
        ]);
        if (!mounted) return;
        const nextSuppliers = listParties().filter((entry) => entry.type === "Supplier");
        const nextItems = listItems();
        const nextPurchasableItems = nextItems.filter(
          (item) =>
            item &&
            item.status !== "Inactive" &&
            (item.type === "Product" || item.type === "Service")
        );
        setSuppliers(nextSuppliers);
        setItems(nextItems);
        setPartyId((prev) => prev || "");
        setLines((prev) => {
          if (!prev.length) return [createLine(nextPurchasableItems)];
          const hasSelectedItem = prev.some((line) => !!line.itemId || !!line.itemName);
          return hasSelectedItem ? prev : [createLine(nextPurchasableItems)];
        });
      } catch (error) {
        toast.error("Failed to load suppliers/items", error?.message || "Using local cached data.");
        if (!mounted) return;
        const cachedSuppliers = listParties().filter((entry) => entry.type === "Supplier");
        const cachedItems = listItems();
        setSuppliers(cachedSuppliers);
        setItems(cachedItems);
        setPartyId((prev) => prev || "");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadLookups();
    return () => {
      mounted = false;
    };
  }, [toast]);

  useEffect(() => {
    let mounted = true;
    async function hydrateSupplierDetails() {
      setPhone(party?.phone || "");
      if (!partyId) {
        setSupplierAddress("");
        return;
      }

      const fallbackAddress = party?.address || "";
      setSupplierAddress(fallbackAddress);
      try {
        const resolvedAddress = await fetchSupplierAddress(partyId);
        if (mounted) setSupplierAddress(resolvedAddress || fallbackAddress);
      } catch {
        if (mounted) setSupplierAddress(fallbackAddress);
      }
    }
    hydrateSupplierDetails();
    return () => {
      mounted = false;
    };
  }, [party?.phone, party?.address, partyId]);

  useEffect(() => {
    if (!party?.phone) return;
    setSupplierSearchPhone(String(party.phone).replace(/\D/g, "").slice(-10));
  }, [party?.phone]);

  useEffect(() => {
    setPaymentDate(billDate);
  }, [billDate]);

  useEffect(() => {
    if (!markAsPaid) {
      setPaidAmount("");
      setReferenceNo("");
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setPaymentNotes("");
      return;
    }
    if (paymentType === "Cash") {
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      return;
    }
    if (paymentType === "Bank Transfer") {
      setChequeNo("");
      return;
    }
    if (paymentType === "Cheque") {
      setBankName("");
      setTransactionId("");
      return;
    }
    if (paymentType === "Card" || paymentType === "Online") {
      setBankName("");
      setChequeNo("");
    }
  }, [markAsPaid, paymentType]);

  const unitOptions = useMemo(() => {
    const itemUnits = items
      .map((item) => normalizeUnit(item.unit))
      .filter((unit) => unit && !BLOCKED_UNITS.includes(unit.toLowerCase()));
    return Array.from(new Set([...DEFAULT_UNITS, ...itemUnits]));
  }, [items]);

  const supplierLookupResults = useMemo(() => {
    const query = String(supplierLookupQuery || "").trim().toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(query);
    return suppliers
      .filter((supplier) => {
        const text = [
          supplier?.name,
          supplier?.email,
          supplier?.address,
          supplier?.state,
          supplier?.country
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        const supplierPhone = normalizePhoneForLookup(supplier?.phone);
        return (
          text.includes(query) ||
          (normalizedPhoneQuery && supplierPhone && supplierPhone.includes(normalizedPhoneQuery))
        );
      })
      .slice(0, 8);
  }, [suppliers, supplierLookupQuery]);

  function updateLine(id, patch) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const nextPatch = typeof patch === "function" ? patch(line) : patch;
        return { ...line, ...nextPatch };
      })
    );
  }

  function handleItemInput(id, inputValue) {
    const normalizedInput = String(inputValue || "").trim().toLowerCase();
    const match = purchasableItems.find(
      (item) => String(item?.name || "").trim().toLowerCase() === normalizedInput
    );
    updateLine(id, (line) => {
      if (!match) {
        return { ...line, itemName: inputValue, itemId: "", itemCode: "" };
      }
      const purchaseRate = Number(
        match?.purchaseRate ?? match?.metadata?.purchasePrice ?? match?.price ?? 0
      );
      return {
        ...line,
        itemName: match.name,
        itemId: match.id,
        itemCode: match.itemCode || "",
        unit: normalizeUnit(match.unit || line.unit),
        rate: purchaseRate,
        tax: match.taxRate ?? line.tax
      };
    });
  }

  function addLine() {
    setLines((prev) => [...prev, createLine(purchasableItems)]);
  }

  function removeLine(id) {
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  function applySupplierSelection(nextSupplier) {
    if (!nextSupplier) return;
    setSupplierSearchError("");
    setPartyId(nextSupplier.id);
    setPhone(nextSupplier.phone || "");
    setSupplierAddress(nextSupplier.address || "");
    setSupplierSearchPhone(String(nextSupplier.phone || "").replace(/\D/g, "").slice(-10));
    setSupplierLookupQuery("");
  }

  function handleSupplierPhoneChange(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
    setSupplierSearchPhone(digits);
    setSupplierSearchError("");
    if (partyId && normalizePhoneForLookup(digits) !== normalizePhoneForLookup(phone)) {
      setPartyId("");
      setPhone("");
      setSupplierAddress("");
    }
  }

  function handleSupplierLookupChange(value) {
    setSupplierLookupQuery(value);
    setSupplierSearchError("");
  }

  function handleSupplierSearch() {
    const normalizedQuery = normalizePhoneForLookup(supplierSearchPhone);
    const phoneDigits = String(supplierSearchPhone || "").replace(/\D/g, "");
    if (phoneDigits) {
      if (phoneDigits.length !== 10) {
        setSupplierSearchError("Enter a valid 10-digit supplier mobile number.");
        return;
      }
      const matchedSupplier = suppliers.find(
        (supplier) => normalizePhoneForLookup(supplier?.phone) === normalizedQuery
      );
      if (!matchedSupplier) {
        setSupplierSearchError("No supplier found for this mobile number.");
        return;
      }
      applySupplierSelection(matchedSupplier);
      return;
    }

    const query = String(supplierLookupQuery || "").trim();
    if (query.length < 2) {
      setSupplierSearchError("Enter mobile number or name/email/address to search.");
      return;
    }
    if (supplierLookupResults.length === 1) {
      applySupplierSelection(supplierLookupResults[0]);
      return;
    }
    if (!supplierLookupResults.length) {
      setSupplierSearchError("No supplier found for this search.");
      return;
    }
    setSupplierSearchError("Multiple suppliers found. Choose one from the list below.");
  }

  function resetSupplier() {
    setPartyId("");
    setPhone("");
    setSupplierAddress("");
    setSupplierSearchError("");
    setSupplierSearchPhone("");
    setSupplierLookupQuery("");
  }

  const computed = useMemo(() => {
    const detailedBase = lines.map((line) => {
      const qty = Number(line.qty || 0);
      const rate = Number(line.rate || 0);
      const taxRate = Number(line.tax || 0);
      const base = qty * rate;
      if (line.priceTaxMode === "WITH_TAX") {
        const divisor = 1 + taxRate / 100;
        const subTotal = divisor > 0 ? base / divisor : base;
        const lineTax = round2(base - subTotal);
        return { ...line, lineSubTotal: round2(subTotal), lineTax, amount: round2(base) };
      }
      const lineTax = round2((base * taxRate) / 100);
      return { ...line, lineSubTotal: round2(base), lineTax, amount: round2(base + lineTax) };
    });

    const totalQty = detailedBase.reduce((sum, line) => sum + Number(line.qty || 0), 0);
    const subTotal = round2(detailedBase.reduce((sum, line) => sum + line.lineSubTotal, 0));
    const lineTaxTotal = round2(detailedBase.reduce((sum, line) => sum + line.lineTax, 0));
    const effectiveRate = subTotal > 0 ? (lineTaxTotal / subTotal) * 100 : 0;
    const tax = calculateTaxes({
      taxableAmount: subTotal,
      taxRate: effectiveRate,
      org: {
        country,
        state: company?.address?.state || "",
        gstin: ""
      },
      party: {
        state: party?.state || "",
        gstin: ""
      }
    });

    const detailed = detailedBase.map((line) => {
      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;
      let vatAmount = 0;
      if (tax.taxMode === "GST") {
        if (tax.supplyType === "INTER") {
          igstAmount = line.lineTax;
        } else {
          cgstAmount = round2(line.lineTax / 2);
          sgstAmount = round2(line.lineTax - cgstAmount);
        }
      } else {
        vatAmount = line.lineTax;
      }
      return { ...line, cgstAmount, sgstAmount, igstAmount, vatAmount };
    });

    const taxTotal = tax.totalTax;
    const grandTotal = round2(subTotal + taxTotal);
    const roundOff = roundOffEnabled ? Number(roundOffValue || 0) : 0;
    const finalTotal = round2(grandTotal + roundOff);
    return { detailed, totalQty, subTotal, tax, taxTotal, grandTotal, roundOff, finalTotal, effectiveRate };
  }, [lines, roundOffEnabled, roundOffValue, country, company?.address?.state, company?.tax?.gstin, party?.state, party?.gstin, party?.taxId]);

  const paymentAmount = useMemo(() => {
    if (!markAsPaid) return 0;
    const parsedAmount = Number(paidAmount || 0);
    return round2(Math.max(0, parsedAmount));
  }, [paidAmount, markAsPaid]);

  const pendingAmount = useMemo(
    () => round2(Math.max(0, Number(computed.finalTotal || 0) - Number(paymentAmount || 0))),
    [computed.finalTotal, paymentAmount]
  );
  const advanceAmount = useMemo(
    () => round2(Math.max(0, Number(paymentAmount || 0) - Number(computed.finalTotal || 0))),
    [paymentAmount, computed.finalTotal]
  );

  async function resolveLinesWithItems(detailedLines) {
    const nextLines = [];
    const itemsById = new Map(items.map((item) => [String(item.id || ""), item]));
    const itemsByName = new Map(
      items
        .filter((item) => item?.name)
        .map((item) => [normalizeItemName(item.name), item])
    );
    const ensureItemCode = async (item) => {
      if (!item || item.itemCode) return item;
      const savedId = await upsertItemRemote(
        {
          ...item,
          id: item.id,
          itemCode: item.itemCode || ""
        },
        country
      );
      const refreshed =
        listItems().find((entry) => String(entry.id) === String(savedId || item.id)) || item;
      itemsById.set(String(refreshed.id || ""), refreshed);
      if (refreshed.name) {
        itemsByName.set(normalizeItemName(refreshed.name), refreshed);
      }
      return refreshed;
    };

    for (const line of detailedLines) {
      if (line.itemId) {
        const matched = await ensureItemCode(itemsById.get(String(line.itemId || "")));
        nextLines.push({
          ...line,
          itemName: line.itemName || matched?.name || "",
          itemCode: line.itemCode || matched?.itemCode || ""
        });
        continue;
      }

      const typedName = String(line.itemName || "").trim();
      if (!typedName) {
        nextLines.push({ ...line, itemId: "", itemCode: "" });
        continue;
      }

      const normalizedName = normalizeItemName(typedName);
      const existing = await ensureItemCode(itemsByName.get(normalizedName));
      if (existing) {
        nextLines.push({
          ...line,
          itemId: existing.id,
          itemCode: existing.itemCode || "",
          itemName: existing.name,
          unit: normalizeUnit(existing.unit || line.unit)
        });
        continue;
      }

      const createdId = await upsertItemRemote(
        {
          name: typedName,
          type: "Product",
          unit: normalizeUnit(line.unit),
          salesRate: Number(line.rate || 0),
          purchaseRate: Number(line.rate || 0),
          taxRate: Number(line.tax || 0),
          taxInclusive: line.priceTaxMode === "WITH_TAX",
          status: "Active",
          trackInventory: true,
          openingStock: 0,
          lowStockAlert: 0
        },
        country
      );

      const refreshedItems = listItems();
      const created =
        refreshedItems.find((item) => String(item.id) === String(createdId)) ||
        refreshedItems.find((item) => normalizeItemName(item.name) === normalizedName);

      if (created) {
        itemsById.set(String(created.id), created);
        itemsByName.set(normalizedName, created);
      }

      nextLines.push({
        ...line,
        itemId: created?.id || createdId || "",
        itemCode: created?.itemCode || "",
        itemName: created?.name || typedName,
        unit: normalizeUnit(created?.unit || line.unit)
      });
    }

    return nextLines;
  }

  async function save() {
    if (!partyId) {
      toast.warning("Supplier required", "Select a supplier before saving.");
      return;
    }
    if (markAsPaid && !paymentDate) {
      toast.warning("Payment date required", "Select payment date for paid amount.");
      return;
    }
    if (markAsPaid && paymentAmount <= 0) {
      toast.warning("Paid amount required", "Enter how much you paid.");
      return;
    }
    if (markAsPaid && paymentType === "Bank Transfer" && !String(bankName || "").trim()) {
      toast.warning("Bank name required", "Enter bank name for bank transfer.");
      return;
    }
    if (
      markAsPaid &&
      (paymentType === "Bank Transfer" || paymentType === "Card" || paymentType === "Online") &&
      !String(transactionId || "").trim()
    ) {
      toast.warning("Transaction ID required", "Enter transaction ID.");
      return;
    }
    if (markAsPaid && paymentType === "Cheque" && !String(chequeNo || "").trim()) {
      toast.warning("Cheque number required", "Enter cheque number.");
      return;
    }
    setSaving(true);
    try {
      const resolvedLines = await resolveLinesWithItems(computed.detailed);
      const resolvedById = new Map(resolvedLines.map((line) => [line.id, line]));
      setLines((prev) =>
        prev.map((line) => {
          const resolved = resolvedById.get(line.id);
          if (!resolved) return line;
          return {
            ...line,
            itemId: resolved.itemId || "",
            itemCode: resolved.itemCode || "",
            itemName: resolved.itemName || "",
            unit: normalizeUnit(resolved.unit),
            rate: Number(resolved.rate || 0),
            tax: Number(resolved.tax || 0)
          };
        })
      );
      setItems(listItems());

      const validLines = resolvedLines.filter((line) => line.itemId);
      if (!validLines.length) {
        toast.warning("Items required", "Add at least one line item before saving.");
        return;
      }

      const effectiveBillNumber = autoBillNumber;
      const effectivePaymentType = markAsPaid ? paymentType : "Unpaid";
      const createdBillId = await purchasesCreate({
        country,
        partyId,
        partyName: party?.name || "",
        phone,
        billNumber: effectiveBillNumber,
        billDate,
        paymentType: effectivePaymentType,
        partyAddress: supplierAddress,
        lines: validLines,
        totals: {
          totalQty: computed.totalQty,
          subTotal: computed.subTotal,
          taxTotal: computed.taxTotal,
          tax: computed.tax,
          taxBreakup: computed.tax.taxBreakup,
          taxRate: computed.effectiveRate,
          roundOff: computed.roundOff,
          grandTotal: computed.finalTotal
        },
        taxMode: computed.tax.taxMode,
        supplyType: computed.tax.supplyType || null
      });

      if (paymentAmount > 0) {
        const payableBefore = outstandingBySupplier(country, partyId);
        const applyAmount = Math.min(paymentAmount, Number(computed.finalTotal || 0));
        const paymentOutRecord = savePaymentOut({
          country,
          paymentDate: paymentDate || billDate,
          supplierId: partyId,
          supplierName: party?.name || "",
          currency: currency || "",
          paymentMode: paymentType,
          referenceNo: referenceNo || "",
          chequeNo: paymentType === "Cheque" ? chequeNo : "",
          bankName: paymentType === "Bank Transfer" ? bankName : "",
          transactionId:
            paymentType === "Bank Transfer" || paymentType === "Card" || paymentType === "Online"
              ? transactionId
              : "",
          paymentReference: referenceNo || "",
          internalNotes: paymentNotes || `Payment from purchase bill ${effectiveBillNumber}`,
          attachment: null,
          desiredStatus: "Applied",
          amountPaid: paymentAmount,
          allocations: [
            {
              billId: createdBillId,
              billNo: effectiveBillNumber,
              billDate,
              billAmount: Number(computed.finalTotal || 0),
              balanceDue: Number(computed.finalTotal || 0),
              applyAmount
            }
          ],
          supplierOutstandingBefore: payableBefore,
          actor: authGetUser()?.name || authGetUser()?.email || "System User"
        });
        await syncPaymentOutRemote(paymentOutRecord);
      }

      toast.success("Purchase bill saved", `Bill ${effectiveBillNumber} saved successfully.`);
      setAutoBillNumber(generateBillNumber());
      setMarkAsPaid(false);
      setPaymentType("Cash");
      setPaymentDate(billDate);
      setPaidAmount("");
      setReferenceNo("");
      setTransactionId("");
      setChequeNo("");
      setBankName("");
      setPaymentNotes("");
    } catch (error) {
      toast.error("Failed to save purchase bill", error?.message || "Could not save bill.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Purchase Bill" subtitle="Search supplier by mobile and create the bill." />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/app/purchase/history")}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Purchase History
        </button>
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-slate-900">1. Find Supplier</h2>
        <p className="mt-1 text-xs text-slate-500">
          Default search starts with mobile number. You can also search by name, email, or address.
        </p>

        <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <FormField label="Supplier Mobile Number">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={supplierSearchPhone}
                autoFocus
                onChange={(event) => handleSupplierPhoneChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSupplierSearch();
                  }
                }}
                inputMode="numeric"
                maxLength={10}
                placeholder="Enter 10-digit mobile number"
                className="min-w-[220px] flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={handleSupplierSearch}
                disabled={loading}
                className="inline-flex h-[42px] items-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Search className="h-4 w-4" />
                Search
              </button>
              {partyId ? (
                <button
                  type="button"
                  onClick={resetSupplier}
                  className="inline-flex h-[42px] items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </FormField>

          <FormField label="Search by Name / Email / Address">
            <input
              value={supplierLookupQuery}
              onChange={(event) => handleSupplierLookupChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSupplierSearch();
                }
              }}
              placeholder="Type supplier name, email, or address"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
            />
          </FormField>
        </div>

        {supplierSearchError ? (
          <p className="mt-2 text-xs font-medium text-rose-600">{supplierSearchError}</p>
        ) : null}

        {supplierLookupQuery.trim() ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Matching Suppliers
            </p>
            {supplierLookupResults.length ? (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                {supplierLookupResults.map((supplier) => (
                  <button
                    key={supplier.id}
                    type="button"
                    onClick={() => applySupplierSelection(supplier)}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{supplier.name || "-"}</p>
                      <p className="text-xs text-slate-600">{supplier.phone || "-"}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{supplier.email || "-"}</p>
                    <p className="mt-1 text-xs text-slate-500">{supplierAddressSummary(supplier) || "-"}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No supplier found. Try another mobile, name, email, or address.
              </p>
            )}
          </div>
        ) : null}
      </Card>

      {partyId ? (
        <>
          <Card className="p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">2. Supplier Details</h2>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Name</p>
                  <p className="font-semibold text-slate-900">{party?.name || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Mobile</p>
                  <p className="font-semibold text-slate-900">{phone || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">Country</p>
                  <p className="font-semibold text-slate-900">{party?.country || "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs text-slate-500">City</p>
                  <p className="font-semibold text-slate-900">
                    {party?.city || extractCity(supplierAddress || party?.address) || party?.state || "-"}
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
                <p className="text-xs text-slate-500">Address</p>
                <p className="font-semibold text-slate-900">{supplierAddress || "-"}</p>
              </div>
            </div>
          </Card>

          <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
          <div>
            <p className="text-xs text-slate-500">Bill ID</p>
            <p className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold text-slate-800">
              {autoBillNumber}
            </p>
          </div>
          <FormField label="Bill Date">
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
            />
          </FormField>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">3. Items</h2>
            <p className="text-xs text-slate-500">Add item rows, quantity, rate, tax and amount.</p>
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

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[820px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Item</th>
                <th className="px-3 py-3 font-semibold">Qty</th>
                <th className="px-3 py-3 font-semibold">Unit</th>
                <th className="px-3 py-3 font-semibold">Rate</th>
                <th className="px-3 py-3 font-semibold">Tax %</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    Loading items...
                  </td>
                </tr>
              ) : computed.detailed.map((line, index) => (
                <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-3">
                    <input
                      list={ITEM_DATALIST_ID}
                      value={line.itemName || ""}
                      onChange={(e) => handleItemInput(line.id, e.target.value)}
                      className="w-full min-w-[220px] rounded-xl border border-slate-100 bg-white px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Select or type item"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">{line.itemCode ? `Code: ${line.itemCode}` : "No code"}</p>
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
                    <input
                      list={UNIT_DATALIST_ID}
                      value={line.unit}
                      onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                      onBlur={(e) => updateLine(line.id, { unit: normalizeUnit(e.target.value) })}
                      className="w-24 rounded-xl border border-slate-100 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="Unit"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <input
                      type="number"
                      min="0"
                      value={line.rate}
                      onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                      className="w-28 rounded-xl border border-slate-100 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100"
                    />
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
          <datalist id={ITEM_DATALIST_ID}>
            {purchasableItems.map((item) => (
              <option key={item.id} value={item.name}>
                {item.type}
              </option>
            ))}
          </datalist>
          <datalist id={UNIT_DATALIST_ID}>
            {unitOptions.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </div>
        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Payment on Purchase</h3>
            <p className="mt-1 text-xs text-slate-500">Choose whether payment is done now.</p>

            <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setMarkAsPaid(false)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  !markAsPaid ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                Not Paid
              </button>
              <button
                type="button"
                onClick={() => setMarkAsPaid(true)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  markAsPaid ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                Paid
              </button>
            </div>

            {markAsPaid ? (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Amount Paid">
                  <input
                    type="number"
                    min="0"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder="Enter paid amount"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </FormField>
                <FormField label="Payment Method">
                  <select
                    value={paymentType}
                    onChange={(e) => setPaymentType(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  >
                    <option>Cash</option>
                    <option>Bank Transfer</option>
                    <option>Cheque</option>
                    <option>Card</option>
                    <option>Online</option>
                  </select>
                </FormField>
                <FormField label="Payment Date">
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </FormField>
                <FormField label="Reference No">
                  <input
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="Enter payment reference"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </FormField>

                {paymentType === "Bank Transfer" ? (
                  <>
                    <FormField label="Bank Name">
                      <input
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="Enter bank name"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                      />
                    </FormField>
                    <FormField label="Transaction ID">
                      <input
                        value={transactionId}
                        onChange={(e) => setTransactionId(e.target.value)}
                        placeholder="Enter transaction ID"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                      />
                    </FormField>
                  </>
                ) : null}

                {paymentType === "Cheque" ? (
                  <FormField label="Cheque Number" className="md:col-span-2">
                    <input
                      value={chequeNo}
                      onChange={(e) => setChequeNo(e.target.value)}
                      placeholder="Enter cheque number"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </FormField>
                ) : null}

                {paymentType === "Card" ? (
                  <FormField label="Transaction ID" className="md:col-span-2">
                    <input
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      placeholder="Enter card transaction ID"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </FormField>
                ) : null}

                {paymentType === "Online" ? (
                  <FormField label="Transaction ID" className="md:col-span-2">
                    <input
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      placeholder="Enter online transaction ID"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </FormField>
                ) : null}

                <FormField label="Notes" className="md:col-span-2">
                  <input
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Optional internal note"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </FormField>
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                Payment will stay pending. You can record it later in Payment Out.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
            <p className="mt-1 text-xs text-slate-500">Auto-calculated totals and payable balance.</p>

            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Total Quantity</span>
                <span className="font-semibold text-slate-900">{money(computed.totalQty)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-semibold text-slate-900">{money(computed.subTotal)}</span>
              </div>
              {computed.tax.taxMode === "GST" ? (
                computed.tax.supplyType === "INTER" ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">GST Total</span>
                    <span className="font-semibold text-slate-900">{money(computed.taxTotal)}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">CGST + SGST</span>
                    <span className="font-semibold text-slate-900">{money(computed.taxTotal)}</span>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Tax Total</span>
                  <span className="font-semibold text-slate-900">{money(computed.taxTotal)}</span>
                </div>
              )}
              {isIndiaOrg && computed.tax.warning ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {computed.tax.warning}
                </p>
              ) : null}
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
                  className="w-24 rounded-xl border border-slate-200 px-2 py-1.5 text-sm outline-none disabled:bg-slate-100"
                />
              </div>
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Final Total</span>
                  <span className="font-semibold text-slate-900">{money(computed.finalTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Paid Now</span>
                  <span className="font-semibold text-emerald-700">{money(paymentAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Balance Due</span>
                  <span className="font-semibold text-rose-700">{money(pendingAmount)}</span>
                </div>
                {advanceAmount > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Advance</span>
                    <span className="font-semibold text-emerald-700">{money(advanceAmount)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            void save();
          }}
          disabled={saving || loading}
          className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Purchase Bill"}
        </button>
      </div>
        </>
      ) : (
        <Card className="p-6">
          <p className="text-sm text-slate-600">
            Search supplier by mobile, name, email, or address to load supplier details. Then bill ID, bill date, and items will appear.
          </p>
        </Card>
      )}
    </div>
  );
}
