import React, { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import EmptyState from "../components/EmptyState";
import DataTable from "../components/DataTable";
import Card from "../components/Card";
import FormField from "../components/FormField";
import { authGetRole } from "../services/auth.service";
import { invoicesList } from "../services/invoices.service";
import { purchasesList } from "../services/purchases.service";

export default function Reports() {
  const role = authGetRole();
  const isAccountant = role === "Accountant";

  const [tab, setTab] = useState("sales");

  const allowedTabs = useMemo(() => {
    if (!isAccountant) {
      return [
        { label: "Sales", value: "sales" },
        { label: "Purchase", value: "purchase" },
        { label: "Tax", value: "tax" },
        { label: "Outstanding", value: "outstanding" },
        { label: "Daybook", value: "daybook" }
      ];
    }
    return [
      { label: "Sales", value: "sales" },
      { label: "Tax", value: "tax" }
    ];
  }, [isAccountant]);

  const invoices = invoicesList();
  const purchases = purchasesList();

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Reports"
        subtitle={isAccountant ? "Accountant view: limited sections" : "Filters + tables (UI skeleton + some data)"}
        right={<Tabs tabs={allowedTabs} value={tab} onChange={setTab} />}
      />

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="From">
            <input type="date" className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none" />
          </FormField>
          <FormField label="To">
            <input type="date" className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none" />
          </FormField>
          <FormField label="Search">
            <input placeholder="Party / invoice no (mock)" className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none" />
          </FormField>
        </div>
      </Card>

      {tab === "sales" ? (
        <DataTable
          columns={[
            { key: "invoiceDate", header: "Date" },
            { key: "partyName", header: "Customer" },
            { key: "grand", header: "Amount", render: (r) => Number(r.totals?.grandTotal || 0).toLocaleString() }
          ]}
          rows={invoices.map((x) => ({ ...x, grand: x.totals?.grandTotal }))}
          emptyText="No invoices yet"
        />
      ) : tab === "purchase" ? (
        <DataTable
          columns={[
            { key: "billDate", header: "Date" },
            { key: "partyName", header: "Supplier" },
            { key: "grand", header: "Amount", render: (r) => Number(r.totals?.grandTotal || 0).toLocaleString() }
          ]}
          rows={purchases.map((x) => ({ ...x, grand: x.totals?.grandTotal }))}
          emptyText="No purchases yet"
        />
      ) : (
        <EmptyState
          icon={BarChart3}
          title="Report section UI"
          description="Add report computations + exports later. Current layout includes filters + table placeholders."
        />
      )}
    </div>
  );
}
