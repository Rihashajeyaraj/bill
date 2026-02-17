import React, { useMemo } from "react";
import { ClipboardList, Package, ReceiptIndianRupee, UserRound } from "lucide-react";
import Card from "../components/Card";
import { invoicesList } from "../services/invoices.service";
import { itemsList } from "../services/items.service";
import { partiesList } from "../services/parties.service";

export default function StaffDashboard() {
  const invoices = invoicesList();
  const items = itemsList();
  const parties = partiesList();

  const stats = useMemo(() => {
    const todaysInvoices = invoices.filter((invoice) => {
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

    const lowStockCount = items.filter((item) => Number(item?.stockQty || 0) <= 10).length;

    return {
      todaysInvoices,
      lowStockCount,
      totalItems: items.length,
      totalParties: parties.length
    };
  }, [invoices, items, parties]);

  return (
    <div className="max-w-6xl space-y-4">
      <div className="rounded-2xl bg-slate-100 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Staff Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Daily operational summary for billing and stock updates.
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
