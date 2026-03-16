import React, { useEffect, useMemo, useState } from "react";
import { FileText, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";

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
import { validateContactTax } from "../services/customerTax";

type SummaryFilter = "all" | "balance" | "risk";

export default function Parties() {
  const nav = useNavigate();
  const toast = useToast();
  const { currency = "", profile: organizationProfile = {}, country: organizationCountry = "" } = useOrganization();

  const [tab, setTab] = useState("Customer");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [activeParty, setActiveParty] = useState(null);
  const [actionMenu, setActionMenu] = useState<{
    party: any;
    top: number;
    left: number;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>("all");

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

  const visibleRows = useMemo(() => {
    if (summaryFilter === "all") return rows;
    if (summaryFilter === "balance") {
      return rows.filter(({ financials }) => financials.outstanding > 0);
    }
    return rows.filter(
      ({ financials }) => financials.amountExceeded || financials.maxOverdueDays > 0
    );
  }, [rows, summaryFilter]);

  const summary = useMemo(() => {
    const scoped = parties.filter((party) => party.type === tab);
    let positive = 0;
    let negative = 0;
    let creditRisk = 0;
    scoped.forEach((party) => {
      const financials = computePartyFinancials(party);
      if (financials.outstanding >= 0) positive += financials.outstanding;
      else negative += Math.abs(financials.outstanding);
      if (financials.amountExceeded || financials.maxOverdueDays > 0) creditRisk += 1;
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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-party-actions-root='true']")) return;
      if (target?.closest("[data-party-actions-menu='true']")) return;
      setActionMenu(null);
    }
    window.addEventListener("pointerdown", handleClickOutside);
    return () => window.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  useEffect(() => {
    setActionMenu(null);
  }, [tab, search, loading]);

  useEffect(() => {
    setSummaryFilter("all");
  }, [tab]);

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
    const taxValidation = validateContactTax(party, {
      ...organizationProfile,
      country: organizationCountry || organizationProfile?.country || ""
    });
    if (taxValidation.warning) {
      toast.warning("Tax ID advisory", taxValidation.warning);
    }
    try {
      await upsertPartyRemote(party, actor);
      setRefreshKey((prev) => prev + 1);
      closeModal();
    } catch (error: any) {
      toast.error("Failed to save party", error?.message || "Party was not saved.");
    }
  }

  async function handleDelete(party) {
    if (!window.confirm(`Archive ${party.name}? You can keep full history in backup and audit logs.`)) return;
    try {
      await removePartyRemote(party.id);
      setRefreshKey((prev) => prev + 1);
    } catch (error: any) {
      toast.error("Failed to delete party", error?.message || "Party was not deleted.");
    }
  }

  function toggleSummaryFilter(nextFilter: SummaryFilter) {
    setSummaryFilter((current) => (current === nextFilter ? "all" : nextFilter));
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-24">
      <PageHeader
        title="Parties"
        subtitle="Customers and suppliers with statement tracking"
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
              {tab === "Customer" ? "Add Customer" : "Add Supplier"}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setSummaryFilter("all")}
          className={`rounded-2xl border bg-white p-4 text-left shadow-soft transition cursor-pointer hover:-translate-y-0.5 hover:shadow ${
            summaryFilter === "all" ? "border-slate-900 bg-slate-50" : "border-slate-200"
          }`}
        >
          <p className="text-xs font-semibold text-slate-500">Total {tab}s</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{summary.count}</p>
        </button>
        <button
          type="button"
          onClick={() => toggleSummaryFilter("balance")}
          className={`rounded-2xl border bg-white p-4 text-left shadow-soft transition cursor-pointer hover:-translate-y-0.5 hover:shadow ${
            summaryFilter === "balance" ? "border-slate-900 bg-slate-50" : "border-slate-200"
          }`}
        >
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
        </button>
        <button
          type="button"
          onClick={() => toggleSummaryFilter("risk")}
          className={`rounded-2xl border bg-white p-4 text-left shadow-soft transition cursor-pointer hover:-translate-y-0.5 hover:shadow ${
            summaryFilter === "risk" ? "border-rose-300 bg-rose-50" : "border-slate-200"
          }`}
        >
          <p className="text-xs font-semibold text-slate-500">Credit / Overdue Risk</p>
          <p className="mt-2 text-2xl font-bold text-rose-600">{summary.creditRisk}</p>
          <p className="mt-1 text-xs text-slate-500">Parties exceeding configured rules</p>
        </button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Party Directory</p>
            <p className="text-xs text-slate-500">Search name or phone. Click a row to manage.</p>
          </div>
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or phone"
              className="search-field-input search-field-input-icon h-10 w-full rounded-full border border-slate-200 bg-slate-50 px-10 text-sm outline-none focus:ring-4 focus:ring-slate-200"
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
              ) : visibleRows.length ? (
                visibleRows.map(({ party, financials }) => {
                  const meta = outstandingMeta(party, financials.outstanding);
                  return (
                    <tr key={party.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <p className="font-semibold text-slate-900">{party.name}</p>
                          {financials.creditExceeded ? (
                            <Badge tone="danger">
                              {financials.amountExceeded
                                ? "Amount limit exceeded"
                                : "Overdue days exceeded"}
                            </Badge>
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
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative inline-flex" data-party-actions-root="true">
                          <button
                            type="button"
                            onClick={(event) => {
                              const triggerRect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              const menuWidth = 160;
                              const estimatedMenuHeight = 132;
                              const left = Math.min(
                                window.innerWidth - menuWidth - 8,
                                Math.max(8, triggerRect.right - menuWidth)
                              );
                              const preferredTop = triggerRect.bottom + 4;
                              const top =
                                preferredTop + estimatedMenuHeight > window.innerHeight - 8
                                  ? Math.max(8, triggerRect.top - estimatedMenuHeight - 4)
                                  : preferredTop;
                              setActionMenu((current) =>
                                current?.party?.id === party.id
                                  ? null
                                  : {
                                      party,
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
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={5}>
                    {summaryFilter === "all" ? "No parties found" : "No parties match the selected card filter"}
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

      {actionMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-party-actions-menu="true"
              className="fixed z-[140] w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
              style={{ top: actionMenu.top, left: actionMenu.left }}
            >
              <button
                type="button"
                onClick={() => {
                  const selected = actionMenu.party;
                  setActionMenu(null);
                  nav(`/app/parties/${selected.id}/statement`);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <FileText className="h-3.5 w-3.5" />
                Statement
              </button>
              <button
                type="button"
                onClick={() => {
                  const selected = actionMenu.party;
                  setActionMenu(null);
                  openEdit(selected);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  const selected = actionMenu.party;
                  setActionMenu(null);
                  void handleDelete(selected);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Archive
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
