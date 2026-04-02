import React, { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import Modal from "../../components/Modal";
import { useFinancialYears } from "../../context/FinancialYearContext";
import { useToast } from "../../context/ToastContext";
import { purchasesList, purchasesSyncFromRemote } from "../../services/purchases.service";
import { listBillTdsHistory, summarizeBillTdsByBill } from "../../modules/paymentOut/store";
import {
  createItemBarcodesForPurchase,
  getBarcodeImageUrl,
  listItemBarcodesByPurchaseIds
} from "../../services/itemBarcodes.service";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";
import { compareHistoryDatesDesc, sortHistoryRowsByDate } from "../../lib/historySort";

function money(n) {
  return formatNumberByPreference(Number(n || 0), { maximumFractionDigits: 2 });
}

function formatDate(value) {
  return formatDateByPreference(value, String(value || "-"));
}

function barcodeValueOf(entry) {
  return String(entry?.barcode_value || entry?.barcodeValue || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sortBarcodeRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftLine = Number(left?.lineIndex ?? left?.line_index ?? 0);
    const rightLine = Number(right?.lineIndex ?? right?.line_index ?? 0);
    if (leftLine !== rightLine) return leftLine - rightLine;

    const leftUnit = Number(left?.unitIndex ?? left?.unit_index ?? 0);
    const rightUnit = Number(right?.unitIndex ?? right?.unit_index ?? 0);
    if (leftUnit !== rightUnit) return leftUnit - rightUnit;

    const leftCreated = String(left?.created_at || left?.createdAt || "");
    const rightCreated = String(right?.created_at || right?.createdAt || "");
    if (leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated);

    return barcodeValueOf(left).localeCompare(barcodeValueOf(right));
  });
}

export default function PurchaseHistory() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeRange, selectedYear } = useFinancialYears();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState(() => purchasesList(activeRange));
  const [selectedBill, setSelectedBill] = useState(null);
  const [barcodesByPurchaseId, setBarcodesByPurchaseId] = useState({});
  const [barcodeModalBill, setBarcodeModalBill] = useState(null);
  const [barcodeModalRows, setBarcodeModalRows] = useState([]);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeActionBillId, setBarcodeActionBillId] = useState("");
  const tdsSummaryByBill = useMemo(() => summarizeBillTdsByBill(""), [bills]);
  const selectedBillTdsRows = useMemo(
    () => (selectedBill?.id ? listBillTdsHistory(selectedBill?.country, selectedBill.id) : []),
    [selectedBill]
  );
  const selectedBillTdsTotal = useMemo(
    () => selectedBillTdsRows.reduce((sum, entry) => sum + Number(entry?.tdsAmount || 0), 0),
    [selectedBillTdsRows]
  );
  const sortedBills = useMemo(
    () =>
      sortHistoryRowsByDate(
        bills,
        (bill) => bill?.billDate || bill?.created_at || bill?.createdAt,
        (bill) => bill?.billNumber || bill?.id
      ),
    [bills]
  );
  const sortedSelectedBillTdsRows = useMemo(
    () =>
      [...selectedBillTdsRows].sort((left, right) => {
        const byDate = compareHistoryDatesDesc(
          left?.date || left?.created_at || left?.createdAt,
          right?.date || right?.created_at || right?.createdAt
        );
        if (byDate !== 0) return byDate;
        return String(right?.paymentNo || right?.paymentId || "").localeCompare(
          String(left?.paymentNo || left?.paymentId || ""),
          undefined,
          { numeric: true, sensitivity: "base" }
        );
      }),
    [selectedBillTdsRows]
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const synced = await purchasesSyncFromRemote(activeRange);
        if (!mounted) return;
        setBills(Array.isArray(synced) ? synced : purchasesList(activeRange));
      } catch (error) {
        if (!mounted) return;
        setBills(purchasesList(activeRange));
        toast.error("Failed to load purchase history", error?.message || "Showing local data.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [toast, activeRange?.fromDate, activeRange?.toDate]);

  useEffect(() => {
    let mounted = true;
    async function loadBarcodes() {
      const purchaseIds = (Array.isArray(bills) ? bills : [])
        .map((bill) => String(bill?.id || "").trim())
        .filter(Boolean);
      if (!purchaseIds.length) {
        if (mounted) setBarcodesByPurchaseId({});
        return;
      }
      setBarcodeLoading(true);
      try {
        const rows = await listItemBarcodesByPurchaseIds(purchaseIds);
        if (!mounted) return;
        const nextMap = {};
        rows.forEach((entry) => {
          const purchaseId = String(entry?.purchase_id || entry?.purchaseId || "").trim();
          if (!purchaseId) return;
          if (!nextMap[purchaseId]) nextMap[purchaseId] = [];
          nextMap[purchaseId].push(entry);
        });
        Object.keys(nextMap).forEach((purchaseId) => {
          nextMap[purchaseId] = sortBarcodeRows(nextMap[purchaseId]);
        });
        setBarcodesByPurchaseId(nextMap);
      } catch (error) {
        if (!mounted) return;
        setBarcodesByPurchaseId({});
        toast.warning("Could not load barcodes", error?.message || "Barcode data is unavailable.");
      } finally {
        if (mounted) setBarcodeLoading(false);
      }
    }
    void loadBarcodes();
    return () => {
      mounted = false;
    };
  }, [bills, toast]);

  function openBarcodeModal(bill) {
    const rows = barcodesByPurchaseId[String(bill?.id || "").trim()] || [];
    setBarcodeModalBill(bill || null);
    setBarcodeModalRows(sortBarcodeRows(rows));
  }

  async function regenerateBillBarcodes(bill, { openAfter = false } = {}) {
    const billId = String(bill?.id || "").trim();
    if (!billId) return;
    if (barcodeActionBillId === billId) return;

    const sourceLines = Array.isArray(bill?.lines) ? bill.lines : [];
    const lineCandidates = sourceLines.filter((line) => {
      const itemId = String(line?.itemId || line?.item_id || "").trim();
      const qty = Number(line?.qty ?? line?.quantity ?? 0);
      return itemId && Number.isFinite(qty) && qty > 0;
    });
    if (!lineCandidates.length) {
      toast.warning("Cannot generate", "No valid item lines found for barcode generation.");
      return;
    }

    const previousRows = barcodesByPurchaseId[billId] || [];
    setBarcodeActionBillId(billId);
    try {
      await createItemBarcodesForPurchase({
        purchaseId: billId,
        billDate: bill?.billDate || bill?.created_at || new Date().toISOString().slice(0, 10),
        lines: sourceLines,
        mode: "unit",
        enabled: true,
        repairMissing: true
      });
      const refreshedRows = sortBarcodeRows(await listItemBarcodesByPurchaseIds([billId]));
      setBarcodesByPurchaseId((prev) => ({
        ...prev,
        [billId]: refreshedRows
      }));
      if (openAfter) {
        setBarcodeModalBill(bill || null);
        setBarcodeModalRows(refreshedRows);
      } else if (barcodeModalBill && String(barcodeModalBill?.id || "").trim() === billId) {
        setBarcodeModalRows(refreshedRows);
      }

      const added = Math.max(0, refreshedRows.length - previousRows.length);
      if (added > 0) {
        toast.success("Barcodes generated", `${added} barcode(s) added.`);
      } else if (refreshedRows.length > 0) {
        toast.info("Barcodes already complete", "No missing barcodes found for this bill.");
      } else {
        toast.warning("No barcodes generated", "Could not generate barcodes for this bill.");
      }
    } catch (error) {
      toast.error("Barcode generation failed", error?.message || "Could not regenerate barcodes.");
    } finally {
      setBarcodeActionBillId("");
    }
  }

  function printBarcodes(bill, rows) {
    if (!bill || !Array.isArray(rows) || !rows.length) return;
    const printWindow = window.open("", "_blank", "width=980,height=760");
    if (!printWindow) {
      toast.warning("Popup blocked", "Allow popups to print barcode labels.");
      return;
    }

    const cardsHtml = rows
      .map((entry, index) => {
        const barcodeValue = barcodeValueOf(entry);
        const barcodeImage = getBarcodeImageUrl(barcodeValue);
        const itemId = String(entry?.item_id || entry?.itemId || "").trim();
        const lineMatch = (Array.isArray(bill?.lines) ? bill.lines : []).find(
          (line) => String(line?.itemId || line?.item_id || "").trim() === itemId
        );
        const itemName = lineMatch?.itemName || lineMatch?.name || `Item ${index + 1}`;
        return `
          <article class="label-card">
            <h3>${escapeHtml(itemName)}</h3>
            <p class="meta">Bill: ${escapeHtml(bill?.billNumber || "-")}</p>
            <img class="barcode" src="${barcodeImage}" alt="Barcode ${escapeHtml(barcodeValue)}" />
            <p class="value">${escapeHtml(barcodeValue)}</p>
          </article>
        `;
      })
      .join("");

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Barcode Labels - ${escapeHtml(bill?.billNumber || "")}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 12px; }
            h1 { font-size: 16px; margin: 0 0 12px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            .label-card { border: 1px solid #dbe2ea; border-radius: 10px; padding: 10px; }
            .label-card h3 { margin: 0 0 4px; font-size: 13px; }
            .label-card .meta { margin: 0 0 8px; color: #64748b; font-size: 11px; }
            .label-card .barcode { width: 100%; height: 72px; object-fit: contain; }
            .label-card .value { margin: 6px 0 0; font-size: 11px; font-weight: 600; }
            @media print {
              body { margin: 0; }
              .grid { gap: 8px; }
            }
          </style>
        </head>
        <body>
          <h1>Barcodes - ${escapeHtml(bill?.billNumber || "-")}</h1>
          <section class="grid">${cardsHtml}</section>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Purchase History"
        subtitle={`All saved purchase bills in one place.${selectedYear?.label ? ` FY ${selectedYear.label}` : ""}`}
      />

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
            {sortedBills.length} bills
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
                <th className="px-3 py-3 font-semibold">TDS</th>
                <th className="px-3 py-3 font-semibold">Payment</th>
                <th className="px-3 py-3 font-semibold">Barcodes</th>
                <th className="px-3 py-3 font-semibold min-w-[260px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={10}>
                    Loading purchase history...
                  </td>
                </tr>
              ) : sortedBills.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={10}>
                    No purchase bills yet.
                  </td>
                </tr>
              ) : (
                sortedBills.map((bill) => {
                  const rowBarcodes = barcodesByPurchaseId[String(bill?.id || "").trim()] || [];
                  const hasBarcodes = rowBarcodes.length > 0;
                  const billTdsSummary = tdsSummaryByBill[String(bill?.id || "").trim()] || null;
                  return (
                  <tr
                    key={bill.id}
                    className={`border-t border-slate-100 ${
                      hasBarcodes ? "bg-emerald-50/40 hover:bg-emerald-50/70" : "hover:bg-slate-50/60"
                    }`}
                  >
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      <button
                        type="button"
                        onClick={() => setSelectedBill(bill)}
                        className="text-left text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        {bill.billNumber || "-"}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{formatDate(bill.billDate)}</td>
                    <td className="px-3 py-3 text-slate-700">{bill.partyName || "-"}</td>
                    <td className="px-3 py-3 text-slate-600">{bill.phone || "-"}</td>
                    <td className="px-3 py-3 text-right text-slate-700">{money(bill?.totals?.totalQty)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-900">
                      {money(bill?.totals?.grandTotal)}
                    </td>
                    <td className="px-3 py-3">
                      {billTdsSummary ? (
                        <div className="space-y-1">
                          <p className="font-semibold text-sky-700">{money(billTdsSummary.totalTdsAmount)}</p>
                          <p className="text-xs text-slate-500">Last: {formatDate(billTdsSummary.lastTdsDate)}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No TDS</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{bill.paymentType || "-"}</td>
                    <td className="px-3 py-3">
                      {hasBarcodes ? (
                        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                          {rowBarcodes.length} ready
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">{barcodeLoading ? "Loading..." : "-"}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/app/purchase/bill?billId=${encodeURIComponent(bill.id)}`)
                          }
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (hasBarcodes) {
                              openBarcodeModal(bill);
                              return;
                            }
                            void regenerateBillBarcodes(bill, { openAfter: true });
                          }}
                          disabled={barcodeActionBillId === String(bill?.id || "").trim()}
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {barcodeActionBillId === String(bill?.id || "").trim()
                            ? "Generating..."
                            : hasBarcodes
                              ? "View Barcodes"
                              : "Generate Barcodes"}
                        </button>
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
                );
              })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!barcodeModalBill}
        title={
          barcodeModalBill
            ? `Barcodes - ${barcodeModalBill.billNumber || barcodeModalBill.id || "-"}`
            : "Barcodes"
        }
        onClose={() => {
          setBarcodeModalBill(null);
          setBarcodeModalRows([]);
        }}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (!barcodeModalBill) return;
                void regenerateBillBarcodes(barcodeModalBill, { openAfter: true });
              }}
              disabled={
                !barcodeModalBill ||
                barcodeActionBillId === String(barcodeModalBill?.id || "").trim()
              }
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {barcodeActionBillId === String(barcodeModalBill?.id || "").trim()
                ? "Regenerating..."
                : "Regenerate Barcodes"}
            </button>
            <button
              type="button"
              onClick={() => printBarcodes(barcodeModalBill, barcodeModalRows)}
              disabled={!barcodeModalRows.length}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          </div>
        }
      >
        {barcodeModalBill ? (
          barcodeModalRows.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {barcodeModalRows.map((entry, index) => {
                const barcodeValue = barcodeValueOf(entry);
                const itemId = String(entry?.item_id || entry?.itemId || "").trim();
                const lineMatch = (Array.isArray(barcodeModalBill?.lines) ? barcodeModalBill.lines : []).find(
                  (line) => String(line?.itemId || line?.item_id || "").trim() === itemId
                );
                const itemName = lineMatch?.itemName || lineMatch?.name || `Item ${index + 1}`;
                return (
                  <article key={entry?.id || `${barcodeValue}_${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">{itemName}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{barcodeValue}</p>
                    <img
                      src={getBarcodeImageUrl(barcodeValue)}
                      alt={`Barcode ${barcodeValue}`}
                      className="mt-2 h-20 w-full rounded-md border border-slate-100 bg-white object-contain"
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
              No barcodes available for this bill.
            </div>
          )
        ) : null}
      </Modal>

      <Modal
        open={!!selectedBill}
        title={selectedBill ? `Purchase Bill Details - ${selectedBill.billNumber || "-"}` : "Purchase Bill Details"}
        onClose={() => setSelectedBill(null)}
      >
        {selectedBill ? (
          <div className="space-y-4 text-sm">
            {(() => {
              const billTdsSummary = tdsSummaryByBill[String(selectedBill?.id || "").trim()] || null;
              return billTdsSummary ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                    <p className="text-xs text-sky-700">Total TDS</p>
                    <p className="font-semibold text-sky-900">{money(billTdsSummary.totalTdsAmount)}</p>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                    <p className="text-xs text-sky-700">Last TDS Date</p>
                    <p className="font-semibold text-sky-900">{formatDate(billTdsSummary.lastTdsDate)}</p>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                    <p className="text-xs text-sky-700">Supplier</p>
                    <p className="font-semibold text-sky-900">{billTdsSummary.supplierName || selectedBill.partyName || "-"}</p>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2">
                    <p className="text-xs text-sky-700">TDS Entries</p>
                    <p className="font-semibold text-sky-900">{billTdsSummary.entriesCount}</p>
                  </div>
                </div>
              ) : null;
            })()}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Bill No</p>
                <p className="font-semibold text-slate-900">{selectedBill.billNumber || "-"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Bill Date</p>
                <p className="font-semibold text-slate-900">{formatDate(selectedBill.billDate)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Supplier</p>
                <p className="font-semibold text-slate-900">{selectedBill.partyName || "-"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Phone</p>
                <p className="font-semibold text-slate-900">{selectedBill.phone || "-"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Payment Type</p>
                <p className="font-semibold text-slate-900">{selectedBill.paymentType || "-"}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Created By</p>
                <p className="font-semibold text-slate-900">{selectedBill.createdByName || selectedBill.createdBy || "-"}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Supplier Address</p>
              <p className="font-semibold text-slate-900">{selectedBill.partyAddress || "-"}</p>
            </div>

            <div className="overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-slate-700">Item</th>
                    <th className="px-3 py-2 font-semibold text-slate-700">Code</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Qty</th>
                    <th className="px-3 py-2 font-semibold text-slate-700">Unit</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Rate</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Tax %</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-700">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(selectedBill.lines) ? selectedBill.lines : []).length ? (
                    selectedBill.lines.map((line, index) => (
                      <tr key={line?.id || `${selectedBill.id}_${index}`} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-700">{line?.itemName || "-"}</td>
                        <td className="px-3 py-2 text-slate-700">{line?.itemCode || "-"}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{money(line?.qty)}</td>
                        <td className="px-3 py-2 text-slate-700">{line?.unit || "-"}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{money(line?.rate)}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{money(line?.tax)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900">{money(line?.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-3 py-5 text-center text-slate-500">
                        No line items found for this bill.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Total Qty</p>
                <p className="font-semibold text-slate-900">{money(selectedBill?.totals?.totalQty)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Grand Total</p>
                <p className="font-semibold text-slate-900">{money(selectedBill?.totals?.grandTotal)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Pending Balance</p>
                <p className="font-semibold text-slate-900">{money(selectedBill?.remainingBalance ?? selectedBill?.totals?.balance)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">TDS Tracking</p>
                  <p className="text-xs text-slate-500">Track TDS amount, date, and supplier for this bill.</p>
                </div>
                <div className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                  Total TDS {money(selectedBillTdsTotal)}
                </div>
              </div>

              {sortedSelectedBillTdsRows.length ? (
                <div className="overflow-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Supplier</th>
                        <th className="px-3 py-2 font-semibold">Payment No</th>
                        <th className="px-3 py-2 text-right font-semibold">TDS Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSelectedBillTdsRows.map((entry) => (
                        <tr key={`${entry.paymentId}_${entry.billId}_${entry.paymentNo}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-700">{formatDate(entry?.date)}</td>
                          <td className="px-3 py-2 text-slate-700">{entry?.supplierName || selectedBill?.partyName || "-"}</td>
                          <td className="px-3 py-2 text-slate-600">{entry?.paymentNo || "-"}</td>
                          <td className="px-3 py-2 text-right font-semibold text-sky-700">{money(entry?.tdsAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-3 py-4 text-sm text-slate-500">
                  No TDS tracked for this bill yet.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
