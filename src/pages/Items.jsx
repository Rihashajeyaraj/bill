import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, FileSpreadsheet, Plus, Search, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import Badge from "../components/Badge";
import Modal from "../components/Modal";
import ItemFormModal from "../modules/items/ItemFormModal";
import { useOrganization } from "../context/OrganizationContext";
import {
  computeItemStock,
  getItemTradeSummary,
  computeItemUsage,
  getItemPurchaseHistoryRemote,
  getItemTradeSummaryRemote,
  listItems,
  removeItemRemote,
  syncItemsFromRemote,
  upsertItemRemote
} from "../modules/items/store";
import { formatMoney, normalizeText, taxContext } from "../modules/items/utils";
import { useToast } from "../context/ToastContext";

export default function Items() {
  const toast = useToast();
  const { country = "India", currency = "" } = useOrganization();

  const [tab, setTab] = useState("Product");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [activeItem, setActiveItem] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historySummary, setHistorySummary] = useState({
    totalSales: 0,
    totalPurchase: 0,
    salesQty: 0,
    purchaseQty: 0
  });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

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

  const tradeSummaryByItem = useMemo(() => {
    const map = new Map();
    filtered.forEach((item) => {
      map.set(item.id, getItemTradeSummary(item.id));
    });
    return map;
  }, [filtered]);

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

  function openCreate() {
    setActiveItem({ type: tab });
    setModalMode("create");
    setModalOpen(true);
  }

  function openEdit(item) {
    setActiveItem(item);
    setModalMode("edit");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveItem(null);
  }

  async function openPurchaseHistory(item) {
    setHistoryItem(item);
    setHistoryRows([]);
    setHistorySummary({
      totalSales: 0,
      totalPurchase: 0,
      salesQty: 0,
      purchaseQty: 0
    });
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const [summary, rows] = await Promise.all([
        getItemTradeSummaryRemote(item.id),
        getItemPurchaseHistoryRemote(item.id)
      ]);
      setHistorySummary(summary || {
        totalSales: 0,
        totalPurchase: 0,
        salesQty: 0,
        purchaseQty: 0
      });
      setHistoryRows(Array.isArray(rows) ? rows : []);
    } catch (error) {
      toast.error("Failed to load purchase history", error?.message || "Could not load history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSave(item) {
    try {
      await upsertItemRemote(item, country);
      setRefreshKey((prev) => prev + 1);
      closeModal();
    } catch (error) {
      toast.error("Failed to save item", error?.message || "Item was not saved.");
    }
  }

  async function handleDelete(item) {
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

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-24">
      <PageHeader
        title="Items"
        subtitle="Products and services with tax and inventory controls"
        right={
          <div className="flex flex-wrap items-center gap-2">
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
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              {tab === "Service" ? "Add Service" : "Add Product"}
            </button>
          </div>
        }
      />

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
              Search by item name or SKU. Country tax: {taxCfg.label}.
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

        <div className="overflow-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">Product Name</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Item ID</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Type</th>
                <th className="px-4 py-3 font-semibold text-slate-700">HSN / SAC</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Sales Rate</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Purchase Rate</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Total Purchase</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Total Sales</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Tax %</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Stock</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                    Loading items...
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((item) => {
                  const usage = computeItemUsage(item);
                  const stock = computeItemStock(item);
                  const canDelete = !usage.used;
                  const tradeSummary = tradeSummaryByItem.get(item.id) || {
                    totalPurchase: 0,
                    totalSales: 0
                  };
                  return (
                    <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              void openPurchaseHistory(item);
                            }}
                            className="w-fit text-left font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                          >
                            {item.name}
                          </button>
                          <p className="text-xs text-slate-500">
                            {item.category || "Uncategorized"} | SKU {item.sku || "-"}
                          </p>
                          {usage.used ? (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              <BarChart3 className="h-3 w-3" />
                              Used {usage.count} times
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {item.itemCode || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{item.type}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {item.type === "Service" ? item.sac || "-" : item.hsn || "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatMoney(item.salesRate, currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatMoney(item.purchaseRate, currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatMoney(tradeSummary.totalPurchase, currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatMoney(tradeSummary.totalSales, currency)}
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
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(item)}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            disabled={!canDelete}
                            title={canDelete ? "Delete" : "Item already used in transactions"}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                    No items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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

      <Modal
        open={historyOpen}
        title={historyItem ? `Purchase History - ${historyItem.name}` : "Purchase History"}
        onClose={() => setHistoryOpen(false)}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Total Purchase</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatMoney(historySummary.totalPurchase, currency)}
              </p>
              <p className="text-[11px] text-slate-500">Qty {historySummary.purchaseQty}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Total Sales</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatMoney(historySummary.totalSales, currency)}
              </p>
              <p className="text-[11px] text-slate-500">Qty {historySummary.salesQty}</p>
            </div>
          </div>

          <div className="overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-700">Supplier</th>
                  <th className="px-3 py-2 font-semibold text-slate-700 text-right">Quantity</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Date</th>
                  <th className="px-3 py-2 font-semibold text-slate-700">Bill No</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Loading history...
                    </td>
                  </tr>
                ) : historyRows.length ? (
                  historyRows.map((entry, index) => (
                    <tr key={`${entry.billNo || "bill"}_${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{entry.supplier || "-"}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{entry.quantity}</td>
                      <td className="px-3 py-2 text-slate-700">{entry.date || "-"}</td>
                      <td className="px-3 py-2 text-slate-700">{entry.billNo || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      No purchase history found for this item.
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

