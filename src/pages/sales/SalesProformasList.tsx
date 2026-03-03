import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import { useToast } from "../../context/ToastContext";
import {
  convertSalesProforma,
  salesProformasList,
  salesProformasSyncFromRemote
} from "../../services/proformas.service";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

function money(value: unknown) {
  return formatNumberByPreference(Number(value || 0), { maximumFractionDigits: 2 });
}

function formatDate(value: unknown) {
  return formatDateByPreference(value as string, String(value || "-"));
}

function statusClass(statusRaw: string) {
  const status = String(statusRaw || "").toUpperCase();
  if (status === "CONVERTED") return "bg-emerald-100 text-emerald-700";
  if (status === "EXPIRED") return "bg-rose-100 text-rose-700";
  if (status === "APPROVED") return "bg-blue-100 text-blue-700";
  if (status === "SENT") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function SalesProformasList() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [convertingId, setConvertingId] = useState("");
  const [rows, setRows] = useState<any[]>(() => salesProformasList());

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const synced = await salesProformasSyncFromRemote();
        if (!mounted) return;
        setRows(Array.isArray(synced) ? synced : salesProformasList());
      } catch (error: any) {
        if (!mounted) return;
        setRows(salesProformasList());
        toast.error("Failed to load sales proformas", error?.message || "Showing local data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [toast]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const da = String(a?.proformaDate || "");
      const db = String(b?.proformaDate || "");
      if (da === db) return String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""));
      return db.localeCompare(da);
    });
  }, [rows]);

  async function onConvert(row: any) {
    const status = String(row?.status || "").toUpperCase();
    if (status === "CONVERTED") {
      toast.warning("Already converted", "This proforma has already been converted.");
      return;
    }
    if (status === "EXPIRED") {
      toast.warning("Expired proforma", "Expired proformas cannot be converted.");
      return;
    }
    setConvertingId(String(row?.id || ""));
    try {
      const result = await convertSalesProforma(row.id);
      toast.success(
        "Converted to invoice",
        result?.invoiceNo ? `Created invoice ${result.invoiceNo}.` : "Invoice created successfully."
      );
      setRows(await salesProformasSyncFromRemote());
      navigate(
        `/app/sales/invoice/history${result?.invoiceId ? `?invoiceId=${encodeURIComponent(result.invoiceId)}` : ""}`
      );
    } catch (error: any) {
      toast.error("Conversion failed", error?.message || "Could not convert sales proforma.");
    } finally {
      setConvertingId("");
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Sales Proformas"
        subtitle="Proforma invoices do not affect stock or accounting until converted."
        right={
          <button
            type="button"
            onClick={() => navigate("/app/sales/proformas/new")}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            New Proforma
          </button>
        }
      />

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Header: PROFORMA INVOICE (Not a Tax Invoice)</p>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {sortedRows.length} proformas
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Proforma No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Valid Till</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    Loading sales proformas...
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    No sales proformas yet.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const status = String(row?.status || "DRAFT").toUpperCase();
                  const converting = String(row?.id || "") === convertingId;
                  return (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-3 py-3 font-semibold text-slate-900">{row.proformaNo || "-"}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.proformaDate)}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.validTill)}</td>
                      <td className="px-3 py-3 text-slate-700">{row.partyName || "-"}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900">
                        {money(row?.totals?.grandTotal)}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(status)}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/app/sales/proformas/${encodeURIComponent(row.id)}`)}
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            View/Edit
                          </button>
                          <button
                            type="button"
                            disabled={converting || status === "CONVERTED" || status === "EXPIRED"}
                            onClick={() => void onConvert(row)}
                            className="rounded-xl border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {converting ? "Converting..." : "Convert to Invoice"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
