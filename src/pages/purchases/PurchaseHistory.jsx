import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import { useToast } from "../../context/ToastContext";
import { purchasesList, purchasesSyncFromRemote } from "../../services/purchases.service";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

function money(n) {
  return formatNumberByPreference(Number(n || 0), { maximumFractionDigits: 2 });
}

function formatDate(value) {
  return formatDateByPreference(value, String(value || "-"));
}

export default function PurchaseHistory() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState(() => purchasesList());

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const synced = await purchasesSyncFromRemote();
        if (!mounted) return;
        setBills(Array.isArray(synced) ? synced : purchasesList());
      } catch (error) {
        if (!mounted) return;
        setBills(purchasesList());
        toast.error("Failed to load purchase history", error?.message || "Showing local data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [toast]);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Purchase History" subtitle="All saved purchase bills in one place." />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/app/purchase/bill")}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Back to Purchase
        </button>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Purchase Bills</h2>
            <p className="text-xs text-slate-500">Review bills and open actions.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {bills.length} bills
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Bill No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Supplier</th>
                <th className="px-3 py-3 font-semibold">Phone</th>
                <th className="px-3 py-3 font-semibold text-right">Qty</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold">Payment</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    Loading purchase history...
                  </td>
                </tr>
              ) : bills.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                    No purchase bills yet.
                  </td>
                </tr>
              ) : (
                bills.map((bill) => (
                  <tr key={bill.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-semibold text-slate-900">{bill.billNumber || "-"}</td>
                    <td className="px-3 py-3 text-slate-600">{formatDate(bill.billDate)}</td>
                    <td className="px-3 py-3 text-slate-700">{bill.partyName || "-"}</td>
                    <td className="px-3 py-3 text-slate-600">{bill.phone || "-"}</td>
                    <td className="px-3 py-3 text-right text-slate-700">{money(bill?.totals?.totalQty)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-900">
                      {money(bill?.totals?.grandTotal)}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{bill.paymentType || "-"}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/app/purchases/payment-out?billId=${encodeURIComponent(bill.id)}`)
                          }
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Payment
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/app/purchase/debit-note?billId=${encodeURIComponent(bill.id)}`)
                          }
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Debit Note
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
