import React, { useEffect, useMemo, useState } from "react";
import { FileText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import Badge from "../components/Badge";
import PartyFormModal from "../modules/parties/PartyFormModal";
import {
  computePartyFinancials,
  listParties,
  removePartyRemote,
  syncPartiesFromRemote,
  upsertPartyRemote
} from "../modules/parties/store";
import { formatMoney, normalizeText, outstandingMeta } from "../modules/parties/utils";
import { authGetUser } from "../services/auth.service";
import { useOrganization } from "../context/OrganizationContext";
import { useToast } from "../context/ToastContext";

export default function Parties() {
  const nav = useNavigate();
  const toast = useToast();
  const { currency = "" } = useOrganization();

  const [tab, setTab] = useState("Customer");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [activeParty, setActiveParty] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const parties = useMemo(() => listParties(), [refreshKey]);
  const filtered = useMemo(() => {
    const query = normalizeText(search);
    return parties.filter((party) => {
      if (party.type !== tab) return false;
      if (!query) return true;
      const haystack = `${party.name} ${party.phone || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [parties, tab, search]);

  const rows = useMemo(
    () =>
      filtered.map((party) => ({
        party,
        financials: computePartyFinancials(party)
      })),
    [filtered]
  );

  const summary = useMemo(() => {
    const scoped = parties.filter((party) => party.type === tab);
    let positive = 0;
    let negative = 0;
    let creditRisk = 0;
    scoped.forEach((party) => {
      const financials = computePartyFinancials(party);
      if (financials.outstanding >= 0) positive += financials.outstanding;
      else negative += Math.abs(financials.outstanding);
      if (financials.creditExceeded) creditRisk += 1;
    });
    return {
      count: scoped.length,
      positive,
      negative,
      creditRisk
    };
  }, [parties, tab]);

  useEffect(() => {
    let mounted = true;
    async function loadParties() {
      setLoading(true);
      try {
        await syncPartiesFromRemote();
        if (mounted) setRefreshKey((prev) => prev + 1);
      } catch (error: any) {
        toast.error("Failed to load parties", error?.message || "Could not fetch parties from backend.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadParties();
    return () => {
      mounted = false;
    };
  }, [toast]);

  function openCreate() {
    setActiveParty({ type: tab });
    setModalMode("create");
    setModalOpen(true);
  }

  function openEdit(party) {
    setActiveParty(party);
    setModalMode("edit");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveParty(null);
  }

  async function handleSave(party) {
    const actor = authGetUser()?.name || authGetUser()?.email || "System";
    try {
      await upsertPartyRemote(party, actor);
      setRefreshKey((prev) => prev + 1);
      closeModal();
    } catch (error: any) {
      toast.error("Failed to save party", error?.message || "Party was not saved.");
    }
  }

  async function handleDelete(party) {
    if (!window.confirm(`Delete ${party.name}? This cannot be undone.`)) return;
    try {
      await removePartyRemote(party.id);
      setRefreshKey((prev) => prev + 1);
    } catch (error: any) {
      toast.error("Failed to delete party", error?.message || "Party was not deleted.");
    }
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-24">
      <PageHeader
        title="Parties"
        subtitle={`Customers & Suppliers \u2022 Create/Edit modal \u2022 Statement ready`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { label: "Customers", value: "Customer" },
                { label: "Suppliers", value: "Supplier" }
              ]}
            />
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Add Party
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold text-slate-500">Total {tab}s</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{summary.count}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold text-slate-500">
            {tab === "Customer" ? "Total Receivable" : "Total Payable"}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {formatMoney(summary.positive, currency)}
          </p>
          {summary.negative > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              Reverse balance: {formatMoney(summary.negative, currency)}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold text-slate-500">Credit Limit Risk</p>
          <p className="mt-2 text-2xl font-bold text-rose-600">{summary.creditRisk}</p>
          <p className="mt-1 text-xs text-slate-500">Parties exceeding limit</p>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Party Directory</p>
            <p className="text-xs text-slate-500">Search name or phone. Click a row to manage.</p>
          </div>
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or phone"
              className="w-full rounded-full border border-slate-200 bg-slate-50 px-10 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200"
            />
          </label>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Phone</th>
                <th className="px-4 py-3 font-semibold text-slate-700">State / Region</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Outstanding Balance</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={5}>
                    Loading parties...
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map(({ party, financials }) => {
                  const meta = outstandingMeta(party, financials.outstanding);
                  return (
                    <tr key={party.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <p className="font-semibold text-slate-900">{party.name}</p>
                          <p className="text-xs text-slate-500">
                            {party.email || party.country || "No email added"}
                          </p>
                          {financials.creditExceeded ? (
                            <Badge tone="danger">Credit limit exceeded</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {party.phone || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {party.state || party.country || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <p className={`text-base font-semibold ${meta.color}`}>
                            {formatMoney(meta.absolute, currency)}
                          </p>
                          <span
                            className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.badge}`}
                          >
                            {meta.label}
                          </span>
                          <p className="text-xs text-slate-500">
                            Inv {formatMoney(financials.breakdown.invoices, currency)} | Pay{" "}
                            {formatMoney(financials.breakdown.payments, currency)} | Cr{" "}
                            {formatMoney(financials.breakdown.creditNotes, currency)} | Dn{" "}
                            {formatMoney(financials.breakdown.debitNotes, currency)}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => nav(`/app/parties/${party.id}/statement`)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Statement
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(party)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(party)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
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
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={5}>
                    No parties found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PartyFormModal
        open={modalOpen}
        mode={modalMode}
        initialParty={activeParty}
        onClose={closeModal}
        onSave={(party) => {
          void handleSave(party);
        }}
      />
    </div>
  );
}
