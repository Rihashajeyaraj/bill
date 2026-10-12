import React, { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Building,
  Calendar,
  DollarSign,
  ArrowLeft,
  Printer,
  ExternalLink,
  Hash,
  Clock,
  Ban,
  User,
  Layers,
  Lock,
  Eye,
  Download,
  X,
  FileCheck
} from "lucide-react";
import { apiClient } from "../../services/apiClient";
import { formatNumberByPreference } from "../../lib/formatPreferences";
import InvoicePreview from "../../components/InvoicePreview";

export default function ProformaVerificationView() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isCrossTenantError, setIsCrossTenantError] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const previewContainerRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function verify() {
      if (!token) {
        setError("Missing verification token");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setIsCrossTenantError(false);

      try {
        const res = await apiClient.verifyDocument(token);
        if (!active) return;
        setData(res);
      } catch (err) {
        if (!active) return;
        const errMsg = err?.message || "Failed to verify invoice";
        if (
          errMsg.toLowerCase().includes("cross-tenant") ||
          errMsg.toLowerCase().includes("403") ||
          errMsg.toLowerCase().includes("forbidden")
        ) {
          setIsCrossTenantError(true);
          setError(
            "Cross-tenant invoice access is blocked. You do not have permission to access invoices belonging to another company."
          );
        } else if (
          errMsg.toLowerCase().includes("404") ||
          errMsg.toLowerCase().includes("not found")
        ) {
          setError("Invoice record not found. This invoice may have been removed or does not exist.");
        } else {
          setError(errMsg);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    verify();
    return () => {
      active = false;
    };
  }, [token]);

  const isTaxInvoice = useMemo(() => {
    if (!data) return token?.startsWith("txv_") || token?.startsWith("inv_");
    return data.invoice_type === "TAX_INVOICE";
  }, [data, token]);

  const docNumber = useMemo(() => {
    if (!data) return "";
    return data.invoice_no || data.proforma_no || "INVOICE";
  }, [data]);

  const isCancelled = data?.status === "CANCELLED" || data?.is_cancelled;
  const isConverted = data?.status === "CONVERTED";

  // Build high-fidelity invoice data for InvoicePreview
  const previewData = useMemo(() => {
    if (!data) return null;
    return {
      id: data.id,
      invoice_no: data.invoice_no || data.proforma_no,
      proforma_no: data.proforma_no,
      invoice_date: data.invoice_date || data.proforma_date,
      proforma_date: data.proforma_date,
      due_date: data.due_date,
      valid_till: data.valid_till,
      document_type: data.invoice_type || (isTaxInvoice ? "TAX_INVOICE" : "PRO_FORMA_INVOICE"),
      invoice_type: data.invoice_type,
      currency_code: data.currency_code || "INR",
      currency_symbol: data.currency_symbol || "₹",
      exchange_rate: data.exchange_rate || 1.0,
      roe: data.roe || 1.0,
      items: data.items || [],
      totals: data.totals || {
        subTotal: data.taxable_total,
        taxable_total: data.taxable_total,
        tax_total: data.tax_total || 0,
        grand_total: data.grand_total,
        advance_received: data.advance_received || 0,
        amount_paid: data.amount_paid || 0,
        balance_due: data.balance_due || 0
      },
      seller: data.seller || {
        name: data.company_name,
        company_name: data.company_name,
        gstin: data.company_gstin
      },
      company_name: data.company_name,
      customer: data.customer || {
        name: data.customer_name,
        display_name: data.customer_name
      },
      customer_name: data.customer_name,
      bank: data.bank || {},
      qr_code_image: data.qr_code_image,
      qr_code_url: data.verification_url,
      verification_url: data.verification_url,
      verification_token: data.verification_token,
      status: data.status,
      freight_terms: data.freight_terms || "Collect"
    };
  }, [data, isTaxInvoice]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    try {
      setDownloadingPdf(true);
      const containerEl = document.getElementById("invoice-printable-container");
      if (!containerEl) {
        window.print();
        setDownloadingPdf(false);
        return;
      }

      const html2canvasModule = await import("html2canvas");
      const html2canvas = html2canvasModule.default || html2canvasModule;
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(containerEl, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff"
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, Math.min(pdfHeight, 297));
      const cleanName = docNumber.replace(/[\/\\:]/g, "_");
      pdf.save(`${cleanName}.pdf`);
    } catch (err) {
      console.warn("Falling back to window.print for PDF:", err);
      window.print();
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* Brand Bar */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center space-x-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-tight text-slate-950 uppercase">
                Twite Billing
              </h1>
              <p className="text-[11px] text-slate-500 font-medium">
                Internal Document Verification System
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-2xs hover:bg-slate-50 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            Back
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
            <div className="inline-block h-9 w-9 animate-spin rounded-full border-3 border-sky-600 border-t-transparent mb-4" />
            <h2 className="text-base font-bold text-slate-900">
              Verifying {isTaxInvoice ? "Tax Invoice" : "Pro Forma Invoice"}...
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Validating cryptographic token against authentic database records.
            </p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="bg-white rounded-2xl border border-rose-200 p-8 shadow-xs text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              {isCrossTenantError ? <Lock className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-950">
                {isCrossTenantError ? "Access Denied" : "Verification Failed"}
              </h2>
              <p className="text-xs text-slate-600 mt-1.5 max-w-md mx-auto">
                {error}
              </p>
            </div>
            <div className="pt-2">
              <Link
                to="/app/dashboard"
                className="inline-flex items-center text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 px-4 py-2 rounded-lg shadow-xs transition"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Verified Data State */}
        {!loading && data && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Status Header Banner */}
            {isCancelled ? (
              <div className="bg-gradient-to-r from-rose-500 to-red-600 p-5 text-white flex items-center space-x-3.5">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <Ban className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Invoice Status: CANCELLED</h2>
                  <p className="text-xs text-rose-100">
                    This document is recorded in the system, but has been officially marked as Cancelled.
                  </p>
                </div>
              </div>
            ) : isConverted ? (
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white flex items-center space-x-3.5">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Invoice Status: CONVERTED</h2>
                  <p className="text-xs text-blue-100">
                    This Pro Forma invoice has been successfully converted into an official Tax Invoice.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-5 text-white flex items-center space-x-3.5">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold tracking-tight">
                    Verified Authentic {isTaxInvoice ? "Tax Invoice" : "Pro Forma Invoice"}
                  </h2>
                  <p className="text-xs text-emerald-100">
                    Cryptographic signature and database record match authorized records in Twite Billing.
                  </p>
                </div>
              </div>
            )}

            {/* Verification Metadata Grid */}
            <div className="p-6 space-y-6">
              
              {/* Primary Invoice Details */}
              <div className="grid grid-cols-2 gap-4 pb-5 border-b border-slate-100">
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                    {isTaxInvoice ? "Tax Invoice Number" : "Pro Forma Number"}
                  </span>
                  <span className="text-base font-extrabold text-slate-900 mt-0.5 block">
                    {docNumber}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Document Status
                  </span>
                  <span className={`inline-block mt-0.5 text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                    isCancelled
                      ? "bg-rose-100 text-rose-800"
                      : isConverted
                        ? "bg-blue-100 text-blue-800"
                        : "bg-emerald-100 text-emerald-800"
                  }`}>
                    {data.status || "ISSUED"}
                  </span>
                </div>
              </div>

              {/* Company & Customer Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-150 space-y-1">
                  <div className="flex items-center text-xs font-bold text-slate-700">
                    <Building className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                    Issued By (Company)
                  </div>
                  <p className="text-xs font-extrabold text-slate-900">{data.company_name}</p>
                  {data.company_gstin && (
                    <p className="text-[11px] text-slate-500 font-medium">GSTIN: {data.company_gstin}</p>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-150 space-y-1">
                  <div className="flex items-center text-xs font-bold text-slate-700">
                    <User className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                    Issued To (Customer)
                  </div>
                  <p className="text-xs font-extrabold text-slate-900">{data.customer_name}</p>
                  {data.customer_ref && (
                    <p className="text-[11px] text-slate-500 font-medium">Ref: {data.customer_ref}</p>
                  )}
                </div>
              </div>

              {/* Dates & Financials Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div className="p-3 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Issue Date</span>
                  <span className="text-xs font-bold text-slate-900 block mt-0.5">
                    {data.invoice_date || data.proforma_date || "-"}
                  </span>
                </div>
                <div className="p-3 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                    {isTaxInvoice ? "Due Date" : "Valid Till"}
                  </span>
                  <span className="text-xs font-bold text-slate-900 block mt-0.5">
                    {data.due_date || data.valid_till || "30 Days"}
                  </span>
                </div>
                <div className="p-3 rounded-lg border border-slate-100">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Line Items</span>
                  <span className="text-xs font-bold text-slate-900 block mt-0.5">
                    {data.items_count} Item(s)
                  </span>
                </div>
                <div className="p-3 rounded-lg border border-slate-100 bg-sky-50/50 border-sky-100">
                  <span className="text-[10px] font-semibold text-sky-800 uppercase block">Invoice Total</span>
                  <span className="text-xs font-extrabold text-sky-950 block mt-0.5">
                    {data.currency_symbol || "₹"} {formatNumberByPreference(data.grand_total, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Line Items Summary Table */}
              {data.items && data.items.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Item Details</span>
                    <span className="text-[11px] text-slate-500 font-medium">{data.items.length} row(s)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/70 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-3">#</th>
                          <th className="py-2 px-3">Description</th>
                          <th className="py-2 px-3 text-right">Qty</th>
                          <th className="py-2 px-3 text-right">Rate</th>
                          <th className="py-2 px-3 text-right">Taxable</th>
                          <th className="py-2 px-3 text-right">GST Total</th>
                          <th className="py-2 px-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                            <td className="py-2 px-3 font-medium text-slate-900">{it.description}</td>
                            <td className="py-2 px-3 text-right text-slate-700">{it.qty} {it.unit || ""}</td>
                            <td className="py-2 px-3 text-right text-slate-700">
                              {data.currency_symbol || "₹"}{formatNumberByPreference(it.rate || it.unit_price, { maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-700">
                              ₹{formatNumberByPreference(it.taxable_amount || it.taxable_value || 0, { maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-700">
                              ₹{formatNumberByPreference(it.gst_total || it.tax_amount || 0, { maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-slate-900">
                              ₹{formatNumberByPreference(it.line_total || it.amount_inr || 0, { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Security & Audit Footer */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2 text-[10px] text-slate-500 font-mono">
                <div className="flex items-center justify-between">
                  <span>Unique Document ID:</span>
                  <span className="font-semibold text-slate-700">{data.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Verification Token:</span>
                  <span className="font-semibold text-slate-700 truncate max-w-[280px]">{data.verification_token}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Verification Timestamp:</span>
                  <span className="text-slate-700">{data.verified_at}</span>
                </div>
              </div>

              {/* Legal Notice */}
              <p className="text-[10.5px] text-slate-400 text-center leading-relaxed">
                This verification certifies internal authenticity within Twite Billing.
                This is an internal identification code and not a government-issued GST e-invoice / IRN.
              </p>

              {/* Primary Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2 print:hidden">
                <button
                  type="button"
                  id="btn-view-pdf"
                  onClick={() => setShowPdfModal(true)}
                  className="inline-flex items-center text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 px-4 py-2.5 rounded-xl shadow-xs transition"
                >
                  <Eye className="w-4 h-4 mr-1.5" />
                  View PDF
                </button>

                <button
                  type="button"
                  id="btn-download-pdf"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="inline-flex items-center text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-xl shadow-xs transition disabled:opacity-60"
                >
                  <Download className="w-4 h-4 mr-1.5" />
                  {downloadingPdf ? "Generating PDF..." : "Download PDF"}
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2.5 rounded-xl shadow-2xs transition"
                >
                  <Printer className="w-4 h-4 mr-1.5 text-slate-500" />
                  Print
                </button>

                <Link
                  to="/app/dashboard"
                  className="inline-flex items-center text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-4 py-2.5 rounded-xl transition"
                >
                  Dashboard
                </Link>
              </div>

            </div>
          </div>
        )}

      </div>

      {/* Hidden container for PDF capture & printing */}
      {previewData && (
        <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
          <div
            id="invoice-printable-container"
            style={{ width: "210mm", backgroundColor: "#ffffff", padding: "10mm" }}
          >
            <InvoicePreview
              invoiceData={previewData}
              documentType={previewData.document_type}
            />
          </div>
        </div>
      )}

      {/* View PDF Modal Dialog */}
      {showPdfModal && previewData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex flex-col justify-between overflow-y-auto p-4 sm:p-6">
          <div className="max-w-4xl w-full mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto border border-slate-200">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <FileCheck className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-bold tracking-tight">
                  {isTaxInvoice ? "Tax Invoice" : "Pro Forma Invoice"} Preview — {docNumber}
                </h3>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="inline-flex items-center text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg shadow-xs transition"
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  {downloadingPdf ? "Downloading..." : "Download"}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg transition"
                >
                  <Printer className="w-3.5 h-3.5 mr-1" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setShowPdfModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: A4 Paper Preview */}
            <div className="p-4 sm:p-8 bg-slate-100 overflow-y-auto max-h-[75vh]">
              <div className="bg-white mx-auto shadow-lg rounded-sm max-w-[210mm] border border-slate-200">
                <InvoicePreview
                  invoiceData={previewData}
                  documentType={previewData.document_type}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>Verified against Twite Billing database.</span>
              <button
                type="button"
                onClick={() => setShowPdfModal(false)}
                className="font-bold text-slate-700 hover:text-slate-900"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
