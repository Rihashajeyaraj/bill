import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import { useToast } from "../../context/ToastContext";
import { convertSalesProforma, salesProformasList, salesProformasSyncFromRemote } from "../../services/proformas.service";
import { apiClient } from "../../services/apiClient";
import { listPaymentIn } from "../../modules/paymentIn/store";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

function money(value: unknown) {
  return formatNumberByPreference(Number(value || 0), { maximumFractionDigits: 2 });
}

function formatDate(value: unknown) {
  return formatDateByPreference(value as string, String(value || "-"));
}

function toAmount(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export default function SalesProformasList() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [convertingId, setConvertingId] = useState("");
  const [rows, setRows] = useState<any[]>(() => salesProformasList());

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const [remoteFastApi, syncedLocal] = await Promise.all([
        apiClient.getProformas().catch(() => []),
        salesProformasSyncFromRemote().catch(() => [])
      ]);

      const mergedMap = new Map<string, any>();

      // 1. Process local/Supabase records
      const localList = Array.isArray(syncedLocal) && syncedLocal.length > 0 ? syncedLocal : salesProformasList();
      localList.forEach((item: any) => {
        const key = String(item.id || item.proformaNo || item.proforma_no || "").trim();
        if (key) {
          mergedMap.set(key, {
            id: item.id,
            proformaNo: item.proformaNo || item.proforma_no || "-",
            proformaDate: item.proformaDate || item.proforma_date || "",
            validTill: item.validTill || item.valid_till || "",
            dueDate: item.dueDate || item.due_date || "",
            partyName: item.partyName || item.customer_name || (item.customer && (item.customer.display_name || item.customer.name)) || "-",
            totals: item.totals || { grandTotal: Number(item.grand_total || item.amount || 0) },
            appliedAmount: Number(item.appliedAmount || item.amount_paid || 0),
            balanceAmount: Number(item.balanceAmount || 0),
            status: item.status || "DRAFT",
            convertedDocumentId: item.convertedDocumentId || item.converted_document_id || ""
          });
        }
      });

      // 2. Process FastAPI records (takes priority for accurate remote state)
      if (Array.isArray(remoteFastApi)) {
        remoteFastApi.forEach((item: any) => {
          const key = String(item.id || item.proforma_no || "").trim();
          if (key) {
            const customerName = item.customer_name || (item.customer && (item.customer.display_name || item.customer.name)) || item.party_name || "-";
            const grandTotal = Number(item.grand_total ?? item.subtotal ?? 0);
            const amountPaid = Number(item.amount_paid || 0);
            mergedMap.set(key, {
              id: item.id,
              proformaNo: item.proforma_no || item.proformaNo || "-",
              proformaDate: item.proforma_date || item.proformaDate || "",
              validTill: item.valid_till || item.validTill || "",
              dueDate: item.due_date || item.dueDate || "",
              partyName: customerName,
              totals: { grandTotal },
              appliedAmount: amountPaid,
              balanceAmount: Math.max(0, grandTotal - amountPaid),
              status: item.status || "DRAFT",
              convertedDocumentId: item.converted_document_id || item.convertedDocumentId || ""
            });
          }
        });
      }

      setRows(Array.from(mergedMap.values()));
    } catch (error: any) {
      toast.showError("Failed to load Pro Forma Invoices", error?.message || "Showing local data.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const handleConvert = async (proformaId: string) => {
    if (!proformaId) return;
    setConvertingId(proformaId);
    try {
      let res: any;
      try {
        res = await apiClient.convertProforma(proformaId);
      } catch (err) {
        res = await convertSalesProforma(proformaId);
      }
      toast.showSuccess(`Converted Pro Forma to Tax Invoice ${res?.invoice_no || ""} successfully!`);
      await loadRows();
      if (res?.id) {
        navigate(`/app/sales/invoice/history`);
      }
    } catch (err: any) {
      toast.showError(err.message || "Failed to convert Pro Forma to Tax Invoice");
    } finally {
      setConvertingId("");
    }
  };

  const sortedRows = useMemo(() => {
    const payments = listPaymentIn().filter(
      (entry) => String(entry?.status || "").trim().toLowerCase() === "applied"
    );
    const appliedByProformaId = new Map<string, number>();
    const appliedByInvoiceId = new Map<string, number>();

    payments.forEach((payment) => {
      const allocations = Array.isArray(payment?.allocations) ? payment.allocations : [];
      allocations.forEach((line) => {
        const isProforma = String(line?.documentType || "invoice").trim().toLowerCase() === "proforma";
        const documentId = String(line?.invoiceId || "").trim();
        const appliedAmount = Math.max(0, toAmount(line?.applyAmount));
        if (!documentId || appliedAmount <= 0) return;
        if (isProforma) {
          appliedByProformaId.set(
            documentId,
            (appliedByProformaId.get(documentId) || 0) + appliedAmount
          );
          return;
        }
        appliedByInvoiceId.set(
          documentId,
          (appliedByInvoiceId.get(documentId) || 0) + appliedAmount
        );
      });
    });

    return [...rows]
      .map((row) => {
        const totalAmount = Math.max(0, toAmount(row?.totals?.grandTotal ?? row?.totals?.total ?? row?.grandTotal));
        const convertedInvoiceAmount = row?.convertedDocumentId
          ? appliedByInvoiceId.get(String(row.convertedDocumentId || "").trim()) || 0
          : 0;
        const appliedAmount = Math.min(
          totalAmount,
          Math.max(
            row?.appliedAmount || 0,
            (appliedByProformaId.get(String(row?.id || "").trim()) || 0) + convertedInvoiceAmount
          )
        );
        const balanceAmount = Math.max(0, totalAmount - appliedAmount);
        return {
          ...row,
          appliedAmount,
          balanceAmount
        };
      })
      .sort((a, b) => {
        const da = String(a?.proformaDate || "");
        const db = String(b?.proformaDate || "");
        if (da === db) return String(b?.id || "").localeCompare(String(a?.id || ""));
        return db.localeCompare(da);
      });
  }, [rows]);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Pro Forma Invoices"
        subtitle="Pro Forma Invoices do not affect stock or accounting until converted."
        right={
          <button
            type="button"
            onClick={() => navigate("/app/sales/proformas/new")}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            New Pro Forma Invoice
          </button>
        }
      />

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Header: PRO FORMA INVOICE (Not a Tax Invoice)</p>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {sortedRows.length} pro forma invoices
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Pro Forma Invoice No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Valid Till</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold text-right">Paid</th>
                <th className="px-3 py-3 font-semibold text-right">Balance</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    Loading Pro Forma Invoices...
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    No Pro Forma Invoices yet.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const status = String(row?.status || "").toUpperCase();
                  const converted = status === "CONVERTED" || !!String(row?.convertedDocumentId || "").trim();
                  const isConvertingThis = convertingId === row.id;

                  return (
                    <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-3 py-3 font-semibold text-slate-900">{row.proformaNo || "-"}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.proformaDate)}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.validTill)}</td>
                      <td className="px-3 py-3 text-slate-700">{row.partyName || "-"}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900">
                        {money(row?.totals?.grandTotal ?? row?.grandTotal)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-sky-700">
                        {money(row?.appliedAmount)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-semibold ${
                          Number(row?.balanceAmount || 0) <= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {money(row?.balanceAmount)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/app/sales/proformas/${encodeURIComponent(row.id)}?mode=view`)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/app/sales/proformas/${encodeURIComponent(row.id)}`)}
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          {converted ? (
                            <span className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                              Converted
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={isConvertingThis}
                              onClick={() => handleConvert(row.id)}
                              className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {isConvertingThis ? "Converting..." : "Convert to Tax Invoice"}
                            </button>
                          )}
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
