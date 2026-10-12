import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Search, Plus, X, RotateCcw, Download, Filter, ChevronDown, ChevronUp,
  FileText, Calendar, CheckCircle2, AlertCircle, Clock, Eye, Printer,
  FileSpreadsheet, ShieldAlert, ArrowUpDown, ChevronRight, User, MoreVertical,
  Check, CreditCard, Building, Building2, ExternalLink, RefreshCw, Users,
  Layers, ArrowRight, Sparkles, AlertTriangle
} from "lucide-react";
import { apiClient } from "../../services/apiClient";
import { useOrganization } from "../../context/OrganizationContext";
import { exportPaymentInCsv, exportPaymentInSummaryPdf, exportSinglePaymentInPdf } from "../../modules/paymentIn/pdf";

// --- Helper Functions ---
function formatINR(val: number | string | null | undefined): string {
  const num = Number(val ?? 0);
  if (isNaN(num)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Compute Indian Financial Year dates
function getFinancialYearDates(fyKey: string) {
  const today = new Date();
  let year = today.getFullYear();
  const month = today.getMonth() + 1; // 1-12
  if (month < 4) year -= 1; // FY starts in April

  if (fyKey === "current") {
    return {
      fromDate: `${year}-04-01`,
      toDate: `${year + 1}-03-31`
    };
  } else if (fyKey === "previous") {
    return {
      fromDate: `${year - 1}-04-01`,
      toDate: `${year}-03-31`
    };
  } else if (fyKey === "all") {
    return { fromDate: "", toDate: "" };
  }
  return { fromDate: `${year}-04-01`, toDate: `${year + 1}-03-31` };
}

// Payment Status Badge Styling
function StatusBadge({ status, isReversed }: { status: string; isReversed?: boolean }) {
  if (isReversed || status?.toLowerCase().includes("reverse") || status?.toLowerCase().includes("cancel")) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
        Reversed
      </span>
    );
  }
  const s = status?.toLowerCase() || "";
  if (s === "fully applied" || s === "applied" || s === "paid") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
        Paid
      </span>
    );
  }
  if (s === "partially applied" || s === "partial" || s === "partially paid") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
        Partially Paid
      </span>
    );
  }
  if (s === "overdue") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
        Overdue
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
      Unpaid
    </span>
  );
}

export default function PaymentInPremium() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();

  // --- View Mode: invoices | customers | receipts ---
  const [viewMode, setViewMode] = useState<"invoices" | "customers" | "receipts">("invoices");

  // Status Tab for Invoice-wise view: all | overdue | partial | unpaid | paid
  const [statusTab, setStatusTab] = useState<"all" | "overdue" | "partial" | "unpaid" | "paid">("all");

  // Expanded customer IDs in customer-wise view
  const [expandedCustomers, setExpandedCustomers] = useState<{ [id: string]: boolean }>({});

  // --- URL State & Filters ---
  const search = searchParams.get("search") || "";
  const financialYear = searchParams.get("fy") || "current";
  const customerId = searchParams.get("customerId") || "all";
  const paymentMode = searchParams.get("mode") || "all";
  const statusParam = searchParams.get("status") || "all";
  const docType = searchParams.get("docType") || "all";
  const fromDate = searchParams.get("from") || getFinancialYearDates("current").fromDate;
  const toDate = searchParams.get("to") || getFinancialYearDates("current").toDate;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "25", 10);
  const sortBy = searchParams.get("sortBy") || "payment_date";
  const sortDir = searchParams.get("sortDir") || "desc";

  // Local Search Input (Debounced 300ms)
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        updateFilter("search", searchInput);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const updateFilter = (key: string, value: string | number) => {
    const newParams = new URLSearchParams(searchParams);
    if (value && value !== "all" && value !== "") {
      newParams.set(key, String(value));
    } else {
      newParams.delete(key);
    }
    if (key !== "page") newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const resetFilters = () => {
    const fyDates = getFinancialYearDates("current");
    setSearchParams({
      fy: "current",
      from: fyDates.fromDate,
      to: fyDates.toDate
    });
    setSearchInput("");
    setStatusTab("all");
  };

  const handleFyChange = (fyKey: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("fy", fyKey);
    const dates = getFinancialYearDates(fyKey);
    if (dates.fromDate) newParams.set("from", dates.fromDate);
    else newParams.delete("from");
    if (dates.toDate) newParams.set("to", dates.toDate);
    else newParams.delete("to");
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  // --- Date Validation ---
  const dateError = fromDate && toDate && new Date(toDate) < new Date(fromDate)
    ? "To date must be on or after From date"
    : null;

  // --- TanStack Queries ---
  // 1. KPI Summary (Server-computed)
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    refetch: refetchSummary
  } = useQuery<any>({
    queryKey: ["receivables-summary", customerId, fromDate, toDate],
    queryFn: () => apiClient.getReceivablesSummary({
      customer_id: customerId !== "all" ? customerId : undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined
    }),
    staleTime: 15000
  });

  // 2. Customer List (for dropdown filter)
  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const res = await apiClient.getParties("customer");
      return Array.isArray(res) ? res : res?.items || [];
    }
  });

  // 3. Receivables List (Invoice-wise)
  const {
    data: receivablesData = [],
    isLoading: isReceivablesLoading,
    isError: isReceivablesError,
    refetch: refetchReceivables
  } = useQuery<any[]>({
    queryKey: ["receivables", customerId, statusTab, fromDate, toDate, search],
    queryFn: () => apiClient.getReceivables({
      customer_id: customerId !== "all" ? customerId : undefined,
      status: statusTab !== "all" ? statusTab : undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      q: search || undefined
    }),
    enabled: viewMode === "invoices"
  });

  // Filtered Receivables by Invoice Type (Pro Forma vs Tax Invoice)
  const filteredReceivables = useMemo(() => {
    if (!Array.isArray(receivablesData)) return [];
    return receivablesData.filter((doc: any) => {
      if (docType && docType !== "all") {
        const type = doc.invoice_type || (doc.invoice_no?.startsWith("PI-") ? "proforma" : "invoice");
        if (type !== docType) return false;
      }
      return true;
    });
  }, [receivablesData, docType]);

  // 4. Customer-wise Receivables
  const {
    data: customerReceivablesData = [],
    isLoading: isCustomerReceivablesLoading,
    isError: isCustomerReceivablesError,
    refetch: refetchCustomerReceivables
  } = useQuery<any[]>({
    queryKey: ["receivables-customers", fromDate, toDate],
    queryFn: () => apiClient.getCustomerReceivables({
      from_date: fromDate || undefined,
      to_date: toDate || undefined
    }),
    enabled: viewMode === "customers"
  });

  const filteredCustomerReceivables = useMemo(() => {
    if (!Array.isArray(customerReceivablesData)) return [];
    return customerReceivablesData.filter((cr: any) => {
      if (customerId !== "all" && cr.customer_id !== customerId) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchesName = cr.customer_name?.toLowerCase().includes(q);
        const matchesInv = cr.invoices?.some((i: any) => i.invoice_no?.toLowerCase().includes(q));
        if (!matchesName && !matchesInv) return false;
      }
      return true;
    });
  }, [customerReceivablesData, customerId, search]);

  // 5. Payment Receipts History (for Receipts tab)
  const filterQueryParams = useMemo(() => ({
    q: search,
    customer_id: customerId !== "all" ? customerId : undefined,
    mode: paymentMode !== "all" ? paymentMode : undefined,
    status: statusParam !== "all" ? statusParam : undefined,
    doc_type: docType !== "all" ? docType : undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    page,
    page_size: pageSize,
    sort: sortDir === "asc" ? sortBy : `-${sortBy}`
  }), [search, customerId, paymentMode, statusParam, docType, fromDate, toDate, page, pageSize, sortBy, sortDir]);

  const {
    data: paymentsData,
    isLoading: isPaymentsLoading,
    isError: isPaymentsError,
    refetch: refetchPayments
  } = useQuery<any>({
    queryKey: ["payments-receipts", filterQueryParams],
    queryFn: () => apiClient.getPayments(filterQueryParams),
    placeholderData: keepPreviousData,
    enabled: viewMode === "receipts"
  });

  // 6. Customer TDS History
  const [tdsCollapsed, setTdsCollapsed] = useState(true);
  const tdsEnabled = currentOrganization?.settings?.tds_enabled ?? true;
  const { data: tdsHistory = [] } = useQuery<any[]>({
    queryKey: ["tds-history", customerId, fromDate, toDate],
    queryFn: () => apiClient.getTdsHistory({
      customer_id: customerId !== "all" ? customerId : undefined,
      from: fromDate || undefined,
      to: toDate || undefined
    }),
    enabled: tdsEnabled
  });

  // --- Modals & Actions State ---
  const [selectedPayment, setSelectedPayment] = useState<any>(null); // Detail drawer
  const [reverseModalPayment, setReverseModalPayment] = useState<any>(null); // Reversal modal
  const [reversalReason, setReversalReason] = useState("");
  const [reversalError, setReversalError] = useState("");
  const [exporting, setExporting] = useState(false);

  // New Payment Wizard State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizCustomer, setWizCustomer] = useState<any>(null);
  const [wizDate, setWizDate] = useState(new Date().toISOString().slice(0, 10));
  const [wizAmount, setWizAmount] = useState<number | "">(0);
  const [wizMode, setWizMode] = useState("UPI");
  const [wizRefNo, setWizRefNo] = useState("");
  const [wizChequeNo, setWizChequeNo] = useState("");
  const [wizChequeDate, setWizChequeDate] = useState("");
  const [wizBankName, setWizBankName] = useState("");
  const [wizDepositAccount, setWizDepositAccount] = useState("");
  const [wizTdsEnabled, setWizTdsEnabled] = useState(false);
  const [wizTdsRate, setWizTdsRate] = useState<number>(2);
  const [wizTdsAmount, setWizTdsAmount] = useState<number>(0);
  const [wizTdsSection, setWizTdsSection] = useState("194C");
  const [wizNotes, setWizNotes] = useState("");
  const [wizAdvance, setWizAdvance] = useState(false);
  const [wizAllocations, setWizAllocations] = useState<{ [docId: string]: number }>({});
  const [wizSaveLoading, setWizSaveLoading] = useState(false);
  const [wizError, setWizError] = useState("");
  const [toastMessage, setToastMessage] = useState("");

  const [idempotencyKey, setIdempotencyKey] = useState<string>("");

  // Customer Summary when Customer is chosen in Wizard (to detect available advance)
  const { data: wizCustomerSummary } = useQuery<any>({
    queryKey: ["customer-summary-wiz", wizCustomer?.id],
    queryFn: () => apiClient.apiRequest(`/payments/customer-summary/${wizCustomer?.id}`, "GET"),
    enabled: !!wizCustomer?.id && wizardOpen
  });

  // Query open docs for chosen customer when wizard is active
  const { data: wizCustomerDocs = [], isLoading: isWizDocsLoading } = useQuery<any[]>({
    queryKey: ["pending-documents-wiz", wizCustomer?.id],
    queryFn: () => apiClient.getPendingDocuments({ customer_id: wizCustomer?.id }),
    enabled: !!wizCustomer?.id && wizardOpen
  });

  // When wizCustomerDocs load, auto-populate allocations if empty
  useEffect(() => {
    if (!wizardOpen || !wizCustomer?.id) return;
    if (Array.isArray(wizCustomerDocs)) {
      if (wizCustomerDocs.length === 0) {
        setWizAdvance(true);
      } else {
        if (Object.keys(wizAllocations).length === 0) {
          const initialAlloc: { [docId: string]: number } = {};
          let totalBal = 0;
          wizCustomerDocs.forEach((doc: any) => {
            const did = doc.id || doc.document_id;
            const bal = Number(doc.balance_due || 0);
            if (bal > 0 && did) {
              initialAlloc[did] = bal;
              totalBal += bal;
            }
          });
          setWizAllocations(initialAlloc);
          if (wizAmount === 0 || wizAmount === "") {
            setWizAmount(totalBal);
          }
          setWizAdvance(false);
        }
      }
    }
  }, [wizCustomerDocs, wizardOpen, wizCustomer?.id]);

  // Auto-open wizard from URL query param ?invoiceId=
  useEffect(() => {
    const prefillInvoice = searchParams.get("invoiceId");
    if (prefillInvoice && Array.isArray(receivablesData) && receivablesData.length > 0) {
      const matchedDoc = receivablesData.find((d: any) => d.invoice_id === prefillInvoice);
      if (matchedDoc) {
        handleOpenWizardWithDoc({
          id: matchedDoc.invoice_id,
          document_id: matchedDoc.invoice_id,
          document_no: matchedDoc.invoice_no,
          customer_id: matchedDoc.customer_id,
          customer_name: matchedDoc.customer_name,
          balance_due: matchedDoc.balance_due,
          available_customer_advance: matchedDoc.available_customer_advance
        });
      }
    }
  }, [searchParams, receivablesData]);

  const handleOpenWizardWithDoc = (doc: any) => {
    const cust = customers.find((c: any) => c.id === doc.customer_id) || {
      id: doc.customer_id,
      name: doc.customer_name
    };
    const did = doc.id || doc.document_id || doc.invoice_id;
    setWizCustomer(cust);
    setWizAmount(doc.balance_due || 0);
    setWizAllocations(did ? { [did]: doc.balance_due || 0 } : {});
    setWizRefNo("");
    setWizNotes("");
    setWizAdvance(false);
    setWizError("");
    setIdempotencyKey(crypto.randomUUID());
    setWizardStep(2);
    setWizardOpen(true);
  };

  const handleOpenWizardEmpty = () => {
    setWizCustomer(null);
    setWizAmount(0);
    setWizAllocations({});
    setWizRefNo("");
    setWizNotes("");
    setWizAdvance(false);
    setWizError("");
    setIdempotencyKey(crypto.randomUUID());
    setWizardStep(1);
    setWizardOpen(true);
  };

  // Apply Advance Mutation
  const applyAdvanceMutation = useMutation({
    mutationFn: async ({ customerId, invoiceId, amount }: { customerId: string; invoiceId: string; amount: number }) => {
      return apiClient.applyAdvance({
        customer_id: customerId,
        invoice_id: invoiceId,
        amount
      });
    },
    onSuccess: (data: any) => {
      setToastMessage(`Applied ${formatINR(data.applied_amount)} advance to invoice ${data.invoice_no}!`);
      setTimeout(() => setToastMessage(""), 5000);
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-summary"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-customers"] });
      queryClient.invalidateQueries({ queryKey: ["payments-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      if (wizardOpen) setWizardOpen(false);
    },
    onError: (err: any) => {
      const msg = err.message || "Failed to apply advance";
      setToastMessage(msg);
      setTimeout(() => setToastMessage(""), 5000);
    }
  });

  // Reversal Mutation
  const reverseMutation = useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; reason: string }) => {
      return apiClient.reversePayment(paymentId, reason);
    },
    onSuccess: () => {
      setReverseModalPayment(null);
      setReversalReason("");
      setReversalError("");
      queryClient.invalidateQueries({ queryKey: ["payments-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-summary"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-customers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      setToastMessage("Payment reversed successfully");
      setTimeout(() => setToastMessage(""), 4000);
    },
    onError: (err: any) => {
      const msg = err.message || "Failed to reverse payment";
      setReversalError(msg);
      setToastMessage(msg);
      setTimeout(() => setToastMessage(""), 5000);
    }
  });

  // Dedicated Record Payment Modal State (Section 4)
  const [recordPaymentDoc, setRecordPaymentDoc] = useState<any | null>(null);
  const [recordPaymentDate, setRecordPaymentDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [recordPaymentAmount, setRecordPaymentAmount] = useState<number | "">("");
  const [recordPaymentMode, setRecordPaymentMode] = useState<string>("Bank Transfer");
  const [recordPaymentRefNo, setRecordPaymentRefNo] = useState<string>("");
  const [recordPaymentNotes, setRecordPaymentNotes] = useState<string>("");
  const [recordPaymentError, setRecordPaymentError] = useState<string>("");

  // Dedicated View Details Modal State
  const [viewDetailsDoc, setViewDetailsDoc] = useState<any | null>(null);

  const handleOpenRecordPayment = (doc: any) => {
    const invTotal = Number(doc.invoice_total ?? doc.grand_total ?? doc.total_amount ?? 0);
    const advRec = Number(doc.advance_received ?? doc.advance_applied ?? 0);
    const addRec = Number(doc.additional_payments_received ?? doc.additional_payments ?? Math.max(0, (doc.total_received ?? doc.paid_amount ?? 0) - advRec));
    const totRec = Number(doc.total_received ?? (advRec + addRec));
    const balDue = Number(doc.balance_due ?? Math.max(0, invTotal - totRec));

    setRecordPaymentDoc(doc);
    setRecordPaymentDate(new Date().toISOString().split("T")[0]);
    setRecordPaymentAmount(balDue > 0 ? balDue : "");
    setRecordPaymentMode("Bank Transfer");
    setRecordPaymentRefNo("");
    setRecordPaymentNotes("");
    setRecordPaymentError("");
  };

  const recordPaymentMutation = useMutation({
    mutationFn: async ({
      doc,
      amount,
      paymentDate,
      paymentMode,
      refNo,
      notes
    }: {
      doc: any;
      amount: number;
      paymentDate: string;
      paymentMode: string;
      refNo: string;
      notes: string;
    }) => {
      const isProforma = doc.invoice_type === "proforma" || doc.invoice_no?.startsWith("PI-");
      const cleanNotes = isProforma
        ? `${notes || "Advance payment"} [proforma:${doc.invoice_id}] [advance]`
        : (notes || "Payment received for invoice");

      return apiClient.createPayment({
        payment_date: paymentDate,
        party_id: doc.customer_id,
        amount: amount,
        amount_received: amount,
        payment_mode: paymentMode,
        reference_no: refNo || undefined,
        notes: cleanNotes,
        allocations: [{
          invoice_id: doc.invoice_id,
          amount_allocated: amount
        }]
      });
    },
    onSuccess: () => {
      setToastMessage(`Payment of ${formatINR(recordPaymentAmount)} recorded successfully!`);
      setTimeout(() => setToastMessage(""), 5000);
      setRecordPaymentDoc(null);
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-summary"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-customers"] });
      queryClient.invalidateQueries({ queryKey: ["payments-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || "Failed to record payment";
      setRecordPaymentError(msg);
    }
  });

  const handleSaveRecordPayment = () => {
    if (!recordPaymentDoc) return;
    const invTotal = Number(recordPaymentDoc.invoice_total ?? recordPaymentDoc.grand_total ?? recordPaymentDoc.total_amount ?? 0);
    const advRec = Number(recordPaymentDoc.advance_received ?? recordPaymentDoc.advance_applied ?? 0);
    const addRec = Number(recordPaymentDoc.additional_payments_received ?? recordPaymentDoc.additional_payments ?? Math.max(0, (recordPaymentDoc.total_received ?? recordPaymentDoc.paid_amount ?? 0) - advRec));
    const totRec = Number(recordPaymentDoc.total_received ?? (advRec + addRec));
    const balDue = Number(recordPaymentDoc.balance_due ?? Math.max(0, invTotal - totRec));

    const numAmt = Number(recordPaymentAmount);
    if (!numAmt || numAmt <= 0) {
      setRecordPaymentError("Payment amount must be greater than zero.");
      return;
    }
    if (numAmt > balDue + 0.01) {
      setRecordPaymentError(`Payment amount cannot exceed outstanding balance of ${formatINR(balDue)}.`);
      return;
    }
    if (!recordPaymentDate) {
      setRecordPaymentError("Payment date is required.");
      return;
    }

    recordPaymentMutation.mutate({
      doc: recordPaymentDoc,
      amount: numAmt,
      paymentDate: recordPaymentDate,
      paymentMode: recordPaymentMode,
      refNo: recordPaymentRefNo,
      notes: recordPaymentNotes
    });
  };

  // Handle Export
  const handleExport = async (type: "csv" | "excel" | "pdf") => {
    setExporting(true);
    try {
      const allFiltered = await apiClient.getPayments({ ...filterQueryParams, page_size: 5000 });
      const records = allFiltered?.items || [];
      if (type === "csv" || type === "excel") {
        exportPaymentInCsv(records, "IN");
      } else if (type === "pdf") {
        exportPaymentInSummaryPdf(records, "IN");
      }
    } catch (err: any) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  // Save Wizard Payment
  const handleSavePayment = async () => {
    if (!wizCustomer?.id) {
      const msg = "Customer is required";
      setWizError(msg);
      setToastMessage(msg);
      setTimeout(() => setToastMessage(""), 4000);
      return;
    }
    const numAmount = Number(wizAmount || 0);
    if (numAmount <= 0) {
      const msg = "Amount must be greater than 0";
      setWizError(msg);
      setToastMessage(msg);
      setTimeout(() => setToastMessage(""), 4000);
      return;
    }
    if (["UPI", "Bank Transfer", "Cheque", "Card"].includes(wizMode) && !wizRefNo.trim()) {
      const msg = `Reference number is required for ${wizMode}.`;
      setWizError(msg);
      setToastMessage(msg);
      setTimeout(() => setToastMessage(""), 4000);
      return;
    }

    setWizSaveLoading(true);
    setWizError("");
    try {
      const allocList = Object.entries(wizAllocations)
        .filter(([_, amt]) => Number(amt) > 0)
        .map(([docId, amt]) => {
          const doc = (Array.isArray(wizCustomerDocs) ? wizCustomerDocs : []).find((d: any) => (d.id || d.document_id) === docId)
            || (Array.isArray(receivablesData) ? receivablesData : []).find((d: any) => (d.invoice_id || d.id) === docId);
          return {
            document_id: docId,
            document_type: doc?.document_type || "invoice",
            amount: Number(amt),
            amount_applied: Number(amt)
          };
        });

      const payload = {
        customer_id: wizCustomer.id,
        payment_date: wizDate,
        amount: numAmount,
        amount_received: numAmount,
        mode: wizMode,
        payment_mode: wizMode,
        reference_no: wizRefNo,
        cheque_no: wizMode === "Cheque" ? wizChequeNo : undefined,
        cheque_date: wizMode === "Cheque" ? wizChequeDate : undefined,
        bank_name: wizMode === "Cheque" ? wizBankName : undefined,
        deposit_account_id: wizDepositAccount || undefined,
        tds_percent: wizTdsEnabled ? wizTdsRate : 0,
        tds_amount: wizTdsEnabled ? wizTdsAmount : 0,
        notes: wizNotes,
        allocations: allocList,
        is_advance: wizAdvance,
        idempotency_key: idempotencyKey || crypto.randomUUID()
      };

      const saved = await apiClient.createPayment(payload);
      setWizSaveLoading(false);
      setWizardOpen(false);
      setToastMessage("Payment receipt created successfully!");
      setTimeout(() => setToastMessage(""), 4000);

      // Auto download PDF receipt if supported
      if (saved) {
        try {
          exportSinglePaymentInPdf(saved);
        } catch (_) {}
      }

      // Refresh query caches
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-summary"] });
      queryClient.invalidateQueries({ queryKey: ["receivables-customers"] });
      queryClient.invalidateQueries({ queryKey: ["payments-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    } catch (err: any) {
      setWizSaveLoading(false);
      const errMsg = err.message || "Failed to record payment.";
      setWizError(errMsg);
      setToastMessage(errMsg);
      setTimeout(() => setToastMessage(""), 5000);
    }
  };

  // Active Filter Chips
  const activeChips = useMemo(() => {
    const chips: { label: string; key: string }[] = [];
    if (search) chips.push({ label: `Search: "${search}"`, key: "search" });
    if (customerId !== "all") {
      const cust = customers.find((c: any) => c.id === customerId);
      chips.push({ label: `Customer: ${cust?.name || customerId}`, key: "customerId" });
    }
    if (paymentMode !== "all") chips.push({ label: `Mode: ${paymentMode}`, key: "paymentMode" });
    if (statusParam !== "all") chips.push({ label: `Status: ${statusParam}`, key: "status" });
    if (docType !== "all") chips.push({ label: `Type: ${docType}`, key: "docType" });
    if (financialYear !== "current") chips.push({ label: `FY: ${financialYear}`, key: "fy" });
    return chips;
  }, [search, customerId, paymentMode, statusParam, docType, financialYear, customers]);

  // Compute available advance for chosen customer in wizard
  const wizCustomerAdvanceAvailable = useMemo(() => {
    return Number(wizCustomerSummary?.advance_balance ?? wizCustomerSummary?.unapplied_balance ?? 0);
  }, [wizCustomerSummary]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 sm:p-6 lg:p-8 space-y-6">
      
      {/* TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-700 text-white px-4 py-3 rounded-lg shadow-xl flex items-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* 1. PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <nav className="text-xs font-medium text-slate-500 mb-1 flex items-center space-x-2">
            <span>Payments</span>
            <span>/</span>
            <span className="text-slate-900 font-semibold">Payment In</span>
          </nav>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Payment In</h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              ₹ INR
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">Track customer advances, payments received, and outstanding balances.</p>
        </div>
        <div>
          <button
            onClick={handleOpenWizardEmpty}
            className="inline-flex items-center px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            <Plus className="w-4 h-4 mr-2" />
            + New Payment
          </button>
        </div>
      </div>

      {/* 2. KPI CARDS (4 RESPONSIVE COLS DYNAMIC FROM BACKEND) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Invoice Amount */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Invoice Amount</span>
            <FileText className="w-5 h-5 text-emerald-600" />
          </div>
          {isSummaryLoading ? (
            <div className="h-8 w-28 bg-slate-200 animate-pulse rounded my-1" />
          ) : isSummaryError ? (
            <div className="py-1">
              <span className="text-xs text-red-500">Failed to load</span>
              <button onClick={() => refetchSummary()} className="ml-2 text-xs font-bold text-emerald-700 underline">Retry</button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-slate-900">
              {formatINR(summaryData?.total_invoice_amount ?? summaryData?.total_invoiced)}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-2">Total billings in period</p>
        </div>

        {/* Card 2: Total Amount Received */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Amount Received</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          {isSummaryLoading ? (
            <div className="h-8 w-32 bg-slate-200 animate-pulse rounded my-1" />
          ) : isSummaryError ? (
            <div className="py-1">
              <span className="text-xs text-red-500">Failed to load</span>
              <button onClick={() => refetchSummary()} className="ml-2 text-xs font-bold text-emerald-700 underline">Retry</button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-emerald-700">
              {formatINR(summaryData?.total_amount_received ?? summaryData?.amount_received ?? summaryData?.total_received)}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-2">Collected from advances & receipts</p>
        </div>

        {/* Card 3: Total Outstanding */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Outstanding</span>
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
          {isSummaryLoading ? (
            <div className="h-8 w-32 bg-slate-200 animate-pulse rounded my-1" />
          ) : isSummaryError ? (
            <div className="py-1">
              <span className="text-xs text-red-500">Failed to load</span>
              <button onClick={() => refetchSummary()} className="ml-2 text-xs font-bold text-emerald-700 underline">Retry</button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-amber-700">
              {formatINR(summaryData?.total_outstanding ?? summaryData?.pending_receivable)}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-2">Total unpaid receivable balance</p>
        </div>

        {/* Card 4: Overdue Amount */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Overdue Amount</span>
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          {isSummaryLoading ? (
            <div className="h-8 w-32 bg-slate-200 animate-pulse rounded my-1" />
          ) : isSummaryError ? (
            <div className="py-1">
              <span className="text-xs text-red-500">Failed to load</span>
              <button onClick={() => refetchSummary()} className="ml-2 text-xs font-bold text-emerald-700 underline">Retry</button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-red-700">
              {formatINR(summaryData?.overdue_amount)}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-2">
            {summaryData?.overdue_count ? (
              <span className="text-red-600 font-semibold">{summaryData.overdue_count} overdue invoice{summaryData.overdue_count > 1 ? "s" : ""}</span>
            ) : (
              "All invoices on schedule"
            )}
          </p>
        </div>
      </div>

      {/* 3. VIEW MODE SWITCHER TABS */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setViewMode("invoices")}
            className={`flex items-center px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              viewMode === "invoices"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <FileText className="w-3.5 h-3.5 mr-2" />
            Invoice-wise Receivables
          </button>
          <button
            onClick={() => setViewMode("customers")}
            className={`flex items-center px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              viewMode === "customers"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Users className="w-3.5 h-3.5 mr-2" />
            Customer-wise
          </button>
          <button
            onClick={() => setViewMode("receipts")}
            className={`flex items-center px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              viewMode === "receipts"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Layers className="w-3.5 h-3.5 mr-2" />
            Payment Receipts History
          </button>
        </div>

        {/* Refresh button */}
        <button
          onClick={() => {
            refetchSummary();
            if (viewMode === "invoices") refetchReceivables();
            else if (viewMode === "customers") refetchCustomerReceivables();
            else refetchPayments();
          }}
          className="inline-flex items-center px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          title="Refresh Data"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
          Refresh
        </button>
      </div>

      {/* 4. FILTER BAR */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
        {/* Row 1: Search */}
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoice no, receipt no, customer name..."
            className="w-full pl-10 pr-10 py-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(""); updateFilter("search", ""); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Row 2: Controls Grid with Dedicated Wide Date Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* FY */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Financial Year</label>
            <select
              value={financialYear}
              onChange={(e) => handleFyChange(e.target.value)}
              className="w-full border border-slate-300 rounded-lg py-2 px-2.5 text-xs font-medium text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            >
              <option value="current">Current FY (2026-27)</option>
              <option value="previous">Previous FY (2025-26)</option>
              <option value="all">All Financial Years</option>
            </select>
          </div>

          {/* Customer */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Customer</label>
            <select
              value={customerId}
              onChange={(e) => updateFilter("customerId", e.target.value)}
              className="w-full border border-slate-300 rounded-lg py-2 px-2.5 text-xs font-medium text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none truncate"
            >
              <option value="all">All Customers</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Invoice Type Filter (active in invoices view) */}
          {viewMode === "invoices" && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice Type</label>
              <select
                value={docType}
                onChange={(e) => updateFilter("docType", e.target.value)}
                className="w-full border border-slate-300 rounded-lg py-2 px-2.5 text-xs font-medium text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="all">All Types</option>
                <option value="invoice">Tax Invoice</option>
                <option value="proforma">Pro Forma</option>
              </select>
            </div>
          )}

          {/* Mode (active in receipts mode) */}
          {viewMode === "receipts" && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => updateFilter("mode", e.target.value)}
                className="w-full border border-slate-300 rounded-lg py-2 px-2.5 text-xs font-medium text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="all">All Modes</option>
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Cheque">Cheque</option>
                <option value="Card">Card</option>
              </select>
            </div>
          )}

          {/* WIDENED DATE INPUTS (Dedicated Columns to Prevent Truncation) */}
          <div className="min-w-[140px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">From date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => updateFilter("from", e.target.value)}
              className="w-full border border-slate-300 rounded-lg py-2 px-3 text-xs font-medium text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="min-w-[140px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">To date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => updateFilter("to", e.target.value)}
              className="w-full border border-slate-300 rounded-lg py-2 px-3 text-xs font-medium text-slate-700 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Date error validation message */}
        {dateError && (
          <p className="text-xs text-red-600 font-medium">{dateError}</p>
        )}

        {/* Bottom Filter Actions & Active Chips */}
        <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-100 gap-3">
          {/* Active Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.length > 0 && (
              <span className="text-xs text-slate-400 font-medium mr-1">Active:</span>
            )}
            {activeChips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
              >
                {chip.label}
                <button
                  onClick={() => {
                    if (chip.key === "search") setSearchInput("");
                    updateFilter(chip.key, "");
                  }}
                  className="ml-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center space-x-3 ml-auto">
            <button
              onClick={resetFilters}
              className="text-xs font-semibold text-slate-500 hover:text-emerald-700 underline underline-offset-2 flex items-center"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset filters
            </button>

            {/* Export Dropdown */}
            <div className="relative group">
              <button
                disabled={exporting}
                className="inline-flex items-center px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 transition-colors"
              >
                <Download className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                {exporting ? "Exporting..." : "Export"}
                <ChevronDown className="w-3.5 h-3.5 ml-1 text-slate-400" />
              </button>
              <div className="absolute right-0 mt-1 w-36 bg-white border border-slate-200 rounded-lg shadow-lg hidden group-hover:block z-20 py-1">
                <button
                  onClick={() => handleExport("csv")}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 flex items-center"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-2 text-emerald-600" />
                  Export CSV
                </button>
                <button
                  onClick={() => handleExport("excel")}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 flex items-center"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-2 text-green-600" />
                  Export Excel
                </button>
                <button
                  onClick={() => handleExport("pdf")}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 flex items-center"
                >
                  <FileText className="w-3.5 h-3.5 mr-2 text-red-600" />
                  Summary PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5. PRIMARY CONTENT SECTION (BASED ON ACTIVE VIEW) */}
      
      {/* 5A. VIEW MODE = "invoices" (INVOICE-WISE RECEIVABLES) */}
      {viewMode === "invoices" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Invoice Receivables</h2>
              <p className="text-xs text-slate-500">Track balance due, overdue status, and advance applied per invoice</p>
            </div>

            {/* STATUS TABS WITH DYNAMIC COUNTS */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1">
              {[
                { id: "all", label: "All", count: summaryData?.tabs_count?.all ?? 0 },
                { id: "overdue", label: "Overdue", count: summaryData?.tabs_count?.overdue ?? 0, badgeColor: "bg-red-100 text-red-800" },
                { id: "partial", label: "Partially Paid", count: summaryData?.tabs_count?.partial ?? 0, badgeColor: "bg-amber-100 text-amber-800" },
                { id: "unpaid", label: "Unpaid", count: summaryData?.tabs_count?.unpaid ?? 0, badgeColor: "bg-blue-100 text-blue-800" },
                { id: "paid", label: "Paid", count: summaryData?.tabs_count?.paid ?? 0, badgeColor: "bg-emerald-100 text-emerald-800" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors whitespace-nowrap ${
                    statusTab === tab.id
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    statusTab === tab.id ? "bg-slate-700 text-white" : tab.badgeColor || "bg-slate-100 text-slate-700"
                  }`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* TABLE */}
          {isReceivablesLoading ? (
            <div className="py-6 space-y-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-10 bg-slate-100 animate-pulse rounded" />
              ))}
            </div>
          ) : isReceivablesError ? (
            <div className="py-12 text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
              <p className="text-sm text-slate-700 font-medium">Failed to load receivables.</p>
              <button
                onClick={() => refetchReceivables()}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
              >
                Retry
              </button>
            </div>
          ) : filteredReceivables.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No invoice receivables matching active filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 border-collapse">
                <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-3.5">Invoice Date</th>
                    <th className="py-3 px-3.5">Invoice No</th>
                    <th className="py-3 px-3.5">Customer Details</th>
                    <th className="py-3 px-3.5 text-right">Total Amount</th>
                    <th className="py-3 px-3.5 text-right">Amount Received</th>
                    <th className="py-3 px-3.5 text-right">Balance Amount</th>
                    <th className="py-3 px-3.5">Due Date</th>
                    <th className="py-3 px-3.5 text-center">Status</th>
                    <th className="py-3 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReceivables.map((doc: any) => {
                    const invTotal = Number(doc.invoice_total ?? doc.grand_total ?? doc.total_amount ?? 0);
                    const advRec = Number(doc.advance_received ?? doc.advance_applied ?? 0);
                    const addRec = Number(doc.additional_payments_received ?? doc.additional_payments ?? Math.max(0, (doc.total_received ?? doc.paid_amount ?? 0) - advRec));
                    const totRec = Number(doc.total_received ?? (advRec + addRec));
                    const balDue = Number(doc.balance_due ?? Math.max(0, invTotal - totRec));

                    const isProforma = doc.invoice_type === "proforma" || doc.invoice_no?.startsWith("PI-");
                    const isOverdue = balDue > 0.01 && Boolean(doc.due_date) && new Date(doc.due_date) < new Date(new Date().setHours(0, 0, 0, 0));

                    let displayStatus: "Paid" | "Partially Paid" | "Overdue" | "Unpaid" = "Unpaid";
                    if (balDue <= 0.01 && totRec > 0) {
                      displayStatus = "Paid";
                    } else if (isOverdue) {
                      displayStatus = "Overdue";
                    } else if (totRec > 0.01) {
                      displayStatus = "Partially Paid";
                    } else {
                      displayStatus = "Unpaid";
                    }

                    return (
                      <tr key={doc.invoice_id} className={`hover:bg-slate-50/80 transition-colors ${isOverdue ? "bg-red-50/20" : ""}`}>
                        {/* 1. Invoice Date */}
                        <td className="py-3 px-3.5 whitespace-nowrap text-slate-600 font-medium">
                          {formatDate(doc.invoice_date)}
                        </td>

                        {/* 2. Invoice No */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-slate-900">{doc.invoice_no}</span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                              isProforma
                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                : "bg-slate-100 text-slate-700 border-slate-200"
                            }`}>
                              {isProforma ? "Pro Forma" : "Tax Invoice"}
                            </span>
                          </div>
                        </td>

                        {/* 3. Customer Details */}
                        <td className="py-3 px-3.5">
                          <div className="font-semibold text-slate-900">{doc.customer_name}</div>
                          {(doc.customer_phone || doc.customer_gstin) && (
                            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                              {doc.customer_phone && <span>Ph: {doc.customer_phone}</span>}
                              {doc.customer_gstin && <span className="font-mono">GSTIN: {doc.customer_gstin}</span>}
                            </div>
                          )}
                        </td>

                        {/* 4. Total Amount */}
                        <td className="py-3 px-3.5 text-right font-medium text-slate-900 whitespace-nowrap">
                          {formatINR(invTotal)}
                        </td>

                        {/* 5. Amount Received */}
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <span className="font-semibold text-emerald-700">{formatINR(totRec)}</span>
                          {advRec > 0 && (
                            <span className="block text-[10px] text-blue-600 font-medium">Adv: {formatINR(advRec)}</span>
                          )}
                        </td>

                        {/* 6. Balance Amount */}
                        <td className="py-3 px-3.5 text-right font-bold whitespace-nowrap text-slate-900">
                          {formatINR(balDue)}
                        </td>

                        {/* 7. Due Date */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <span className={isOverdue ? "text-red-700 font-semibold" : "text-slate-600"}>
                            {doc.due_date ? formatDate(doc.due_date) : "-"}
                          </span>
                          {isOverdue && (
                            <span className="block text-[10px] text-red-600 font-medium">Past Due</span>
                          )}
                        </td>

                        {/* 8. Status */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          {displayStatus === "Paid" ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                              Paid
                            </span>
                          ) : displayStatus === "Partially Paid" ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <Clock className="w-3 h-3 mr-1 text-amber-600" />
                              Partially Paid
                            </span>
                          ) : displayStatus === "Overdue" ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                              <AlertTriangle className="w-3 h-3 mr-1 text-red-600" />
                              Overdue
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              <AlertCircle className="w-3 h-3 mr-1 text-blue-600" />
                              Unpaid
                            </span>
                          )}
                        </td>

                        {/* 9. Actions */}
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => setViewDetailsDoc(doc)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold transition-colors border border-slate-200"
                            >
                              View Details
                            </button>
                            {balDue > 0.01 ? (
                              <button
                                onClick={() => handleOpenRecordPayment(doc)}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition-colors shadow-xs"
                              >
                                Record Payment
                              </button>
                            ) : (
                              <span className="px-2 py-1 text-xs text-slate-400 font-medium">Settled</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900 text-xs">
                  <tr>
                    <td colSpan={3} className="py-3 px-3.5 uppercase text-slate-500 tracking-wider">Total</td>
                    <td className="py-3 px-3.5 text-right text-slate-900">
                      {formatINR(filteredReceivables.reduce((sum: number, i: any) => sum + Number(i.invoice_total ?? i.grand_total ?? i.total_amount ?? 0), 0))}
                    </td>
                    <td className="py-3 px-3.5 text-right text-emerald-700">
                      {formatINR(filteredReceivables.reduce((sum: number, i: any) => sum + Number(i.total_received ?? (Number(i.advance_received || 0) + Number(i.additional_payments_received || 0))), 0))}
                    </td>
                    <td className="py-3 px-3.5 text-right text-slate-900 font-bold">
                      {formatINR(filteredReceivables.reduce((sum: number, i: any) => sum + Number(i.balance_due || 0), 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 5B. VIEW MODE = "customers" (CUSTOMER-WISE RECEIVABLES WITH EXPANDABLE SUB-TABLE) */}
      {viewMode === "customers" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-5 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-base font-bold text-slate-900">Customer-wise Receivables Summary</h2>
            <p className="text-xs text-slate-500">Aggregated invoiced, collected, advance available, and outstanding balance by customer</p>
          </div>

          {isCustomerReceivablesLoading ? (
            <div className="py-6 space-y-3">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-12 bg-slate-100 animate-pulse rounded" />
              ))}
            </div>
          ) : isCustomerReceivablesError ? (
            <div className="py-12 text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
              <p className="text-sm text-slate-700 font-medium">Failed to load customer receivables.</p>
              <button
                onClick={() => refetchCustomerReceivables()}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
              >
                Retry
              </button>
            </div>
          ) : filteredCustomerReceivables.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No customer receivables found matching active filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 border-collapse">
                <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-3">Customer</th>
                    <th className="py-3 px-3 text-right">Invoiced (₹)</th>
                    <th className="py-3 px-3 text-right">Received (₹)</th>
                    <th className="py-3 px-3 text-right">Unapplied Adv (₹)</th>
                    <th className="py-3 px-3 text-right">Balance Due (₹)</th>
                    <th className="py-3 px-3 text-right">Overdue (₹)</th>
                    <th className="py-3 px-3">Oldest Due Date</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomerReceivables.map((cr: any) => {
                    const isExpanded = !!expandedCustomers[cr.customer_id];

                    return (
                      <React.Fragment key={cr.customer_id || cr.customer_name}>
                        <tr
                          onClick={() => setExpandedCustomers(prev => ({ ...prev, [cr.customer_id]: !prev[cr.customer_id] }))}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-3 font-bold text-slate-900">
                            <div className="flex items-center space-x-2">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-emerald-600 shrink-0" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                              )}
                              <span>{cr.customer_name}</span>
                              <span className="text-[11px] text-slate-400 font-normal">({cr.invoices?.length || 0} invoices)</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-medium">{formatINR(cr.invoiced)}</td>
                          <td className="py-3 px-3 text-right font-medium text-slate-600">{formatINR(cr.received)}</td>
                          <td className="py-3 px-3 text-right font-semibold text-purple-700">{formatINR(cr.advance)}</td>
                          <td className="py-3 px-3 text-right font-bold text-emerald-700">{formatINR(cr.balance)}</td>
                          <td className="py-3 px-3 text-right font-bold text-red-600">
                            {cr.overdue_amount > 0 ? formatINR(cr.overdue_amount) : "-"}
                          </td>
                          <td className="py-3 px-3 text-slate-600">{formatDate(cr.oldest_due_date)}</td>
                          <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => {
                                const found = customers.find((c: any) => c.id === cr.customer_id) || {
                                  id: cr.customer_id,
                                  name: cr.customer_name
                                };
                                setWizCustomer(found);
                                setWizAmount(cr.balance || 0);
                                setWizAllocations({});
                                setWizAdvance(cr.balance <= 0);
                                setWizardStep(2);
                                setWizardOpen(true);
                              }}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold transition-colors"
                            >
                              Receive Payment
                            </button>
                          </td>
                        </tr>

                        {/* EXPANDED INVOICES ACCORDION ROW */}
                        {isExpanded && cr.invoices?.length > 0 && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={8} className="p-3 pl-8">
                              <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                                <h4 className="text-xs font-bold text-slate-700">Open & Historical Invoices for {cr.customer_name}</h4>
                                <table className="w-full text-left text-[11px] text-slate-600">
                                  <thead className="bg-slate-100 font-semibold text-slate-600 border-b border-slate-200">
                                    <tr>
                                      <th className="py-1.5 px-2">Invoice No</th>
                                      <th className="py-1.5 px-2">Date</th>
                                      <th className="py-1.5 px-2">Due Date</th>
                                      <th className="py-1.5 px-2 text-right">Total (₹)</th>
                                      <th className="py-1.5 px-2 text-right">Paid (₹)</th>
                                      <th className="py-1.5 px-2 text-right">Balance (₹)</th>
                                      <th className="py-1.5 px-2">Status</th>
                                      <th className="py-1.5 px-2 text-right">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {cr.invoices.map((inv: any) => (
                                      <tr key={inv.invoice_id} className="hover:bg-slate-50">
                                        <td className="py-1.5 px-2 font-bold text-slate-900">{inv.invoice_no}</td>
                                        <td className="py-1.5 px-2">{formatDate(inv.invoice_date)}</td>
                                        <td className="py-1.5 px-2">{formatDate(inv.due_date)}</td>
                                        <td className="py-1.5 px-2 text-right font-medium">{formatINR(inv.grand_total ?? inv.total_amount)}</td>
                                        <td className="py-1.5 px-2 text-right">{formatINR(inv.paid_amount)}</td>
                                        <td className="py-1.5 px-2 text-right font-bold text-emerald-700">{formatINR(inv.balance_due)}</td>
                                        <td className="py-1.5 px-2">
                                          <StatusBadge status={inv.status} />
                                        </td>
                                        <td className="py-1.5 px-2 text-right">
                                          {inv.balance_due > 0.01 && (
                                            <button
                                              onClick={() => handleOpenWizardWithDoc(inv)}
                                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-semibold"
                                            >
                                              Pay
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 5C. VIEW MODE = "receipts" (PAYMENT RECEIPTS HISTORY) */}
      {viewMode === "receipts" && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {isPaymentsError ? (
            <div className="p-8 text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
              <p className="text-sm text-slate-700 font-medium">Failed to load payment records.</p>
              <button
                onClick={() => refetchPayments()}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
              >
                Retry
              </button>
            </div>
          ) : isPaymentsLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-10 bg-slate-100 animate-pulse rounded" />
              ))}
            </div>
          ) : paymentsData?.items?.length === 0 ? (
            <div className="p-12 text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600">
                <FileText className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">No payment receipts found</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  No payment receipts match your active filter criteria. Try resetting filters or create a new payment.
                </p>
              </div>
              <button
                onClick={handleOpenWizardEmpty}
                className="inline-flex items-center px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                + New Payment
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-left text-xs text-slate-700 border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Receipt No</th>
                      <th
                        className="py-3 px-4 cursor-pointer hover:bg-slate-100"
                        onClick={() => updateFilter("sortDir", sortDir === "asc" ? "desc" : "asc")}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Date</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-400" />
                        </div>
                      </th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Applied To</th>
                      <th className="py-3 px-4">Mode</th>
                      <th className="py-3 px-4 text-right">Received (₹)</th>
                      <th className="py-3 px-4 text-right">TDS (₹)</th>
                      <th className="py-3 px-4 text-right">Applied (₹)</th>
                      <th className="py-3 px-4 text-right">Unapplied (₹)</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentsData?.items?.map((item: any) => {
                      const isRev = item.is_reversed || item.status === "Reversed";
                      const allocs = item.allocations || [];
                      const firstDoc = allocs[0]?.invoice_no || "-";
                      const extraDocsCount = allocs.length > 1 ? allocs.length - 1 : 0;
                      const allDocNos = allocs.map((a: any) => a.invoice_no).join(", ");

                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedPayment(item)}
                          className={`hover:bg-slate-50/80 cursor-pointer transition-colors ${
                            isRev ? "bg-red-50/40 text-slate-400 line-through" : ""
                          }`}
                        >
                          <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                            {item.receipt_no}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {formatDate(item.payment_date)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-800">{item.customer_name}</div>
                            {item.customer_gstin && (
                              <div className="text-[10px] text-slate-400 font-mono">GSTIN: {item.customer_gstin}</div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-slate-700" title={allDocNos}>
                              {firstDoc}
                            </span>
                            {extraDocsCount > 0 && (
                              <span
                                className="ml-1 text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-semibold border border-slate-200"
                                title={allDocNos}
                              >
                                +{extraDocsCount} more
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800">{item.payment_mode}</div>
                            {item.reference_no && (
                              <div className="text-[10px] text-slate-400 font-mono">Ref: {item.reference_no}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-emerald-700 whitespace-nowrap">
                            {formatINR(item.amount_received)}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-slate-600 whitespace-nowrap">
                            {formatINR(item.tds_amount)}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-blue-700 whitespace-nowrap">
                            {formatINR(item.amount_applied)}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-amber-700 whitespace-nowrap">
                            {formatINR(item.unapplied_amount)}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={item.status} isReversed={item.is_reversed} />
                          </td>
                          <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="relative group inline-block text-left">
                              <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-xl hidden group-hover:block z-30 py-1 text-xs">
                                <button
                                  onClick={() => setSelectedPayment(item)}
                                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center"
                                >
                                  <Eye className="w-3.5 h-3.5 mr-2 text-slate-500" />
                                  View receipt
                                </button>
                                <button
                                  onClick={() => exportSinglePaymentInPdf(item)}
                                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center"
                                >
                                  <Download className="w-3.5 h-3.5 mr-2 text-emerald-600" />
                                  Download PDF
                                </button>
                                <button
                                  onClick={() => window.print()}
                                  className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center"
                                >
                                  <Printer className="w-3.5 h-3.5 mr-2 text-slate-500" />
                                  Print
                                </button>
                                {!isRev && (
                                  <button
                                    onClick={() => { setReverseModalPayment(item); setReversalReason(""); }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center"
                                  >
                                    <ShieldAlert className="w-3.5 h-3.5 mr-2 text-red-500" />
                                    Reverse payment
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-100/80 border-t border-slate-300 font-bold text-slate-900 text-xs">
                    <tr>
                      <td colSpan={5} className="py-3 px-4 uppercase text-slate-500 tracking-wider">Page Total</td>
                      <td className="py-3 px-4 text-right text-emerald-700">
                        {formatINR(paymentsData?.items?.reduce((sum: number, i: any) => sum + (i.amount_received || 0), 0))}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-700">
                        {formatINR(paymentsData?.items?.reduce((sum: number, i: any) => sum + (i.tds_amount || 0), 0))}
                      </td>
                      <td className="py-3 px-4 text-right text-blue-700">
                        {formatINR(paymentsData?.items?.reduce((sum: number, i: any) => sum + (i.amount_applied || 0), 0))}
                      </td>
                      <td className="py-3 px-4 text-right text-amber-700">
                        {formatINR(paymentsData?.items?.reduce((sum: number, i: any) => sum + (i.unapplied_amount || 0), 0))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
                <div className="flex items-center space-x-2">
                  <span>Showing</span>
                  <span className="font-semibold text-slate-900">
                    {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, paymentsData?.total || 0)}
                  </span>
                  <span>of</span>
                  <span className="font-semibold text-slate-900">{paymentsData?.total || 0}</span>
                  <span>items</span>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1">
                    <span>Per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => updateFilter("pageSize", e.target.value)}
                      className="border border-slate-300 rounded py-1 px-1.5 bg-white text-xs font-semibold"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      disabled={page <= 1}
                      onClick={() => updateFilter("page", page - 1)}
                      className="px-2.5 py-1 border border-slate-300 rounded bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold"
                    >
                      Prev
                    </button>
                    <span className="px-2 font-bold text-slate-800">{page}</span>
                    <button
                      disabled={page * pageSize >= (paymentsData?.total || 0)}
                      onClick={() => updateFilter("page", page + 1)}
                      className="px-2.5 py-1 border border-slate-300 rounded bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 6. CUSTOMER TDS HISTORY (COLLAPSIBLE) */}
      {tdsEnabled && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-5">
          <div
            onClick={() => setTdsCollapsed(!tdsCollapsed)}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-slate-900">Customer TDS History</h2>
              <span className="text-xs text-slate-400">({tdsHistory.length} entries)</span>
            </div>
            {tdsCollapsed ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronUp className="w-5 h-5 text-slate-400" />}
          </div>

          {!tdsCollapsed && (
            <div className="mt-4 pt-4 border-t border-slate-100 overflow-x-auto">
              {tdsHistory.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No TDS entries found.</p>
              ) : (
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Receipt No</th>
                      <th className="py-2 px-3">Invoice No</th>
                      <th className="py-2 px-3">Customer</th>
                      <th className="py-2 px-3 text-right">TDS %</th>
                      <th className="py-2 px-3 text-right">TDS Amount (₹)</th>
                      <th className="py-2 px-3">Section</th>
                      <th className="py-2 px-3">Certificate Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tdsHistory.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3">{formatDate(item.payment_date)}</td>
                        <td className="py-2 px-3 font-semibold">{item.receipt_no}</td>
                        <td className="py-2 px-3">{item.invoice_no || "-"}</td>
                        <td className="py-2 px-3 font-medium">{item.customer_name}</td>
                        <td className="py-2 px-3 text-right font-medium">{item.tds_rate}%</td>
                        <td className="py-2 px-3 text-right font-bold text-slate-800">{formatINR(item.tds_amount)}</td>
                        <td className="py-2 px-3 font-mono text-[11px]">{item.tds_section || "194C"}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                            {item.certificate_status || "Pending"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* 7. DETAIL DRAWER */}
      {selectedPayment && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl overflow-y-auto p-6 space-y-6 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-4 border-slate-200">
                <div>
                  <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Payment Details</span>
                  <h3 className="text-xl font-bold text-slate-900">{selectedPayment.receipt_no}</h3>
                </div>
                <button
                  onClick={() => setSelectedPayment(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Customer</span>
                  <span className="font-bold text-slate-900">{selectedPayment.customer_name}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Payment Date</span>
                  <span className="font-semibold text-slate-900">{formatDate(selectedPayment.payment_date)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Payment Mode</span>
                  <span className="font-semibold text-slate-900">{selectedPayment.payment_mode}</span>
                </div>
                {selectedPayment.reference_no && (
                  <div className="flex justify-between py-1.5 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Reference No</span>
                    <span className="font-mono text-slate-900">{selectedPayment.reference_no}</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Amount Received</span>
                  <span className="font-bold text-emerald-700 text-sm">{formatINR(selectedPayment.amount_received)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">TDS Deducted</span>
                  <span className="font-semibold text-slate-800">{formatINR(selectedPayment.tds_amount)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Amount Applied</span>
                  <span className="font-semibold text-blue-700">{formatINR(selectedPayment.amount_applied)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Unapplied Advance</span>
                  <span className="font-semibold text-amber-700">{formatINR(selectedPayment.unapplied_amount)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Status</span>
                  <StatusBadge status={selectedPayment.status} isReversed={selectedPayment.is_reversed} />
                </div>
              </div>

              {/* Document Allocations */}
              {selectedPayment.allocations?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-800">Document Allocations</h4>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-[11px] text-slate-700">
                      <thead className="bg-slate-50 font-semibold text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-1.5 px-2.5">Doc No</th>
                          <th className="py-1.5 px-2.5 text-right">Applied (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedPayment.allocations.map((alloc: any, idx: number) => (
                          <tr key={idx}>
                            <td className="py-1.5 px-2.5 font-medium">{alloc.invoice_no || alloc.document_id || "-"}</td>
                            <td className="py-1.5 px-2.5 text-right font-bold text-blue-700">{formatINR(alloc.amount || alloc.amount_allocated)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-between space-x-2">
              <button
                onClick={() => exportSinglePaymentInPdf(selectedPayment)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                onClick={() => setSelectedPayment(null)}
                className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. REVERSAL CONFIRMATION MODAL */}
      {reverseModalPayment && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-600">
              <ShieldAlert className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">Reverse Payment</h3>
            </div>
            <p className="text-xs text-slate-600">
              Are you sure you want to reverse payment <strong>{reverseModalPayment.receipt_no}</strong> for <strong>{formatINR(reverseModalPayment.amount_received)}</strong>? Document balances will be restored.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reason for Reversal *</label>
              <textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="e.g. Cheque bounce, wrong entry, customer dispute..."
                rows={3}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            {reversalError && (
              <p className="text-xs text-red-600 font-semibold">{reversalError}</p>
            )}
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setReverseModalPayment(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={!reversalReason.trim() || reverseMutation.isPending}
                onClick={() => reverseMutation.mutate({ paymentId: reverseModalPayment.id, reason: reversalReason })}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
              >
                {reverseMutation.isPending ? "Reversing..." : "Confirm Reversal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. NEW PAYMENT WIZARD MODAL (WITH ADVANCE HANDLING) */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-6">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-3 border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-900">New Payment Receipt</h3>
                <p className="text-xs text-slate-500">Step {wizardStep} of 3</p>
              </div>
              <button onClick={() => setWizardOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Steps Indicator */}
            <div className="flex items-center justify-between text-xs font-semibold border-b pb-3">
              <span className={wizardStep === 1 ? "text-emerald-600 font-bold" : "text-slate-400"}>1. Customer</span>
              <ChevronRight className="w-4 h-4 text-slate-300" />
              <span className={wizardStep === 2 ? "text-emerald-600 font-bold" : "text-slate-400"}>2. Details</span>
              <ChevronRight className="w-4 h-4 text-slate-300" />
              <span className={wizardStep === 3 ? "text-emerald-600 font-bold" : "text-slate-400"}>3. Review</span>
            </div>

            {/* STEP 1: CUSTOMER */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                <label className="block text-xs font-semibold text-slate-700">Select Customer *</label>
                <select
                  value={wizCustomer?.id || ""}
                  onChange={(e) => {
                    const found = customers.find((c: any) => c.id === e.target.value);
                    setWizCustomer(found);
                  }}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- Choose Customer --</option>
                  {customers.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                <div className="flex justify-end pt-4">
                  <button
                    disabled={!wizCustomer}
                    onClick={() => setWizardStep(2)}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
                  >
                    Next: Details
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: DETAILS */}
            {wizardStep === 2 && (
              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1 text-xs">
                
                {/* PROMINENT AVAILABLE ADVANCE BANNER / ACTION */}
                {wizCustomerAdvanceAvailable > 0.01 && (
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-purple-900">Unapplied Advance Available: {formatINR(wizCustomerAdvanceAvailable)}</p>
                        <p className="text-[11px] text-purple-700">You can apply available advance to pending invoices without recording a new cash flow.</p>
                      </div>
                    </div>
                    {Object.keys(wizAllocations).length > 0 && (
                      <button
                        type="button"
                        disabled={applyAdvanceMutation.isPending}
                        onClick={() => {
                          const firstDoc = Object.keys(wizAllocations)[0];
                          const allocAmt = wizAllocations[firstDoc] || Number(wizAmount || 0);
                          const amtToApply = Math.min(allocAmt, wizCustomerAdvanceAvailable);
                          if (firstDoc && amtToApply > 0) {
                            applyAdvanceMutation.mutate({
                              customerId: wizCustomer.id,
                              invoiceId: firstDoc,
                              amount: amtToApply
                            });
                          }
                        }}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded text-xs font-semibold shrink-0"
                      >
                        {applyAdvanceMutation.isPending ? "Applying..." : "Apply Advance Now"}
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Payment Date *</label>
                    <input
                      type="date"
                      value={wizDate}
                      onChange={(e) => setWizDate(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 font-medium"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Amount Received (₹) *</label>
                    <input
                      type="number"
                      value={wizAmount}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setWizAmount(val);
                      }}
                      className="w-full border border-slate-300 rounded-lg p-2 font-bold text-emerald-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Payment Mode *</label>
                    <select
                      value={wizMode}
                      onChange={(e) => setWizMode(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 font-medium"
                    >
                      <option value="Cash">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Card">Card</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Reference No {["UPI", "Bank Transfer", "Cheque", "Card"].includes(wizMode) && "*"}
                    </label>
                    <input
                      type="text"
                      value={wizRefNo}
                      onChange={(e) => setWizRefNo(e.target.value)}
                      placeholder="Transaction / Ref ID"
                      className="w-full border border-slate-300 rounded-lg p-2"
                    />
                  </div>
                </div>

                {wizMode === "Cheque" && (
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Cheque No</label>
                      <input
                        type="text"
                        value={wizChequeNo}
                        onChange={(e) => setWizChequeNo(e.target.value)}
                        className="w-full border border-slate-300 rounded p-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Cheque Date</label>
                      <input
                        type="date"
                        value={wizChequeDate}
                        onChange={(e) => setWizChequeDate(e.target.value)}
                        className="w-full border border-slate-300 rounded p-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Bank Name</label>
                      <input
                        type="text"
                        value={wizBankName}
                        onChange={(e) => setWizBankName(e.target.value)}
                        className="w-full border border-slate-300 rounded p-1.5"
                      />
                    </div>
                  </div>
                )}

                {/* Open Documents Allocation Section */}
                <div className="border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-800 text-xs">Document Allocations</h4>
                      <p className="text-[11px] text-slate-500">Apply payment amount against pending invoices / proformas</p>
                    </div>
                    <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wizAdvance}
                        onChange={(e) => setWizAdvance(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>Record as Advance</span>
                    </label>
                  </div>

                  {isWizDocsLoading ? (
                    <div className="py-3 text-center text-xs text-slate-400">Loading pending documents...</div>
                  ) : wizCustomerDocs.length === 0 ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start space-x-2 text-blue-800">
                      <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold">No pending documents, recording as advance</p>
                        <p className="text-[11px] text-blue-600">This customer has no unpaid tax invoices or unconverted proformas. Payment will be stored as an unapplied advance balance.</p>
                      </div>
                    </div>
                  ) : wizAdvance ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800">
                      <p className="font-semibold">Advance Payment Mode Active</p>
                      <p className="text-[11px] text-amber-600">Entire amount of {formatINR(wizAmount)} will be credited to customer's unapplied balance.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto bg-white rounded-lg border border-slate-200">
                      <table className="w-full text-left text-[11px] text-slate-700">
                        <thead className="bg-slate-100 font-semibold text-slate-600 uppercase border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-2">Doc No</th>
                            <th className="py-2 px-2">Type</th>
                            <th className="py-2 px-2">Date</th>
                            <th className="py-2 px-2 text-right">Balance Due (₹)</th>
                            <th className="py-2 px-2 text-right">Allocate (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {wizCustomerDocs.map((doc: any) => {
                            const did = doc.id || doc.document_id;
                            const bal = Number(doc.balance_due || 0);
                            const currentAlloc = wizAllocations[did] ?? 0;
                            return (
                              <tr key={did} className="hover:bg-slate-50">
                                <td className="py-2 px-2 font-semibold text-slate-900">{doc.document_no}</td>
                                <td className="py-2 px-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                    doc.document_type === "proforma" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"
                                  }`}>
                                    {doc.document_type === "proforma" ? "Pro Forma" : "Tax Invoice"}
                                  </span>
                                </td>
                                <td className="py-2 px-2">{formatDate(doc.document_date)}</td>
                                <td className="py-2 px-2 text-right font-semibold text-slate-700">{formatINR(bal)}</td>
                                <td className="py-2 px-2 text-right">
                                  <input
                                    type="number"
                                    min="0"
                                    max={bal}
                                    value={currentAlloc}
                                    onChange={(e) => {
                                      const val = Math.min(bal, Math.max(0, parseFloat(e.target.value) || 0));
                                      setWizAllocations(prev => ({ ...prev, [did]: val }));
                                    }}
                                    className="w-24 border border-slate-300 rounded px-2 py-1 text-right font-bold text-emerald-700 text-xs"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* TDS Section */}
                <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Deduct TDS</span>
                    <input
                      type="checkbox"
                      checked={wizTdsEnabled}
                      onChange={(e) => setWizTdsEnabled(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                  </div>
                  {wizTdsEnabled && (
                    <div className="grid grid-cols-3 gap-2 pt-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600">Rate %</label>
                        <input
                          type="number"
                          value={wizTdsRate}
                          onChange={(e) => {
                            const r = parseFloat(e.target.value) || 0;
                            setWizTdsRate(r);
                            setWizTdsAmount((Number(wizAmount || 0) * r) / 100);
                          }}
                          className="w-full border border-slate-300 rounded p-1.5"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600">Amount (₹)</label>
                        <input
                          type="number"
                          value={wizTdsAmount}
                          onChange={(e) => setWizTdsAmount(parseFloat(e.target.value) || 0)}
                          className="w-full border border-slate-300 rounded p-1.5 font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600">Section</label>
                        <select
                          value={wizTdsSection}
                          onChange={(e) => setWizTdsSection(e.target.value)}
                          className="w-full border border-slate-300 rounded p-1.5"
                        >
                          <option value="194C">194C (Contractor)</option>
                          <option value="194J">194J (Professional)</option>
                          <option value="194H">194H (Commission)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {wizError && <p className="text-xs text-red-600 font-semibold">{wizError}</p>}

                <div className="flex justify-between pt-4 border-t border-slate-200">
                  <button
                    onClick={() => setWizardStep(1)}
                    className="px-4 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setWizardStep(3)}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold"
                  >
                    Next: Review
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: REVIEW */}
            {wizardStep === 3 && (
              <div className="space-y-4 text-xs">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Customer</span>
                    <span className="font-bold text-slate-900">{wizCustomer?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Payment Date</span>
                    <span className="font-semibold text-slate-900">{formatDate(wizDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Payment Mode</span>
                    <span className="font-semibold text-slate-900">{wizMode}</span>
                  </div>
                  {wizRefNo && (
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-medium">Reference No</span>
                      <span className="font-mono text-slate-900">{wizRefNo}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="text-slate-700 font-bold">Total Amount Received</span>
                    <span className="font-bold text-emerald-700 text-sm">{formatINR(wizAmount)}</span>
                  </div>
                </div>

                {wizError && <p className="text-xs text-red-600 font-semibold">{wizError}</p>}

                <div className="flex justify-between pt-4 border-t border-slate-200">
                  <button
                    disabled={wizSaveLoading}
                    onClick={() => setWizardStep(2)}
                    className="px-4 py-2 border border-slate-300 rounded-lg font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    disabled={wizSaveLoading}
                    onClick={handleSavePayment}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-bold shadow-md flex items-center space-x-2"
                  >
                    {wizSaveLoading ? (
                      <span>Creating Receipt...</span>
                    ) : (
                      <span>Confirm & Create Receipt</span>
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* 10. RECORD PAYMENT MODAL (SECTION 4) */}
      {recordPaymentDoc && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b pb-3 border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Record Payment</h3>
                <p className="text-xs text-slate-500">Record customer payment against invoice {recordPaymentDoc.invoice_no}</p>
              </div>
              <button
                onClick={() => setRecordPaymentDoc(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Read-Only Display (Required: Invoice No, Customer Name, Invoice Total, Previously Received, Outstanding Balance) */}
            <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Invoice Number:</span>
                <span className="font-bold text-slate-900">{recordPaymentDoc.invoice_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Customer Name:</span>
                <span className="font-semibold text-slate-800">{recordPaymentDoc.customer_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Invoice Total:</span>
                <span className="font-bold text-slate-900">
                  {formatINR(recordPaymentDoc.invoice_total ?? recordPaymentDoc.grand_total ?? recordPaymentDoc.total_amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Previously Received:</span>
                <span className="font-semibold text-emerald-700">
                  {formatINR(recordPaymentDoc.total_received ?? 0)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold">
                <span className="text-slate-700">Outstanding Balance:</span>
                <span className="text-amber-700">
                  {formatINR(recordPaymentDoc.balance_due)}
                </span>
              </div>
            </div>

            {/* User Input: Payment Date, Payment Amount, Payment Method, Reference Number, Notes */}
            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Date *</label>
                  <input
                    type="date"
                    value={recordPaymentDate}
                    onChange={(e) => setRecordPaymentDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={Number(recordPaymentDoc.balance_due || 0)}
                    value={recordPaymentAmount}
                    onChange={(e) => {
                      const val = e.target.value === "" ? "" : parseFloat(e.target.value);
                      setRecordPaymentAmount(val);
                    }}
                    placeholder="Enter amount"
                    className="w-full border border-slate-300 rounded-lg p-2 font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Method *</label>
                  <select
                    value={recordPaymentMode}
                    onChange={(e) => setRecordPaymentMode(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Card">Card</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Reference Number</label>
                  <input
                    type="text"
                    value={recordPaymentRefNo}
                    onChange={(e) => setRecordPaymentRefNo(e.target.value)}
                    placeholder="e.g. UTR / Cheque / Txn ID"
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                <textarea
                  value={recordPaymentNotes}
                  onChange={(e) => setRecordPaymentNotes(e.target.value)}
                  placeholder="Additional remarks or notes..."
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg p-2 text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              {recordPaymentError && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{recordPaymentError}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRecordPaymentDoc(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={recordPaymentMutation.isPending || !recordPaymentAmount || Number(recordPaymentAmount) <= 0}
                onClick={handleSaveRecordPayment}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs flex items-center space-x-1.5"
              >
                {recordPaymentMutation.isPending ? "Saving..." : "Save Payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. VIEW DETAILS MODAL */}
      {viewDetailsDoc && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b pb-3 border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{viewDetailsDoc.invoice_no}</h3>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                  (viewDetailsDoc.invoice_type === "proforma" || viewDetailsDoc.invoice_no?.startsWith("PI-"))
                    ? "bg-purple-100 text-purple-800 border border-purple-200"
                    : "bg-slate-100 text-slate-800 border border-slate-200"
                }`}>
                  {(viewDetailsDoc.invoice_type === "proforma" || viewDetailsDoc.invoice_no?.startsWith("PI-")) ? "Pro Forma Invoice" : "Tax Invoice"}
                </span>
              </div>
              <button
                onClick={() => setViewDetailsDoc(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-1.5">
                <div className="font-bold text-slate-900 text-sm">{viewDetailsDoc.customer_name}</div>
                {viewDetailsDoc.customer_phone && <div className="text-slate-600">Phone: {viewDetailsDoc.customer_phone}</div>}
                {viewDetailsDoc.customer_gstin && <div className="text-slate-600 font-mono">GSTIN: {viewDetailsDoc.customer_gstin}</div>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Invoice Date</span>
                  <span className="font-semibold text-slate-900">{formatDate(viewDetailsDoc.invoice_date)}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Due Date</span>
                  <span className="font-semibold text-slate-900">{viewDetailsDoc.due_date ? formatDate(viewDetailsDoc.due_date) : "-"}</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 p-3 space-y-2">
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Total Invoice Amount:</span>
                  <span className="font-bold text-slate-900">{formatINR(viewDetailsDoc.invoice_total ?? viewDetailsDoc.grand_total ?? viewDetailsDoc.total_amount)}</span>
                </div>
                {(viewDetailsDoc.advance_received ?? viewDetailsDoc.advance_applied) > 0 && (
                  <div className="flex justify-between py-1">
                    <span className="text-slate-600">Advance Received:</span>
                    <span className="font-semibold text-blue-700">{formatINR(viewDetailsDoc.advance_received ?? viewDetailsDoc.advance_applied)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Total Amount Received:</span>
                  <span className="font-bold text-emerald-700">{formatINR(viewDetailsDoc.total_received ?? 0)}</span>
                </div>
                <div className="flex justify-between py-1 text-sm font-bold">
                  <span className="text-slate-900">Outstanding Balance:</span>
                  <span className="text-amber-700">{formatINR(viewDetailsDoc.balance_due)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setViewDetailsDoc(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              {Number(viewDetailsDoc.balance_due || 0) > 0.01 && (
                <button
                  onClick={() => {
                    const docToPay = viewDetailsDoc;
                    setViewDetailsDoc(null);
                    handleOpenRecordPayment(docToPay);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  Record Payment
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
