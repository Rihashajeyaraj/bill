import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import { useToast } from "../../context/ToastContext";
import {
  convertPurchaseProforma,
  purchaseProformaGetByIdRemote,
  purchaseProformasList,
  purchaseProformasSyncFromRemote
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

export default function PurchaseProformasList() {
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [convertingId, setConvertingId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [rows, setRows] = useState<any[]>(() => purchaseProformasList());

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const synced = await purchaseProformasSyncFromRemote();
        if (!mounted) return;
        setRows(Array.isArray(synced) ? synced : purchaseProformasList());
      } catch (error: any) {
        if (!mounted) return;
        setRows(purchaseProformasList());
        toast.error("Failed to load Pro Forma Purchase Orders", error?.message || "Showing local data.");
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
      toast.warning("Already converted", "This Pro Forma Purchase Order has already been converted.");
      return;
    }
    if (status === "EXPIRED") {
      toast.warning("Expired Pro Forma Purchase Order", "Expired Pro Forma Purchase Orders cannot be converted.");
      return;
    }
    setConvertingId(String(row?.id || ""));
    try {
      const result = await convertPurchaseProforma(row.id);
      toast.success(
        "Converted to purchase bill",
        result?.billNo ? `Created bill ${result.billNo}.` : "Purchase bill created successfully."
      );
      setRows(await purchaseProformasSyncFromRemote());
      navigate(
        `/app/purchase/history${result?.billId ? `?billId=${encodeURIComponent(result.billId)}` : ""}`
      );
    } catch (error: any) {
      toast.error("Conversion failed", error?.message || "Could not convert Pro Forma Purchase Order.");
    } finally {
      setConvertingId("");
    }
  }

  async function onDownloadPdf(row: any) {
    const recordId = String(row?.id || "");
    if (!recordId) return;
    setDownloadingId(recordId);
    try {
      const fetched = await purchaseProformaGetByIdRemote(recordId);
      const record = fetched || row;
      const lines = Array.isArray(record?.lines) ? record.lines : [];

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 10;
      const right = pageWidth - margin;
      let y = 14;

      const ensureRoom = (requiredHeight = 6) => {
        if (y + requiredHeight <= pageHeight - 12) return;
        doc.addPage();
        y = 14;
      };

      const drawLineItemsHeader = () => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("Item", margin, y);
        doc.text("Qty", 118, y, { align: "right" });
        doc.text("Unit", 134, y, { align: "right" });
        doc.text("Rate", 158, y, { align: "right" });
        doc.text("Tax %", 176, y, { align: "right" });
        doc.text("Amount", right, y, { align: "right" });
        y += 2;
        doc.line(margin, y, right, y);
        y += 4;
      };

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("PRO FORMA PURCHASE ORDER", margin, y);
      y += 7;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`No: ${record?.proformaNo || "-"}`, margin, y);
      doc.text(`Date: ${formatDate(record?.proformaDate)}`, right, y, { align: "right" });
      y += 5;
      doc.text(`Valid Till: ${formatDate(record?.validTill)}`, margin, y);
      doc.text(`Status: ${String(record?.status || "DRAFT").toUpperCase()}`, right, y, { align: "right" });
      y += 6;

      doc.setFont("helvetica", "bold");
      doc.text("Supplier", margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.text(String(record?.partyName || "-"), margin, y);
      y += 5;
      const supplierAddress = String(record?.partyAddress || "").trim() || "-";
      const supplierAddressLines = doc.splitTextToSize(supplierAddress, pageWidth - margin * 2);
      supplierAddressLines.forEach((lineText: string) => {
        ensureRoom(5);
        doc.text(lineText, margin, y);
        y += 4.5;
      });
      y += 2;

      ensureRoom(10);
      drawLineItemsHeader();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      if (!lines.length) {
        ensureRoom(6);
        doc.text("No line items.", margin, y);
        y += 5;
      } else {
        lines.forEach((line: any, index: number) => {
          const description = String(
            line?.description || line?.itemInput || line?.itemName || `Line ${index + 1}`
          ).trim();
          const descriptionLines = doc.splitTextToSize(description || "-", 96);
          const qty = Number(line?.qty || 0);
          const unit = String(line?.unit || "").trim() || "-";
          const rate = Number(line?.rate || line?.unitPrice || 0);
          const taxRate = Number(line?.taxRate || 0);
          const amount = Number(
            line?.lineTotal ??
              Math.max(0, qty * rate + (Math.max(0, qty * rate) * taxRate) / 100)
          );

          const rowHeight = Math.max(5, descriptionLines.length * 4);
          ensureRoom(rowHeight + 2);
          if (y === 14) {
            drawLineItemsHeader();
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
          }

          doc.text(descriptionLines, margin, y);
          doc.text(money(qty), 118, y, { align: "right" });
          doc.text(unit, 134, y, { align: "right" });
          doc.text(money(rate), 158, y, { align: "right" });
          doc.text(money(taxRate), 176, y, { align: "right" });
          doc.text(money(amount), right, y, { align: "right" });
          y += rowHeight;
        });
      }

      y += 3;
      ensureRoom(20);
      doc.line(120, y, right, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Sub Total", 150, y, { align: "right" });
      doc.text(money(record?.totals?.subTotal), right, y, { align: "right" });
      y += 5;
      doc.text("Tax Total", 150, y, { align: "right" });
      doc.text(money(record?.totals?.taxTotal), right, y, { align: "right" });
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.text("Grand Total", 150, y, { align: "right" });
      doc.text(money(record?.totals?.grandTotal), right, y, { align: "right" });

      const filename = String(record?.proformaNo || "proforma-purchase-order").replace(/[^\w.-]+/g, "_");
      doc.save(`${filename}.pdf`);
    } catch (error: any) {
      toast.error("PDF download failed", error?.message || "Could not generate Pro Forma Purchase Order PDF.");
    } finally {
      setDownloadingId("");
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Pro Forma Purchase Orders"
        subtitle="Pro Forma Purchase Orders do not affect stock or accounting until converted."
        right={
          <button
            type="button"
            onClick={() => navigate("/app/purchase/proformas/new")}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            New Pro Forma Purchase Order
          </button>
        }
      />

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Header: PRO FORMA PURCHASE ORDER (Not a Final Bill)</p>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {sortedRows.length} pro forma purchase orders
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[1200px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Pro Forma Purchase Order No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Valid Till</th>
                <th className="px-3 py-3 font-semibold">Supplier</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    Loading Pro Forma Purchase Orders...
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    No Pro Forma Purchase Orders yet.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const status = String(row?.status || "DRAFT").toUpperCase();
                  const converting = String(row?.id || "") === convertingId;
                  const downloading = String(row?.id || "") === downloadingId;
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
                            onClick={() =>
                              navigate(
                                `/app/purchase/proformas/${encodeURIComponent(row.id)}?mode=view`
                              )
                            }
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/app/purchase/proformas/${encodeURIComponent(row.id)}`)}
                            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={converting || status === "CONVERTED" || status === "EXPIRED"}
                            onClick={() => void onConvert(row)}
                            className="rounded-xl border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {converting ? "Converting..." : "Convert to Purchase Bill"}
                          </button>
                          <button
                            type="button"
                            disabled={downloading}
                            onClick={() => void onDownloadPdf(row)}
                            className="rounded-xl border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {downloading ? "Generating..." : "Download PDF"}
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
