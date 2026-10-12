import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Search, X, Plus, Eye, Printer, AlertTriangle, Lock } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import InvoicePreview from "../../components/InvoicePreview";
import { useToast } from "../../context/ToastContext";
import { useOrganization } from "../../context/OrganizationContext";
import {
  convertSalesProforma,
  salesProformaDelete,
  salesProformaDeleteAll,
  salesProformaGetByIdRemote,
  salesProformasList,
  salesProformasSyncFromRemote
} from "../../services/proformas.service";
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

function buildPreviewData(record: any, company: any) {
  if (!record) return null;
  const companyAddressParts = [
    company?.address?.line1 || company?.address,
    company?.address?.city || company?.city,
    company?.address?.state || company?.state,
    company?.address?.postalCode || company?.postalCode
  ].filter(Boolean);

  const customerObj = record.customer || {};
  const customerName = record.customer_name || record.partyName || customerObj.display_name || customerObj.name || "-";
  const customerAddress = record.customer_address || [customerObj.billing_address_line1, customerObj.city, customerObj.state_name].filter(Boolean).join(", ") || "-";
  const customerState = record.place_of_supply_state || customerObj.state_name || "";
  const customerGstin = record.customer_gstin || customerObj.gstin || "";
  const customerEmail = record.customer_email || customerObj.email || "";
  const customerPhone = record.customer_phone || customerObj.phone || "";
  const customerCountry = record.customer_country || customerObj.country_name || customerObj.country || "India";

  const rawItems = Array.isArray(record.items) && record.items.length > 0
    ? record.items
    : (Array.isArray(record.lines) ? record.lines : []);
    
  const formattedItems = rawItems.map((l: any, idx: number) => {
    const qty = Number(l.qty || 1);
    const rate = Number(l.unit_price ?? l.rate ?? l.unitPrice ?? 0);
    const discAmount = Number(l.discount_amount ?? l.discountAmount ?? 0);
    const taxable = Number(l.taxable_amount ?? l.taxableAmount ?? Math.max(0, qty * rate - discAmount));
    const taxRate = Number(l.tax_rate ?? l.taxRate ?? 0);
    const cgstAmount = Number(l.cgst_amount ?? l.cgstAmount ?? 0);
    const sgstAmount = Number(l.sgst_amount ?? l.sgstAmount ?? 0);
    const igstAmount = Number(l.igst_amount ?? l.igstAmount ?? 0);
    const vatAmount = Number(l.vat_amount ?? l.vatAmount ?? 0);
    const lineTax = cgstAmount + sgstAmount + igstAmount + vatAmount;
    const lineTotal = Number(l.line_total ?? l.lineTotal ?? (taxable + lineTax));

    return {
      id: l.id || `line_${idx}`,
      name: l.description || l.itemName || "Item",
      description: l.description || "",
      hsn: l.hsn_sac || l.hsnSac || "",
      hsn_sac: l.hsn_sac || l.hsnSac || "",
      qty,
      unit: l.unit || "PCS",
      rate,
      unit_price: rate,
      discount: discAmount,
      discount_amount: discAmount,
      discount_percent: Number(l.discount_percent ?? l.discountPercent ?? 0),
      currency: l.currency || record.currency_code || record.currencyCode || "INR",
      placeOfSupply: l.place_of_supply || record.place_of_supply_state || "",
      cgstRate: Number(l.cgst_rate ?? l.cgstRate ?? (cgstAmount > 0 ? taxRate / 2 : 0)),
      sgstRate: Number(l.sgst_rate ?? l.sgstRate ?? (sgstAmount > 0 ? taxRate / 2 : 0)),
      igstRate: Number(l.igst_rate ?? l.igstRate ?? (igstAmount > 0 ? taxRate : 0)),
      cgstAmount,
      sgstAmount,
      igstAmount,
      taxMode: igstAmount > 0 ? "IGST" : (cgstAmount > 0 ? "GST" : "NONE"),
      taxAmount: lineTax,
      amountInr: qty * rate,
      taxableValue: taxable,
      taxable_amount: taxable,
      amount: lineTotal,
      net: lineTotal
    };
  });

  const totals = record.totals || {};
  const grandTotal = Number(record.grand_total ?? record.grandTotal ?? totals.grandTotal ?? 0);
  const subTotal = Number(record.subtotal ?? totals.subTotal ?? record.taxable_total ?? totals.taxableTotal ?? grandTotal);
  const discountTotal = Number(record.discount_total ?? totals.discountTotal ?? 0);
  const cgstTotal = Number(record.cgst_total ?? totals.cgst ?? 0);
  const sgstTotal = Number(record.sgst_total ?? totals.sgst ?? 0);
  const igstTotal = Number(record.igst_total ?? totals.igst ?? 0);
  const taxTotal = Number(record.tax_total ?? totals.taxTotal ?? (cgstTotal + sgstTotal + igstTotal));
  const amountPaid = Number(record.amount_paid ?? record.appliedAmount ?? totals.amountPaid ?? 0);
  const balanceDue = Math.max(0, grandTotal - amountPaid);

  return {
    title: "PRO FORMA INVOICE",
    isProforma: true,
    companyName: company?.companyName || company?.name || "",
    companyAddress: companyAddressParts.join(", "),
    companyGstin: company?.tax?.gstin || company?.gstin || "",
    companyPan: company?.pan || "",
    companyPhone: company?.phone || "",
    companyState: company?.address?.state || company?.state || "",
    companyLogoUrl: company?.logoBase64 || company?.logo_url || company?.logoUrl || "",
    companySignatureUrl: company?.signatureUrl || company?.signatureBase64 || company?.settings?.signatureUrl || "",
    company: {
      ...(company || {}),
      logo_url: company?.logoBase64 || company?.logo_url || company?.logoUrl || "",
      signature_url: company?.signatureUrl || company?.signatureBase64 || company?.settings?.signatureUrl || ""
    },
    seller: {
      name: company?.companyName || company?.name || "",
      address: companyAddressParts.join(", "),
      gstin: company?.tax?.gstin || company?.gstin || "",
      phone: company?.phone || "",
      logoUrl: company?.logoBase64 || company?.logo_url || company?.logoUrl || "",
      signatureUrl: company?.signatureUrl || company?.signatureBase64 || company?.settings?.signatureUrl || ""
    },

    customerName,
    customerAddress,
    customerState,
    customerGstin,
    customerEmail,
    customerPhone,
    customerCountry,

    invoiceNo: record.proforma_no || record.proformaNo || "",
    proformaNo: record.proforma_no || record.proformaNo || "",
    invoiceDate: record.proforma_date || record.proformaDate || "",
    proformaDate: record.proforma_date || record.proformaDate || "",
    validTill: record.valid_till || record.validTill || "",
    dueDate: record.due_date || record.dueDate || "",
    customerRef: record.customer_ref || record.customerRef || "",
    placeOfSupply: record.place_of_supply_state || record.placeOfSupply || customerState,
    currencyCode: record.currency_code || record.currencyCode || "INR",
    exchangeRate: String(record.exchange_rate || record.exchangeRate || "1.00"),

    shipperName: record.shipper_name || record.shipperName,
    consigneeName: record.consignee_name || record.consigneeName,
    origin: record.origin,
    destination: record.destination,
    packsQty: record.packs_qty || record.packsQty,
    weightKgs: record.weight_kgs || record.weightKgs,
    volumeCbm: record.volume_cbm || record.volumeCbm,
    freightTerms: record.freight_terms || record.freightTerms,

    blNumber: record.bl_number || record.blNumber,
    thblNumber: record.thbl_number || record.thblNumber,
    mblNumber: record.mbl_number || record.mblNumber,
    oceanBlNo: record.ocean_bl_no || record.oceanBlNo,
    vesselName: record.vessel_name || record.vesselName,
    voyageNo: record.voyage_no || record.voyageNo,
    etdDate: record.etd_date || record.etdDate,
    etaDate: record.eta_date || record.etaDate,

    igmNo: record.igm_no || record.igmNo,
    igmItemNo: record.igm_item_no || record.igmItemNo,
    fileNo: record.file_no || record.fileNo,
    salesRep: record.sales_rep || record.salesRep,
    rcmApplicable: Boolean(record.rcm_applicable || record.rcmApplicable),
    containerDetails: record.container_details || record.containerDetails,

    notes: record.notes,
    terms: record.terms,

    bankDetails: {
      accountName: company?.bankDetails?.accountName || company?.settings?.bankDetails?.accountName || company?.name || company?.companyName || "",
      bankName: company?.bankDetails?.bankName || company?.settings?.bankDetails?.bankName || company?.bankName || "",
      accountNo: company?.bankDetails?.accountNo || company?.settings?.bankDetails?.accountNo || company?.accountNo || "",
      ifsc: company?.bankDetails?.ifsc || company?.settings?.bankDetails?.ifsc || company?.ifsc || "",
      swift: company?.bankDetails?.swift || company?.settings?.bankDetails?.swift || company?.swift || "",
      iban: company?.bankDetails?.iban || company?.settings?.bankDetails?.iban || company?.iban || "",
      address: company?.bankDetails?.bankAddress || company?.settings?.bankDetails?.bankAddress || ""
    },

    items: formattedItems,
    totals: {
      grossSubTotal: subTotal + discountTotal,
      discountTotal,
      subTotal,
      taxableTotal: subTotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      taxTotal,
      total: grandTotal,
      grandTotal,
      amountPaid,
      balanceDue
    },
    amountPaid,
    balanceDue,
    grand_total_in_words: record.grand_total_in_words || ""
  };
}

export default function SalesProformasList() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile: company = {} } = useOrganization();
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [convertingId, setConvertingId] = useState("");
  const [confirmConvertModal, setConfirmConvertModal] = useState<any>(null);

  // View PDF Modal State
  const [viewModalRow, setViewModalRow] = useState<any>(null);
  const [viewFullRecord, setViewFullRecord] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [rows, setRows] = useState<any[]>(() => salesProformasList());

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      let proformaRecords: any[] = [];
      let fastApiSuccess = false;

      // 1. Primary: FastAPI backend (batch-loaded parties, avoids duplicate line items download)
      try {
        const remoteFastApi = await apiClient.getProformas();
        if (Array.isArray(remoteFastApi) && remoteFastApi.length > 0) {
          fastApiSuccess = true;
          proformaRecords = remoteFastApi.map((item: any) => {
            const pNo = item.proforma_no || item.proformaNo || "";
            const customerName = item.customer_name || (item.customer && (item.customer.display_name || item.customer.name)) || item.party_name || "-";
            const grandTotal = Number(item.grand_total ?? item.subtotal ?? 0);
            const amountPaid = Number(item.amount_paid || 0);
            return {
              id: item.id,
              proformaNo: pNo || "-",
              proformaDate: item.proforma_date || item.proformaDate || "",
              validTill: item.valid_till || item.validTill || "",
              dueDate: item.due_date || item.dueDate || "",
              partyName: customerName,
              totals: { grandTotal },
              appliedAmount: amountPaid,
              balanceAmount: Math.max(0, grandTotal - amountPaid),
              status: item.status || "DRAFT",
              templateId: item.template_id || item.templateId || "new_globe_export",
              convertedDocumentId: item.converted_document_id || item.convertedDocumentId || "",
              convertedInvoiceNo: item.converted_invoice_no || item.convertedInvoiceNo || item.invoice_no || ""
            };
          });
        }
      } catch (err) {
        console.warn("FastAPI proformas fetch failed, using fallback:", err);
      }

      // 2. Fallback: remote sync or local storage if primary was empty/failed
      if (!fastApiSuccess) {
        const syncedLocal = await salesProformasSyncFromRemote().catch(() => []);
        const localList = Array.isArray(syncedLocal) && syncedLocal.length > 0 ? syncedLocal : salesProformasList();
        proformaRecords = localList.map((item: any) => {
          const pNo = item.proformaNo || item.proforma_no || "";
          return {
            id: item.id,
            proformaNo: pNo || "-",
            proformaDate: item.proformaDate || item.proforma_date || "",
            validTill: item.validTill || item.valid_till || "",
            dueDate: item.dueDate || item.due_date || "",
            partyName: item.partyName || item.customer_name || (item.customer && (item.customer.display_name || item.customer.name)) || "-",
            totals: item.totals || { grandTotal: Number(item.grand_total || item.amount || 0) },
            appliedAmount: Number(item.appliedAmount || item.amount_paid || 0),
            balanceAmount: Number(item.balanceAmount || 0),
            status: item.status || "DRAFT",
            templateId: item.templateId || item.template_id || "new_globe_export",
            convertedDocumentId: item.convertedDocumentId || item.converted_document_id || "",
            convertedInvoiceNo: item.convertedInvoiceNo || item.converted_invoice_no || item.invoice_no || ""
          };
        });
      }

      setRows(proformaRecords);
    } catch (error: any) {
      toast.showError("Failed to load Pro Forma Invoices", error?.message || "Showing local data.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const handleView = async (row: any) => {
    setViewModalRow(row);
    setViewLoading(true);
    try {
      let fullRec: any = null;
      try {
        fullRec = await apiClient.getProforma(row.id);
      } catch {
        fullRec = await salesProformaGetByIdRemote(row.id);
      }
      setViewFullRecord(fullRec || row);
    } catch {
      setViewFullRecord(row);
    } finally {
      setViewLoading(false);
    }
  };

  const queryClient = useQueryClient();

  const handleConvert = async (proformaId: string) => {
    if (!proformaId) return;
    setConvertingId(proformaId);
    try {
      const res: any = await apiClient.convertProforma(proformaId);
      const invNo = res?.invoice_no || res?.invoiceNo || "";
      const invId = res?.id || res?.invoice_id || res?.invoiceId;

      toast.showSuccess(`Tax Invoice ${invNo ? invNo : ""} created successfully!`);

      // Invalidate TanStack Query keys
      try {
        queryClient.invalidateQueries({ queryKey: ["proformas"] });
        queryClient.invalidateQueries({ queryKey: ["proforma"] });
        queryClient.invalidateQueries({ queryKey: ["tax_invoices"] });
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        queryClient.invalidateQueries({ queryKey: ["payments"] });
        queryClient.invalidateQueries({ queryKey: ["pending-documents"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["reports"] });
      } catch (_) {}

      await loadRows();

      if (invId) {
        navigate(`/app/sales/invoice?preview=${encodeURIComponent(invId)}`);
      } else {
        navigate(`/app/sales/invoice/history`);
      }
    } catch (err: any) {
      toast.showError(err.message || "Failed to convert Pro Forma to Tax Invoice");
    } finally {
      setConvertingId("");
    }
  };

  const handleDelete = async (proformaId: string) => {
    if (!proformaId) return;
    if (!window.confirm("Are you sure you want to delete this Pro Forma Invoice?")) return;
    try {
      await apiClient.deleteProforma(proformaId).catch(() => {});
      await salesProformaDelete(proformaId);
      toast.showSuccess("Pro Forma Invoice deleted successfully!");
      await loadRows();
    } catch (err: any) {
      toast.showError(err.message || "Failed to delete Pro Forma Invoice");
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm("Are you sure you want to remove ALL Pro Forma Invoices? This action cannot be undone.")) return;
    setDeleting(true);
    try {
      await apiClient.deleteAllProformas().catch(() => {});
      await salesProformaDeleteAll();
      setRows([]);
      toast.showSuccess("All Pro Forma Invoices removed successfully!");
      await loadRows();
    } catch (err: any) {
      toast.showError(err.message || "Failed to remove Pro Forma Invoices");
    } finally {
      setDeleting(false);
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

  const filteredRows = useMemo(() => {
    return sortedRows.filter((row) => {
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const matchNo = String(row.proformaNo || "").toLowerCase().includes(q);
        const matchCustomer = String(row.partyName || "").toLowerCase().includes(q);
        if (!matchNo && !matchCustomer) return false;
      }

      const status = String(row.status || "").toUpperCase();
      const isConverted = status === "CONVERTED" || !!row.convertedDocumentId;
      if (statusFilter === "DRAFT" && isConverted) return false;
      if (statusFilter === "CONVERTED" && !isConverted) return false;
      return true;
    });
  }, [sortedRows, searchQuery, statusFilter]);

  const previewInvoiceData = useMemo(() => {
    if (!viewFullRecord) return null;
    return buildPreviewData(viewFullRecord, company);
  }, [viewFullRecord, company]);

  const unlinkedCount = useMemo(() => {
    return sortedRows.filter((r) => r.needs_customer_link || (!r.customer_id && !r.party_id)).length;
  }, [sortedRows]);

  return (
    <div className="max-w-6xl space-y-6">
      {unlinkedCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800 text-sm flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <span className="font-bold">Attention Required:</span> {unlinkedCount} legacy Pro Forma invoice(s) are missing a linked Customer. Click <strong>Edit</strong> on affected invoices to link a Customer so billing snapshots, payment tracking, and PDFs work properly.
            </div>
          </div>
        </div>
      )}

      <PageHeader
        title="Pro Forma Invoices"
        subtitle="Pro Forma Invoices do not affect stock or accounting until converted."
        className=""
        right={
          <div className="flex items-center gap-3">
            {sortedRows.length > 0 && (
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteAll}
                className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                {deleting ? "Removing..." : "Remove All Data"}
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate("/app/sales/proformas/new")}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              New Pro Forma Invoice
            </button>
          </div>
        }
      />

      <Card className="p-5">
        {/* SEARCH & FILTERS BAR */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search Pro Forma (No, Customer)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-sky-500 transition-all shadow-2xs"
            >
              <option value="ALL">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="CONVERTED">Converted</option>
            </select>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 shrink-0">
              {filteredRows.length} {filteredRows.length === 1 ? "invoice" : "invoices"}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Pro Forma Invoice No</th>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Valid Till</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold text-right">Status</th>
                <th className="px-3 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    Loading Pro Forma Invoices...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                    No Pro Forma Invoices found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const status = String(row?.status || "").toUpperCase();
                  const converted = status === "CONVERTED" || !!String(row?.convertedDocumentId || "").trim();
                  const isConvertingThis = convertingId === row.id;

                  return (
                    <tr key={row.id} className={`border-t border-slate-100 ${converted ? "bg-slate-50/70" : "hover:bg-slate-50/70"}`}>
                      <td className="px-3 py-3 font-semibold text-slate-900">
                        {converted ? <Lock className="w-3.5 h-3.5 text-slate-400 inline mr-1" /> : null}
                        {row.proformaNo || "-"}
                      </td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.proformaDate)}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.validTill)}</td>
                      <td className="px-3 py-3 text-slate-700">{row.partyName || "-"}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900">
                        {money(row?.totals?.grandTotal ?? row?.grandTotal)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {converted ? (
                          <button
                            type="button"
                            onClick={() => {
                              const docId = row.converted_document_id || row.convertedDocumentId;
                              if (docId) {
                                navigate(`/app/sales/invoice?preview=${encodeURIComponent(docId)}`);
                              } else {
                                navigate("/app/sales/invoice/history");
                              }
                            }}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300 transition-all cursor-pointer"
                            title="View Converted Tax Invoice"
                          >
                            Converted &rarr; {row.convertedInvoiceNo || "INV"}
                          </button>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-800">
                            Draft
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* VIEW BUTTON */}
                          <button
                            type="button"
                            onClick={() => handleView(row)}
                            className="rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-all flex items-center gap-1"
                            title="View A4 Template Preview"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </button>
                          
                          {/* EDIT BUTTON (Disabled if converted) */}
                          <button
                            type="button"
                            disabled={converted}
                            onClick={() => !converted && navigate(`/app/sales/proformas/${encodeURIComponent(row.id)}`)}
                            className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-all ${
                              converted
                                ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed opacity-50"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs"
                            }`}
                            title={converted ? "Proforma is converted and locked" : "Edit"}
                          >
                            Edit
                          </button>

                          {/* CONVERT BUTTON (Disabled if converted) */}
                          <button
                            type="button"
                            disabled={converted || isConvertingThis}
                            onClick={() => !converted && setConfirmConvertModal(row)}
                            className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-all ${
                              converted
                                ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed opacity-50"
                                : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            }`}
                            title={converted ? "Already converted" : "Convert"}
                          >
                            {isConvertingThis ? "Converting..." : "Convert"}
                          </button>
                          
                          {/* DELETE BUTTON (Disabled if converted) */}
                          <button
                            type="button"
                            disabled={converted}
                            onClick={() => !converted && handleDelete(row.id)}
                            className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-all ${
                              converted
                                ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed opacity-50"
                                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                            }`}
                            title={converted ? "Converted proforma cannot be deleted" : "Delete"}
                          >
                            Delete
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

      {/* A4 PDF PREVIEW MODAL */}
      {viewModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-slate-100 rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh]">
            {/* MODAL HEADER */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 rounded-t-2xl shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    Pro Forma Invoice Preview - {viewModalRow.proformaNo || "-"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    A4 PDF Template view for {viewModalRow.partyName || "Customer"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-2xs flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4 text-slate-500" />
                  Print / Save PDF
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setViewModalRow(null);
                    setViewFullRecord(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 rounded-xl p-1.5 hover:bg-slate-100 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* MODAL BODY */}
            <div className="p-6 overflow-y-auto flex-1 flex justify-center bg-slate-100">
              {viewLoading ? (
                <div className="py-20 text-center text-slate-500">Loading Pro Forma Preview...</div>
              ) : previewInvoiceData ? (
                <div className="w-full max-w-[210mm] bg-white shadow-xl rounded-lg p-6 sm:p-8 border border-slate-200">
                  <InvoicePreview
                    templateId={viewModalRow.templateId || viewFullRecord?.template_id || "new_globe_export"}
                    styleConfig={{}}
                    invoiceData={previewInvoiceData}
                    documentType="PRO FORMA INVOICE"
                  />
                </div>
              ) : (
                <div className="py-20 text-center text-slate-500">Failed to render template preview.</div>
              )}
            </div>

            {/* MODAL FOOTER */}
            <div className="px-6 py-3 bg-white border-t border-slate-200 rounded-b-2xl flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500">A4 Document Layout</span>
              <button
                type="button"
                onClick={() => {
                  setViewModalRow(null);
                  setViewFullRecord(null);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition-all border border-slate-200"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONVERSION CONFIRMATION MODAL */}
      {confirmConvertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-lg">Convert Pro Forma?</h3>
              <button
                type="button"
                onClick={() => setConfirmConvertModal(null)}
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
              <p><strong className="text-slate-900 font-semibold">Pro Forma:</strong> {confirmConvertModal.proformaNo || "-"}</p>
              <p><strong className="text-slate-900 font-semibold">Customer:</strong> {confirmConvertModal.partyName || "-"}</p>
              <p><strong className="text-slate-900 font-semibold">Amount:</strong> {money(confirmConvertModal?.totals?.grandTotal ?? confirmConvertModal?.grandTotal)}</p>
            </div>
            <p className="text-xs text-slate-500">
              This will generate an official Tax Invoice in Supabase and update the Pro Forma status to Converted.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmConvertModal(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition-all border border-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={convertingId === confirmConvertModal.id}
                onClick={async () => {
                  const targetId = confirmConvertModal.id;
                  setConfirmConvertModal(null);
                  await handleConvert(targetId);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                Convert to Tax Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
