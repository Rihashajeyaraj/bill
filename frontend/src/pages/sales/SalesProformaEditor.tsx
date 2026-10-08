import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, X, ChevronDown, ChevronUp, FileText, User, Truck, Ship, ShieldCheck, ListOrdered, FileCode, Sparkles, Printer, Download, Save } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Card from "../../components/Card";
import FieldLabelText from "../../components/FieldLabelText";
import GradientButton from "../../components/GradientButton";
import PageHeader from "../../components/PageHeader";
import DateInput from "../../components/DateInput";
import CurrencySelect from "../../components/CurrencySelect";
import InvoicePreview from "../../components/InvoicePreview";
import InvoiceTemplateSelector from "../../components/InvoiceTemplateSelector";
import { getDefaultTemplateKey } from "../../services/templateService";
import { useToast } from "../../context/ToastContext";
import { useOrganization } from "../../context/OrganizationContext";
import { apiClient } from "../../services/apiClient";
import { formatDecimalByPreference } from "../../lib/formatPreferences";
import { listAllCountries, listStatesByCountry } from "../../lib/geoData";
import { calculateTaxes, getCountryTaxConfig } from "../../services/tax";
import { salesProformaUpsert } from "../../services/proformas.service";
import { uid } from "../../services/storage";

function createEmptyLine(defaultCurrency = "INR") {
  return {
    id: `line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    item_id: "",
    description: "",
    hsn_sac: "",
    qty: "1",
    unit: "PCS",
    unit_price: "",
    currency: defaultCurrency,
    tax_rate: "0",
    cgst_rate: "0",
    sgst_rate: "0",
    igst_rate: "0",
    place_of_supply: ""
  };
}

// Indian Currency Number to Words converter helper
function numberToWordsINR(num: number): string {
  const amount = Math.round(Number(num || 0));
  if (amount <= 0) return "RUPEES ZERO ONLY";

  const a = [
    "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
    "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"
  ];
  const b = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " HUNDRED" + (n % 100 !== 0 ? " " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + " THOUSAND" + (n % 1000 !== 0 ? " " + inWords(n % 1000) : "");
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + " LAKH" + (n % 100000 !== 0 ? " " + inWords(n % 100000) : "");
    return inWords(Math.floor(n / 10000000)) + " CRORE" + (n % 10000000 !== 0 ? " " + inWords(n % 10000000) : "");
  }

  return `RUPEES ${inWords(amount)} ONLY`;
}

export default function SalesProformaEditor() {
  const { id = "new" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = String(id || "") === "new";

  const { profile: company = {} } = useOrganization();

  const [selectedTemplateKey, setSelectedTemplateKey] = useState(() => getDefaultTemplateKey());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [itemsMaster, setItemsMaster] = useState<any[]>([]);

  const [customerEntryMode, setCustomerEntryMode] = useState<"existing" | "manual">("existing");
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");

  // Form State matching Master Template Data Model
  const [form, setForm] = useState<any>({
    id: "",
    proforma_no: "",
    proforma_date: new Date().toISOString().slice(0, 10),
    valid_till: "",
    due_date: "",
    amount_paid: "0",
    party_id: "",
    customer_ref: "",
    place_of_supply_state: "",
    currency_code: "INR",
    exchange_rate: "1.0",
    
    // Customer Snapshot & Manual Entry Fields
    customer_name: "",
    customer_company_name: "",
    customer_country: "",
    customer_address: "",
    customer_city: "",
    customer_gstin: "",
    customer_phone: "",
    customer_email: "",
    save_customer_to_master: false,
    
    // Shipment & Logistics
    shipper_name: "",
    consignee_name: "",
    origin: "",
    destination: "",
    packs_qty: "",
    weight_kgs: "",
    volume_cbm: "",
    freight_terms: "",
    
    // Shipping Details
    bl_number: "",
    thbl_number: "",
    mbl_number: "",
    ocean_bl_no: "",
    vessel_name: "",
    voyage_no: "",
    etd_date: "",
    eta_date: "",
    
    // Operations & Customs
    igm_no: "",
    igm_item_no: "",
    file_no: "",
    sales_rep: "",
    rcm_applicable: false,
    container_details: "",
    
    status: "DRAFT",
    converted_document_id: "",
    notes: "",
    terms: "Interest @ 18% p.a. will be applicable if the invoice is not paid on or before the due date.",
    items: [createEmptyLine("INR")]
  });

  const [validationErrors, setValidationErrors] = useState<any>({});

  // Section Collapsible States
  const [openSections, setOpenSections] = useState({
    invoiceDetails: true,
    customerDetails: true,
    shipmentLogistics: true,
    shippingDetails: false,
    operationsCustoms: false,
    lineItems: true,
    notesTerms: false
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const isConverted = form?.status === "CONVERTED" || !!form?.converted_document_id;
  const isReadOnly = String(searchParams.get("mode") || "").toLowerCase() === "view" || isConverted;

  const allCountries = useMemo(() => listAllCountries(), []);

  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c?.id || "") === String(form?.party_id || "")) || null,
    [customers, form?.party_id]
  );

  const effectiveCustomerCountry = useMemo(() => {
    if (customerEntryMode === "existing" && selectedCustomer) {
      return selectedCustomer.country_name || selectedCustomer.country || "";
    }
    if (customerEntryMode === "manual" && form?.customer_country) {
      return form.customer_country;
    }
    return "";
  }, [customerEntryMode, selectedCustomer, form?.customer_country]);

  const customerStateOptions = useMemo(() => {
    if (!effectiveCustomerCountry) return [];
    return listStatesByCountry(effectiveCustomerCountry);
  }, [effectiveCustomerCountry]);

  const currentTaxConfig = useMemo(() => {
    return getCountryTaxConfig(effectiveCustomerCountry || company?.country || "India");
  }, [effectiveCustomerCountry, company?.country]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearchQuery.trim()) return customers;
    const q = customerSearchQuery.toLowerCase();
    return customers.filter((c) =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.display_name || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.gstin || "").toLowerCase().includes(q) ||
      (c.state_name || "").toLowerCase().includes(q)
    );
  }, [customers, customerSearchQuery]);

  // List of Indian States for Place of Supply selection
  const indianStates = useMemo(() => listStatesByCountry("IN"), []);

  // Load Customers, Items & Proforma Data from FastAPI
  useEffect(() => {
    let active = true;
    async function initData() {
      setLoading(true);
      try {
        const [partiesRes, itemsRes] = await Promise.all([
          apiClient.getParties("customer").catch(() => []),
          apiClient.getItems().catch(() => [])
        ]);

        if (!active) return;
        setCustomers(Array.isArray(partiesRes) ? partiesRes : []);
        setItemsMaster(Array.isArray(itemsRes) ? itemsRes : []);

        if (!isNew && id) {
          const proforma = await apiClient.getProforma(id);
          if (!active) return;
          if (proforma) {
            if (proforma.template_id) {
              setSelectedTemplateKey(proforma.template_id);
            }
            setForm({
              id: proforma.id || "",
              proforma_no: proforma.proforma_no || "",
              proforma_date: proforma.proforma_date || "",
              valid_till: proforma.valid_till || "",
              due_date: proforma.due_date || "",
              party_id: proforma.party_id || "",
              customer_ref: proforma.customer_ref || "",
              place_of_supply_state: proforma.place_of_supply_state || "",
              currency_code: proforma.currency_code || "INR",
              exchange_rate: String(proforma.exchange_rate || "1.0"),
              
              shipper_name: proforma.shipper_name || "",
              consignee_name: proforma.consignee_name || "",
              origin: proforma.origin || "",
              destination: proforma.destination || "",
              packs_qty: proforma.packs_qty ? String(proforma.packs_qty) : "",
              weight_kgs: proforma.weight_kgs ? String(proforma.weight_kgs) : "",
              volume_cbm: proforma.volume_cbm ? String(proforma.volume_cbm) : "",
              freight_terms: proforma.freight_terms || "Collect",
              
              bl_number: proforma.bl_number || "",
              thbl_number: proforma.thbl_number || "",
              mbl_number: proforma.mbl_number || "",
              ocean_bl_no: proforma.ocean_bl_no || "",
              vessel_name: proforma.vessel_name || "",
              voyage_no: proforma.voyage_no || "",
              etd_date: proforma.etd_date || "",
              eta_date: proforma.eta_date || "",
              
              igm_no: proforma.igm_no || "",
              igm_item_no: proforma.igm_item_no || "",
              file_no: proforma.file_no || "",
              sales_rep: proforma.sales_rep || "",
              rcm_applicable: Boolean(proforma.rcm_applicable),
              container_details: proforma.container_details || "",
              
              status: proforma.status || "DRAFT",
              converted_document_id: proforma.converted_document_id || "",
              notes: proforma.notes || "",
              terms: proforma.terms || "",
              items: Array.isArray(proforma.items) && proforma.items.length > 0
                ? proforma.items.map((it: any) => ({
                    id: it.id || `line_${Math.random()}`,
                    item_id: it.item_id || "",
                    description: it.description || "",
                    hsn_sac: it.hsn_sac || "",
                    qty: String(it.qty ?? 1),
                    unit: it.unit || "PCS",
                    unit_price: String(it.unit_price ?? 0),
                    currency: it.currency || proforma.currency_code || "INR",
                    tax_rate: String(it.tax_rate ?? 18),
                    cgst_rate: String(it.cgst_rate ?? 9),
                    sgst_rate: String(it.sgst_rate ?? 9),
                    igst_rate: String(it.igst_rate ?? 0),
                    place_of_supply: it.place_of_supply || ""
                  }))
                : [createEmptyLine(proforma.currency_code || "INR")]
            });
          }
        } else {
          // For new Pro Forma Invoice: auto-generate number if not set
          try {
            const list = await apiClient.getProformas().catch(() => []);
            const count = Array.isArray(list) ? list.length : 0;
            const generatedNo = `PI-${String(count + 1).padStart(4, "0")}`;
            setForm((prev: any) => ({
              ...prev,
              proforma_no: prev.proforma_no || generatedNo
            }));
          } catch {
            setForm((prev: any) => ({
              ...prev,
              proforma_no: prev.proforma_no || "PI-0001"
            }));
          }
        }
      } catch (err: any) {
        toast.showError(err.message || "Failed to load initial data from backend");
      } finally {
        if (active) setLoading(false);
      }
    }
    initData();
    return () => { active = false; };
  }, [id, isNew]);

  // Auto Generate Pro Forma No Handler
  const handleAutoGenerateProformaNo = async () => {
    try {
      const list = await apiClient.getProformas().catch(() => []);
      const count = Array.isArray(list) ? list.length : 0;
      const generatedNo = `PI-${String(count + 1).padStart(4, "0")}`;
      setForm((prev: any) => ({ ...prev, proforma_no: generatedNo }));
      toast.showSuccess(`Auto-generated Pro Forma No: ${generatedNo}`);
    } catch {
      const fallbackNo = `PI-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      setForm((prev: any) => ({ ...prev, proforma_no: fallbackNo }));
      toast.showSuccess(`Generated Pro Forma No: ${fallbackNo}`);
    }
  };

  // Customer Selection Autofill Handler
  const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const customer = customers.find((c) => String(c.id) === String(selectedId));
    setForm((prev: any) => ({
      ...prev,
      party_id: selectedId,
      customer_name: customer ? (customer.name || customer.display_name || "") : "",
      customer_company_name: customer ? (customer.display_name || customer.company_name || "") : "",
      customer_country: customer ? (customer.country_name || customer.country || "India") : "",
      customer_address: customer ? (customer.billing_address_line1 || customer.address || "") : "",
      customer_city: customer ? (customer.city || "") : "",
      customer_gstin: customer ? (customer.gstin || "") : "",
      customer_phone: customer ? (customer.phone || "") : "",
      customer_email: customer ? (customer.email || "") : "",
      place_of_supply_state: customer ? (customer.state_name || customer.state_code || customer.state || "") : ""
    }));
  };

  // Item Selection Autofill Handler
  const handleLineItemSelect = (index: number, itemId: string) => {
    const masterItem = itemsMaster.find((it) => String(it.id) === String(itemId));
    setForm((prev: any) => {
      const newItems = [...prev.items];
      if (masterItem) {
        const rateStr = masterItem.tax_rate !== undefined && masterItem.tax_rate !== null ? String(masterItem.tax_rate) : "18";
        const numRate = Number(rateStr || 0);
        newItems[index] = {
          ...newItems[index],
          item_id: masterItem.id,
          description: masterItem.item_name || masterItem.description || "",
          hsn_sac: masterItem.hsn_sac || "",
          unit: masterItem.unit || "PCS",
          unit_price: masterItem.sale_price !== undefined && masterItem.sale_price !== null ? String(masterItem.sale_price) : newItems[index].unit_price,
          tax_rate: rateStr,
          cgst_rate: String(numRate / 2),
          sgst_rate: String(numRate / 2),
          igst_rate: String(numRate)
        };
      } else {
        newItems[index].item_id = itemId;
      }
      return { ...prev, items: newItems };
    });
  };

  // Document Currency change handler - propagates to line items
  const handleDocumentCurrencyChange = (newCurrencyCode: string) => {
    setForm((prev: any) => ({
      ...prev,
      currency_code: newCurrencyCode,
      items: (prev.items || []).map((line: any) => ({
        ...line,
        currency: newCurrencyCode
      }))
    }));
  };

  // Field updates
  const handleInputChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleLineItemChange = (index: number, field: string, value: any) => {
    setForm((prev: any) => {
      const newItems = [...prev.items];
      const item = { ...newItems[index], [field]: value };

      if (field === "tax_rate") {
        const rate = Number(value || 0);
        item.cgst_rate = String(rate / 2);
        item.sgst_rate = String(rate / 2);
        item.igst_rate = String(rate);
      } else if (field === "cgst_rate" || field === "sgst_rate") {
        const cgst = Number(field === "cgst_rate" ? value : item.cgst_rate || 0);
        const sgst = Number(field === "sgst_rate" ? value : item.sgst_rate || 0);
        item.tax_rate = String(cgst + sgst);
        item.igst_rate = String(cgst + sgst);
      } else if (field === "igst_rate") {
        const igst = Number(value || 0);
        item.tax_rate = String(igst);
        item.cgst_rate = String(igst / 2);
        item.sgst_rate = String(igst / 2);
      }

      newItems[index] = item;
      return { ...prev, items: newItems };
    });
  };

  const addLineItem = () => {
    setForm((prev: any) => ({
      ...prev,
      items: [...prev.items, createEmptyLine(prev.currency_code || "INR")]
    }));
  };

  const removeLineItem = (index: number) => {
    if (form.items.length <= 1) return;
    setForm((prev: any) => ({
      ...prev,
      items: prev.items.filter((_: any, i: number) => i !== index)
    }));
  };

  // Real-time Preview Computations
  const previewData = useMemo(() => {
    const companyAddressParts = [company?.address?.line1, company?.address?.city, company?.address?.state, company?.address?.postalCode].filter(Boolean);
    const roe = Number(form.exchange_rate) || 1.0;

    // ── Company context ──────────────────────────────────────────────────────
    const companyCountry = company?.country || company?.countryName || "India";
    const companyState = company?.address?.state || company?.state || "";
    const companyGstin = company?.tax?.gstin || company?.gstin || "";

    // ── Customer context (supports both existing-select and manual-entry) ───
    // For existing customer: pull from selectedCustomer
    // For manual customer:   pull from form.customer_* fields
    const isExisting = customerEntryMode === "existing" && selectedCustomer;
    const resolvedCustomerCountry = isExisting
      ? (selectedCustomer.country_name || selectedCustomer.country || "India")
      : (form.customer_country || "");
    const resolvedCustomerState = isExisting
      ? (selectedCustomer.state_name || selectedCustomer.state_code || "")
      : (form.place_of_supply_state || "");
    const resolvedCustomerGstin = isExisting
      ? (selectedCustomer.gstin || "")
      : (form.customer_gstin || "");

    let subTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;
    let vatTotal = 0;
    let stateTaxTotal = 0;

    const formattedItems = (form.items || []).map((l: any, idx: number) => {
      const qty = Number(l.qty || 0);
      const rate = Number(l.unit_price || 0);
      const rawTaxRate = Number(l.tax_rate);
      const rawIgstRate = Number(l.igst_rate);
      const rawCgstRate = Number(l.cgst_rate);
      const rawSgstRate = Number(l.sgst_rate);
      const taxRate = (!isNaN(rawTaxRate) && rawTaxRate > 0)
        ? rawTaxRate
        : ((!isNaN(rawIgstRate) && rawIgstRate > 0)
          ? rawIgstRate
          : (rawCgstRate || 0) + (rawSgstRate || 0));

      const amountInr = (l.currency !== "INR" && roe > 0) ? (qty * rate * roe) : (qty * rate);
      const taxable = amountInr;

      // Place of supply: item-level override → form-level document PoS → customer state
      const pos = l.place_of_supply || form.place_of_supply_state || resolvedCustomerState;

      // For the tax engine, prefer Place of Supply as the party state (it is the
      // definitive GST jurisdiction field for Indian supply)
      const partyStateForTax = pos || resolvedCustomerState;
      const partyCountryForTax = resolvedCustomerCountry || "India";

      const hasCustomerContext = Boolean(
        resolvedCustomerCountry || resolvedCustomerState ||
        form.party_id || form.customer_name || pos
      );

      const taxRes = hasCustomerContext ? calculateTaxes({
        taxableAmount: taxable,
        taxRate,
        org: { country: companyCountry, state: companyState, gstin: companyGstin },
        party: { country: partyCountryForTax, state: partyStateForTax, gstin: resolvedCustomerGstin }
      }) : {
        cgst: 0,
        sgst: 0,
        igst: 0,
        vat: 0,
        stateTax: 0,
        totalTax: 0,
        grandTotal: taxable,
        taxMode: "NONE",
        sameState: false
      };

      subTotal += taxable;
      cgstTotal += taxRes.cgst || 0;
      sgstTotal += taxRes.sgst || 0;
      igstTotal += taxRes.igst || 0;
      vatTotal += taxRes.vat || 0;
      stateTaxTotal += taxRes.stateTax || 0;

      const isIntraState = taxRes.sameState && taxRes.taxMode === "GST";
      const isInterState = !taxRes.sameState && taxRes.taxMode === "GST";

      const itemCgstRate = isIntraState ? (taxRate / 2) : 0;
      const itemSgstRate = isIntraState ? (taxRate / 2) : 0;
      const itemIgstRate = isInterState ? taxRate : 0;

      return {
        id: l.id || `line_${idx}`,
        name: l.description || "Item",
        description: l.description || "",
        hsn: l.hsn_sac || "",
        hsn_sac: l.hsn_sac || "",
        qty,
        unit: l.unit || "PCS",
        rate,
        unit_price: rate,
        discount: l.discount_amount || 0,
        discount_amount: l.discount_amount || 0,
        currency: l.currency || form.currency_code || "INR",
        placeOfSupply: pos,
        cgstRate: itemCgstRate,
        sgstRate: itemSgstRate,
        igstRate: itemIgstRate,
        cgstAmount: taxRes.cgst || 0,
        sgstAmount: taxRes.sgst || 0,
        igstAmount: taxRes.igst || 0,
        vatRate: taxRes.vatRate || 0,
        stateTaxRate: taxRes.stateTaxRate || 0,
        localTaxRate: taxRes.localTaxRate || 0,
        taxMode: taxRes.taxMode,
        taxAmount: taxRes.totalTax,
        amountInr,
        taxableValue: taxable,
        taxable_amount: taxable,
        amount: taxRes.grandTotal,
        net: taxRes.grandTotal
      };
    });

    const taxTotal = cgstTotal + sgstTotal + igstTotal + vatTotal + stateTaxTotal;
    const grandTotal = Math.round(subTotal + taxTotal);
    const grandTotalInWords = numberToWordsINR(grandTotal);

    // ── Customer display data ────────────────────────────────────────────────
    const displayCustomerName = isExisting
      ? (selectedCustomer?.display_name || selectedCustomer?.name || "")
      : (form.customer_name || "");
    const displayCustomerAddress = isExisting
      ? [selectedCustomer?.billing_address_line1, selectedCustomer?.city, selectedCustomer?.state_name].filter(Boolean).join(", ")
      : [form.customer_address, form.customer_city, form.place_of_supply_state, form.customer_country].filter(Boolean).join(", ");
    const displayCustomerState = isExisting
      ? (selectedCustomer?.state_name || form.place_of_supply_state || "")
      : (form.place_of_supply_state || "");
    const displayCustomerGstin = isExisting
      ? (selectedCustomer?.gstin || "")
      : (form.customer_gstin || "");
    const displayCustomerEmail = isExisting
      ? (selectedCustomer?.email || "")
      : (form.customer_email || "");
    const displayCustomerPhone = isExisting
      ? (selectedCustomer?.phone || "")
      : (form.customer_phone || "");

    return {
      title: "PRO FORMA INVOICE",
      isProforma: true,
      companyName: company?.companyName || company?.name || "",
      companyAddress: companyAddressParts.join(", "),
      companyGstin: companyGstin,
      companyPan: company?.pan || "",
      companyIec: company?.iec || "",
      companyCin: company?.cin || "",
      companyPhone: company?.phone || "",
      companyState,

      customerName: displayCustomerName,
      customerAddress: displayCustomerAddress,
      customerState: displayCustomerState,
      customerGstin: displayCustomerGstin,
      customerEmail: displayCustomerEmail,
      customerPhone: displayCustomerPhone,
      customerCountry: resolvedCustomerCountry,

      invoiceNo: form.proforma_no || "",
      proformaNo: form.proforma_no || "",
      invoiceDate: form.proforma_date,
      proformaDate: form.proforma_date,
      validTill: form.valid_till,
      dueDate: form.due_date,
      customerRef: form.customer_ref,
      placeOfSupply: form.place_of_supply_state || displayCustomerState,
      currencyCode: form.currency_code || "INR",
      exchangeRate: form.exchange_rate || "1.00",
      roe: form.exchange_rate || "1.00",

      shipperName: form.shipper_name,
      consigneeName: form.consignee_name,
      origin: form.origin,
      destination: form.destination,
      packsQty: form.packs_qty,
      weightKgs: form.weight_kgs,
      volumeCbm: form.volume_cbm,
      freightTerms: form.freight_terms,

      blNumber: form.bl_number,
      thblNumber: form.thbl_number,
      mblNumber: form.mbl_number,
      oceanBlNo: form.ocean_bl_no,
      vesselName: form.vessel_name,
      voyageNo: form.voyage_no,
      etdDate: form.etd_date,
      etaDate: form.eta_date,

      igmNo: form.igm_no,
      igmItemNo: form.igm_item_no,
      fileNo: form.file_no,
      salesRep: form.sales_rep,
      rcmApplicable: form.rcm_applicable,
      containerDetails: form.container_details,

      notes: form.notes,
      terms: form.terms,
      paymentTerms: form.terms,

      bankDetails: {
        accountName: company?.name || company?.companyName || "",
        bankName: company?.bankName || company?.bank_name || "",
        accountNo: company?.accountNo || company?.account_no || company?.account_number || "",
        ifsc: company?.ifsc || company?.ifsc_code || "",
        swift: company?.swift || company?.swift_code || "",
        iban: company?.iban || "",
        address: company?.bankAddress || company?.bank_address || ""
      },

      items: formattedItems,
      totals: {
        subTotal,
        cgstTotal,
        sgstTotal,
        igstTotal,
        vatTotal,
        stateTaxTotal,
        total: grandTotal,
        amountPaid: Number(form.amount_paid || 0),
        balanceDue: Math.max(0, grandTotal - Number(form.amount_paid || 0))
      },
      amountPaid: Number(form.amount_paid || 0),
      balanceDue: Math.max(0, grandTotal - Number(form.amount_paid || 0)),
      grand_total_in_words: grandTotalInWords
    };
  }, [form, selectedCustomer, company, customerEntryMode]);

  // Form Validation
  const validateForm = () => {
    const errs: any = {};
    const hasCustomer = customerEntryMode === "existing" ? Boolean(form.party_id) : Boolean(form.customer_name?.trim() || selectedCustomer);
    if (!hasCustomer) {
      if (customerEntryMode === "existing") {
        errs.party_id = "Please select a customer from the database.";
      } else {
        errs.customer_name = "Customer name is required.";
      }
    }
    if (!form.proforma_date) errs.proforma_date = "Pro Forma date is required.";
    if (Number(form.exchange_rate) <= 0) errs.exchange_rate = "Rate of Exchange (ROE) must be > 0.";
    
    let validItems = 0;
    (form.items || []).forEach((line: any) => {
      if (line.description && Number(line.qty) > 0 && Number(line.unit_price) >= 0) validItems++;
    });
    if (validItems === 0) errs.items = "At least one line item with description, Qty > 0, and Unit Price is required.";

    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Submit Handler -> Dual Storage (Local Store + FastAPI Backend)
  const handleSave = async () => {
    if (!validateForm()) {
      toast.showError("Please fill all required fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const customerDisplayName = form.customer_name || selectedCustomer?.display_name || selectedCustomer?.name || "Customer";
      
      const payload = {
        template_id: selectedTemplateKey,
        proforma_no: form.proforma_no || undefined,
        proforma_date: form.proforma_date,
        valid_till: form.valid_till || undefined,
        due_date: form.due_date || undefined,
        party_id: form.party_id || undefined,
        customer_ref: form.customer_ref || undefined,
        place_of_supply_state: form.place_of_supply_state || undefined,
        currency_code: form.currency_code || "INR",
        exchange_rate: Number(form.exchange_rate || 1.0),

        customer_name: customerDisplayName,
        customer_company_name: form.customer_company_name || undefined,
        customer_country: form.customer_country || effectiveCustomerCountry || undefined,
        customer_address: form.customer_address || undefined,
        customer_city: form.customer_city || undefined,
        customer_gstin: form.customer_gstin || undefined,
        customer_phone: form.customer_phone || undefined,
        customer_email: form.customer_email || undefined,
        save_customer_to_master: Boolean(form.save_customer_to_master),
        amount_paid: Number(form.amount_paid || 0),

        shipper_name: form.shipper_name || undefined,
        consignee_name: form.consignee_name || undefined,
        origin: form.origin || undefined,
        destination: form.destination || undefined,
        packs_qty: form.packs_qty || "1",
        weight_kgs: form.weight_kgs ? Number(form.weight_kgs) : undefined,
        volume_cbm: form.volume_cbm ? Number(form.volume_cbm) : undefined,
        freight_terms: form.freight_terms || "Collect",

        bl_number: form.bl_number || undefined,
        thbl_number: form.thbl_number || undefined,
        mbl_number: form.mbl_number || undefined,
        ocean_bl_no: form.ocean_bl_no || undefined,
        vessel_name: form.vessel_name || undefined,
        voyage_no: form.voyage_no || undefined,
        etd_date: form.etd_date || undefined,
        eta_date: form.eta_date || undefined,

        igm_no: form.igm_no || undefined,
        igm_item_no: form.igm_item_no || undefined,
        file_no: form.file_no || undefined,
        sales_rep: form.sales_rep || undefined,
        rcm_applicable: Boolean(form.rcm_applicable),
        container_details: form.container_details || undefined,

        notes: form.notes || undefined,
        terms: form.terms || undefined,

        items: (form.items || []).map((line: any) => ({
          item_id: line.item_id || undefined,
          description: line.description || "Item",
          hsn_sac: line.hsn_sac || "",
          qty: Number(line.qty || 1),
          unit: line.unit || "PCS",
          unit_price: Number(line.unit_price || 0),
          discount_percent: 0,
          discount_amount: 0,
          tax_rate: Number(line.tax_rate || 0),
          cgst_rate: Number(line.cgst_rate || 0),
          sgst_rate: Number(line.sgst_rate || 0),
          igst_rate: Number(line.igst_rate || 0),
          place_of_supply: line.place_of_supply || undefined,
          currency: line.currency || form.currency_code || "INR"
        }))
      };

      const upsertInput = {
        id: isNew ? form.id || uid("sp_") : form.id,
        proformaNo: form.proforma_no || `PI-${Date.now()}`,
        proformaDate: form.proforma_date,
        validTill: form.valid_till || undefined,
        dueDate: form.due_date || undefined,
        partyId: form.party_id || undefined,
        partyName: customerDisplayName,
        customerRef: form.customer_ref || undefined,
        placeOfSupply: form.place_of_supply_state || undefined,
        currencyCode: form.currency_code || "INR",
        exchangeRate: Number(form.exchange_rate || 1.0),
        amountPaid: Number(form.amount_paid || 0),
        status: "DRAFT",
        notes: form.notes || undefined,
        terms: form.terms || undefined,
        lines: (form.items || []).map((l: any, idx: number) => ({
          lineNo: idx + 1,
          description: l.description || "Item",
          hsnSac: l.hsn_sac || "",
          qty: Number(l.qty || 1),
          unit: l.unit || "PCS",
          unitPrice: Number(l.unit_price || 0),
          taxRate: Number(l.tax_rate || 0),
          cgstRate: Number(l.cgst_rate || 0),
          sgstRate: Number(l.sgst_rate || 0),
          igstRate: Number(l.igst_rate || 0)
        }))
      };

      // 1. Save to local storage store first so it appears in history list immediately
      try {
        await salesProformaUpsert(upsertInput);
      } catch (localErr) {
        console.warn("Local storage save warning:", localErr);
      }

      // 2. Post/PUT to FastAPI backend
      let res: any;
      try {
        if (isNew) {
          res = await apiClient.createProforma(payload);
        } else {
          res = await apiClient.updateProforma(form.id, payload);
        }
      } catch (apiErr) {
        console.warn("FastAPI backend save warning:", apiErr);
      }

      const savedNo = res?.proforma_no || res?.proformaNo || form.proforma_no || "PI-0001";
      toast.showSuccess(`Pro Forma Invoice ${savedNo} saved successfully!`);
      navigate("/app/sales/proformas/history");
    } catch (err: any) {
      toast.showError(err.message || "Failed to save Pro Forma invoice");
    } finally {
      setSaving(false);
    }
  };

  // Convert to Tax Invoice Handler
  const handleConvert = async () => {
    if (isNew || !form.id) return;
    setConverting(true);
    try {
      const res = await apiClient.convertProforma(form.id);
      toast.showSuccess(`Converted to Tax Invoice ${res.invoice_no} successfully!`);
      navigate(`/sales/invoices/${res.id}`);
    } catch (err: any) {
      toast.showError(err.message || "Failed to convert Pro Forma to Tax Invoice");
    } finally {
      setConverting(false);
    }
  };

  // Print / Download PDF Handler
  const handlePrintPdf = () => {
    const previewElement = document.getElementById("proforma-preview-container");
    if (!previewElement) {
      toast.showError("Preview container not found.");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.showError("Pop-up blocked. Please allow pop-ups in browser settings to print or download PDF.");
      return;
    }

    const title = form.proforma_no || "Pro_Forma_Invoice";
    const styles = Array.from(document.querySelectorAll("style, link[rel='stylesheet']"))
      .map((el) => el.outerHTML)
      .join("\n");

    printWindow.document.open();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          ${styles}
          <style>
            @page { size: A4 portrait; margin: 8mm; }
            body { margin: 0; padding: 12px; background: #fff !important; font-family: system-ui, -apple-system, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          </style>
        </head>
        <body>
          <div class="print-content">
            ${previewElement.innerHTML}
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.focus();
                window.print();
              }, 300);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-500 border-t-transparent"></div>
      </div>
    );
  }

  // Sleek Vyapar-inspired input styling: 44px height, crisp border, smooth shadow & focus states
  const commonInputStyle = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all shadow-2xs disabled:bg-slate-50 disabled:text-slate-500";
  const labelStyle = "block text-xs font-semibold text-slate-700 mb-1.5";

  return (
    <div className="space-y-3.5 max-w-[1600px] mx-auto pb-10">
      <PageHeader
        title={isNew ? "Create Pro Forma Invoice" : `Pro Forma Invoice: ${form.proforma_no}`}
        subtitle="Master Template Billing Layout & Multi-tenant FastAPI Engine"
        actions={
          <div className="flex items-center gap-2.5">
            <GradientButton variant="secondary" onClick={() => navigate("/app/sales/proformas/history")}>
              Back to List
            </GradientButton>
            <GradientButton variant="secondary" onClick={handlePrintPdf}>
              <Printer className="w-4 h-4 mr-1.5 text-sky-600" />
              Download / Print PDF
            </GradientButton>
            {!isNew && !isConverted && (
              <GradientButton onClick={handleConvert} loading={converting} variant="secondary">
                Convert to Tax Invoice
              </GradientButton>
            )}
            {!isReadOnly && (
              <GradientButton onClick={handleSave} loading={saving}>
                <Save className="w-4 h-4 mr-1.5" />
                {isNew ? "Save Pro Forma" : "Update Pro Forma"}
              </GradientButton>
            )}
          </div>
        }
      />

      {/* TWO COLUMN DESKTOP GRID LAYOUT (VYAPAR STYLED) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(480px,0.95fr)_minmax(580px,1.05fr)] gap-4 items-start">
        
        {/* LEFT FORM COLUMN */}
        <div className="space-y-3.5">
          
          {/* VISUAL INVOICE TEMPLATE SELECTOR */}
          <InvoiceTemplateSelector
            selectedTemplateKey={selectedTemplateKey}
            onSelectTemplate={(key) => setSelectedTemplateKey(key)}
            invoiceData={previewData}
            disabled={isReadOnly}
          />
          
          {/* SECTION 1: INVOICE DETAILS */}
          <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
            <div
              className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
              onClick={() => toggleSection("invoiceDetails")}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">1. Invoice Details</h3>
              </div>
              {openSections.invoiceDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openSections.invoiceDetails && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Pro Forma Invoice No" required={false} />
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="e.g. PI-0001"
                      value={form.proforma_no || ""}
                      onChange={(e) => handleInputChange("proforma_no", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={handleAutoGenerateProformaNo}
                        className="shrink-0 px-3 py-2.5 bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5"
                        title="Auto generate next sequence number"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                        Auto Generate
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Pro Forma Date" required />
                  </label>
                  <DateInput
                    value={form.proforma_date}
                    placeholder="DD/MM/YYYY"
                    onChange={(val) => handleInputChange("proforma_date", val)}
                    disabled={isReadOnly}
                  />
                  {validationErrors.proforma_date && <p className="text-xs text-rose-500 mt-1 font-medium">{validationErrors.proforma_date}</p>}
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Valid Till" />
                  </label>
                  <DateInput
                    value={form.valid_till}
                    placeholder="DD/MM/YYYY"
                    onChange={(val) => handleInputChange("valid_till", val)}
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Due Date" />
                  </label>
                  <DateInput
                    value={form.due_date}
                    placeholder="DD/MM/YYYY"
                    onChange={(val) => handleInputChange("due_date", val)}
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Customer Reference" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter customer reference"
                    value={form.customer_ref}
                    onChange={(e) => handleInputChange("customer_ref", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Payment Received / Advance Paid" />
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount_paid}
                    onChange={(e) => handleInputChange("amount_paid", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* SECTION 2: CUSTOMER / BILL TO */}
          <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
            <div
              className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
              onClick={() => toggleSection("customerDetails")}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">2. Customer / Bill To</h3>
                  <p className="text-[11px] text-slate-500">Select an existing customer or enter billing details manually.</p>
                </div>
              </div>
              {openSections.customerDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openSections.customerDetails && (
              <div className="mt-4 space-y-4">
                {/* SEGMENTED CONTROL MODE SELECTOR */}
                <div className="flex items-center p-1 bg-slate-100 rounded-xl max-w-md border border-slate-200/80">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerEntryMode("existing");
                      if (selectedCustomer) {
                        handleCustomerSelect({ target: { value: selectedCustomer.id } } as any);
                      }
                    }}
                    className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-all ${
                      customerEntryMode === "existing"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Select Existing Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerEntryMode("manual");
                      if (selectedCustomer && !form.customer_name) {
                        setForm((prev: any) => ({
                          ...prev,
                          customer_name: selectedCustomer.name || selectedCustomer.display_name || "",
                          customer_company_name: selectedCustomer.display_name || "",
                          customer_address: selectedCustomer.billing_address_line1 || "",
                          customer_city: selectedCustomer.city || "",
                          customer_country: selectedCustomer.country_name || selectedCustomer.country || company?.country || "India",
                          customer_gstin: selectedCustomer.gstin || "",
                          customer_phone: selectedCustomer.phone || "",
                          customer_email: selectedCustomer.email || "",
                          place_of_supply_state: selectedCustomer.state_name || selectedCustomer.state_code || prev.place_of_supply_state
                        }));
                      }
                    }}
                    className={`flex-1 py-1.5 px-3 text-xs font-bold rounded-lg transition-all ${
                      customerEntryMode === "manual"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    Enter Manually
                  </button>
                </div>

                {/* MODE 1: SELECT EXISTING CUSTOMER */}
                {customerEntryMode === "existing" && (
                  <div className="space-y-3">
                    <div className="relative">
                      <label className={labelStyle}>
                        <FieldLabelText label="Search & Select Customer" required />
                      </label>
                      
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="w-4 h-4 absolute left-3 top-3.5 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Filter by name, phone or GSTIN/Tax ID..."
                            value={customerSearchQuery}
                            onChange={(e) => setCustomerSearchQuery(e.target.value)}
                            disabled={isReadOnly}
                            className={`${commonInputStyle} pl-9`}
                          />
                        </div>

                        <select
                          value={form.party_id}
                          onChange={handleCustomerSelect}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="">-- Select Customer from Database ({filteredCustomers.length} available) --</option>
                          {filteredCustomers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.display_name || c.name} {c.phone ? `· 📞 ${c.phone}` : ""} {c.state_name ? `· 📍 ${c.state_name}` : ""} {c.gstin ? `(Tax ID: ${c.gstin})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      {validationErrors.party_id && <p className="text-xs text-rose-500 mt-1 font-medium">{validationErrors.party_id}</p>}
                    </div>

                    {selectedCustomer ? (
                      <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 text-xs space-y-1.5 text-emerald-950 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <p className="font-extrabold text-slate-900 text-sm">{selectedCustomer.display_name || selectedCustomer.name}</p>
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded uppercase">
                            Master Customer
                          </span>
                        </div>
                        <p><strong className="text-slate-900 font-semibold">Address:</strong> {[selectedCustomer.billing_address_line1, selectedCustomer.city, selectedCustomer.state_name, selectedCustomer.country_name || selectedCustomer.country].filter(Boolean).join(", ")}</p>
                        <p><strong className="text-slate-900 font-semibold">State / Region:</strong> {selectedCustomer.state_name || "-"} ({selectedCustomer.state_code || "-"})</p>
                        <p><strong className="text-slate-900 font-semibold">Tax ID / GSTIN:</strong> {selectedCustomer.gstin || "N/A"}</p>
                        {selectedCustomer.phone && <p><strong className="text-slate-900 font-semibold">Phone:</strong> {selectedCustomer.phone}</p>}
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 italic">
                        No customer selected yet. Pick a customer from the dropdown above or switch to "Enter Manually".
                      </div>
                    )}
                  </div>
                )}

                {/* MODE 2: ENTER CUSTOMER MANUALLY */}
                {customerEntryMode === "manual" && (
                  <div className="space-y-4 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Customer Name" required />
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. John Doe / Global Tech LLC"
                          value={form.customer_name}
                          onChange={(e) => handleInputChange("customer_name", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Company Name (Optional)" />
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Acme Corporation"
                          value={form.customer_company_name}
                          onChange={(e) => handleInputChange("customer_company_name", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Country" required />
                        </label>
                        <select
                          value={form.customer_country || ""}
                          onChange={(e) => {
                            const newCountry = e.target.value;
                            handleInputChange("customer_country", newCountry);
                            handleInputChange("place_of_supply_state", "");
                          }}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="">-- Select Country --</option>
                          {allCountries.map((c) => (
                            <option key={c.isoCode} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="State / Region (Place of Supply)" required />
                        </label>
                        {!effectiveCustomerCountry ? (
                          <select disabled className={commonInputStyle} value="">
                            <option value="">Select customer first</option>
                          </select>
                        ) : customerStateOptions.length > 0 ? (
                          <select
                            value={form.place_of_supply_state || ""}
                            onChange={(e) => handleInputChange("place_of_supply_state", e.target.value)}
                            disabled={isReadOnly}
                            className={commonInputStyle}
                          >
                            <option value="">-- Select Place of Supply --</option>
                            {customerStateOptions.map((st) => (
                              <option key={st.isoCode || st.name} value={st.name}>
                                {st.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="Enter State or Region"
                            value={form.place_of_supply_state || ""}
                            onChange={(e) => handleInputChange("place_of_supply_state", e.target.value)}
                            disabled={isReadOnly}
                            className={commonInputStyle}
                          />
                        )}
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="City" />
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Chennai / Austin / Dubai"
                          value={form.customer_city}
                          onChange={(e) => handleInputChange("customer_city", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label={currentTaxConfig.taxIdLabel || "GSTIN / Tax ID"} />
                        </label>
                        <input
                          type="text"
                          placeholder={`Enter ${currentTaxConfig.taxIdLabel || "Tax ID"}`}
                          value={form.customer_gstin}
                          onChange={(e) => handleInputChange("customer_gstin", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Phone Number" />
                        </label>
                        <input
                          type="text"
                          placeholder="+1 (555) 000-0000"
                          value={form.customer_phone}
                          onChange={(e) => handleInputChange("customer_phone", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Email Address" />
                        </label>
                        <input
                          type="email"
                          placeholder="billing@customer.com"
                          value={form.customer_email}
                          onChange={(e) => handleInputChange("customer_email", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={labelStyle}>
                        <FieldLabelText label="Full Billing Address" />
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Street address, building, suite..."
                        value={form.customer_address}
                        onChange={(e) => handleInputChange("customer_address", e.target.value)}
                        disabled={isReadOnly}
                        className={`${commonInputStyle} h-auto py-2`}
                      />
                    </div>

                    {/* SAVE TO MASTER CHECKBOX */}
                    {!isReadOnly && (
                      <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200/80 flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          id="save_customer_to_master"
                          checked={Boolean(form.save_customer_to_master)}
                          onChange={(e) => handleInputChange("save_customer_to_master", e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                        />
                        <label htmlFor="save_customer_to_master" className="text-xs text-indigo-950 font-medium cursor-pointer">
                          <strong className="font-bold text-indigo-900 block">Save this customer for future invoices</strong>
                          If checked, this customer will be saved to your Customer Master database. If unchecked, billing details will be stored as an invoice-specific snapshot.
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* SECTION 3: SHIPMENT & LOGISTICS */}
          <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
            <div
              className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
              onClick={() => toggleSection("shipmentLogistics")}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                  <Truck className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">3. Shipment & Logistics</h3>
              </div>
              {openSections.shipmentLogistics ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openSections.shipmentLogistics && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Shipper Name" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter shipper name"
                    value={form.shipper_name}
                    onChange={(e) => handleInputChange("shipper_name", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Consignee Name" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter consignee name"
                    value={form.consignee_name}
                    onChange={(e) => handleInputChange("consignee_name", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Origin" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter origin"
                    value={form.origin}
                    onChange={(e) => handleInputChange("origin", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Destination" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter destination"
                    value={form.destination}
                    onChange={(e) => handleInputChange("destination", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Packs / Quantity" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter packs / quantity"
                    value={form.packs_qty}
                    onChange={(e) => handleInputChange("packs_qty", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Freight Terms" />
                  </label>
                  <select
                    value={form.freight_terms}
                    onChange={(e) => handleInputChange("freight_terms", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  >
                    <option value="">Select freight terms ▼</option>
                    <option value="Collect">Collect</option>
                    <option value="Prepaid">Prepaid</option>
                  </select>
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Weight (Kgs)" />
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    placeholder="Enter weight (Kgs)"
                    value={form.weight_kgs}
                    onChange={(e) => handleInputChange("weight_kgs", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Volume (CBM)" />
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Enter volume (CBM)"
                    value={form.volume_cbm}
                    onChange={(e) => handleInputChange("volume_cbm", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="ROE" required />
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Enter rate of exchange"
                    value={form.exchange_rate}
                    onChange={(e) => handleInputChange("exchange_rate", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                  {validationErrors.exchange_rate && <p className="text-xs text-rose-500 mt-1 font-medium">{validationErrors.exchange_rate}</p>}
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Currency" />
                  </label>
                  <CurrencySelect
                    value={form.currency_code || "INR"}
                    onChange={handleDocumentCurrencyChange}
                    disabled={isReadOnly}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* SECTION 4: SHIPPING DETAILS */}
          <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
            <div
              className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
              onClick={() => toggleSection("shippingDetails")}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                  <Ship className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">4. Shipping Details</h3>
              </div>
              {openSections.shippingDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openSections.shippingDetails && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="MBL" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter MBL number"
                    value={form.mbl_number}
                    onChange={(e) => handleInputChange("mbl_number", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="ThBL" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter ThBL number"
                    value={form.thbl_number}
                    onChange={(e) => handleInputChange("thbl_number", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="BL" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter BL number"
                    value={form.bl_number}
                    onChange={(e) => handleInputChange("bl_number", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Ocean BL No" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter Ocean BL number"
                    value={form.ocean_bl_no}
                    onChange={(e) => handleInputChange("ocean_bl_no", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Vessel" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter vessel name"
                    value={form.vessel_name}
                    onChange={(e) => handleInputChange("vessel_name", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Voyage No" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter voyage number"
                    value={form.voyage_no}
                    onChange={(e) => handleInputChange("voyage_no", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="ETD" />
                  </label>
                  <DateInput
                    value={form.etd_date}
                    placeholder="DD/MM/YYYY"
                    onChange={(val) => handleInputChange("etd_date", val)}
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="ETA" />
                  </label>
                  <DateInput
                    value={form.eta_date}
                    placeholder="DD/MM/YYYY"
                    onChange={(val) => handleInputChange("eta_date", val)}
                    disabled={isReadOnly}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* SECTION 5: OPERATIONS & CUSTOMS */}
          <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
            <div
              className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
              onClick={() => toggleSection("operationsCustoms")}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">5. Operations & Customs</h3>
              </div>
              {openSections.operationsCustoms ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openSections.operationsCustoms && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="IGM No" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter IGM number"
                    value={form.igm_no}
                    onChange={(e) => handleInputChange("igm_no", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="IGM Item No" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter IGM item number"
                    value={form.igm_item_no}
                    onChange={(e) => handleInputChange("igm_item_no", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="File No" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter file number"
                    value={form.file_no}
                    onChange={(e) => handleInputChange("file_no", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div>
                  <label className={labelStyle}>
                    <FieldLabelText label="Sales Rep" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter sales representative"
                    value={form.sales_rep}
                    onChange={(e) => handleInputChange("sales_rep", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelStyle}>
                    <FieldLabelText label="Container & Vehicle No" />
                  </label>
                  <input
                    type="text"
                    placeholder="Enter container / vehicle number"
                    value={form.container_details}
                    onChange={(e) => handleInputChange("container_details", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
                <div className="sm:col-span-2 flex items-center gap-2.5 pt-1">
                  <input
                    type="checkbox"
                    id="rcm_applicable"
                    checked={form.rcm_applicable}
                    onChange={(e) => handleInputChange("rcm_applicable", e.target.checked)}
                    disabled={isReadOnly}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                  />
                  <label htmlFor="rcm_applicable" className="text-xs font-semibold text-slate-700 cursor-pointer select-none">
                    Reverse Charge Applicable (RCM)
                  </label>
                </div>
              </div>
            )}
          </Card>

          {/* SECTION 6: LINE ITEMS (VYAPAR STYLED CARD EDITOR) */}
          <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                  <ListOrdered className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">6. Line Items</h3>
              </div>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={addLineItem}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-50 text-xs font-bold text-sky-700 hover:bg-sky-100 transition-colors border border-sky-200/80 shadow-2xs"
                >
                  <Plus className="w-4 h-4" /> Add Line Item
                </button>
              )}
            </div>

            {validationErrors.items && <p className="text-xs text-rose-500 mt-2 font-medium">{validationErrors.items}</p>}

            <div className="mt-4 space-y-4">
              {form.items.map((line: any, idx: number) => {
                const lineQty = Number(line.qty || 0);
                const lineUnitPrice = Number(line.unit_price || 0);
                const lineTaxRate = Number(line.tax_rate) || Number(line.igst_rate) || (Number(line.cgst_rate || 0) + Number(line.sgst_rate || 0)) || 0;
                const lineRoe = Number(form.exchange_rate || 1.0);
                const lineAmountInr = line.currency !== "INR" && lineRoe > 0 ? (lineQty * lineUnitPrice * lineRoe) : (lineQty * lineUnitPrice);
                const lineTaxable = lineAmountInr;
                const lineGst = previewData?.items?.[idx]?.taxAmount ?? ((lineTaxable * lineTaxRate) / 100);

                return (
                  <div key={line.id || idx} className="p-4 sm:p-5 bg-slate-50/70 rounded-2xl border border-slate-200/80 space-y-4 relative shadow-2xs">
                    {!isReadOnly && form.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLineItem(idx)}
                        className="absolute top-3.5 right-3.5 text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors"
                        title="Remove Line Item"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}

                    {/* CARD ROW 1: ITEM SELECTION & HSN/SAC */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pr-6">
                      <div className="sm:col-span-2">
                        <label className={labelStyle}>
                          <FieldLabelText label="Item" required />
                        </label>
                        <select
                          value={line.item_id}
                          onChange={(e) => handleLineItemSelect(idx, e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="">Search / Select Item ▼</option>
                          {itemsMaster.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.item_name} {it.hsn_sac ? `(HSN: ${it.hsn_sac})` : `(₹${it.sale_price})`}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="SAC / HSN" />
                        </label>
                        <input
                          type="text"
                          placeholder="Enter SAC / HSN"
                          value={line.hsn_sac}
                          onChange={(e) => handleLineItemChange(idx, "hsn_sac", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                    </div>

                    {/* CARD ROW 2: DESCRIPTION (FULL WIDTH) */}
                    <div>
                      <label className={labelStyle}>
                        <FieldLabelText label="Description" />
                      </label>
                      <input
                        type="text"
                        placeholder="Enter description"
                        value={line.description}
                        onChange={(e) => handleLineItemChange(idx, "description", e.target.value)}
                        disabled={isReadOnly}
                        className={commonInputStyle}
                      />
                    </div>

                    {/* CARD ROW 3: QTY, PER UNIT, CURRENCY, PLACE OF SUPPLY */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Quantity" required />
                        </label>
                        <input
                          type="number"
                          min="1"
                          placeholder="Enter quantity"
                          value={line.qty}
                          onChange={(e) => handleLineItemChange(idx, "qty", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Per Unit" required />
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Enter per unit"
                          value={line.unit_price}
                          onChange={(e) => handleLineItemChange(idx, "unit_price", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Currency" />
                        </label>
                        <CurrencySelect
                          value={line.currency || form.currency_code || "INR"}
                          onChange={(code) => handleLineItemChange(idx, "currency", code)}
                          disabled={isReadOnly}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Place of Supply" />
                        </label>
                        <select
                          value={line.place_of_supply}
                          onChange={(e) => handleLineItemChange(idx, "place_of_supply", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="">Select place of supply ▼</option>
                          {indianStates.map((st: any) => (
                            <option key={st.isoCode || st.name} value={st.name}>
                              {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* CARD ROW 4: TAX RATES (CGST %, SGST %, IGST %) */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="CGST %" />
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Enter CGST %"
                          value={line.cgst_rate}
                          onChange={(e) => handleLineItemChange(idx, "cgst_rate", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="SGST %" />
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Enter SGST %"
                          value={line.sgst_rate}
                          onChange={(e) => handleLineItemChange(idx, "sgst_rate", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>

                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="IGST %" />
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Enter IGST %"
                          value={line.igst_rate}
                          onChange={(e) => handleLineItemChange(idx, "igst_rate", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                    </div>

                    {/* CARD ROW 5: NON-EDITABLE CALCULATED VALUES AREA */}
                    <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 flex flex-wrap items-center justify-between text-xs text-slate-700 gap-2 select-none shadow-2xs">
                      <div>
                        Amount in INR: <strong className="text-slate-900 font-bold">₹{formatDecimalByPreference(lineAmountInr)}</strong>
                      </div>
                      <div>
                        Taxable Amount: <strong className="text-slate-900 font-bold">₹{formatDecimalByPreference(lineTaxable)}</strong>
                      </div>
                      <div>
                        GST Total: <strong className="text-slate-900 font-bold">₹{formatDecimalByPreference(lineGst)}</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FORM TOTALS SUMMARY DISPLAY */}
            <div className="mt-5 p-4 sm:p-5 bg-slate-100/80 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between text-slate-700">
                <span>Total Before Tax:</span>
                <span className="font-semibold text-slate-900">₹{formatDecimalByPreference(previewData.totals.subTotal)}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>CGST Total:</span>
                <span className="font-semibold text-slate-900">₹{formatDecimalByPreference(previewData.totals.cgstTotal)}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>SGST Total:</span>
                <span className="font-semibold text-slate-900">₹{formatDecimalByPreference(previewData.totals.sgstTotal)}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>IGST Total:</span>
                <span className="font-semibold text-slate-900">₹{formatDecimalByPreference(previewData.totals.igstTotal)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span>Payment Received / Advance:</span>
                <span className="font-semibold text-emerald-700">₹{formatDecimalByPreference(previewData.totals.amountPaid || 0)}</span>
              </div>
              <div className="pt-2 border-t border-slate-300 flex justify-between text-sm font-bold text-slate-900">
                <span>Total After Tax:</span>
                <span className="text-sky-600 text-base">₹{formatDecimalByPreference(previewData.totals.total)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-slate-900">
                <span>Balance Due:</span>
                <span className="text-rose-600 text-base">₹{formatDecimalByPreference(previewData.totals.balanceDue)}</span>
              </div>
              <p className="pt-1 text-[11px] font-semibold text-slate-600 italic">
                Amount in words: <span className="text-slate-900 uppercase font-bold">{previewData.grand_total_in_words}</span>
              </p>
            </div>
          </Card>

          {/* SECTION 7: NOTES & TERMS */}
          <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
            <div
              className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
              onClick={() => toggleSection("notesTerms")}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                  <FileCode className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">7. Notes & Terms</h3>
              </div>
              {openSections.notesTerms ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>

            {openSections.notesTerms && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelStyle}>
                    <FieldLabelText label="Notes / Remarks" />
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter notes or internal remarks"
                    value={form.notes}
                    onChange={(e) => handleInputChange("notes", e.target.value)}
                    disabled={isReadOnly}
                    className="w-full h-[100px] rounded-xl border border-slate-200 bg-white p-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all shadow-2xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelStyle}>
                    <FieldLabelText label="Terms & Conditions" />
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter terms and conditions"
                    value={form.terms}
                    onChange={(e) => handleInputChange("terms", e.target.value)}
                    disabled={isReadOnly}
                    className="w-full h-[100px] rounded-xl border border-slate-200 bg-white p-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all shadow-2xs"
                  />
                </div>
              </div>
            )}
          </Card>

          {/* BOTTOM FORM SAVE ACTION CARD */}
          {!isReadOnly && (
            <Card padding="p-4 sm:p-5" className="border-sky-200 bg-gradient-to-r from-sky-50/80 via-indigo-50/50 to-white shadow-sm rounded-2xl flex flex-wrap items-center justify-between gap-3 mt-4">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Ready to save your Pro Forma Invoice?</h4>
                <p className="text-xs text-slate-500">All entered customer, line items, and tax details will be saved.</p>
              </div>
              <div className="flex items-center gap-2.5">
                <GradientButton variant="secondary" onClick={() => navigate("/app/sales/proformas/history")}>
                  Cancel
                </GradientButton>
                <GradientButton variant="secondary" onClick={handlePrintPdf}>
                  <Printer className="w-4 h-4 mr-1.5 text-sky-600" />
                  Print / PDF
                </GradientButton>
                <GradientButton onClick={handleSave} loading={saving}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {isNew ? "Save Pro Forma Invoice" : "Update Pro Forma Invoice"}
                </GradientButton>
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT LIVE STICKY MASTER PREVIEW COLUMN (VYAPAR STYLED) */}
        <div className="xl:sticky xl:top-[85px] xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto pr-1 space-y-3 custom-scrollbar">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Live Dynamic Master Preview</h3>
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-bold text-sky-700 uppercase tracking-wider">
                {previewData.isProforma ? "PRO FORMA" : "TAX INVOICE"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrintPdf}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5"
                title="Print or Download PDF"
              >
                <Printer className="w-3.5 h-3.5 text-sky-600" />
                Print / PDF
              </button>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                  title="Save Pro Forma Invoice"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>
          </div>

          {/* Render Master Invoice Preview matching I031066_TI.pdf with Vyapar container card */}
          <div className="p-4 sm:p-5 bg-slate-100/70 rounded-2xl border border-slate-200/90 shadow-inner overflow-hidden">
            <div id="proforma-preview-container" className="bg-white rounded-xl shadow-lg border border-slate-200/80 overflow-hidden">
              <InvoicePreview
                templateId={selectedTemplateKey}
                invoiceData={previewData}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
