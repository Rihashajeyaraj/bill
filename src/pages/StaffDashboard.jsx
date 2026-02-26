import React, { useEffect, useMemo, useState } from "react";
import { ClipboardList, Package, ReceiptIndianRupee, UserRound } from "lucide-react";
import Card from "../components/Card";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { computeItemStock, listItems, syncItemsFromRemote } from "../modules/items/store";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import { useOrganization } from "../context/OrganizationContext";

const COUNTRY_ALIAS = {
  india: "india",
  in: "india",
  "sri lanka": "sri lanka",
  lk: "sri lanka",
  sl: "sri lanka",
  uae: "uae",
  ae: "uae",
  usa: "usa",
  us: "usa",
  "united states": "usa",
  uk: "uk",
  gb: "uk",
  "united kingdom": "uk",
  ireland: "ireland",
  ie: "ireland",
  singapore: "singapore",
  sg: "singapore"
};

function normalizeCountryKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return COUNTRY_ALIAS[key] || key;
}

function recordCountry(record) {
  if (!record || typeof record !== "object") return "";
  return record.country || record.countryCode || record?.metadata?.country || record?.companySnapshot?.country || "";
}

function countryMatches(recordValue, targetCountry) {
  const target = normalizeCountryKey(targetCountry);
  const source = normalizeCountryKey(recordValue);
  if (!source) return true;
  return source === target;
}

export default function StaffDashboard() {
  const { country = "India", countryCode = "IN" } = useOrganization();
  const [invoices, setInvoices] = useState(() => invoicesList());
  const [items, setItems] = useState(() => listItems());
  const [parties, setParties] = useState(() => listParties());

  useEffect(() => {
    let mounted = true;
    async function syncDashboardData() {
      try {
        const [syncedInvoices] = await Promise.all([
          invoicesSyncFromRemote(),
          syncItemsFromRemote(),
          syncPartiesFromRemote()
        ]);
        if (!mounted) return;
        setInvoices(Array.isArray(syncedInvoices) ? syncedInvoices : invoicesList());
        setItems(listItems());
        setParties(listParties());
      } catch {
        if (!mounted) return;
        setInvoices(invoicesList());
        setItems(listItems());
        setParties(listParties());
      }
    }
    syncDashboardData();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const scopedInvoices = invoices.filter((invoice) => countryMatches(recordCountry(invoice), country));
    const scopedItems = items.filter((item) => countryMatches(recordCountry(item), country));
    const scopedParties = parties.filter((party) => countryMatches(recordCountry(party), country));

    const todaysInvoices = scopedInvoices.filter((invoice) => {
      const dateValue = invoice?.invoiceDate || invoice?.date || invoice?.created_at;
      if (!dateValue) return false;
      const date = new Date(dateValue);
      const now = new Date();
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    }).length;

    const lowStockCount = scopedItems.filter((item) => {
      const stock = computeItemStock(item);
      return item?.trackInventory && stock.lowStock;
    }).length;

    return {
      todaysInvoices,
      lowStockCount,
      totalItems: scopedItems.length,
      totalParties: scopedParties.length
    };
  }, [invoices, items, parties, country]);

  return (
    <div className="dashboard-theme max-w-6xl space-y-4">
      <div className="rounded-2xl bg-slate-100 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Staff Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Daily operational summary for billing and stock updates ({countryCode} {country}).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <ReceiptIndianRupee className="h-4 w-4" />
            <p className="text-xs font-semibold">Today Invoices</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.todaysInvoices}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <Package className="h-4 w-4" />
            <p className="text-xs font-semibold">Total Items</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.totalItems}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <ClipboardList className="h-4 w-4" />
            <p className="text-xs font-semibold">Low Stock</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{stats.lowStockCount}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <UserRound className="h-4 w-4" />
            <p className="text-xs font-semibold">Parties</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{stats.totalParties}</p>
        </Card>
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold text-slate-800">Staff Workflow</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>Create sales invoices and purchase entries assigned by owner/accounter.</li>
          <li>Update item stock and verify unit + HSN/SAC before saving documents.</li>
          <li>Check customer and supplier details to avoid tax/GST mismatches.</li>
        </ul>
      </Card>
    </div>
  );
}
