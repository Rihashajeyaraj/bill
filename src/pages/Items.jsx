import React, { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import DataTable from "../components/DataTable";
import { itemsList, itemsRemove } from "../services/items.service";

export default function Items() {
  const nav = useNavigate();
  const loc = useLocation();
  const rows = useMemo(() => itemsList(), [loc.key]);

  function money(n) {
    const v = Number(n || 0);
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function openCreate() {
    nav("/items/new");
  }

  function renderTax(r) {
    if (r.taxLabel) return r.taxLabel;
    if (r.taxRate !== undefined && r.taxRate !== null) return `GST@${r.taxRate}%`;
    return "-";
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Items & Services"
        subtitle="Add/Edit items • HSN/SAC • tax rate • stock qty"
        right={
          <GradientButton onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Item
          </GradientButton>
        }
      />

      <DataTable
        columns={[
          { key: "name", header: "Name" },
          { key: "type", header: "Type" },
          { key: "unit", header: "Unit" },
          { key: "price", header: "Sale Price", render: (r) => money(r.price) },
          { key: "stockQty", header: "Stock" },
          { key: "tax", header: "Tax", render: renderTax },
          {
            key: "actions",
            header: "Actions",
            render: (r) => (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => itemsRemove(r.id)}
                  className="h-9 w-9 rounded-2xl border border-slate-100 bg-white hover:bg-rose-50 flex items-center justify-center"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4 text-rose-600" />
                </button>
              </div>
            )
          }
        ]}
        rows={rows}
        emptyText="No items yet"
      />
    </div>
  );
}
