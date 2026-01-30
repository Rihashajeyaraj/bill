import React, { useMemo, useState } from "react";
import { Plus, Trash2, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import GradientButton from "../components/GradientButton";
import DataTable from "../components/DataTable";
import Modal from "../components/Modal";
import FormField from "../components/FormField";

import { partiesByType, partiesRemove, partiesUpsert } from "../services/parties.service";

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function Parties() {
  const nav = useNavigate();
  const [tab, setTab] = useState("Customer");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const rows = useMemo(() => partiesByType(tab), [tab, open, editing]);

  function openCreate() {
    setEditing({
      type: tab,
      name: "",
      phone: "",
      email: "",
      state: "",
      address: "",
      gstin: "",
      balance: 0
    });
    setOpen(true);
  }

  function openEdit(r) {
    setEditing({ ...r });
    setOpen(true);
  }

  function save() {
    partiesUpsert(editing);
    setOpen(false);
    setEditing(null);
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Parties"
        subtitle="Customers & Suppliers • Create/Edit modal • Statement skeleton"
        right={
          <div className="flex items-center gap-2">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { label: "Customers", value: "Customer" },
                { label: "Suppliers", value: "Supplier" }
              ]}
            />
            <GradientButton onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add
            </GradientButton>
          </div>
        }
      />

      <DataTable
        columns={[
          { key: "name", header: "Name" },
          { key: "phone", header: "Phone" },
          { key: "state", header: "State/Region" },
          { key: "balance", header: "Outstanding", render: (r) => money(r.balance) },
          {
            key: "actions",
            header: "Actions",
            render: (r) => (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => nav(`/app/parties/${r.id}/statement`)}
                  className="h-9 w-9 rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 flex items-center justify-center"
                  title="Statement"
                >
                  <FileText className="h-4 w-4" />
                </button>
                <button
                  onClick={() => openEdit(r)}
                  className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => partiesRemove(r.id)}
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
        emptyText="No parties yet"
      />

      <Modal
        open={open}
        title={editing?.id ? "Edit Party" : "Create Party"}
        onClose={() => setOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-2xl border border-slate-100 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              Cancel
            </button>
            <GradientButton onClick={save}>Save</GradientButton>
          </div>
        }
      >
        {editing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Type">
              <select
                value={editing.type}
                onChange={(e) => setEditing((p) => ({ ...p, type: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none"
              >
                <option value="Customer">Customer</option>
                <option value="Supplier">Supplier</option>
              </select>
            </FormField>

            <FormField label="Name">
              <input
                value={editing.name}
                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="Phone">
              <input
                value={editing.phone}
                onChange={(e) => setEditing((p) => ({ ...p, phone: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="Email">
              <input
                value={editing.email}
                onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="State/Region (for GST state compare)">
              <input
                value={editing.state}
                onChange={(e) => setEditing((p) => ({ ...p, state: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>

            <FormField label="Address">
              <input
                value={editing.address || ""}
                onChange={(e) => setEditing((p) => ({ ...p, address: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
                placeholder="Street, city, state"
              />
            </FormField>

            <FormField label="GSTIN (optional)">
              <input
                value={editing.gstin || ""}
                onChange={(e) => setEditing((p) => ({ ...p, gstin: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
                placeholder="15 digit GSTIN"
              />
            </FormField>

            <FormField label="Outstanding Balance" hint="Mock value">
              <input
                value={editing.balance}
                onChange={(e) => setEditing((p) => ({ ...p, balance: e.target.value }))}
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
            </FormField>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
