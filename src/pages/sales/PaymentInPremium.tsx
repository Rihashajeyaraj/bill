import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eye, FileDown, FilePenLine, FileSpreadsheet, Mail, Plus, Save, Search, Trash2, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import DateInput from "../../components/DateInput";
import FieldLabelText from "../../components/FieldLabelText";
import {
  COUNTRY_CONFIG,
  COUNTRY_NAME_TO_CODE,
  COUNTRY_OPTIONS,
  formatPaymentModeLabel,
  normalizePaymentMode,
  paymentStatusLabel,
  type CountryCode,
  type PaymentMode,
  type PaymentStatus
} from "../../modules/paymentIn/countryConfig";
import {
  applySelectedAdvanceWalletEntriesToCustomerInvoice,
  getSelectedPaymentCountry,
  listCustomerAdvanceWalletEntries,
  listCustomerAdvanceWalletHistory,
  listPaymentIn,
  mapCustomersByCountry,
  mapOpenInvoicesByCountry,
  outstandingByCustomer,
  paymentInAllocationTdsShare,
  paymentInsightsByCustomer,
  removePaymentIn,
  savePaymentIn,
  setSelectedPaymentCountry,
  summarizePaymentIn,
  type CustomerOpenInvoice,
  type PaymentInRecord
} from "../../modules/paymentIn/store";
import {
  applySelectedCreditNotesToInvoice,
  listCreditNotesForCustomerMatch
} from "../../modules/creditNote/store";
import {
  calculateTdsAmount,
  computeEditorTotals,
  defaultForm,
  formFromRecord,
  formatMoney,
  isCustomTdsCategory,
  TDS_CATEGORY_OPTIONS,
  getTdsRateForCategory,
  parseNumber
} from "../../modules/paymentIn/utils";
import { exportPaymentInCsv, exportPaymentInSummaryPdf, exportSinglePaymentInPdf } from "../../modules/paymentIn/pdf";
import type { PaymentInFormState } from "../../modules/paymentIn/types";
import { authGetRole, authGetUser } from "../../services/auth.service";
import { canCreateEntries, canDeleteEntries, canEditEntries, roleTypeLabel } from "../../services/roles";
import { useOrganization } from "../../context/OrganizationContext";
import { creditNotesSyncFromRemote } from "../../services/creditNotes.service";
import { invoicesSyncFromRemote } from "../../services/invoices.service";
import { deletePaymentInRemote, paymentsSyncFromRemote, syncPaymentInRemote } from "../../services/payments.service";
import { salesProformasSyncFromRemote } from "../../services/proformas.service";
import { syncPartiesFromRemote } from "../../modules/parties/store";
import { isOrganizationScopedStorageEventKey, LS_KEYS, lsGetOrganizationScoped } from "../../services/storage";
import { formatInputNumberByPreference, normalizeFormattedNumberInput } from "../../lib/formatPreferences";
import FlowCard from "../../modules/paymentIn/FlowCard";
import FlowStepTabs from "../../modules/paymentIn/FlowStepTabs";
import PaymentModePicker from "../../modules/paymentIn/PaymentModePicker";
import PaymentInSkeleton from "../../modules/paymentIn/PaymentInSkeleton";
import AuditDrawer from "../../modules/paymentIn/AuditDrawer";
import { useGlobalLoadingBridge } from "../../hooks/useGlobalLoadingBridge";

const STEPS = ["Customer", "Details", "Review"];
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const CREDIT_NOTE_PREMIUM_KEY = "creditNotesPremiumV1";

type PanelMode = "feed" | "flow";
type FlowMode = "create" | "edit" | "view";

function roleAccess(role: string, user: any) {
  const configured = Array.isArray(user?.allowedCountries) ? user.allowedCountries.filter((entry: string) => entry in COUNTRY_CONFIG) : [];
  return {
    roleType: roleTypeLabel(role) as "Admin" | "Staff",
    allowedCountries: configured.length ? configured : COUNTRY_OPTIONS.map((entry) => entry.code)
  };
}

function canReopenWithinWindow(record: PaymentInRecord | null) {
  if (!record || record.status !== "Applied") return false;
  const touched = new Date(record.audit.modifiedAt).getTime();
  return Number.isFinite(touched) && Date.now() - touched <= EDIT_WINDOW_MS;
}

function statusBadgeClass(status: PaymentStatus) {
  if (status === "Applied") return "bg-emerald-100 text-emerald-700";
  if (status === "Confirmed") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function resolveFixedCountry(organizationCountry: string, organizationCountryCode: string): CountryCode {
  const rawCode = String(organizationCountryCode || "").trim().toUpperCase();
  if (rawCode === "LK") return "SL";
  if (rawCode === "GB") return "UK";
  if (rawCode && rawCode in COUNTRY_CONFIG) return rawCode as CountryCode;

  const raw = String(organizationCountry || "").trim();
  if (raw && raw in COUNTRY_CONFIG) return raw as CountryCode;
  if (raw && COUNTRY_NAME_TO_CODE[raw]) return COUNTRY_NAME_TO_CODE[raw];
  const saved = getSelectedPaymentCountry();
  if (saved && saved in COUNTRY_CONFIG) return saved;
  return "IN";
}

function normalizePhoneForLookup(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) digits = digits.slice(-10);
  digits = digits.replace(/^0+/, "");
  return digits || "0";
}

function normalizeIdentityName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function customerAddressSummary(customer: any) {
  return [customer?.address, customer?.state, customer?.country]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function numberInputValue(value: unknown) {
  const numeric = parseNumber(value as any);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return formatInputNumberByPreference(value);
}

function documentTypeLabel(documentType: "invoice" | "proforma") {
  return documentType === "proforma" ? "Proforma" : "Invoice";
}

function paymentLinkedDocumentSummary(record: Pick<PaymentInRecord, "allocations">) {
  const allocations = Array.isArray(record?.allocations) ? record.allocations : [];
  if (!allocations.length) return "-";

  const labels = allocations
    .map((line) => {
      const invoiceNo = String(line?.invoiceNo || "").trim();
      if (!invoiceNo) return "";
      return `${documentTypeLabel((line?.documentType || "invoice") as "invoice" | "proforma")} ${invoiceNo}`;
    })
    .filter(Boolean);

  if (!labels.length) return "-";
  return labels.join(", ");
}

function formatTdsPercent(value: unknown) {
  const rate = Math.max(0, parseNumber(value as any));
  return `${rate}%`;
}

function buildAllocation(document: CustomerOpenInvoice | null, amountReceived: unknown) {
  if (!document) return [];
  const amount = Math.max(0, parseNumber(amountReceived as any));
  return [
    {
      invoiceId: document.id,
      invoiceNo: document.invoiceNo,
      invoiceDate: document.invoiceDate,
      invoiceAmount: document.invoiceAmount,
      discountAmount: document.discountAmount,
      taxableAmount: document.taxableAmount,
      taxAmount: document.taxAmount,
      balanceDue: document.balanceDue,
      applyAmount: Math.min(amount, document.balanceDue),
      documentType: document.documentType
    }
  ];
}

function withAdjustedDocumentBalance(document: CustomerOpenInvoice | null, advanceUsed = 0) {
  if (!document) return null;
  return {
    ...document,
    balanceDue: Math.max(0, Number(document.balanceDue || 0) - Math.max(0, Number(advanceUsed || 0)))
  };
}

function updatePrimaryAllocationAmount(allocations: any[], nextInvoiceAmount: number) {
  if (!Array.isArray(allocations) || !allocations.length) return allocations;
  return allocations.map((line, index) =>
    index === 0
      ? {
          ...line,
          invoiceAmount: nextInvoiceAmount
        }
      : line
  );
}

function calculatedTdsInputValue(amountReceived: unknown, tdsRate: unknown) {
  return String(calculateTdsAmount(amountReceived, tdsRate));
}

function autoTdsBaseAmount(document: CustomerOpenInvoice | null, allocationMode: "linked" | "normal", fallbackAmount: unknown) {
  if (allocationMode === "linked") {
    const taxableAmount = Math.max(0, parseNumber(document?.taxableAmount as any));
    if (taxableAmount > 0) return taxableAmount;
  }
  return Math.max(0, parseNumber(fallbackAmount as any));
}

function normalizeRegion(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function buildDocumentGstLines({
  taxAmount,
  taxBreakup,
  supplyType,
  companyState,
  partyState
}: {
  taxAmount: unknown;
  taxBreakup?: Record<string, unknown> | null;
  supplyType?: unknown;
  companyState?: unknown;
  partyState?: unknown;
}) {
  const totalTax = Math.max(0, parseNumber(taxAmount as any));
  const cgstValue = Math.max(0, parseNumber((taxBreakup as any)?.cgst));
  const sgstValue = Math.max(0, parseNumber((taxBreakup as any)?.sgst));
  const igstValue = Math.max(0, parseNumber((taxBreakup as any)?.igst));

  if (cgstValue > 0 || sgstValue > 0 || igstValue > 0) {
    return [
      cgstValue > 0 ? { label: "CGST", value: cgstValue } : null,
      sgstValue > 0 ? { label: "SGST", value: sgstValue } : null,
      igstValue > 0 ? { label: "IGST", value: igstValue } : null
    ].filter(Boolean) as Array<{ label: string; value: number }>;
  }

  if (totalTax <= 0) return [];

  const normalizedSupplyType = String(supplyType || "").trim().toUpperCase();
  const intraState =
    normalizedSupplyType === "INTRA" ||
    (normalizedSupplyType !== "INTER" &&
      normalizeRegion(companyState) &&
      normalizeRegion(companyState) === normalizeRegion(partyState));

  if (intraState) {
    const cgst = Number((totalTax / 2).toFixed(2));
    const sgst = Number((totalTax - cgst).toFixed(2));
    return [
      { label: "CGST", value: cgst },
      { label: "SGST", value: sgst }
    ];
  }

  return [{ label: "IGST", value: totalTax }];
}

function fallbackOpenInvoiceFromStorage(
  country: CountryCode,
  invoiceId: string,
  customers: Array<{ id: string; name?: string; phone?: string; state?: string }>
): CustomerOpenInvoice | null {
  const invoices = lsGetOrganizationScoped(LS_KEYS.invoices, []);
  const source = Array.isArray(invoices) ? invoices : [];
  const invoice = source.find((entry: any) => String(entry?.id || entry?.invoiceId || entry?.invoice_id || "").trim() === invoiceId);
  if (!invoice) return null;

  const total = Math.max(
    0,
    parseNumber(
      invoice?.totals?.grandTotal ??
        invoice?.totals?.finalTotal ??
        invoice?.totals?.total ??
        invoice?.grandTotal ??
        invoice?.finalTotal ??
        invoice?.total ??
        invoice?.amount
    )
  );
  const storedBalance = Math.max(
    0,
    parseNumber(invoice?.totals?.balance ?? invoice?.remainingBalance ?? invoice?.balanceAmount ?? total)
  );
  if (storedBalance <= 0) return null;

  const rawCustomerId = String(
    invoice?.partyId || invoice?.party_id || invoice?.customerId || invoice?.customer_id || invoice?.buyer?.id || ""
  ).trim();
  const rawCustomerName = String(
    invoice?.partyName || invoice?.party_name || invoice?.customerName || invoice?.customer_name || invoice?.buyer?.name || "Customer"
  ).trim();
  const rawCustomerPhone = normalizePhoneForLookup(
    invoice?.phone ||
      invoice?.partyPhone ||
      invoice?.party_phone ||
      invoice?.customerPhone ||
      invoice?.customer_phone ||
      invoice?.buyer?.phone ||
      ""
  );

  const matchedCustomer =
    customers.find((entry) => rawCustomerId && String(entry?.id || "").trim() === rawCustomerId) ||
    customers.find((entry) => {
      if (normalizeIdentityName(entry?.name) !== normalizeIdentityName(rawCustomerName)) return false;
      const customerPhone = normalizePhoneForLookup(entry?.phone || "");
      if (rawCustomerPhone && customerPhone) return rawCustomerPhone === customerPhone;
      return true;
    }) ||
    null;

  return {
    id: invoiceId,
    invoiceNo: String(invoice?.invoiceNo || invoice?.invoice_no || invoiceId).trim(),
    country,
    customerId: String(matchedCustomer?.id || rawCustomerId || rawCustomerName || "unknown_customer").trim(),
    customerName: String(matchedCustomer?.name || rawCustomerName || "Customer").trim(),
    customerState: String(invoice?.buyer?.state || invoice?.partyState || invoice?.party_state || invoice?.customerState || matchedCustomer?.state || "").trim(),
    invoiceDate: String(invoice?.invoiceDate || invoice?.invoice_date || invoice?.date || "").trim(),
    invoiceAmount: total,
    discountAmount: Math.max(
      0,
      parseNumber(invoice?.totals?.discountTotal ?? invoice?.totals?.discount ?? invoice?.discountTotal ?? 0)
    ),
    taxableAmount: Math.max(
      0,
      parseNumber(invoice?.totals?.subTotal ?? invoice?.totals?.taxableTotal ?? invoice?.taxableTotal ?? total)
    ),
    taxAmount: Math.max(
      0,
      parseNumber(invoice?.totals?.taxTotal ?? invoice?.totals?.taxAmount ?? invoice?.taxTotal ?? 0)
    ),
    taxBreakup:
      invoice?.totals?.taxBreakup && typeof invoice.totals.taxBreakup === "object"
        ? invoice.totals.taxBreakup
        : invoice?.taxBreakup && typeof invoice.taxBreakup === "object"
          ? invoice.taxBreakup
          : null,
    supplyType:
      invoice?.supplyType ||
      invoice?.totals?.tax?.supplyType ||
      invoice?.totals?.taxBreakup?.supplyType ||
      null,
    balanceDue: storedBalance,
    documentType: "invoice"
  };
}

export default function PaymentInPremium() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile: company = {}, country: organizationCountry, countryCode: organizationCountryCode } = useOrganization();
  const user = authGetUser();
  const role = authGetRole();
  const access = useMemo(() => roleAccess(role, user), [role, user]);
  const canCreatePayment = canCreateEntries(role);
  const canEditPayment = canEditEntries(role);
  const canDeletePayment = canDeleteEntries(role);
  const actorName = user?.name || user?.email || "System User";

  const country = useMemo<CountryCode>(
    () => resolveFixedCountry(organizationCountry, organizationCountryCode),
    [organizationCountry, organizationCountryCode]
  );
  const [panelMode, setPanelMode] = useState<PanelMode>("feed");
  const [flowMode, setFlowMode] = useState<FlowMode>("create");
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState<PaymentInFormState | null>(null);
  const [activePayment, setActivePayment] = useState<PaymentInRecord | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccessPopup, setSaveSuccessPopup] = useState("");
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showAudit, setShowAudit] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "">("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [customerLookupQuery, setCustomerLookupQuery] = useState("");
  const [customerSearchError, setCustomerSearchError] = useState("");
  const [useAdvanceWallet, setUseAdvanceWallet] = useState(false);
  const [selectedAdvancePaymentIds, setSelectedAdvancePaymentIds] = useState<string[]>([]);
  const [selectedCreditNoteIds, setSelectedCreditNoteIds] = useState<string[]>([]);
  const [advanceWalletPickerOpen, setAdvanceWalletPickerOpen] = useState(false);
  const [creditNotePickerOpen, setCreditNotePickerOpen] = useState(false);
  const savingRef = useRef(false);
  useGlobalLoadingBridge(loading || saving, "payment-in");

  const payments = useMemo(() => listPaymentIn(country), [country, refreshKey]);
  const customers = useMemo(() => mapCustomersByCountry(country), [country, refreshKey]);
  const openInvoices = useMemo(() => mapOpenInvoicesByCountry(country), [country, refreshKey]);
  const summary = useMemo(() => summarizePaymentIn(country), [country, refreshKey]);

  const customerOutstandingBefore = useMemo(() => (form?.customerId ? outstandingByCustomer(country, form.customerId) : 0), [country, form?.customerId, refreshKey]);
  const customerInsights = useMemo(() => (form?.customerId ? paymentInsightsByCustomer(country, form.customerId) : { lastPaymentDate: "", advanceWallet: 0, totalReceived: 0, paymentCount: 0 }), [country, form?.customerId, refreshKey]);
  const customerAdvanceHistory = useMemo(
    () => (form?.customerId ? listCustomerAdvanceWalletHistory(country, form.customerId) : []),
    [country, form?.customerId, refreshKey]
  );
  const customerAdvanceEntries = useMemo(
    () => (form?.customerId ? listCustomerAdvanceWalletEntries(country, form.customerId) : []),
    [country, form?.customerId, refreshKey]
  );
  const selectedCustomer = useMemo(() => customers.find((entry) => entry.id === form?.customerId) || null, [customers, form?.customerId]);
  const customerCreditNotes = useMemo(
    () => (
      form?.customerId || form?.customerInput
        ? listCreditNotesForCustomerMatch(country, form?.customerId || "", selectedCustomer?.name || form?.customerInput || "", form?.selectedDocumentId || "")
        : []
    ),
    [country, form?.customerId, form?.customerInput, form?.selectedDocumentId, selectedCustomer?.name, refreshKey]
  );
  const selectedAdvancePaymentIdSet = useMemo(
    () => new Set(selectedAdvancePaymentIds.map((entry) => String(entry || "").trim()).filter(Boolean)),
    [selectedAdvancePaymentIds]
  );
  const selectedCreditNoteIdSet = useMemo(
    () => new Set(selectedCreditNoteIds.map((entry) => String(entry || "").trim()).filter(Boolean)),
    [selectedCreditNoteIds]
  );
  const customerTdsHistory = useMemo(
    () =>
      payments
        .filter((entry) => entry.customerId === form?.customerId)
        .filter((entry) => Math.max(0, Number(entry?.totals?.tdsAmount || 0)) > 0)
        .flatMap((entry) => {
          const allocations = Array.isArray(entry?.allocations) ? entry.allocations : [];
          if (!allocations.length) {
            return [
              {
                id: `tds_${entry.id}`,
                date: entry.paymentDate || "",
                invoiceNo: "-",
                customerName: entry.customerName || "-",
                tdsRate: Number(entry?.tdsRate || 0),
                tdsAmount: Math.max(0, Number(entry?.totals?.tdsAmount || 0))
              }
            ];
          }
          return allocations
            .map((allocation, index) => ({
              id: `tds_${entry.id}_${allocation.invoiceId || index}`,
              date: entry.paymentDate || "",
              invoiceNo: allocation.invoiceNo || "-",
              customerName: entry.customerName || "-",
              tdsRate: Number(entry?.tdsRate || 0),
              tdsAmount: paymentInAllocationTdsShare(entry, allocation)
            }))
            .filter((row) => row.tdsAmount > 0);
        })
        .sort((left, right) => {
          const byDate = String(right.date || "").localeCompare(String(left.date || ""));
          if (byDate !== 0) return byDate;
          return String(right.id || "").localeCompare(String(left.id || ""));
        }),
    [form?.customerId, payments]
  );
  const totals = useMemo(
    () =>
      form
        ? computeEditorTotals(form, customerOutstandingBefore)
        : { amountReceived: 0, tdsAmount: 0, totalSettled: 0, amountApplied: 0, unappliedAmount: 0, outstandingAfter: 0 },
    [form, customerOutstandingBefore]
  );
  const availableAdvanceBalance = useMemo(() => Math.max(0, Number(customerInsights.advanceWallet || 0)), [customerInsights.advanceWallet]);
  const selectedAdvancePaymentBalance = useMemo(
    () =>
      customerAdvanceEntries.reduce((sum, entry) => {
        if (!selectedAdvancePaymentIdSet.has(String(entry.paymentId || "").trim())) return sum;
        return sum + Math.max(0, Number(entry.availableAmount || 0));
      }, 0),
    [customerAdvanceEntries, selectedAdvancePaymentIdSet]
  );
  const selectedCreditNoteBalance = useMemo(
    () =>
      customerCreditNotes.reduce((sum, entry: any) => {
        if (!selectedCreditNoteIdSet.has(String(entry.id || "").trim())) return sum;
        return sum + Math.max(0, Number(entry.availableAmount || 0));
      }, 0),
    [customerCreditNotes, selectedCreditNoteIdSet]
  );
  const customerDocuments = useMemo(
    () =>
      openInvoices.filter(
        (entry) =>
          entry.customerId === form?.customerId && Math.max(0, Number(entry?.balanceDue || 0)) > 0
      ),
    [openInvoices, form?.customerId]
  );
  const selectedCustomerDocument = useMemo(() => {
    const liveDocument = customerDocuments.find((entry) => entry.id === form?.selectedDocumentId);
    if (liveDocument) return liveDocument;
    const savedDocument = form?.allocations?.[0];
    if (!savedDocument) return null;
    return {
      id: savedDocument.invoiceId,
      invoiceNo: savedDocument.invoiceNo,
      country,
      customerId: form?.customerId || "",
      customerName: form?.customerInput || "",
      customerState: selectedCustomer?.state || "",
      invoiceDate: savedDocument.invoiceDate,
      invoiceAmount: savedDocument.invoiceAmount,
      discountAmount: savedDocument.discountAmount ?? 0,
      taxableAmount: savedDocument.taxableAmount ?? savedDocument.invoiceAmount,
      taxAmount: savedDocument.taxAmount ?? 0,
      taxBreakup: null,
      supplyType: null,
      balanceDue: savedDocument.balanceDue,
      documentType: savedDocument.documentType || "invoice"
    } satisfies CustomerOpenInvoice;
  }, [country, customerDocuments, form?.allocations, form?.customerId, form?.customerInput, form?.selectedDocumentId, selectedCustomer?.state]);
  const invoiceGstLines = useMemo(
    () =>
      buildDocumentGstLines({
        taxAmount: selectedCustomerDocument?.taxAmount,
        taxBreakup: selectedCustomerDocument?.taxBreakup || null,
        supplyType: selectedCustomerDocument?.supplyType,
        companyState: company?.address?.state || company?.state || "",
        partyState: selectedCustomerDocument?.customerState || selectedCustomer?.state || ""
      }),
    [company?.address?.state, company?.state, selectedCustomer?.state, selectedCustomerDocument]
  );
  const selectedDocumentPaymentHistory = useMemo(() => {
    if (!selectedCustomerDocument) return [];
    return payments
      .filter((entry) => entry.status !== "Draft")
      .flatMap((entry) =>
        (Array.isArray(entry.allocations) ? entry.allocations : [])
          .filter(
            (allocation) =>
              (
                String(allocation?.invoiceId || "") === String(selectedCustomerDocument.id) ||
                (
                  String(allocation?.invoiceNo || "").trim().toLowerCase() ===
                    String(selectedCustomerDocument.invoiceNo || "").trim().toLowerCase() &&
                  String(entry?.customerId || "") === String(selectedCustomerDocument.customerId || "")
                )
              ) &&
              String(allocation?.documentType || "invoice") === String(selectedCustomerDocument.documentType || "invoice")
          )
          .map((allocation, index) => {
            const appliedAmount = Math.max(0, parseNumber(allocation?.applyAmount as any));
            const tdsShare = Math.max(0, paymentInAllocationTdsShare(entry, allocation));
            return {
              id: `${entry.id}_${allocation.invoiceId || index}`,
              receiptNo: entry.receiptNo || "-",
              paymentDate: entry.paymentDate || "",
              paymentMode: formatPaymentModeLabel(entry.paymentMode),
              appliedAmount,
              tdsShare,
              settledAmount: appliedAmount + tdsShare,
              referenceNo: entry.referenceNo || entry.transactionId || ""
            };
          })
      )
      .filter((entry) => entry.appliedAmount > 0 || entry.tdsShare > 0)
      .sort((left, right) => {
        const byDate = String(right.paymentDate || "").localeCompare(String(left.paymentDate || ""));
        if (byDate !== 0) return byDate;
        return String(right.receiptNo || "").localeCompare(String(left.receiptNo || ""));
      });
  }, [payments, selectedCustomerDocument]);
  const inferredPreviouslySettledAmount = useMemo(() => {
    if (!selectedCustomerDocument) return 0;
    return Math.max(
      0,
      parseNumber(selectedCustomerDocument.invoiceAmount as any) - parseNumber(selectedCustomerDocument.balanceDue as any)
    );
  }, [selectedCustomerDocument]);
  const selectedDocumentPreviouslyPaidAmount = useMemo(
    () =>
      Math.max(
        selectedDocumentPaymentHistory.reduce((sum, entry) => sum + entry.appliedAmount, 0),
        inferredPreviouslySettledAmount
      ),
    [inferredPreviouslySettledAmount, selectedDocumentPaymentHistory]
  );
  useEffect(() => {
    if (!form || form.allocationMode !== "linked" || !selectedCustomerDocument) return;
    const invoiceAmount = Math.max(0, parseNumber(selectedCustomerDocument.invoiceAmount as any));
    const taxableAmount = Math.max(0, parseNumber(selectedCustomerDocument.taxableAmount as any));
    const discountAmount = Math.max(0, parseNumber((selectedCustomerDocument as any).discountAmount as any));
    const gstAmount = Math.max(0, parseNumber(selectedCustomerDocument.taxAmount as any));
    const tdsPercentage = Math.max(0, parseNumber(form.tdsRate as any));
    const calculatedTdsAmount = calculateTdsAmount(
      autoTdsBaseAmount(selectedCustomerDocument, form.allocationMode, form.amountReceived),
      tdsPercentage
    );
    console.log("[PaymentIn:TDS]", {
      invoiceAmount,
      taxableAmount,
      discountAmount,
      gstAmount,
      tdsPercentage,
      calculatedTdsAmount
    });
  }, [
    form,
    selectedCustomerDocument
  ]);
  const advanceWalletUsable = useMemo(() => {
    if (!useAdvanceWallet) return 0;
    if (!selectedCustomerDocument || selectedCustomerDocument.documentType !== "invoice") return 0;
    return Math.max(0, Math.min(selectedAdvancePaymentBalance, Number(selectedCustomerDocument.balanceDue || 0)));
  }, [selectedAdvancePaymentBalance, selectedCustomerDocument, useAdvanceWallet]);
  const creditNoteUsable = useMemo(() => {
    if (!selectedCustomerDocument || selectedCustomerDocument.documentType !== "invoice") return 0;
    return Math.max(0, Math.min(selectedCreditNoteBalance, Math.max(0, Number(selectedCustomerDocument.balanceDue || 0) - advanceWalletUsable)));
  }, [advanceWalletUsable, selectedCreditNoteBalance, selectedCustomerDocument]);
  const documentBalanceAfterAdvance = useMemo(() => {
    if (!selectedCustomerDocument) return 0;
    return Math.max(0, Number(selectedCustomerDocument.balanceDue || 0) - advanceWalletUsable - creditNoteUsable);
  }, [advanceWalletUsable, creditNoteUsable, selectedCustomerDocument]);
  const totalAvailableCreditNoteBalance = useMemo(
    () =>
      customerCreditNotes.reduce(
        (sum: number, row: any) => sum + Math.max(0, Number(row.availableAmount || 0)),
        0
      ),
    [customerCreditNotes]
  );
  const effectiveSelectedDocumentBalance = useMemo(() => {
    if (!selectedCustomerDocument) return 0;
    if (selectedCustomerDocument.documentType !== "invoice") {
      return Math.max(0, Number(selectedCustomerDocument.balanceDue || 0));
    }
    return documentBalanceAfterAdvance;
  }, [documentBalanceAfterAdvance, selectedCustomerDocument]);
  const remainingWalletBalance = useMemo(
    () => Math.max(0, selectedAdvancePaymentBalance - advanceWalletUsable),
    [selectedAdvancePaymentBalance, advanceWalletUsable]
  );
  useEffect(() => {
    setUseAdvanceWallet(selectedAdvancePaymentIds.length > 0);
  }, [selectedAdvancePaymentIds]);
  useEffect(() => {
    setSelectedAdvancePaymentIds([]);
    setSelectedCreditNoteIds([]);
  }, [form?.customerId, form?.selectedDocumentId]);
  const editableInvoiceAmount = useMemo(() => {
    const allocationInvoiceAmount = form?.allocations?.[0]?.invoiceAmount;
    if (allocationInvoiceAmount !== undefined && allocationInvoiceAmount !== null && allocationInvoiceAmount !== "") {
      return parseNumber(allocationInvoiceAmount as any);
    }
    return parseNumber(selectedCustomerDocument?.invoiceAmount as any);
  }, [form?.allocations, selectedCustomerDocument?.invoiceAmount]);
  const displayedInvoiceAmount = useMemo(() => {
    if (form?.allocationMode === "linked" && selectedCustomerDocument) {
      return effectiveSelectedDocumentBalance;
    }
    return editableInvoiceAmount;
  }, [editableInvoiceAmount, effectiveSelectedDocumentBalance, form?.allocationMode, selectedCustomerDocument]);
  const remainingPayableAfterPayment = useMemo(
    () => Math.max(0, documentBalanceAfterAdvance - totals.totalSettled),
    [documentBalanceAfterAdvance, totals.totalSettled]
  );
  const maxReceivableAmount = useMemo(() => {
    if (form?.allocationMode !== "linked" || !selectedCustomerDocument) return null;
    return Math.max(0, effectiveSelectedDocumentBalance);
  }, [effectiveSelectedDocumentBalance, form?.allocationMode, selectedCustomerDocument]);
  const filteredPayments = useMemo(() => payments.filter((entry) => {
    const allocationText = (Array.isArray(entry.allocations) ? entry.allocations : [])
      .map((allocation) =>
        [
          allocation?.invoiceNo,
          allocation?.invoiceId,
          allocation?.documentType
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(" ")
      )
      .join(" ");
    const haystack = `${entry.customerName} ${entry.receiptNo} ${entry.referenceNo || ""} ${entry.transactionId || ""} ${allocationText}`.toLowerCase();
    const q = search.trim().toLowerCase();
    const matchFrom = fromDate ? entry.paymentDate >= fromDate : true;
    const matchTo = toDate ? entry.paymentDate <= toDate : true;
    return (
      (!q || haystack.includes(q)) &&
      (!statusFilter || entry.status === statusFilter) &&
      (!customerFilter || entry.customerId === customerFilter) &&
      (!modeFilter || normalizePaymentMode(entry.paymentMode) === normalizePaymentMode(modeFilter)) &&
      matchFrom &&
      matchTo
    );
  }), [payments, search, statusFilter, customerFilter, modeFilter, fromDate, toDate]);
  const paymentTdsHistory = useMemo(
    () =>
      filteredPayments
        .filter((entry) => Math.max(0, Number(entry?.totals?.tdsAmount || 0)) > 0)
        .flatMap((entry) => {
          const allocations = Array.isArray(entry?.allocations) ? entry.allocations : [];
          if (!allocations.length) {
            return [
              {
                id: `tds_feed_${entry.id}`,
                date: entry.paymentDate || "",
                invoiceNo: "-",
                customerName: entry.customerName || "-",
                tdsRate: Number(entry?.tdsRate || 0),
                tdsAmount: Math.max(0, Number(entry?.totals?.tdsAmount || 0))
              }
            ];
          }
          return allocations
            .map((allocation, index) => ({
              id: `tds_feed_${entry.id}_${allocation.invoiceId || index}`,
              date: entry.paymentDate || "",
              invoiceNo: allocation.invoiceNo || "-",
              customerName: entry.customerName || "-",
              tdsRate: Number(entry?.tdsRate || 0),
              tdsAmount: paymentInAllocationTdsShare(entry, allocation)
            }))
            .filter((row) => row.tdsAmount > 0);
        })
        .sort((left, right) => {
          const byDate = String(right.date || "").localeCompare(String(left.date || ""));
          if (byDate !== 0) return byDate;
          return String(right.id || "").localeCompare(String(left.id || ""));
        }),
    [filteredPayments]
  );
  const customerLookupResults = useMemo(() => {
    const query = String(customerLookupQuery || "").trim().toLowerCase();
    if (!query) return [];
    const normalizedPhoneQuery = normalizePhoneForLookup(query);
    return customers
      .filter((customer) => {
        const text = [
          customer?.name,
          customer?.email,
          customer?.address,
          customer?.state,
          customer?.country
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        const customerPhone = normalizePhoneForLookup(customer?.phone);
        return (
          text.includes(query) ||
          (normalizedPhoneQuery && customerPhone && customerPhone.includes(normalizedPhoneQuery))
        );
      })
      .slice(0, 8);
  }, [customers, customerLookupQuery]);

  const allowed = access.allowedCountries.includes(country);
  const readOnly = flowMode === "view";
  const prefillInvoiceId = searchParams.get("invoiceId") || "";
  const prefillInvoice = useMemo(() => {
    if (!prefillInvoiceId) return null;
    return (
      openInvoices.find((entry) => entry.id === prefillInvoiceId) ||
      fallbackOpenInvoiceFromStorage(country, prefillInvoiceId, customers)
    );
  }, [country, customers, openInvoices, prefillInvoiceId]);
  useEffect(() => {
    setSelectedPaymentCountry(country);
  }, [country]);

  useEffect(() => {
    let mounted = true;
    async function syncReferenceData() {
      try {
        await Promise.allSettled([
          syncPartiesFromRemote(),
          invoicesSyncFromRemote(),
          salesProformasSyncFromRemote(),
          paymentsSyncFromRemote(),
          creditNotesSyncFromRemote()
        ]);
      } catch {
        // Continue with local cache.
      } finally {
        if (mounted) setRefreshKey((prev) => prev + 1);
      }
    }
    syncReferenceData();
    return () => {
      mounted = false;
    };
  }, [country]);

  useEffect(() => {
    let disposed = false;

    const refreshReferences = async () => {
      try {
        await Promise.allSettled([
          syncPartiesFromRemote(),
          invoicesSyncFromRemote(),
          salesProformasSyncFromRemote(),
          paymentsSyncFromRemote(),
          creditNotesSyncFromRemote()
        ]);
      } finally {
        if (!disposed) setRefreshKey((prev) => prev + 1);
      }
    };

    const onStorage = (event: StorageEvent) => {
      const key = event?.key || "";
      if (
        isOrganizationScopedStorageEventKey(LS_KEYS.parties, key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.invoices, key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.sales_proformas, key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.payments, key) ||
        isOrganizationScopedStorageEventKey(LS_KEYS.creditNotes, key) ||
        isOrganizationScopedStorageEventKey(CREDIT_NOTE_PREMIUM_KEY, key)
      ) {
        setRefreshKey((prev) => prev + 1);
      }
    };

    const onFocus = () => {
      void refreshReferences();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [country]);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 180);
    return () => window.clearTimeout(timer);
  }, [country]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!prefillInvoiceId) return;
    const invoice = prefillInvoice;
    if (!invoice) return;

    setForm((prev) => {
      const base = prev || defaultForm(country, company);
      return {
        ...base,
        customerId: invoice.customerId,
        customerInput: invoice.customerName,
        allocationMode: "linked",
        selectedDocumentId: invoice.id,
        allocations: buildAllocation(invoice, base.amountReceived)
      };
    });
    setPanelMode("flow");
    setFlowMode("create");
    setActiveStep(1);
    setDirty(false);

    const next = new URLSearchParams(searchParams);
    next.delete("invoiceId");
    setSearchParams(next, { replace: true });
  }, [prefillInvoice, prefillInvoiceId, country, company, searchParams, setSearchParams]);

  useEffect(() => {
    if (!form || form.allocationMode !== "linked" || !form.selectedDocumentId) return;
    setForm((prev) => {
      if (!prev || prev.allocationMode !== "linked" || !prev.selectedDocumentId) return prev;
      const linkedDocument =
        customerDocuments.find((entry) => entry.id === prev.selectedDocumentId) || null;
      return {
        ...prev,
        allocations: buildAllocation(
          withAdjustedDocumentBalance(
            linkedDocument,
            linkedDocument?.documentType === "invoice" ? advanceWalletUsable + creditNoteUsable : 0
          ),
          prev.amountReceived
        )
      };
    });
  }, [advanceWalletUsable, creditNoteUsable, customerDocuments, form?.allocationMode, form?.amountReceived, form?.selectedDocumentId]);

  function clearMessages() {
    setErrorMessage("");
    setSuccessMessage("");
    setFieldErrors({});
  }

  function clearFieldError(field: string) {
    setFieldErrors((prev) => {
      if (!prev?.[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function startNewPayment() {
    if (!allowed) return;
    if (!canCreatePayment) {
      setErrorMessage("You do not have permission to create payment receipts.");
      setSuccessMessage("");
      return;
    }
    setForm(defaultForm(country, company));
    setActivePayment(null);
    setPanelMode("flow");
    setFlowMode("create");
    setActiveStep(0);
    setDirty(false);
    setUseAdvanceWallet(false);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
    clearMessages();
  }

  function openFlow(record: PaymentInRecord, mode: FlowMode) {
    if (record.country !== country) return;
    if (mode === "edit" && !canEditPayment) {
      setErrorMessage("You do not have permission to edit payment receipts.");
      setSuccessMessage("");
      return;
    }
    if (mode === "edit" && record.status === "Applied" && !canReopenWithinWindow(record)) return;
    setForm(formFromRecord(record));
    setActivePayment(record);
    setPanelMode("flow");
    setFlowMode(mode);
    setActiveStep(mode === "view" ? 2 : 0);
    setDirty(false);
    setUseAdvanceWallet(false);
    clearMessages();
  }

  function backToFeed() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setPanelMode("feed");
    setFlowMode("create");
    setActiveStep(0);
    setForm(null);
    setActivePayment(null);
    setDirty(false);
    setUseAdvanceWallet(false);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
    clearMessages();
  }

  function updateForm<K extends keyof PaymentInFormState>(key: K, value: PaymentInFormState[K]) {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "amountReceived" && next.allocationMode === "linked" && next.selectedDocumentId) {
        const linkedDocument =
          openInvoices.find(
            (entry) => entry.id === next.selectedDocumentId && entry.customerId === next.customerId
          ) || null;
        const effectiveBalance = Math.max(
          0,
          Number(linkedDocument?.balanceDue || 0) -
            (linkedDocument?.documentType === "invoice" ? advanceWalletUsable + creditNoteUsable : 0)
        );
        next.allocations = linkedDocument
          ? [
              {
                invoiceId: linkedDocument.id,
                invoiceNo: linkedDocument.invoiceNo,
                invoiceDate: linkedDocument.invoiceDate,
                invoiceAmount: linkedDocument.invoiceAmount,
                balanceDue: effectiveBalance,
                applyAmount: Math.min(Math.max(0, parseNumber(value as any)), effectiveBalance),
                documentType: linkedDocument.documentType
              }
            ]
          : [];
      }
      return next;
    });
    setDirty(true);
  }

  function handleAmountReceivedChange(value: string) {
    setForm((prev) => {
      if (!prev) return prev;
      let nextAmountReceived = value;
      if (prev.allocationMode === "linked" && prev.selectedDocumentId) {
        const linkedDocument =
          openInvoices.find(
            (entry) => entry.id === prev.selectedDocumentId && entry.customerId === prev.customerId
          ) || null;
        const cappedAmount = linkedDocument
          ? Math.min(
              Math.max(0, parseNumber(value as any)),
              Math.max(
                0,
                Number(linkedDocument.balanceDue || 0) -
                  (linkedDocument?.documentType === "invoice" ? advanceWalletUsable + creditNoteUsable : 0)
              )
            )
          : Math.max(0, parseNumber(value as any));
        nextAmountReceived = String(cappedAmount);
      }
      const next = { ...prev, amountReceived: nextAmountReceived };
      if (next.allocationMode === "linked" && next.selectedDocumentId) {
        const linkedDocument =
          openInvoices.find(
            (entry) => entry.id === next.selectedDocumentId && entry.customerId === next.customerId
          ) || null;
        next.allocations = buildAllocation(
          withAdjustedDocumentBalance(
            linkedDocument,
            linkedDocument?.documentType === "invoice" ? advanceWalletUsable + creditNoteUsable : 0
          ),
          nextAmountReceived
        );
        if (!next.isManual) {
          next.tdsAmount = calculatedTdsInputValue(
            autoTdsBaseAmount(linkedDocument, next.allocationMode, nextAmountReceived),
            next.tdsRate
          );
        }
        return next;
      }
      if (!next.isManual) {
        next.tdsAmount = calculatedTdsInputValue(
          autoTdsBaseAmount(null, next.allocationMode, value),
          next.tdsRate
        );
      }
      return next;
    });
    clearFieldError("amountReceived");
    clearFieldError("tdsAmount");
    setDirty(true);
  }

  function handleInvoiceAmountChange(value: string) {
    setForm((prev) => {
      if (!prev) return prev;
      const nextInvoiceAmount = Math.max(0, parseNumber(value));
      return {
        ...prev,
        allocations: updatePrimaryAllocationAmount(prev.allocations, nextInvoiceAmount)
      };
    });
    setDirty(true);
  }

  function handleTdsAmountChange(value: string) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            tdsAmount: value,
            tdsCategory: "none",
            tdsRate: "0",
            isManual: false
          }
        : prev
    );
    clearFieldError("tdsAmount");
    setDirty(true);
  }

  function handleTdsCategoryChange(category: string) {
    if (isCustomTdsCategory(category)) {
      setForm((prev) =>
        prev
          ? {
              ...prev,
              tdsCategory: "custom",
              tdsAmount: calculatedTdsInputValue(
                autoTdsBaseAmount(selectedCustomerDocument, prev.allocationMode, prev.amountReceived),
                prev.tdsRate
              ),
              isManual: false
            }
          : prev
      );
      clearFieldError("tdsAmount");
      setDirty(true);
      return;
    }
    const nextRate = getTdsRateForCategory(category);
    setForm((prev) =>
      prev
        ? {
            ...prev,
            tdsCategory: category,
            tdsRate: String(nextRate),
            tdsAmount: calculatedTdsInputValue(
              autoTdsBaseAmount(selectedCustomerDocument, prev.allocationMode, prev.amountReceived),
              nextRate
            ),
            isManual: false
          }
        : prev
    );
    clearFieldError("tdsAmount");
    setDirty(true);
  }

  function handleTdsRateChange(value: string) {
    setForm((prev) => {
      if (!prev) return prev;
      const parsedRate = Math.max(0, parseNumber(value));
      const matchedOption = TDS_CATEGORY_OPTIONS.find((option) => option.rate === parsedRate);
      return {
        ...prev,
        tdsCategory: matchedOption ? matchedOption.value : "custom",
        tdsRate: value,
        tdsAmount: calculatedTdsInputValue(
          autoTdsBaseAmount(selectedCustomerDocument, prev.allocationMode, prev.amountReceived),
          value
        ),
        isManual: false
      };
    });
    clearFieldError("tdsAmount");
    setDirty(true);
  }

  function applyCalculatedTds() {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            tdsAmount: calculatedTdsInputValue(
              autoTdsBaseAmount(selectedCustomerDocument, prev.allocationMode, prev.amountReceived),
              prev.tdsRate
            ),
            isManual: false
          }
        : prev
    );
    clearFieldError("tdsAmount");
    setDirty(true);
  }

  function handleAllocationModeChange(mode: "linked" | "normal") {
    setForm((prev) => {
      if (!prev) return prev;
      if (mode === "normal") {
        return {
          ...prev,
          allocationMode: "normal",
          selectedDocumentId: "",
          allocations: []
        };
      }
      const linkedDocument =
        customerDocuments.find((entry) => entry.id === prev.selectedDocumentId) || null;
      const next = {
        ...prev,
        allocationMode: "linked",
        allocations: buildAllocation(
          withAdjustedDocumentBalance(
            linkedDocument,
            useAdvanceWallet && linkedDocument?.documentType === "invoice" ? advanceWalletUsable : 0
          ),
          prev.amountReceived
        )
      };
      if (!next.isManual) {
        next.tdsAmount = calculatedTdsInputValue(
          autoTdsBaseAmount(linkedDocument, next.allocationMode, next.amountReceived),
          next.tdsRate
        );
      }
      return next;
    });
    clearFieldError("selectedDocumentId");
    setDirty(true);
  }

  function handleDocumentSelection(documentId: string) {
    const linkedDocument = customerDocuments.find((entry) => entry.id === documentId) || null;
    setUseAdvanceWallet(false);
    setForm((prev) =>
      prev
        ? (() => {
            const next = {
              ...prev,
              allocationMode: "linked" as const,
              selectedDocumentId: linkedDocument?.id || "",
              allocations: buildAllocation(linkedDocument, prev.amountReceived)
            };
            if (!next.isManual) {
              next.tdsAmount = calculatedTdsInputValue(
                autoTdsBaseAmount(linkedDocument, next.allocationMode, next.amountReceived),
                next.tdsRate
              );
            }
            return next;
          })()
        : prev
    );
    clearFieldError("selectedDocumentId");
    setDirty(true);
  }

  function applyCustomer(customerId: string, inputName?: string) {
    const customer = customers.find((entry) => entry.id === customerId);
    setForm((prev) =>
      prev
        ? {
            ...prev,
            customerId,
            customerInput: inputName || customer?.name || prev.customerInput,
            allocationMode: "normal",
            selectedDocumentId: "",
            registrationNumber: customer?.registrationNumber || prev.registrationNumber,
            allocations: []
          }
        : prev
    );
    setUseAdvanceWallet(false);
    setDirty(true);
  }

  function applyCustomerSelection(customer: any) {
    if (!customer) return;
    applyCustomer(customer.id, customer.name);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
  }

  function handleCustomerLookupChange(value: string) {
    setCustomerLookupQuery(value);
    setCustomerSearchError("");
  }

  function handleCustomerSearch() {
    const query = String(customerLookupQuery || "").trim();
    if (query.length < 2) {
      setCustomerSearchError("Enter at least 2 characters to search.");
      return;
    }
    if (!customerLookupResults.length) {
      setCustomerSearchError("No customer found.");
      return;
    }
    if (customerLookupResults.length === 1) {
      applyCustomerSelection(customerLookupResults[0]);
      return;
    }
    setCustomerSearchError("Multiple customers found. Select one below.");
  }

  function resetCustomerSelection() {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            customerId: "",
            customerInput: "",
            allocationMode: "normal",
            selectedDocumentId: "",
            allocations: []
          }
        : prev
    );
    setDirty(true);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
    setUseAdvanceWallet(false);
  }

  function validate(targetStatus: PaymentStatus) {
    if (!form) return false;
    const cfg = COUNTRY_CONFIG[country];
    const errors: Record<string, string> = {};
    const amountReceived = Math.max(0, parseNumber(form.amountReceived));
    if (!form.paymentDate) errors.paymentDate = "Payment date is required.";
    if (!form.customerId) errors.customerId = "Customer is required.";
    if (amountReceived <= 0) errors.amountReceived = "Amount received must be greater than zero.";
    if (form.allocationMode === "linked" && !form.selectedDocumentId) {
      errors.selectedDocumentId = "Select an invoice or proforma invoice.";
    }
    if (cfg.registrationRequired && !form.registrationNumber.trim()) errors.registrationNumber = `${cfg.registrationLabel} is required.`;
    if (cfg.registrationRegex && form.registrationNumber.trim() && !cfg.registrationRegex.test(form.registrationNumber.trim())) errors.registrationNumber = `Invalid ${cfg.registrationLabel} format.`;
    if (form.paymentMode === "Cheque") {
      if (!form.chequeNo.trim()) errors.chequeNo = "Cheque number is required.";
      if (!form.bankName.trim()) errors.bankName = "Bank name is required.";
    }
    if (form.paymentMode === "Net Banking" && !form.bankAccount.trim()) errors.bankAccount = "Bank account is required.";
    if ((form.paymentMode === "Net Banking" || form.paymentMode === "Card" || form.paymentMode === "UPI" || form.paymentMode === "Online Gateway") && !form.transactionId.trim()) errors.transactionId = "Transaction ID is required.";
    if (targetStatus === "Applied") {
      if (form.allocationMode !== "linked" || !form.selectedDocumentId) {
        errors.selectedDocumentId = "Select an invoice or proforma and confirm the payment before applying it.";
      } else if (totals.amountApplied <= 0) {
        errors.selectedDocumentId = "Applied amount must be greater than zero before applying this payment.";
      }
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      if (errors.customerId) {
        setActiveStep(0);
      } else if (
        errors.amountReceived ||
        errors.selectedDocumentId ||
        errors.paymentDate ||
        errors.registrationNumber ||
        errors.chequeNo ||
        errors.bankName ||
        errors.bankAccount ||
        errors.transactionId
      ) {
        setActiveStep(1);
      }
      setErrorMessage(Object.values(errors)[0] || "Please fix the highlighted fields before saving.");
      setSuccessMessage("");
      return false;
    }
    return true;
  }

  function buildPayload(targetStatus: PaymentStatus, options?: { id?: string; outstandingOverride?: number }) {
    if (!form) return null;
    const customer = customers.find((entry) => entry.id === form.customerId);
    return {
      id: options?.id ?? form.id,
      country,
      paymentDate: form.paymentDate,
      customerId: form.customerId,
      customerName: customer?.name || form.customerInput || "Customer",
      paymentMode: form.paymentMode,
      referenceNo: form.referenceNo,
      chequeNo: form.chequeNo,
      bankName: form.bankName,
      bankAccount: form.bankAccount,
      transactionId: form.transactionId,
      paymentReference: form.paymentReference,
      registrationNumber: form.registrationNumber,
      internalNotes: form.internalNotes,
      customerNotes: form.customerNotes,
      attachment: form.attachment,
      desiredStatus: targetStatus,
      amountReceived: parseNumber(form.amountReceived),
      tdsRate: parseNumber(form.tdsRate),
      tdsAmount: parseNumber(form.tdsAmount),
      tdsCategory: form.tdsCategory,
      isManual: false,
      allocations: form.allocations,
      customerOutstandingBefore:
        typeof options?.outstandingOverride === "number" ? options.outstandingOverride : customerOutstandingBefore,
      actor: actorName
    };
  }

  async function persist(
    targetStatus: PaymentStatus,
    options?: { email?: boolean; download?: boolean },
    payloadOptions?: { id?: string; outstandingOverride?: number }
  ) {
    if (!form) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("Saving payment...");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const isEditMode = !!form?.id;
    if (isEditMode && !canEditPayment) {
      setErrorMessage("You do not have permission to edit payment receipts.");
      setSuccessMessage("");
      savingRef.current = false;
      setSaving(false);
      return;
    }
    if (!isEditMode && !canCreatePayment) {
      setErrorMessage("You do not have permission to create payment receipts.");
      setSuccessMessage("");
      savingRef.current = false;
      setSaving(false);
      return;
    }
    if (!validate(targetStatus)) {
      savingRef.current = false;
      setSaving(false);
      return;
    }
    try {
      const payload = buildPayload(targetStatus, payloadOptions);
      if (!payload) return;
      const saved = savePaymentIn(payload);
      if (!saved) return;
      const savedMessage = `${saved.receiptNo} payment saved successfully.`;
      setSuccessMessage(savedMessage);
      setErrorMessage("");
      setSaveSuccessPopup(savedMessage);
      if (options?.download) exportSinglePaymentInPdf(saved);
      if (options?.email) window.alert(`Email queued for ${saved.receiptNo}.`);
      setRefreshKey((prev) => prev + 1);
      setActivePayment(saved);
      setForm(formFromRecord(saved));
      setFlowMode("edit");
      setActiveStep(2);
      setDirty(false);
      void syncPaymentInRemote(saved).then((remoteResult) => {
        if (remoteResult?.savedLocallyOnly) {
          setErrorMessage(remoteResult?.remoteSyncMessage || "Supabase denied access. Saved in local storage only.");
        }
      }).catch((syncError) => {
        console.warn("Payment In remote sync failed after local save", syncError);
      });
      return saved;
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to save payment.");
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function closeSaveSuccessPopup() {
    setSaveSuccessPopup("");
    setPanelMode("feed");
    setFlowMode("create");
    setActiveStep(0);
    setForm(null);
    setActivePayment(null);
    setDirty(false);
    setUseAdvanceWallet(false);
    setCustomerLookupQuery("");
    setCustomerSearchError("");
  }

  async function handleApply() {
    if (!form) return;
    if (!activePayment || activePayment.status !== "Confirmed") {
      setErrorMessage("Save this payment as Received before applying it.");
      setSuccessMessage("");
      return;
    }
    if (form.allocationMode !== "linked" || !form.selectedDocumentId || totals.amountApplied <= 0) {
      setFieldErrors((prev) => ({
        ...prev,
        selectedDocumentId: "Select an invoice or proforma and confirm the payment before applying it."
      }));
      setActiveStep(1);
      setErrorMessage("Confirm the payment and select a valid invoice or proforma before applying it.");
      setSuccessMessage("");
      return;
    }

    if (
      useAdvanceWallet &&
      selectedCustomerDocument &&
      selectedCustomerDocument.documentType === "invoice" &&
      advanceWalletUsable > 0
    ) {
      applySelectedAdvanceWalletEntriesToCustomerInvoice({
        country,
        customerId: form.customerId,
        invoiceId: selectedCustomerDocument.id,
        invoiceNo: selectedCustomerDocument.invoiceNo,
        invoiceDate: selectedCustomerDocument.invoiceDate,
        invoiceAmount: selectedCustomerDocument.invoiceAmount,
        selectedPaymentIds: selectedAdvancePaymentIds,
        maxApplyAmount: advanceWalletUsable,
        actor: actorName
      });
      setRefreshKey((prev) => prev + 1);
    }
    if (selectedCustomerDocument && creditNoteUsable > 0) {
      applySelectedCreditNotesToInvoice({
        country,
        customerId: form.customerId,
        invoiceId: selectedCustomerDocument.id,
        invoiceNo: selectedCustomerDocument.invoiceNo,
        invoiceDate: selectedCustomerDocument.invoiceDate,
        invoiceAmount: selectedCustomerDocument.invoiceAmount,
        selectedNoteIds: selectedCreditNoteIds,
        maxApplyAmount: creditNoteUsable,
        actor: actorName
      });
      setRefreshKey((prev) => prev + 1);
    }

    await persist(
      "Applied",
      undefined,
      activePayment
        ? {
            id: activePayment.id,
            outstandingOverride: activePayment.totals.customerOutstandingBefore
          }
        : undefined
    );
  }

  async function removeRecord(record: PaymentInRecord) {
    if (!canDeletePayment) {
      setErrorMessage("You do not have permission to delete payment receipts.");
      setSuccessMessage("");
      return;
    }
    if (record.status === "Applied") {
      setErrorMessage("Applied payment receipts cannot be deleted.");
      setSuccessMessage("");
      return;
    }
    const confirmed = window.confirm(`Delete ${record.receiptNo}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      removePaymentIn(record.id);
      await deletePaymentInRemote(record.id);
      if (activePayment?.id === record.id) {
        setPanelMode("feed");
        setFlowMode("create");
        setActiveStep(0);
        setForm(null);
        setActivePayment(null);
        setDirty(false);
      }
      setRefreshKey((prev) => prev + 1);
      setSuccessMessage(`${record.receiptNo} deleted successfully.`);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to delete payment receipt.");
      setSuccessMessage("");
    }
  }

  const saveStatus: PaymentStatus =
    activePayment?.status === "Applied" || activePayment?.status === "Confirmed" || activeStep === 2
      ? "Confirmed"
      : "Draft";
  const hasPreviousStep = activeStep > 0;
  const hasNextStep = activeStep < STEPS.length - 1;
  const canSaveCurrentFlow = !saving && (form?.id ? canEditPayment : canCreatePayment);

  return (
    <div className="mx-auto min-h-full max-w-[1360px] space-y-4 pb-36">
      {saving ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 backdrop-blur-sm">
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 text-center shadow-2xl">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
            <p className="text-sm font-semibold text-slate-900">Saving payment...</p>
            <p className="mt-1 text-xs text-slate-500">Please wait. Do not click again.</p>
          </div>
        </div>
      ) : null}

      {saveSuccessPopup ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-emerald-200 bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
              ✓
            </div>
            <p className="text-base font-semibold text-slate-900">Payment saved successfully</p>
            <p className="mt-2 text-sm text-slate-600">{saveSuccessPopup}</p>
            <button
              type="button"
              onClick={closeSaveSuccessPopup}
              className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}

      <div className="z-30 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-white/95 to-slate-50/95 px-3 py-2 shadow-sm backdrop-blur sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">Payment In</p>
            <p className="text-xs text-slate-500">Receive money from customers</p>
          </div>
          <div className="mx-auto w-full max-w-xs rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-slate-700 sm:mx-0 sm:flex-1 sm:max-w-sm">
            {COUNTRY_CONFIG[country].name} | {COUNTRY_CONFIG[country].currency}
          </div>
          <button onClick={startNewPayment} disabled={!allowed || !canCreatePayment} className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="h-4 w-4" />
            New Payment
          </button>
        </div>
      </div>

      {!allowed ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">You do not have access to manage {COUNTRY_CONFIG[country].name} data.</div>
      ) : (
        <div className="space-y-4">
          {panelMode === "feed" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <FlowCard title="Total Payments" subtitle="Count of receipts">{loading ? <PaymentInSkeleton /> : <p className="text-2xl font-bold text-slate-900">{summary?.count || 0}</p>}</FlowCard>
                <FlowCard title="Received Amount" subtitle="Actual incoming payment"><p className="text-2xl font-bold text-slate-900">{formatMoney(summary?.totalReceived || 0, country)}</p></FlowCard>
                <FlowCard title="Total Settled" subtitle="Received amount plus TDS"><p className="text-2xl font-bold text-slate-900">{formatMoney((summary?.totalReceived || 0) + (summary?.totalTds || 0), country)}</p></FlowCard>
                <FlowCard title="Advance Balance" subtitle="Amount kept on account"><p className="text-2xl font-bold text-slate-900">{formatMoney(summary?.totalUnallocated || 0, country)}</p></FlowCard>
              </div>

              <FlowCard>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, receipt, reference" className="search-field-input h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200" />
                  <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"><option value="">All Customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>
                  <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"><option value="">All Modes</option>{COUNTRY_CONFIG[country].paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as PaymentStatus | "")} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200"><option value="">All Status</option><option value="Draft">Draft</option><option value="Confirmed">Received</option><option value="Applied">Applied</option></select>
                  <DateInput value={fromDate} onChange={(nextValue) => setFromDate(nextValue)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200" />
                  <DateInput value={toDate} onChange={(nextValue) => setToDate(nextValue)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-slate-200" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={() => exportPaymentInSummaryPdf(filteredPayments, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><FileDown className="h-3.5 w-3.5" />Summary PDF</button>
                  <button onClick={() => exportPaymentInCsv(filteredPayments, country)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><FileSpreadsheet className="h-3.5 w-3.5" />CSV</button>
                </div>
              </FlowCard>

              {loading ? (
                <PaymentInSkeleton />
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="min-w-[1180px] w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-3 font-semibold">Receipt No</th>
                        <th className="px-3 py-3 font-semibold">Invoice No</th>
                        <th className="px-3 py-3 font-semibold">Date</th>
                        <th className="px-3 py-3 font-semibold">Customer</th>
                        <th className="px-3 py-3 font-semibold">Mode</th>
                        <th className="px-3 py-3 font-semibold text-right">Received Amount</th>
                        <th className="px-3 py-3 font-semibold text-right">TDS Amount</th>
                        <th className="px-3 py-3 font-semibold text-right">Total Settled</th>
                        <th className="px-3 py-3 font-semibold text-right">Advance Balance</th>
                        <th className="px-3 py-3 font-semibold">Status</th>
                        <th className="px-3 py-3 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!filteredPayments.length ? (
                        <tr className="border-t border-slate-100">
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={11}>
                            No payments found. Create a new payment to get started.
                          </td>
                        </tr>
                      ) : (
                        filteredPayments.map((record) => (
                          <tr key={record.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                            <td className="px-3 py-3 font-semibold text-slate-900">{record.receiptNo}</td>
                            <td className="px-3 py-3 text-slate-700">{paymentLinkedDocumentSummary(record)}</td>
                            <td className="px-3 py-3 text-slate-600">{record.paymentDate || "-"}</td>
                            <td className="px-3 py-3 text-slate-700">{record.customerName || "-"}</td>
                            <td className="px-3 py-3 text-slate-600">{formatPaymentModeLabel(record.paymentMode)}</td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-900">
                              {formatMoney(record?.totals?.amountReceived || 0, country)}
                            </td>
                            <td className="px-3 py-3 text-right font-semibold text-sky-700">
                              {formatMoney(record?.totals?.tdsAmount || 0, country)}
                            </td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-900">
                              {formatMoney(record?.totals?.totalSettled || 0, country)}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-700">
                              {formatMoney(record?.totals?.unappliedAmount || 0, country)}
                            </td>
                            <td className="px-3 py-3">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(record.status)}`}>
                                {paymentStatusLabel(record.status)}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => openFlow(record, "view")}
                                  title="View"
                                  aria-label="View"
                                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openFlow(record, "edit")}
                                  disabled={!canEditPayment || (record.status === "Applied" && !canReopenWithinWindow(record))}
                                  title="Edit"
                                  aria-label="Edit"
                                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <FilePenLine className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => exportSinglePaymentInPdf(record)}
                                  title="Download PDF"
                                  aria-label="Download PDF"
                                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
                                >
                                  <FileDown className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeRecord(record)}
                                  disabled={!canDeletePayment || record.status === "Applied"}
                                  title="Delete"
                                  aria-label="Delete"
                                  className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <FlowCard title="Customer TDS History" subtitle="Invoice-wise TDS deducted from Payment In receipts">
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="min-w-[760px] w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-3 font-semibold">Date</th>
                        <th className="px-3 py-3 font-semibold">Invoice No</th>
                        <th className="px-3 py-3 font-semibold">Customer</th>
                        <th className="px-3 py-3 font-semibold text-right">TDS %</th>
                        <th className="px-3 py-3 font-semibold text-right">TDS Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!paymentTdsHistory.length ? (
                        <tr className="border-t border-slate-100">
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                            No customer-side TDS history found for the current filters.
                          </td>
                        </tr>
                      ) : (
                        paymentTdsHistory.map((entry) => (
                          <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                            <td className="px-3 py-3 text-slate-700">{entry.date || "-"}</td>
                            <td className="px-3 py-3 text-slate-700">{entry.invoiceNo || "-"}</td>
                            <td className="px-3 py-3 text-slate-700">{entry.customerName || "-"}</td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatTdsPercent(entry.tdsRate)}</td>
                            <td className="px-3 py-3 text-right font-semibold text-sky-700">{formatMoney(entry.tdsAmount, country)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </FlowCard>
            </>
          ) : null}

          {panelMode === "flow" && form ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <button onClick={backToFeed} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><ArrowLeft className="h-4 w-4" />Back</button>
                <button onClick={() => setShowAudit(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Audit Timeline</button>
              </div>

              <FlowStepTabs steps={STEPS} activeStep={activeStep} onChange={setActiveStep} />

              {activeStep === 0 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <FlowCard title="Country Context" subtitle="Auto updates currency, label and legal wording">
                    <div className="space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">{COUNTRY_CONFIG[country].name}</div>
                      <p className="text-sm text-slate-700">Currency: <span className="font-semibold">{COUNTRY_CONFIG[country].currency}</span></p>
                      <p className="text-sm text-slate-700">Receipt Label: <span className="font-semibold">{COUNTRY_CONFIG[country].receiptLabel}</span></p>
                      <p className="text-xs text-slate-500">Payment In is locked to {COUNTRY_CONFIG[country].name}.</p>
                      <p className="text-xs text-slate-500">{COUNTRY_CONFIG[country].legalWording}</p>
                    </div>
                  </FlowCard>

                  <FlowCard title="Customer" subtitle="Search and pick a customer to begin">
                    <div className="space-y-3">
                      <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-600">
                          <FieldLabelText required className="text-xs font-semibold text-slate-600">
                            Customer Search
                          </FieldLabelText>
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={customerLookupQuery}
                            onChange={(event) => handleCustomerLookupChange(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                handleCustomerSearch();
                              }
                            }}
                            placeholder="Search customer/supplier by name, phone, email, or address"
                            disabled={readOnly}
                            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-slate-200 disabled:bg-slate-100 sm:min-w-[220px]"
                          />
                          <button
                            type="button"
                            onClick={handleCustomerSearch}
                            disabled={readOnly}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Search className="h-3.5 w-3.5" />
                            Search
                          </button>
                        </div>
                        {customerSearchError ? (
                          <p className="text-xs font-medium text-rose-600">{customerSearchError}</p>
                        ) : null}
                        {customerLookupQuery.trim() ? (
                          customerLookupResults.length ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {customerLookupResults.map((customer) => (
                                <button
                                  key={customer.id}
                                  type="button"
                                  onClick={() => applyCustomerSelection(customer)}
                                  disabled={readOnly}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <p className="text-sm font-semibold text-slate-900">{customer.name || "-"}</p>
                                  <p className="text-xs text-slate-600">{customer.phone || "-"}</p>
                                  <p className="text-xs text-slate-500">{customerAddressSummary(customer) || "-"}</p>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                              No customer found. Try another search.
                            </p>
                          )
                        ) : null}
                      </div>
                      {selectedCustomer ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                          <p className="font-semibold text-slate-900">{selectedCustomer.name || "-"}</p>
                          <p className="mt-1 text-slate-500">{selectedCustomer.phone || "-"}</p>
                          <p className="mt-1 text-slate-500">{selectedCustomer.email || "-"}</p>
                          <p className="mt-1 text-slate-500">{customerAddressSummary(selectedCustomer) || "-"}</p>
                        </div>
                      ) : null}
                      {form.customerId ? (
                        <button
                          type="button"
                          onClick={resetCustomerSelection}
                          disabled={readOnly}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Clear Selection
                        </button>
                      ) : null}
                      {fieldErrors.customerId ? <p className="text-xs text-rose-600">{fieldErrors.customerId}</p> : null}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-500">Outstanding</p><p className="font-semibold text-slate-900">{formatMoney(customerOutstandingBefore, country)}</p></div>
                        <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-500">Last Payment</p><p className="font-semibold text-slate-900">{customerInsights.lastPaymentDate || "-"}</p></div>
                        <div className="rounded-xl bg-slate-50 p-3 text-xs"><p className="text-slate-500">Available Advance Balance</p><p className="font-semibold text-amber-700">{formatMoney(customerInsights.advanceWallet, country)}</p></div>
                      </div>
                      {customerAdvanceHistory.length ? (
                        <div className="rounded-2xl border border-slate-200 bg-white">
                          <div className="border-b border-slate-100 px-3 py-2">
                            <p className="text-xs font-semibold text-slate-700">Advance Wallet History</p>
                          </div>
                          <div className="max-h-52 overflow-auto">
                            <table className="w-full min-w-[720px] text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Date</th>
                                  <th className="px-3 py-2 font-semibold">Receipt</th>
                                  <th className="px-3 py-2 font-semibold">Invoice</th>
                                  <th className="px-3 py-2 text-right font-semibold">Advance Added</th>
                                  <th className="px-3 py-2 text-right font-semibold">Advance Used</th>
                                  <th className="px-3 py-2 text-right font-semibold">Remaining Balance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {customerAdvanceHistory.slice(0, 12).map((entry) => (
                                  <tr key={entry.id} className="border-t border-slate-100">
                                    <td className="px-3 py-2 text-slate-700">{entry.date || "-"}</td>
                                    <td className="px-3 py-2 text-slate-700">{entry.receiptNo || "-"}</td>
                                    <td className="px-3 py-2 text-slate-700">{entry.invoiceNo || "-"}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                      {entry.amountAdded > 0 ? formatMoney(entry.amountAdded, country) : "-"}
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-sky-700">
                                      {entry.amountUsed > 0 ? formatMoney(entry.amountUsed, country) : "-"}
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                                      {formatMoney(entry.remainingBalance, country)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                      {customerTdsHistory.length ? (
                        <div className="rounded-2xl border border-slate-200 bg-white">
                          <div className="border-b border-slate-100 px-3 py-2">
                            <p className="text-xs font-semibold text-slate-700">Customer TDS History</p>
                          </div>
                          <div className="max-h-52 overflow-auto">
                            <table className="w-full min-w-[640px] text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Date</th>
                                  <th className="px-3 py-2 font-semibold">Invoice</th>
                                  <th className="px-3 py-2 font-semibold text-right">TDS %</th>
                                  <th className="px-3 py-2 text-right font-semibold">TDS Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {customerTdsHistory.slice(0, 12).map((entry) => (
                                  <tr key={entry.id} className="border-t border-slate-100">
                                    <td className="px-3 py-2 text-slate-700">{entry.date || "-"}</td>
                                    <td className="px-3 py-2 text-slate-700">{entry.invoiceNo || "-"}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatTdsPercent(entry.tdsRate)}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-sky-700">{formatMoney(entry.tdsAmount, country)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </FlowCard>
                </div>
              ) : null}

              {activeStep === 1 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <FlowCard title="Payment Details" subtitle="Core details for this receipt">
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3">
                        <label className="block">
                          <FieldLabelText required className="text-xs font-semibold text-slate-600">
                            Received Amount
                          </FieldLabelText>
                          <input
                            type="text"
                            value={numberInputValue(form.amountReceived)}
                            placeholder="0"
                            disabled={readOnly}
                            onChange={(event) => handleAmountReceivedChange(normalizeFormattedNumberInput(event.target.value))}
                            inputMode="decimal"
                            className="numeric-input-uniform mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-2xl font-bold text-slate-900 outline-none focus:ring-4 focus:ring-slate-200"
                          />
                          {fieldErrors.amountReceived ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.amountReceived}</p> : null}
                          {maxReceivableAmount !== null ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Received amount is capped to the selected document pending balance of {formatMoney(maxReceivableAmount, country)}.
                            </p>
                          ) : null}
                        </label>
                      </div>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-semibold text-slate-600">Amount Entry</p>
                          <div className="mt-3 grid grid-cols-1 gap-3">
                            <label className="block">
                              <span className="text-xs font-semibold text-slate-600">
                                {form.allocationMode === "linked" ? "Pending Amount" : "Invoice Amount"}
                              </span>
                              <input
                                type="text"
                                value={numberInputValue(displayedInvoiceAmount)}
                                disabled={readOnly || form.allocationMode === "linked"}
                                onChange={(event) => handleInvoiceAmountChange(normalizeFormattedNumberInput(event.target.value))}
                                inputMode="decimal"
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-200"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold text-slate-600">Received Amount</span>
                              <input
                                type="text"
                                value={numberInputValue(form.amountReceived)}
                                disabled={readOnly}
                                onChange={(event) => handleAmountReceivedChange(normalizeFormattedNumberInput(event.target.value))}
                                inputMode="decimal"
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-200"
                              />
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold text-slate-600">Total Settled Amount</span>
                              <input
                                type="text"
                                value={formatMoney(totals.totalSettled, country)}
                                disabled
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                              />
                            </label>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-semibold text-slate-600">TDS Entry</p>
                          <div className="mt-3 grid grid-cols-1 gap-3">
                            <label className="block">
                              <span className="text-xs font-semibold text-slate-600">TDS Percentage</span>
                              <div className="mt-1 grid grid-cols-1 gap-2">
                                <select
                                  value={form.tdsCategory}
                                  disabled={readOnly}
                                  onChange={(event) => handleTdsCategoryChange(event.target.value)}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                                >
                                  {TDS_CATEGORY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                  <option value="custom">Custom</option>
                                </select>
                                {form.tdsCategory === "custom" ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.tdsRate}
                                    disabled={readOnly}
                                    onChange={(event) => handleTdsRateChange(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                                    placeholder="%"
                                  />
                                ) : null}
                              </div>
                            </label>
                            <label className="block">
                              <span className="text-xs font-semibold text-slate-600">TDS Amount</span>
                              <input
                                type="text"
                                value={formatMoney(totals.tdsAmount, country)}
                                disabled
                                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      {selectedCustomerDocument?.documentType === "invoice" && availableAdvanceBalance > 0 && !customerAdvanceEntries.length ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-xs font-semibold text-slate-700">Customer Advance Wallet</p>
                              <p className="mt-1 text-xs text-slate-600">
                                Available Advance Balance: {formatMoney(availableAdvanceBalance, country)}
                              </p>
                            </div>
                            <label className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                              <input
                                type="checkbox"
                                checked={useAdvanceWallet}
                                onChange={(event) => setUseAdvanceWallet(event.target.checked)}
                                disabled={readOnly}
                                className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                              />
                              Use Available Advance Balance
                            </label>
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-600">
                              <p>Invoice Total: <span className="font-semibold text-slate-900">{formatMoney(selectedCustomerDocument.invoiceAmount, country)}</span></p>
                              <p className="mt-1">Advance Used: <span className="font-semibold text-emerald-700">{formatMoney(advanceWalletUsable, country)}</span></p>
                            </div>
                            <div className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-600">
                              <p>Remaining Payable Amount: <span className="font-semibold text-rose-700">{formatMoney(documentBalanceAfterAdvance, country)}</span></p>
                              <p className="mt-1">Remaining Wallet Balance: <span className="font-semibold text-amber-700">{formatMoney(remainingWalletBalance, country)}</span></p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs font-semibold text-slate-600">Is this payment for a specific invoice?</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleAllocationModeChange("linked")}
                            disabled={readOnly || !form.customerId}
                            className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                              form.allocationMode === "linked"
                                ? "bg-slate-900 text-white"
                                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            Yes - Pay against Invoice
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAllocationModeChange("normal")}
                            disabled={readOnly}
                            className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                              form.allocationMode === "normal"
                                ? "bg-slate-900 text-white"
                                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            No - Normal Payment Entry
                          </button>
                        </div>
                        {!form.customerId ? (
                          <p className="mt-2 text-xs text-slate-500">Select a customer first to load invoice and proforma options.</p>
                        ) : null}
                      </div>
                      {form.allocationMode === "linked" ? (
                        <label className="block">
                          <FieldLabelText required className="text-xs font-semibold text-slate-600">
                            Invoice / Proforma Invoice
                          </FieldLabelText>
                          <select
                            value={form.selectedDocumentId}
                            disabled={readOnly || !form.customerId || !customerDocuments.length}
                            onChange={(event) => handleDocumentSelection(event.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">
                              {customerDocuments.length
                                ? "Select invoice or proforma invoice"
                                : "No open invoices or proformas for this customer"}
                            </option>
                            {customerDocuments.map((document) => (
                              <option key={`${document.documentType}-${document.id}`} value={document.id}>
                                {`${documentTypeLabel(document.documentType)} - ${document.invoiceNo} | ${document.invoiceDate || "-"} | Pending: ${formatMoney(document.balanceDue, country)}`}
                              </option>
                            ))}
                          </select>
                          {fieldErrors.selectedDocumentId ? (
                            <p className="mt-1 text-xs text-rose-600">{fieldErrors.selectedDocumentId}</p>
                          ) : null}
                        </label>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
                          Normal Payment Entry selected. This payment will be saved without linking to any invoice or proforma invoice.
                        </div>
                      )}
                      {form.allocationMode === "linked" && selectedCustomerDocument ? (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
                          <p className="font-semibold">
                            {documentTypeLabel(selectedCustomerDocument.documentType)} - {selectedCustomerDocument.invoiceNo}
                          </p>
                          <p className="mt-1">
                            Date: {selectedCustomerDocument.invoiceDate || "-"} | Pending: {formatMoney(effectiveSelectedDocumentBalance, country)}
                          </p>
                          <p className="mt-1">
                            Taxable Amount: {formatMoney(selectedCustomerDocument.taxableAmount || 0, country)}
                          </p>
                          {selectedDocumentPreviouslyPaidAmount > 0 ? (
                            <>
                              <p className="mt-1">
                                Previously Paid: {formatMoney(selectedDocumentPreviouslyPaidAmount, country)}
                              </p>
                              {selectedDocumentPaymentHistory.length ? (
                                <div className="mt-2 rounded-xl border border-emerald-200 bg-white/70 px-3 py-2 text-[11px] text-emerald-950">
                                  <p className="font-semibold text-emerald-900">Previous Payment History</p>
                                  <div className="mt-1 space-y-1">
                                    {selectedDocumentPaymentHistory.slice(0, 3).map((entry) => (
                                      <p key={entry.id}>
                                        {entry.paymentDate || "-"} | {entry.receiptNo} | {entry.paymentMode} | Applied{" "}
                                        {formatMoney(entry.appliedAmount, country)}
                                        {entry.tdsShare > 0
                                          ? ` | TDS ${formatMoney(entry.tdsShare, country)} | Settled ${formatMoney(entry.settledAmount, country)}`
                                          : ""}
                                        {entry.referenceNo ? ` | Ref ${entry.referenceNo}` : ""}
                                      </p>
                                    ))}
                                    {selectedDocumentPaymentHistory.length > 3 ? (
                                      <p className="text-emerald-800">
                                        +{selectedDocumentPaymentHistory.length - 3} more payment entr
                                        {selectedDocumentPaymentHistory.length - 3 === 1 ? "y" : "ies"}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              ) : (
                                <p className="mt-1 text-[11px] text-emerald-800">
                                  Previous payment date/details are not available for this older linked entry, but the settled
                                  amount is included in the pending balance.
                                </p>
                              )}
                            </>
                          ) : null}
                          {invoiceGstLines.map((line) => (
                            <p key={line.label} className="mt-1">
                              {line.label}: {formatMoney(line.value, country)}
                            </p>
                          ))}
                          {advanceWalletUsable > 0 ? (
                            <p className="mt-1">
                              Advance Used: {formatMoney(advanceWalletUsable, country)} | Remaining Payable: {formatMoney(documentBalanceAfterAdvance, country)}
                            </p>
                          ) : null}
                          <p className="mt-1">
                            Received Amount Applied: {formatMoney(totals.amountApplied, country)}
                          </p>
                          <p className="mt-1">
                            Total Settled: {formatMoney(totals.totalSettled, country)}
                          </p>
                        </div>
                      ) : null}
                      <label className="block">
                        <FieldLabelText required className="text-xs font-semibold text-slate-600">
                          Payment Date
                        </FieldLabelText>
                        <DateInput value={form.paymentDate} disabled={readOnly} onChange={(nextValue) => updateForm("paymentDate", nextValue)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                        {fieldErrors.paymentDate ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.paymentDate}</p> : null}
                      </label>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-600">Payment Mode</p>
                        <PaymentModePicker options={COUNTRY_CONFIG[country].paymentModes} value={form.paymentMode} onChange={(mode) => updateForm("paymentMode", mode as PaymentMode)} />
                      </div>
                    </div>
                  </FlowCard>

                  <FlowCard title="Mode Specific Fields" subtitle="Details vary by selected payment mode">
                    <div className="space-y-3">
                      <input value={form.referenceNo} disabled={readOnly} onChange={(event) => updateForm("referenceNo", event.target.value)} placeholder="Payment Reference" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      {form.paymentMode === "Cheque" ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div><input value={form.chequeNo} disabled={readOnly} onChange={(event) => updateForm("chequeNo", event.target.value)} placeholder="Cheque No" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.chequeNo ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.chequeNo}</p> : null}</div>
                          <div><input value={form.bankName} disabled={readOnly} onChange={(event) => updateForm("bankName", event.target.value)} placeholder="Bank Name" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.bankName ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.bankName}</p> : null}</div>
                        </div>
                      ) : null}
                      {form.paymentMode === "Net Banking" ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div><input value={form.bankAccount} disabled={readOnly} onChange={(event) => updateForm("bankAccount", event.target.value)} placeholder="Bank Account" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.bankAccount ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.bankAccount}</p> : null}</div>
                          <div><input value={form.transactionId} disabled={readOnly} onChange={(event) => updateForm("transactionId", event.target.value)} placeholder="Transaction ID" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.transactionId}</p> : null}</div>
                        </div>
                      ) : null}
                      {(form.paymentMode === "Card" || form.paymentMode === "UPI" || form.paymentMode === "Online Gateway") ? <div><input value={form.transactionId} disabled={readOnly} onChange={(event) => updateForm("transactionId", event.target.value)} placeholder="Transaction ID" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />{fieldErrors.transactionId ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.transactionId}</p> : null}</div> : null}
                      <label className="block">
                        <FieldLabelText
                          required={COUNTRY_CONFIG[country].registrationRequired}
                          className="text-xs font-semibold text-slate-600"
                        >
                          {COUNTRY_CONFIG[country].registrationLabel}
                        </FieldLabelText>
                        <input value={form.registrationNumber} disabled={readOnly} onChange={(event) => updateForm("registrationNumber", event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      </label>
                      <label className="block rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                        <input type="file" disabled={readOnly} onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          updateForm("attachment", file ? { name: file.name, size: file.size, type: file.type || "application/octet-stream" } : null);
                        }} className="hidden" />
                        Drag & drop payment proof or click to upload
                        {form.attachment ? <p className="mt-2 text-xs font-semibold text-slate-700">{form.attachment.name}</p> : null}
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Internal Notes</span>
                        <textarea
                          value={form.internalNotes}
                          disabled={readOnly}
                          onChange={(event) => updateForm("internalNotes", event.target.value)}
                          rows={3}
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          placeholder="Visible to finance team only"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-slate-600">Customer Notes</span>
                        <textarea
                          value={form.customerNotes}
                          disabled={readOnly}
                          onChange={(event) => updateForm("customerNotes", event.target.value)}
                          rows={3}
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          placeholder="Shown in receipt PDF"
                        />
                      </label>
                    </div>
                  </FlowCard>
                </div>
              ) : null}

              {activeStep === 2 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                  <FlowCard title="Review & Confirm" subtitle="Final check before posting this payment">
                    <div className="space-y-3 text-sm">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Customer</p>
                        <p className="font-semibold text-slate-900">{selectedCustomer?.name || form.customerInput || "-"}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {COUNTRY_CONFIG[country].name} | {COUNTRY_CONFIG[country].currency}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Invoice Amount</p>
                          <p className="text-base font-semibold text-slate-900">{selectedCustomerDocument ? formatMoney(selectedCustomerDocument.invoiceAmount, country) : "-"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Received Amount</p>
                          <p className="text-base font-semibold text-slate-900">{formatMoney(totals.amountReceived, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">TDS Percentage</p>
                          <p className="text-base font-semibold text-slate-900">{formatTdsPercent(form.tdsRate)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">TDS Amount</p>
                          <p className={`text-base font-semibold ${totals.tdsAmount < 0 ? "text-rose-700" : "text-slate-900"}`}>{formatMoney(totals.tdsAmount, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Available Advance</p>
                          <p className={`text-base font-semibold ${availableAdvanceBalance < 0 ? "text-rose-700" : "text-slate-900"}`}>{formatMoney(availableAdvanceBalance, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Advance Used</p>
                          <p className={`text-base font-semibold ${advanceWalletUsable < 0 ? "text-rose-700" : "text-slate-900"}`}>{formatMoney(advanceWalletUsable, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Total Settled</p>
                          <p className="text-base font-semibold text-slate-900">{formatMoney(totals.totalSettled, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Remaining Wallet Balance</p>
                          <p className={`text-base font-semibold ${remainingWalletBalance < 0 ? "text-rose-700" : "text-slate-900"}`}>{formatMoney(remainingWalletBalance, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Final Payable Amount</p>
                          <p className={`text-base font-semibold ${remainingPayableAfterPayment < 0 ? "text-rose-700" : "text-slate-900"}`}>{formatMoney(remainingPayableAfterPayment, country)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Advance Balance</p>
                          <p className="text-base font-semibold text-slate-900">{formatMoney(totals.unappliedAmount, country)}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Extra received amount stays on the customer account.
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">Payment Mode</p>
                          <p className="text-base font-semibold text-slate-900">{formatPaymentModeLabel(form.paymentMode)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3">
                          <p className="text-slate-500">
                            {form.allocationMode === "linked" ? "Selected Document" : "Payment Flow"}
                          </p>
                          <p className="text-base font-semibold text-slate-900">
                            {selectedCustomerDocument
                              ? `${documentTypeLabel(selectedCustomerDocument.documentType)} - ${selectedCustomerDocument.invoiceNo}`
                              : "Normal Payment Entry"}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {selectedCustomerDocument
                              ? `Pending ${formatMoney(effectiveSelectedDocumentBalance, country)} | Settled ${formatMoney(totals.totalSettled, country)}`
                              : "Saved without linking to any invoice or proforma invoice."}
                          </p>
                        </div>
                      </div>
                      {totals.unappliedAmount > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {form.allocationMode === "linked"
                            ? "Pending balance on the selected document updates automatically. Any excess amount is retained as advance."
                            : "This receipt is stored as a normal payment entry without invoice allocation."}
                        </div>
                      ) : null}
                    </div>
                  </FlowCard>

                  <FlowCard title="Receipt Snapshot" subtitle="Country wording + legal labels">
                    <div className="space-y-3">
                      <p className="text-xs text-slate-500">{COUNTRY_CONFIG[country].receiptLabel}</p>
                  <p className="text-3xl font-bold tracking-tight text-slate-900">{formatMoney(totals.totalSettled, country)}</p>
                  <p className="text-xs text-slate-500">
                    Received {formatMoney(totals.amountReceived, country)} | TDS {formatMoney(totals.tdsAmount, country)}
                  </p>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        <p>{COUNTRY_CONFIG[country].legalWording}</p>
                        <p className="mt-2">
                          {COUNTRY_CONFIG[country].registrationLabel}:{" "}
                          <span className="font-semibold text-slate-800">{form.registrationNumber || "-"}</span>
                        </p>
                      </div>
                      {activePayment ? (
                        <button
                          type="button"
                          onClick={() => exportSinglePaymentInPdf(activePayment)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          Download Current PDF
                        </button>
                      ) : null}
                    </div>
                  </FlowCard>
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </div>
              ) : null}
              {successMessage ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {successMessage}
                </div>
              ) : null}

              {!readOnly ? (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
                    disabled={!hasPreviousStep}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStep((current) => Math.min(STEPS.length - 1, current + 1))}
                    disabled={!hasNextStep}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      {panelMode === "flow" && form && !readOnly ? (
        <div className="app-floating-action-bar fixed bottom-4 right-4 z-40 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => persist(saveStatus)}
            disabled={!canSaveCurrentFlow}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : saveStatus === "Draft" ? "Save Draft" : "Save Received"}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={
              !canSaveCurrentFlow ||
              activeStep !== 2 ||
              form.allocationMode !== "linked" ||
              activePayment?.status !== "Confirmed"
            }
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              if (activePayment) {
                exportSinglePaymentInPdf(activePayment);
                return;
              }
              persist(saveStatus, { download: true });
            }}
            disabled={!canSaveCurrentFlow}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileDown className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Download PDF"}
          </button>
        </div>
      ) : null}

      <AuditDrawer open={showAudit} record={activePayment} onClose={() => setShowAudit(false)} />
    </div>
  );
}
