import React, { useEffect, useState, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import InvoicePreview from "../../components/InvoicePreview";
import { apiClient } from "../../services/apiClient";
import { invoicesList, invoicesSyncFromRemote } from "../../services/invoices.service";
import { formatNumberByPreference, formatDateByPreference } from "../../lib/formatPreferences";
import { useToast } from "../../context/ToastContext";

function money(val) {
  return "₹" + formatNumberByPreference(Number(val || 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InvoiceReadOnlyView() {
  const { id: paramId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const invoiceId = paramId || searchParams.get("preview") || searchParams.get("id");
  const openPaymentInitial = searchParams.get("payment") === "true" || searchParams.get("openPayment") === "true";

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Payment Modal State
  const [paymentModalOpen, setPaymentModalOpen] = useState(openPaymentInitial);
  const [additionalAmount, setAdditionalAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [transactionRef, setTransactionRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const loadInvoiceData = async () => {
    if (!invoiceId) {
      setError("No invoice ID provided.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Fetch full details from backend API
      let remoteInv = null;
      try {
        remoteInv = await apiClient.getInvoice(invoiceId);
      } catch (err) {
        console.warn("Backend getInvoice failed, falling back to local store:", err);
      }

      if (remoteInv && (remoteInv.id || remoteInv.invoice_no)) {
        setInvoice(remoteInv);
        setLoading(false);
        return;
      }

      // 2. Fallback to local store or remote sync
      let localInvs = invoicesList();
      let match = localInvs.find((i) => String(i?.id || "") === String(invoiceId) || String(i?.invoiceNo || "") === String(invoiceId));

      if (!match) {
        const synced = await invoicesSyncFromRemote();
        const list = Array.isArray(synced) ? synced : invoicesList();
        match = list.find((i) => String(i?.id || "") === String(invoiceId) || String(i?.invoiceNo || "") === String(invoiceId));
      }

      if (match) {
        setInvoice(match);
      } else {
        setError("Tax Invoice not found.");
      }
    } catch (err) {
      setError(err?.message || "Failed to load tax invoice.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoiceData();
  }, [invoiceId]);

  // Derived Financial Values for Payment Workflow
  const originalTotal = useMemo(() => {
    if (!invoice) return 0;
    return Number(
      invoice?.totals?.grandTotal ??
      invoice?.grand_total ??
      invoice?.totals?.grand_total ??
      0
    );
  }, [invoice]);

  const advancePaid = useMemo(() => {
    if (!invoice) return 0;
    return Number(
      invoice?.advance_received ??
      invoice?.advanceReceived ??
      invoice?.amount_paid ??
      invoice?.amountPaid ??
      invoice?.totals?.advance_received ??
      invoice?.totals?.amount_paid ??
      0
    );
  }, [invoice]);

  const numericAdditional = useMemo(() => {
    const val = Number(additionalAmount);
    return isNaN(val) || val < 0 ? 0 : val;
  }, [additionalAmount]);

  const totalPaid = useMemo(() => {
    return advancePaid + numericAdditional;
  }, [advancePaid, numericAdditional]);

  const balanceDue = useMemo(() => {
    return Math.max(0, originalTotal - totalPaid);
  }, [originalTotal, totalPaid]);

  const paymentStatus = useMemo(() => {
    if (balanceDue <= 0.01 && originalTotal > 0) return "Paid";
    if (totalPaid > 0) return "Partially Paid";
    return "Unpaid";
  }, [balanceDue, originalTotal, totalPaid]);

  const statusBadge = useMemo(() => {
    const st = invoice?.payment_status || (balanceDue <= 0.01 && originalTotal > 0 ? "Paid" : advancePaid > 0 ? "Partially Paid" : "Issued");
    if (st.toLowerCase() === "paid") {
      return { label: "PAID", class: "bg-emerald-100 text-emerald-800 border-emerald-300" };
    }
    if (st.toLowerCase() === "partially paid" || st.toLowerCase() === "partial") {
      return { label: "PARTIALLY PAID", class: "bg-amber-100 text-amber-800 border-amber-300" };
    }
    return { label: "UNPAID", class: "bg-slate-100 text-slate-800 border-slate-300" };
  }, [invoice, balanceDue, originalTotal, advancePaid]);

  // Handle Payment Submit
  const handleRecordPayment = async (e) => {
    e.preventDefault();
    setPaymentError("");

    if (numericAdditional <= 0) {
      setPaymentError("Please enter an additional amount greater than ₹0.");
      return;
    }

    const currentRemaining = Math.max(0, originalTotal - advancePaid);
    if (numericAdditional > currentRemaining + 0.01) {
      setPaymentError(`Additional amount cannot exceed remaining balance of ${money(currentRemaining)}.`);
      return;
    }

    if (!paymentDate) {
      setPaymentError("Please select a payment date.");
      return;
    }

    setSavingPayment(true);
    try {
      const partyId = invoice.party_id || invoice.partyId || invoice.customer_id;
      const invoiceNo = invoice.invoice_no || invoice.invoiceNo;

      const payload = {
        payment_date: paymentDate,
        party_id: partyId || null,
        customer_id: partyId || null,
        amount: numericAdditional,
        amount_received: numericAdditional,
        mode: paymentMethod,
        payment_mode: paymentMethod,
        reference_no: transactionRef ? String(transactionRef).trim() : `PAY-${invoiceNo}`,
        notes: paymentNotes
          ? String(paymentNotes).trim()
          : `Additional payment received for Tax Invoice ${invoiceNo}`,
        allocations: [
          {
            document_id: invoice.id,
            invoice_id: invoice.id,
            document_type: "invoice",
            amount: numericAdditional,
            amount_allocated: numericAdditional
          }
        ]
      };

      await apiClient.createPayment(payload);

      // Re-fetch invoice data to update balance and payments
      await loadInvoiceData();
      await invoicesSyncFromRemote();

      setPaymentModalOpen(false);
      setAdditionalAmount("");
      setTransactionRef("");
      setPaymentNotes("");

      if (toast?.success) {
        toast.success(`Payment of ${money(numericAdditional)} recorded successfully.`);
      } else {
        alert(`Payment of ${money(numericAdditional)} recorded successfully.`);
      }
    } catch (err) {
      console.error("Error creating payment:", err);
      setPaymentError(err?.message || "Failed to record payment. Please try again.");
    } finally {
      setSavingPayment(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-600 border-t-transparent" />
        <p className="text-sm font-semibold text-slate-600">Loading Tax Invoice...</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <h2 className="text-base font-bold text-rose-800">Tax Invoice View Error</h2>
          <p className="mt-1 text-sm text-rose-600">{error || "Invoice not found."}</p>
          <button
            type="button"
            onClick={() => navigate("/app/sales/invoice/history")}
            className="mt-5 inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            ← Return to Tax Invoice History
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100/60 pb-16 print:bg-white print:p-0">
      {/* PRINT STYLES */}
      <style>{`
        @media print {
          nav, aside, header, .no-print, .action-bar {
            display: none !important;
          }
          body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .tax-invoice-view-container {
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {/* TOP READ-ONLY ACTION BAR */}
      <div className="action-bar sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          {/* LEFT: BACK & TITLE */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/app/sales/invoice/history")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <span>←</span>
              <span>Back to Invoice History</span>
            </button>
            <div className="hidden sm:block h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-slate-900">
                {invoice.invoice_no || invoice.invoiceNo || "Tax Invoice"}
              </span>
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${statusBadge.class}`}>
                {statusBadge.label}
              </span>
            </div>
          </div>

          {/* RIGHT: ONLY 3 ACTION BUTTONS (PAYMENT, PRINT/PDF, CLOSE) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAdditionalAmount(balanceDue > 0 ? String(balanceDue) : "");
                setPaymentModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <span>💳</span>
              <span>Payment</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <span>🖨️</span>
              <span>Print / Save PDF</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/app/sales/invoice/history")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
            >
              <span>✕ Close</span>
            </button>
          </div>
        </div>
      </div>

      {/* MASTER A4 TEMPLATE CONTAINER (READ-ONLY DISPLAY) */}
      <div className="tax-invoice-view-container mx-auto max-w-[215mm] p-4 sm:p-6 print:p-0">
        <InvoicePreview
          invoiceData={invoice}
          documentType="TAX INVOICE"
        />
      </div>

      {/* PAYMENT WORKFLOW MODAL */}
      {paymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm print:hidden">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl transition-all">
            {/* MODAL HEADER */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Record Tax Invoice Payment
                </h3>
                <p className="text-xs text-slate-500">
                  {invoice.invoice_no || invoice.invoiceNo} &bull; Issue Date: {formatDateByPreference(invoice.invoice_date || invoice.invoiceDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {/* ERROR ALERT */}
            {paymentError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                {paymentError}
              </div>
            )}

            {/* FINANCIAL SUMMARY CARDS */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Original Invoice Total
                </span>
                <span className="mt-1 block text-sm font-bold text-slate-900">
                  {money(originalTotal)}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Advance Paid
                </span>
                <span className="mt-1 block text-sm font-semibold text-emerald-700">
                  {money(advancePaid)}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 col-span-2 sm:col-span-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Payment Status
                </span>
                <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${
                  paymentStatus === "Paid" ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                  paymentStatus === "Partially Paid" ? "bg-amber-100 text-amber-800 border-amber-300" :
                  "bg-rose-100 text-rose-800 border-rose-300"
                }`}>
                  {paymentStatus}
                </span>
              </div>
            </div>

            {/* DYNAMIC CALCULATION CARDS */}
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 rounded-xl border border-sky-100 bg-sky-50/50 p-2.5">
              <div>
                <span className="block text-[10px] font-semibold uppercase text-sky-800">
                  Total Paid (Auto-Calc)
                </span>
                <span className="mt-0.5 block text-sm font-bold text-sky-950">
                  {money(totalPaid)}
                </span>
              </div>
              <div className="text-right">
                <span className="block text-[10px] font-semibold uppercase text-sky-800">
                  Balance Due (Auto-Calc)
                </span>
                <span className={`mt-0.5 block text-sm font-extrabold ${balanceDue > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                  {money(balanceDue)}
                </span>
              </div>
            </div>

            {/* PAYMENT FORM */}
            <form onSubmit={handleRecordPayment} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Additional Amount Received (₹) <span className="text-rose-500">*</span>
                </label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm font-bold text-slate-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Enter additional payment amount"
                    value={additionalAmount}
                    onChange={(e) => setAdditionalAmount(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-7 pr-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    required
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>Current Remaining: {money(Math.max(0, originalTotal - advancePaid))}</span>
                  {balanceDue > 0 && (
                    <button
                      type="button"
                      onClick={() => setAdditionalAmount(String(Math.max(0, originalTotal - advancePaid)))}
                      className="font-semibold text-emerald-600 hover:underline"
                    >
                      Pay Full Balance
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Payment Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-slate-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Payment Method <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-slate-400"
                  >
                    <option value="Bank Transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                    <option value="UPI">UPI</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Card">Credit / Debit Card</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Transaction Reference <span className="font-normal text-slate-400">(UTR / Cheque No / Ref ID)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. UTR-9823478912"
                  value={transactionRef}
                  onChange={(e) => setTransactionRef(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Payment Notes / Remarks <span className="font-normal text-slate-400">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Final balance settlement"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none transition focus:border-slate-400"
                />
              </div>

              {/* MODAL ACTIONS */}
              <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  disabled={savingPayment}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPayment || numericAdditional <= 0}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingPayment ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Recording...</span>
                    </>
                  ) : (
                    <span>Save Payment</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
