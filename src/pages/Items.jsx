import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, Clock3, Eye, FileSpreadsheet, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import Badge from "../components/Badge";
import Modal from "../components/Modal";
import ItemFormModal from "../modules/items/ItemFormModal";
import { listCreditNotes } from "../modules/creditNote/store";
import { useOrganization } from "../context/OrganizationContext";
import {
  computeItemStock,
  getItemSalesHistoryRemote,
  getItemTradeSummary,
  computeItemUsage,
  getItemPurchaseHistoryRemote,
  getItemTradeSummaryRemote,
  listItems,
  removeItemRemote,
  syncItemsFromRemote,
  upsertItemRemote
} from "../modules/items/store";
import { formatMoney, normalizeText, parseNumber, taxContext } from "../modules/items/utils";
import { listItemReturnActions, saveItemReturnAction } from "../services/itemReturns.service";
import { fetchItemStockHistory, fetchPurchaseBillByBatchId } from "../services/inventory.service";
import { purchasesList } from "../services/purchases.service";
import { useToast } from "../context/ToastContext";
import { authGetRole } from "../services/auth.service";
import { canCreateEntries, canDeleteEntries, canEditEntries } from "../services/roles";

export default function Items() {
  const navigate = useNavigate();
  const toast = useToast();
  const role = authGetRole();
  const canCreateItem = canCreateEntries(role);
  const canEditItem = canEditEntries(role);
  const canDeleteItem = canDeleteEntries(role);
  const { country = "India", currency = "" } = useOrganization();

  const [pageView, setPageView] = useState("items");
  const [tab, setTab] = useState("Product");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [activeItem, setActiveItem] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewItem, setViewItem] = useState(null);
  const [viewTradeSummary, setViewTradeSummary] = useState({
    totalSales: 0,
    totalPurchase: 0,
    salesQty: 0,
    purchaseQty: 0
  });
  const [viewBatchRows, setViewBatchRows] = useState([]);
  const [viewDetailLoading, setViewDetailLoading] = useState(false);
  const [viewDetailError, setViewDetailError] = useState("");
  const [actionMenu, setActionMenu] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);
  const [historyMode, setHistoryMode] = useState("purchase");
  const [historyRowsByMode, setHistoryRowsByMode] = useState({
    purchase: [],
    sales: []
  });
  const [historySummary, setHistorySummary] = useState({
    totalSales: 0,
    totalPurchase: 0,
    salesQty: 0,
    purchaseQty: 0
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  function normalizeBillKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9/_-]/g, "");
  }

  const items = useMemo(() => listItems(), [refreshKey]);
  const taxCfg = useMemo(() => taxContext(country, tab), [country, tab]);

  const filtered = useMemo(() => {
    const query = normalizeText(search);
    return items.filter((item) => {
      if (tab && item.type !== tab) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (!query) return true;
      const haystack = `${item.name} ${item.itemCode || ""} ${item.sku || ""} ${item.barcode || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [items, tab, statusFilter, search]);

  const viewBatchSummary = useMemo(() => {
    return viewBatchRows.reduce(
      (acc, batch) => {
        acc.purchaseQty += parseNumber(batch.purchaseQty);
        acc.soldQty += parseNumber(batch.soldQty);
        acc.pendingQty += parseNumber(batch.pendingQty);
        return acc;
      },
      { purchaseQty: 0, soldQty: 0, pendingQty: 0 }
    );
  }, [viewBatchRows]);

  const summary = useMemo(() => {
    const scoped = items.filter((item) => item.type === tab);
    const active = scoped.filter((item) => item.status === "Active").length;
    const lowStock = scoped.filter((item) => computeItemStock(item).lowStock).length;
    return {
      total: scoped.length,
      active,
      lowStock
    };
  }, [items, tab]);

  const returnActionsByRef = useMemo(() => {
    const map = new Map();
    listItemReturnActions().forEach((entry) => {
      const key = String(entry?.returnRef || "").trim();
      if (!key) return;
      map.set(key, entry);
    });
    return map;
  }, [refreshKey]);

  const purchaseByBillNo = useMemo(() => {
    const map = new Map();
    (Array.isArray(purchasesList()) ? purchasesList() : []).forEach((purchase) => {
      const billNoRaw = String(purchase?.billNumber || purchase?.invoiceNo || "").trim();
      const keys = [billNoRaw, normalizeBillKey(billNoRaw)];
      keys.forEach((key) => {
        if (!key || map.has(key)) return;
        map.set(key, purchase);
      });
    });
    return map;
  }, [refreshKey]);

  const nonReusableReturns = useMemo(() => {
    const rows = [];
    const notes = listCreditNotes();
    (Array.isArray(notes) ? notes : []).forEach((note) => {
      const status = String(note?.status || "").trim().toLowerCase();
      if (status !== "applied") return;
      (Array.isArray(note?.lines) ? note.lines : []).forEach((line, index) => {
        const returnCondition = String(line?.returnCondition || "").trim().toUpperCase();
        if (returnCondition !== "NOT_REUSABLE") return;
        const returnedQty = Math.max(0, Number(line?.quantity ?? line?.qty ?? 0) || 0);
        if (!returnedQty) return;
        const baseRef = `${note?.id || "note"}::${line?.sourceInvoiceItemId || line?.id || index}`;
        const lineAllocations = Array.isArray(line?.returnAllocations) ? line.returnAllocations : [];
        if (!lineAllocations.length) {
          const action = returnActionsByRef.get(baseRef) || null;
          rows.push({
            returnRef: baseRef,
            noteId: note?.id || "",
            creditNoteNo: note?.creditNoteNo || "",
            returnDate: note?.creditNoteDate || note?.creditDate || "",
            itemId: line?.itemId || "",
            itemName: line?.itemName || line?.description || "Item",
            originalBillNo: note?.linkedInvoiceNo || note?.referenceInvoiceNo || "",
            sourceBatchId: "",
            sourceBatchDocumentNo: "",
            purchaseBillId: "",
            purchaseBillNo: "",
            supplierId: "",
            purchaseRate: Math.max(0, Number(line?.purchaseRate || 0) || 0),
            sellingRate: Math.max(0, Number(line?.rate || 0) || 0),
            returnedQty,
            refundMode: note?.refundMode || "FULL",
            refundAmount: Math.max(0, Number(note?.totals?.total || 0) || 0),
            action
          });
          return;
        }

        let remainingQty = returnedQty;
        lineAllocations.forEach((allocation, allocIndex) => {
          if (remainingQty <= 1e-6) return;
          const allocQty = Math.max(0, Number(allocation?.allocatedQty ?? allocation?.allocated_qty ?? 0) || 0);
          if (allocQty <= 0) return;
          const usedQty = Math.min(remainingQty, allocQty);
          if (usedQty <= 0) return;
          remainingQty -= usedQty;

          const batchDocumentNo = String(
            allocation?.batchDocumentNo || allocation?.batch_document_no || ""
          ).trim();
          const purchase =
            purchaseByBillNo.get(batchDocumentNo) ||
            purchaseByBillNo.get(batchDocumentNo.toLowerCase()) ||
            purchaseByBillNo.get(normalizeBillKey(batchDocumentNo)) ||
            null;
          const returnRef = `${baseRef}::${allocation?.batchId || allocation?.batch_id || allocIndex}`;
          const action = returnActionsByRef.get(returnRef) || null;

          rows.push({
            returnRef,
            noteId: note?.id || "",
            creditNoteNo: note?.creditNoteNo || "",
            returnDate: note?.creditNoteDate || note?.creditDate || "",
            itemId: line?.itemId || "",
            itemName: line?.itemName || line?.description || "Item",
            originalBillNo: note?.linkedInvoiceNo || note?.referenceInvoiceNo || "",
            sourceBatchId: String(allocation?.batchId || allocation?.batch_id || ""),
            sourceBatchDocumentNo: batchDocumentNo,
            purchaseBillId: String(purchase?.id || ""),
            purchaseBillNo: String(purchase?.billNumber || purchase?.invoiceNo || batchDocumentNo || ""),
            supplierId: String(purchase?.partyId || ""),
            purchaseRate: Math.max(
              0,
              Number(
                allocation?.unitCostExclTax ??
                  allocation?.unit_cost_excl_tax ??
                  line?.purchaseRate ??
                  0
              ) || 0
            ),
            sellingRate: Math.max(0, Number(line?.rate || 0) || 0),
            returnedQty: usedQty,
            refundMode: note?.refundMode || "FULL",
            refundAmount: Math.max(0, Number(note?.totals?.total || 0) || 0),
            action
          });
        });
      });
    });
    return rows.sort((a, b) => {
      const aDate = String(a.returnDate || "");
      const bDate = String(b.returnDate || "");
      return aDate < bDate ? 1 : -1;
    });
  }, [purchaseByBillNo, refreshKey, returnActionsByRef]);

  useEffect(() => {
    let mounted = true;
    async function loadItems() {
      setLoading(true);
      try {
        await syncItemsFromRemote();
        if (mounted) setRefreshKey((prev) => prev + 1);
      } catch (error) {
        toast.error("Failed to load items", error?.message || "Could not fetch items from backend.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadItems();
    return () => {
      mounted = false;
    };
  }, [toast]);

  useEffect(() => {
    function handleClickOutside(event) {
      const target = event.target;
      if (target?.closest?.("[data-item-actions-root='true']")) return;
      if (target?.closest?.("[data-item-actions-menu='true']")) return;
      setActionMenu(null);
    }
    window.addEventListener("pointerdown", handleClickOutside);
    return () => window.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  useEffect(() => {
    function closeActionMenu() {
      setActionMenu(null);
    }
    window.addEventListener("resize", closeActionMenu);
    window.addEventListener("scroll", closeActionMenu, true);
    return () => {
      window.removeEventListener("resize", closeActionMenu);
      window.removeEventListener("scroll", closeActionMenu, true);
    };
  }, []);

  useEffect(() => {
    if (pageView !== "items") {
      setActionMenu(null);
    }
  }, [pageView]);

  function openCreate() {
    if (!canCreateItem) {
      toast.error("Permission denied", "You do not have permission to create items.");
      return;
    }
    setActiveItem({ type: tab });
    setModalMode("create");
    setModalOpen(true);
  }

  function openEdit(item) {
    if (!canEditItem) {
      toast.error("Permission denied", "You do not have permission to edit items.");
      return;
    }
    setActiveItem(item);
    setModalMode("edit");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveItem(null);
  }

  function openView(item) {
    setHistoryOpen(false);
    setHistoryItem(null);
    setActionMenu(null);
    setViewItem(item);
    setViewTradeSummary(getItemTradeSummary(item?.id));
    setViewBatchRows([]);
    setViewDetailError("");
    setViewOpen(true);
  }

  function formatDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString();
    }
    if (raw.length >= 10 && raw[4] === "-" && raw[7] === "-") {
      return raw.slice(0, 10);
    }
    return raw;
  }

  useEffect(() => {
    if (!viewOpen || !viewItem?.id) return;
    let active = true;
    async function loadViewDetails() {
      setViewDetailLoading(true);
      setViewDetailError("");
      try {
        const [tradeSummary, stockDetails] = await Promise.all([
          getItemTradeSummaryRemote(viewItem.id),
          fetchItemStockHistory(viewItem.id)
        ]);
        if (!active) return;
        setViewTradeSummary(
          tradeSummary || {
            totalSales: 0,
            totalPurchase: 0,
            salesQty: 0,
            purchaseQty: 0
          }
        );
        const batches = (Array.isArray(stockDetails?.batches) ? stockDetails.batches : []).map((row) => {
          const purchaseQty = parseNumber(row?.qty_purchased ?? row?.qtyPurchased);
          const pendingQty = Math.max(0, parseNumber(row?.qty_remaining ?? row?.qtyRemaining));
          return {
            batchId: String(row?.batch_id || row?.batchId || ""),
            batchDate: String(row?.batch_date || row?.batchDate || ""),
            sourceDocumentNo: String(row?.source_document_no || row?.sourceDocumentNo || ""),
            purchaseBillId: String(row?.purchase_bill_id || row?.purchaseBillId || ""),
            purchaseQty,
            pendingQty,
            soldQty: Math.max(0, purchaseQty - pendingQty),
            unitCostExclTax: parseNumber(row?.unit_cost_excl_tax ?? row?.unitCostExclTax),
            suggestedSaleRate: parseNumber(row?.suggested_sale_rate ?? row?.suggestedSaleRate),
            taxRate: parseNumber(row?.tax_rate ?? row?.taxRate),
            taxInclusive: !!(row?.tax_inclusive ?? row?.taxInclusive)
          };
        });
        setViewBatchRows(
          batches.sort((a, b) => new Date(b.batchDate || 0).getTime() - new Date(a.batchDate || 0).getTime())
        );
      } catch (error) {
        if (!active) return;
        setViewDetailError(error?.message || "Could not load batch-wise stock details.");
      } finally {
        if (active) setViewDetailLoading(false);
      }
    }
    void loadViewDetails();
    return () => {
      active = false;
    };
  }, [viewOpen, viewItem?.id]);

  async function loadHistoryRowsByMode(itemId, mode) {
    if (mode === "sales") {
      return getItemSalesHistoryRemote(itemId);
    }
    return getItemPurchaseHistoryRemote(itemId);
  }

  async function switchHistoryMode(mode) {
    if (!historyItem?.id || mode === historyMode) return;
    setHistoryMode(mode);
    setHistoryLoading(true);
    try {
      const rows = await loadHistoryRowsByMode(historyItem.id, mode);
      setHistoryRowsByMode((prev) => ({
        ...prev,
        [mode]: Array.isArray(rows) ? rows : []
      }));
    } catch (error) {
      toast.error(
        `Failed to load ${mode === "sales" ? "sales" : "purchase"} history`,
        error?.message || "Could not load history."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openItemHistory(item) {
    setViewOpen(false);
    setViewItem(null);
    setActionMenu(null);
    setHistoryItem(item);
    setHistoryMode("purchase");
    setHistoryRowsByMode({
      purchase: [],
      sales: []
    });
    setHistorySummary({
      totalSales: 0,
      totalPurchase: 0,
      salesQty: 0,
      purchaseQty: 0
    });
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const [summary, purchaseRows] = await Promise.all([
        getItemTradeSummaryRemote(item.id),
        loadHistoryRowsByMode(item.id, "purchase")
      ]);
      setHistorySummary(summary || {
        totalSales: 0,
        totalPurchase: 0,
        salesQty: 0,
        purchaseQty: 0
      });
      setHistoryRowsByMode({
        purchase: Array.isArray(purchaseRows) ? purchaseRows : [],
        sales: []
      });
    } catch (error) {
      toast.error("Failed to load item history", error?.message || "Could not load history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSave(item) {
    if (modalMode === "edit" && !canEditItem) {
      toast.error("Permission denied", "You do not have permission to edit items.");
      return;
    }
    if (modalMode !== "edit" && !canCreateItem) {
      toast.error("Permission denied", "You do not have permission to create items.");
      return;
    }
    try {
      await upsertItemRemote(item, country);
      setRefreshKey((prev) => prev + 1);
      closeModal();
    } catch (error) {
      toast.error("Failed to save item", error?.message || "Item was not saved.");
    }
  }

  async function handleDelete(item) {
    if (!canDeleteItem) {
      toast.error("Permission denied", "You do not have permission to delete items.");
      return;
    }
    const usage = computeItemUsage(item);
    if (usage.used) return;
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
    try {
      await removeItemRemote(item.id);
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      toast.error("Failed to delete item", error?.message || "Item was not deleted.");
    }
  }

  function applyReturnAction(returnRow, action, extra = {}) {
    const existing = returnActionsByRef.get(returnRow.returnRef) || null;
    const existingAction = String(existing?.action || "").trim().toUpperCase();
    if (existingAction && existingAction !== "PENDING") {
      toast.error("Status locked", "This return status is already finalized and cannot be changed.");
      return;
    }
    try {
      saveItemReturnAction({
        returnRef: returnRow.returnRef,
        action,
        supplierId: returnRow.supplierId || "",
        ...extra
      });
      setRefreshKey((prev) => prev + 1);
      toast.success("Return action updated", `${returnRow.itemName} marked as ${action.replaceAll("_", " ").toLowerCase()}.`);
    } catch (error) {
      toast.error("Failed to update return action", error?.message || "Could not save return action.");
    }
  }

  async function handleReturnToSupplier(returnRow) {
    let purchaseBillId = String(returnRow?.purchaseBillId || "").trim();
    let purchaseBillNo = String(returnRow?.purchaseBillNo || "").trim();

    if (!purchaseBillId && returnRow?.sourceBatchDocumentNo) {
      const purchase =
        purchaseByBillNo.get(returnRow.sourceBatchDocumentNo) ||
        purchaseByBillNo.get(String(returnRow.sourceBatchDocumentNo).toLowerCase()) ||
        purchaseByBillNo.get(normalizeBillKey(returnRow.sourceBatchDocumentNo)) ||
        null;
      if (purchase?.id) {
        purchaseBillId = String(purchase.id);
        purchaseBillNo = String(purchase.billNumber || purchase.invoiceNo || purchaseBillNo);
      }
    }

    if (!purchaseBillId && returnRow?.sourceBatchId) {
      try {
        const resolved = await fetchPurchaseBillByBatchId(returnRow.sourceBatchId);
        if (resolved?.purchaseBillId) {
          purchaseBillId = String(resolved.purchaseBillId);
          purchaseBillNo = String(resolved.purchaseBillNo || purchaseBillNo);
        }
      } catch {
        // Fallback error handled below with explicit message.
      }
    }

    if (!purchaseBillId) {
      toast.error(
        "Purchase bill not found",
        "No linked purchase bill was resolved from this return batch yet."
      );
      return;
    }

    const params = new URLSearchParams();
    params.set("billId", purchaseBillId);
    if (returnRow.itemId) params.set("itemId", returnRow.itemId);
    if (returnRow.returnedQty > 0) params.set("qty", String(returnRow.returnedQty));
    params.set("reason", "Customer return to supplier");
    if (returnRow.sourceBatchId) params.set("batchId", returnRow.sourceBatchId);
    params.set("returnRef", String(returnRow.returnRef || ""));
    navigate(`/app/purchase/debit-note?${params.toString()}`);
  }

  function handleResellAction(returnRow) {
    const customerName = window.prompt("Resell to customer (name)", "");
    if (customerName === null) return;
    const trimmedCustomer = String(customerName || "").trim();
    if (!trimmedCustomer) {
      toast.error("Customer name required", "Enter customer name for resale.");
      return;
    }
    const defaultPrice = returnRow.sellingRate > 0 ? returnRow.sellingRate : 0;
    const priceInput = window.prompt(
      `Resell price (must be <= original selling rate ${defaultPrice})`,
      String(defaultPrice)
    );
    if (priceInput === null) return;
    const resellPrice = Math.max(0, Number(priceInput) || 0);
    if (resellPrice > defaultPrice + 1e-6) {
      toast.error("Invalid resale price", "Resale price must be same or lower than original selling rate.");
      return;
    }
    applyReturnAction(returnRow, "RESELL", {
      resellCustomerName: trimmedCustomer,
      resellPrice
    });
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-24">
      <PageHeader
        title="Items"
        subtitle={
          pageView === "items"
            ? "Products and services with tax and inventory controls"
            : "Customer returns management"
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={pageView}
              onChange={setPageView}
              tabs={[
                { label: "Items", value: "items" },
                { label: "Returns", value: "returns" }
              ]}
            />
            {pageView === "items" ? (
              <>
                <Tabs
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { label: "Products", value: "Product" },
                    { label: "Services", value: "Service" }
                  ]}
                />
                <button
                  type="button"
                  onClick={openCreate}
                  disabled={!canCreateItem}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  {tab === "Service" ? "Add Service" : "Add Product"}
                </button>
              </>
            ) : null}
          </div>
        }
      />
      {pageView === "items" ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <p className="text-xs font-semibold text-slate-500">Total {tab}s</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <p className="text-xs font-semibold text-slate-500">Active Items</p>
              <p className="mt-2 text-2xl font-bold text-emerald-600">{summary.active}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
              <p className="text-xs font-semibold text-slate-500">Low Stock Alerts</p>
              <p className="mt-2 text-2xl font-bold text-rose-600">{summary.lowStock}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Item Library</p>
            <p className="text-xs text-slate-500">
              Search by item name or Item ID. Country tax: {taxCfg.label}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search items"
                className="w-full rounded-full border border-slate-200 bg-slate-50 px-10 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm"
            >
              <option value="">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Bulk Import
            </button>
          </div>
        </div>

      <div className="relative overflow-x-auto overflow-y-visible">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">Item ID</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Type</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Sales Rate</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Tax %</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Stock</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    Loading items...
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((item) => {
                  const usage = computeItemUsage(item);
                  const stock = computeItemStock(item);
                  const canDeleteByUsage = !usage.used;
                  const canDelete = canDeleteItem && canDeleteByUsage;
                  const deleteDisabledReason = !canDeleteItem
                    ? "You do not have delete permission."
                    : !canDeleteByUsage
                      ? "Item already used in transactions."
                      : "";
                  return (
                    <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {item.itemCode || item.sku || item.id || "-"}
                      </td>
                      <td className="relative px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              void openItemHistory(item);
                            }}
                            className="w-fit text-left font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                          >
                            {item.name}
                          </button>
                          <p className="text-xs text-slate-500">{item.category || "Uncategorized"}</p>
                          {usage.used ? (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              <BarChart3 className="h-3 w-3" />
                              Used {usage.count} times
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.type}</td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatMoney(item.salesRate, currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {item.taxRate ? `${item.taxRate}%` : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {item.type === "Service" ? (
                          <span className="text-xs text-slate-400">Inventory disabled</span>
                        ) : item.trackInventory ? (
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold text-slate-900">{stock.available}</span>
                            {stock.lowStock ? (
                              <span className="text-[11px] font-semibold text-rose-600">Low stock</span>
                            ) : (
                              <span className="text-[11px] text-slate-500">In stock</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Not tracked</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={item.status === "Active" ? "success" : "neutral"}>{item.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative inline-flex" data-item-actions-root="true">
                          <button
                            type="button"
                            onClick={(event) => {
                              const triggerRect = event.currentTarget.getBoundingClientRect();
                              const menuWidth = 160;
                              const estimatedMenuHeight = 160;
                              const left = Math.min(
                                window.innerWidth - menuWidth - 8,
                                Math.max(8, triggerRect.right - menuWidth)
                              );
                              const preferredTop = triggerRect.bottom + 4;
                              const top =
                                preferredTop + estimatedMenuHeight > window.innerHeight - 8
                                  ? Math.max(8, triggerRect.top - estimatedMenuHeight - 8)
                                  : preferredTop;
                              setActionMenu((current) =>
                                current?.item?.id === item.id
                                  ? null
                                  : {
                                      item,
                                      canEdit: canEditItem,
                                      canDelete,
                                      deleteDisabledReason,
                                      top,
                                      left
                                    }
                              );
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            aria-label="Open actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
          <div className="border-b border-slate-100 px-4 py-4">
            <p className="text-sm font-semibold text-slate-900">Returns (Non-Reusable)</p>
            <p className="text-xs text-slate-500">
              Customer-returned items that are not reusable. Manage supplier return, resale, or loss.
            </p>
          </div>
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-700">Item</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Original Bill</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Batch / Purchase Bill</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 text-right">Purchase Rate</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 text-right">Selling Rate</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 text-right">Returned Qty</th>
                  <th className="px-4 py-3 font-semibold text-slate-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {nonReusableReturns.length ? (
                  nonReusableReturns.map((entry) => (
                    (() => {
                      const actionCode = String(entry.action?.action || "").trim().toUpperCase();
                      const locked = !!actionCode && actionCode !== "PENDING";
                      return (
                    <tr key={entry.returnRef} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{entry.itemName}</p>
                        <p className="text-xs text-slate-500">
                          Return {entry.creditNoteNo || "-"} | {entry.returnDate || "-"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{entry.originalBillNo || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <p>Batch: {entry.sourceBatchId || "-"}</p>
                        <p>Purchase Bill: {entry.purchaseBillNo || "-"}</p>
                        <p>ID: {entry.purchaseBillId || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatMoney(entry.purchaseRate, currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatMoney(entry.sellingRate, currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">{entry.returnedQty}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleReturnToSupplier(entry)}
                            disabled={locked}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Return to Supplier
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResellAction(entry)}
                            disabled={locked}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Resell
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              applyReturnAction(entry, "LOSS", {
                                notes: "Marked as inventory loss from Items returns panel."
                              })
                            }
                            disabled={locked}
                            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Mark as Loss
                          </button>
                          <span className="text-[11px] font-semibold text-slate-500">
                            {entry.action?.action
                              ? entry.action.action === "RESELL"
                                ? `Resold (${entry.action.resellCustomerName || "-"})`
                                : entry.action.action.replaceAll("_", " ")
                              : "Pending"}
                          </span>
                        </div>
                      </td>
                    </tr>
                      );
                    })()
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-500">
                      No non-reusable customer returns found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ItemFormModal
        open={modalOpen}
        mode={modalMode}
        country={country}
        initialItem={activeItem}
        onClose={closeModal}
        onSave={(item) => {
          void handleSave(item);
        }}
      />

      {actionMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-item-actions-menu="true"
              className="fixed z-[140] w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
              style={{ top: actionMenu.top, left: actionMenu.left }}
            >
              <button
                type="button"
                onClick={() => {
                  const selectedItem = actionMenu.item;
                  setActionMenu(null);
                  openView(selectedItem);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Eye className="h-3.5 w-3.5" />
                View
              </button>
              <button
                type="button"
                onClick={() => {
                  const selectedItem = actionMenu.item;
                  setActionMenu(null);
                  openEdit(selectedItem);
                }}
                disabled={!actionMenu.canEdit}
                title={actionMenu.canEdit ? "Edit" : "You do not have edit permission."}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  const selectedItem = actionMenu.item;
                  setActionMenu(null);
                  void openItemHistory(selectedItem);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Clock3 className="h-3.5 w-3.5" />
                History
              </button>
              <button
                type="button"
                onClick={() => {
                  const selectedItem = actionMenu.item;
                  setActionMenu(null);
                  void handleDelete(selectedItem);
                }}
                disabled={!actionMenu.canDelete}
                title={actionMenu.canDelete ? "Delete" : actionMenu.deleteDisabledReason}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>,
            document.body
          )
        : null}

      <Modal
        open={viewOpen}
        title={viewItem ? `Item Details - ${viewItem.name}` : "Item Details"}
        onClose={() => {
          setViewOpen(false);
          setViewDetailError("");
        }}
      >
        {viewItem ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Item ID</p>
                <p className="font-semibold text-slate-900">{viewItem.itemCode || "-"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Type</p>
                <p className="font-semibold text-slate-900">{viewItem.type}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Sales Rate</p>
                <p className="font-semibold text-slate-900">{formatMoney(viewItem.salesRate, currency)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Purchase Rate</p>
                <p className="font-semibold text-slate-900">{formatMoney(viewItem.purchaseRate, currency)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Tax %</p>
                <p className="font-semibold text-slate-900">{viewItem.taxRate ? `${viewItem.taxRate}%` : "-"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">HSN / SAC</p>
                <p className="font-semibold text-slate-900">
                  {viewItem.type === "Service" ? viewItem.sac || "-" : viewItem.hsn || "-"}
                </p>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                <p className="text-xs text-blue-700">Total Purchase Value</p>
                <p className="font-semibold text-blue-950">{formatMoney(viewTradeSummary.totalPurchase, currency)}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <p className="text-xs text-emerald-700">Total Sales Value</p>
                <p className="font-semibold text-emerald-950">{formatMoney(viewTradeSummary.totalSales, currency)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Purchase Qty</p>
                <p className="font-semibold text-slate-900">{parseNumber(viewTradeSummary.purchaseQty)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Selling Qty</p>
                <p className="font-semibold text-slate-900">{parseNumber(viewTradeSummary.salesQty)}</p>
              </div>
            </div>

            {viewItem.type === "Product" && viewItem.trackInventory ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-100 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Batch-wise Stock Overview</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                      <p className="text-xs text-indigo-700">Purchased Qty</p>
                      <p className="text-lg font-semibold text-indigo-950">{viewBatchSummary.purchaseQty}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs text-amber-700">Sold Qty</p>
                      <p className="text-lg font-semibold text-amber-950">{viewBatchSummary.soldQty}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-xs text-emerald-700">Pending / In Stock</p>
                      <p className="text-lg font-semibold text-emerald-950">{viewBatchSummary.pendingQty}</p>
                    </div>
                  </div>
                </div>

                {viewDetailLoading ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-slate-500">
                    Loading batch details...
                  </div>
                ) : viewDetailError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-xs text-rose-700">
                    {viewDetailError}
                  </div>
                ) : viewBatchRows.length ? (
                  <div className="overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[740px] text-left text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 font-semibold text-slate-700">Batch</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">Bill No</th>
                          <th className="px-3 py-2 font-semibold text-slate-700">Batch Date</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-700">Purchased</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-700">Sold</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-700">Pending</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-700">Unit Cost</th>
                          <th className="px-3 py-2 text-right font-semibold text-slate-700">Suggested Sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewBatchRows.map((batch) => (
                          <tr key={batch.batchId || `${batch.sourceDocumentNo}_${batch.batchDate}`} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-mono text-xs text-slate-700">{batch.batchId || "-"}</td>
                            <td className="px-3 py-2 text-slate-700">{batch.sourceDocumentNo || "-"}</td>
                            <td className="px-3 py-2 text-slate-700">{formatDate(batch.batchDate)}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{batch.purchaseQty}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{batch.soldQty}</td>
                            <td className="px-3 py-2 text-right font-semibold text-emerald-700">{batch.pendingQty}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{formatMoney(batch.unitCostExclTax, currency)}</td>
                            <td className="px-3 py-2 text-right text-slate-700">{formatMoney(batch.suggestedSaleRate, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-slate-500">
                    No batch-wise stock entries found for this product.
                  </div>
                )}
              </>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Description</p>
              <p className="font-semibold text-slate-900">{viewItem.description || "-"}</p>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={historyOpen}
        title={historyItem ? `Item History - ${historyItem.name}` : "Item History"}
        onClose={() => setHistoryOpen(false)}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                void switchHistoryMode("purchase");
              }}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                historyMode === "purchase"
                  ? "border-blue-300 bg-blue-50"
                  : "border-slate-200 bg-slate-50 hover:border-slate-300"
              }`}
            >
              <p className="text-xs text-slate-500">Total Purchase</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatMoney(historySummary.totalPurchase, currency)}
              </p>
              <p className="text-[11px] text-slate-500">Qty {historySummary.purchaseQty}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                void switchHistoryMode("sales");
              }}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                historyMode === "sales"
                  ? "border-blue-300 bg-blue-50"
                  : "border-slate-200 bg-slate-50 hover:border-slate-300"
              }`}
            >
              <p className="text-xs text-slate-500">Total Sales</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatMoney(historySummary.totalSales, currency)}
              </p>
              <p className="text-[11px] text-slate-500">Qty {historySummary.salesQty}</p>
            </button>
          </div>

          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-700">Item ID</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">
                    {historyMode === "sales" ? "Customer" : "Supplier"}
                  </th>
                  <th className="px-3 py-2 font-semibold text-slate-700 text-right">Quantity</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Date</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Bill No</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 text-right">
                    {historyMode === "sales" ? "Sales Amount" : "Purchase Amount"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Loading history...
                    </td>
                  </tr>
                ) : (historyRowsByMode[historyMode] || []).length ? (
                  (historyRowsByMode[historyMode] || []).map((entry, index) => (
                    <tr key={`${entry.billNo || "bill"}_${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">
                        {entry.itemId || entry.itemCode || historyItem?.itemCode || historyItem?.id || "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {historyMode === "sales" ? entry.customer || "-" : entry.supplier || "-"}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">{entry.quantity}</td>
                      <td className="px-3 py-2 text-slate-700">{entry.date || "-"}</td>
                      <td className="px-3 py-2 text-slate-700">{entry.billNo || "-"}</td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {formatMoney(
                          historyMode === "sales" ? entry.salesAmount : entry.purchaseAmount,
                          currency
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No {historyMode} history found for this item.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}

