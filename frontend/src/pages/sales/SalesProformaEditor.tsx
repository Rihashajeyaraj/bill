import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, X, ChevronDown, ChevronUp, FileText, User, Truck, Ship, ShieldCheck, ListOrdered, FileCode, Sparkles, Printer, Download, Save, ArrowLeft, Trash2 } from "lucide-react";
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
import { getTemplateConfig } from "../../services/templateConfig";
import { useToast } from "../../context/ToastContext";
import { useOrganization } from "../../context/OrganizationContext";
import { apiClient } from "../../services/apiClient";
import { formatDecimalByPreference } from "../../lib/formatPreferences";
import { listAllCountries, listStatesByCountry } from "../../lib/geoData";
import { calculateTaxes, getCountryTaxConfig } from "../../services/tax";
import { useQueryClient } from "@tanstack/react-query";
import { salesProformaUpsert } from "../../services/proformas.service";
import { uid } from "../../services/storage";
import { upsertPartyRemote } from "../../modules/parties/store";


function createEmptyLine(defaultCurrency = "INR") {
  return {
    id: `line_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    item_id: "",
    item_mode: "select",
    item_name: "",
    description: "",
    hsn_sac: "",
    qty: "1",
    unit: "PCS",
    unit_price: "",
    discount_type: "PERCENT",
    discount_value: "0",
    discount_amount: "0",
    discount_percent: "0",
    currency: defaultCurrency,
    tax_rate: "0",
    cgst_rate: "0",
    sgst_rate: "0",
    igst_rate: "0",
    place_of_supply: ""
  };
}


function numberToWordsINR(num: number): string {
  const val = Number(num || 0);
  if (val <= 0) return "ZERO ONLY";

  const rupees = Math.floor(val);
  const paise = Math.round((val - rupees) * 100);

  const a = [
    "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
    "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"
  ];
  const b = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? (b[Math.floor(n / 10)] ? "-" : "") + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " HUNDRED" + (n % 100 !== 0 ? " " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + " THOUSAND" + (n % 1000 !== 0 ? " " + inWords(n % 1000) : "");
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + " LAKH" + (n % 100000 !== 0 ? " " + inWords(n % 100000) : "");
    return inWords(Math.floor(n / 10000000)) + " CRORE" + (n % 10000000 !== 0 ? " " + inWords(n % 10000000) : "");
  }

  let result = rupees > 0 ? inWords(rupees) : "";
  if (paise > 0) {
    result = result ? `${result} AND ${inWords(paise)}` : inWords(paise);
  }
  return `${result.trim()} ONLY`;
}

export default function SalesProformaEditor() {
  const { id = "new" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
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
    export_type: "DOMESTIC",
    lut_number: "",
    lut_bond_no: "",

    // Customer Snapshot
    customer_name: "",
    customer_company_name: "",
    customer_country: "",
    customer_address: "",
    customer_city: "",
    customer_pincode: "",
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
    hbl_number: "",
    thbl_number: "",
    mbl_number: "",
    ocean_bl_no: "",
    vessel_name: "",
    voyage_no: "",
    vessel_voyage: "",
    etd_date: "",
    eta_date: "",

    // Operations & Customs
    igm_no: "",
    igm_date: "",
    igm_item_no: "",
    file_no: "",
    sales_rep: "",
    rcm_applicable: false,
    container_details: "",
    container_vehicle_no: "",

    status: "DRAFT",
    converted_document_id: "",
    discount_type: "AMOUNT",
    discount_value: "0",
    notes: "",
    remarks: "",
    terms: "Interest @ 18% p.a. will be applicable if the invoice is not paid on or before the due date.",
    tds_note: "Kindly deduct T.D.S on Invoice amount excluding GST amount.",
    items: [createEmptyLine("INR")]
  });

  const [validationErrors, setValidationErrors] = useState<any>({});

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

  const templateConfig = useMemo(() => getTemplateConfig(selectedTemplateKey), [selectedTemplateKey]);
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

  const indianStates = useMemo(() => listStatesByCountry("IN"), []);

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
              exchange_rate: String(proforma.exchange_rate || proforma.roe || "1.0"),
              export_type: proforma.export_type || "DOMESTIC",
              lut_number: proforma.lut_number || proforma.lut_bond_no || "",
              lut_bond_no: proforma.lut_bond_no || "",

              customer_name: proforma.customer_name || "",
              customer_company_name: proforma.customer_company_name || "",
              customer_country: proforma.customer_country || "India",
              customer_address: proforma.customer_address || "",
              customer_city: proforma.customer_city || "",
              customer_pincode: proforma.customer_pincode || proforma.bill_pincode || "",
              customer_gstin: proforma.customer_gstin || "",
              customer_phone: proforma.customer_phone || "",
              customer_email: proforma.customer_email || "",
              save_customer_to_master: Boolean(proforma.save_customer_to_master),
              amount_paid: String(proforma.amount_paid ?? proforma.advance_paid ?? 0),

              shipper_name: proforma.shipper_name || "",
              consignee_name: proforma.consignee_name || "",
              origin: proforma.origin || "",
              destination: proforma.destination || "",
              packs_qty: proforma.packs_qty ? String(proforma.packs_qty) : "",
              weight_kgs: proforma.weight_kgs ? String(proforma.weight_kgs) : "",
              volume_cbm: proforma.volume_cbm ? String(proforma.volume_cbm) : "",
              freight_terms: proforma.freight_terms || "Collect",

              bl_number: proforma.bl_number || proforma.hbl_number || "",
              hbl_number: proforma.hbl_number || "",
              thbl_number: proforma.thbl_number || "",
              mbl_number: proforma.mbl_number || "",
              ocean_bl_no: proforma.ocean_bl_no || "",
              vessel_name: proforma.vessel_name || "",
              voyage_no: proforma.voyage_no || proforma.vessel_voyage || "",
              vessel_voyage: proforma.vessel_voyage || "",
              etd_date: proforma.etd_date || "",
              eta_date: proforma.eta_date || "",

              igm_no: proforma.igm_no || "",
              igm_date: proforma.igm_date || "",
              igm_item_no: proforma.igm_item_no || "",
              file_no: proforma.file_no || "",
              sales_rep: proforma.sales_rep || "",
              rcm_applicable: Boolean(proforma.rcm_applicable),
              container_details: proforma.container_details || proforma.container_vehicle_no || "",

              discount_type: proforma.discount_type || "AMOUNT",
              discount_value: String(proforma.discount_value ?? proforma.discount_amount ?? 0),
              status: proforma.status || "DRAFT",
              converted_document_id: proforma.converted_document_id || "",
              notes: proforma.notes || "",
              remarks: proforma.remarks || proforma.notes || "",
              terms: proforma.terms || "",
              tds_note: proforma.tds_note || "Kindly deduct T.D.S on Invoice amount excluding GST amount.",
              items: Array.isArray(proforma.items) && proforma.items.length > 0
                ? proforma.items.map((it: any) => ({
                  id: it.id || `line_${Math.random()}`,
                  item_id: it.item_id || "",
                  item_mode: it.item_id ? "select" : "manual",
                  item_name: it.item_name || it.description || "",
                  description: it.description || "",
                  hsn_sac: it.hsn_sac || "",
                  qty: String(it.qty ?? 1),
                  unit: it.unit || "PCS",
                  unit_price: String(it.unit_price ?? 0),
                  discount_type: it.discount_type || (it.discount_percent > 0 ? "PERCENT" : "AMOUNT"),
                  discount_value: String(it.discount_value ?? it.discount_amount ?? it.discount_percent ?? 0),
                  currency: it.currency || proforma.currency_code || "INR",
                  tax_rate: String(it.tax_rate ?? 18),
                  cgst_rate: String(it.cgst_rate ?? 9),
                  sgst_rate: String(it.sgst_rate ?? 9),
                  igst_rate: String(it.igst_rate ?? 0),
                  place_of_supply: it.place_of_supply || ""
                }))
                : [createEmptyLine(proforma.currency_code || "INR")]
            });
            if (proforma.party_id) {
              setCustomerEntryMode("existing");
            } else if (proforma.customer_name) {
              setCustomerEntryMode("manual");
            }
          }
        } else {
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

  const handleLineItemSelect = (index: number, itemId: string) => {
    if (itemId === "MANUAL_ENTRY") {
      setForm((prev: any) => {
        const newItems = [...prev.items];
        newItems[index] = {
          ...newItems[index],
          item_id: "",
          item_mode: "manual"
        };
        return { ...prev, items: newItems };
      });
      return;
    }

    const masterItem = itemsMaster.find((it) => String(it.id) === String(itemId));
    setForm((prev: any) => {
      const newItems = [...prev.items];
      if (masterItem) {
        const isLut = prev.export_type === "LUT";
        const rateStr = isLut ? "0" : (masterItem.tax_rate !== undefined && masterItem.tax_rate !== null ? String(masterItem.tax_rate) : "18");
        const numRate = Number(rateStr || 0);
        const name = masterItem.item_name || masterItem.description || "";
        newItems[index] = {
          ...newItems[index],
          item_id: masterItem.id,
          item_mode: "select",
          item_name: name,
          description: masterItem.description || name,
          hsn_sac: masterItem.hsn_sac || "",
          unit: masterItem.unit || "PCS",
          unit_price: masterItem.sale_price !== undefined && masterItem.sale_price !== null ? String(masterItem.sale_price) : newItems[index].unit_price,
          tax_rate: rateStr,
          cgst_rate: String(numRate / 2),
          sgst_rate: String(numRate / 2),
          igst_rate: String(numRate)
        };
      } else {
        newItems[index] = {
          ...newItems[index],
          item_id: itemId,
          item_mode: itemId ? "select" : "manual"
        };
      }
      return { ...prev, items: newItems };
    });
  };

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

  const handleExportTypeChange = (newType: string) => {
    setForm((prev: any) => {
      const isLut = newType === "LUT";
      return {
        ...prev,
        export_type: newType,
        items: (prev.items || []).map((line: any) => ({
          ...line,
          tax_rate: isLut ? "0" : line.tax_rate,
          cgst_rate: isLut ? "0" : line.cgst_rate,
          sgst_rate: isLut ? "0" : line.sgst_rate,
          igst_rate: isLut ? "0" : line.igst_rate
        }))
      };
    });
  };

  const handleInputChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleLineItemChange = (index: number, field: string, value: any) => {
    setForm((prev: any) => {
      const newItems = [...prev.items];
      const item = { ...newItems[index], [field]: value };

      if (field === "item_name") {
        item.description = value;
      } else if (field === "description" && item.item_mode === "manual") {
        item.item_name = value;
      }

      if (prev.export_type === "LUT") {
        item.tax_rate = "0";
        item.cgst_rate = "0";
        item.sgst_rate = "0";
        item.igst_rate = "0";
      } else if (field === "tax_rate") {
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

  const previewData = useMemo(() => {
    const companyAddressParts = [company?.address?.line1, company?.address?.city, company?.address?.state, company?.address?.postalCode].filter(Boolean);
    const roe = Number(form.exchange_rate) || 1.0;
    const isLutExport = form.export_type === "LUT";

    const companyCountry = company?.country || company?.countryName || "India";
    const companyState = company?.address?.state || company?.state || "";
    const companyGstin = company?.tax?.gstin || company?.gstin || "";

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

    let grossSubTotal = 0;
    let linesDiscountTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    const formattedItems = (form.items || []).map((l: any, idx: number) => {
      const qty = Number(l.qty || 0);
      const rate = Number(l.unit_price || 0);
      const rawTaxRate = isLutExport ? 0 : Number(l.tax_rate || 0);

      const rawAmountInr = (l.currency !== "INR" && roe > 0) ? (qty * rate * roe) : (qty * rate);
      const discVal = Number(l.discount_value ?? l.discount_amount ?? l.discount_percent ?? 0);
      const discType = l.discount_type || (Number(l.discount_percent || 0) > 0 ? "PERCENT" : "AMOUNT");
      let lineDiscountInr = 0;
      if (discType === "PERCENT") {
        lineDiscountInr = (rawAmountInr * discVal) / 100;
      } else {
        lineDiscountInr = discVal * ((l.currency !== "INR" && roe > 0) ? roe : 1);
      }
      lineDiscountInr = Math.min(rawAmountInr, Math.max(0, lineDiscountInr));
      const taxable = Math.max(0, rawAmountInr - lineDiscountInr);

      const pos = l.place_of_supply || form.place_of_supply_state || resolvedCustomerState;
      const partyStateForTax = pos || resolvedCustomerState;
      const partyCountryForTax = resolvedCustomerCountry || "India";

      const hasCustomerContext = Boolean(
        resolvedCustomerCountry || resolvedCustomerState ||
        form.party_id || form.customer_name || pos
      );

      const taxRes = (!isLutExport && hasCustomerContext) ? calculateTaxes({
        taxableAmount: taxable,
        taxRate: rawTaxRate,
        localTaxRate: 0,
        taxLabel: "GST",
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

      grossSubTotal += rawAmountInr;
      linesDiscountTotal += lineDiscountInr;
      cgstTotal += taxRes.cgst || 0;
      sgstTotal += taxRes.sgst || 0;
      igstTotal += taxRes.igst || 0;

      const isIntraState = taxRes.sameState && taxRes.taxMode === "GST";
      const isInterState = !taxRes.sameState && taxRes.taxMode === "GST";

      const itemCgstRate = isLutExport ? 0 : (isIntraState ? (rawTaxRate / 2) : 0);
      const itemSgstRate = isLutExport ? 0 : (isIntraState ? (rawTaxRate / 2) : 0);
      const itemIgstRate = isLutExport ? 0 : (isInterState ? rawTaxRate : 0);

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
        discount: lineDiscountInr,
        discount_amount: lineDiscountInr,
        discount_type: discType,
        discount_value: discVal,
        currency: l.currency || form.currency_code || "INR",
        placeOfSupply: pos,
        cgstRate: itemCgstRate,
        sgstRate: itemSgstRate,
        igstRate: itemIgstRate,
        cgstAmount: isLutExport ? 0 : (taxRes.cgst || 0),
        sgstAmount: isLutExport ? 0 : (taxRes.sgst || 0),
        igstAmount: isLutExport ? 0 : (taxRes.igst || 0),
        taxMode: isLutExport ? "LUT" : taxRes.taxMode,
        taxAmount: isLutExport ? 0 : taxRes.totalTax,
        amountInr: rawAmountInr,
        taxableValue: taxable,
        taxable_amount: taxable,
        amount: isLutExport ? taxable : taxRes.grandTotal,
        net: isLutExport ? taxable : taxRes.grandTotal
      };
    });

    const subTotalAfterLineDisc = Math.max(0, grossSubTotal - linesDiscountTotal);
    const docDiscVal = Number(form.discount_value || 0);
    const docDiscType = form.discount_type || "AMOUNT";
    let docDiscountInr = 0;
    if (docDiscType === "PERCENT") {
      docDiscountInr = (subTotalAfterLineDisc * docDiscVal) / 100;
    } else {
      docDiscountInr = docDiscVal;
    }
    docDiscountInr = Math.min(subTotalAfterLineDisc, Math.max(0, docDiscountInr));

    const discountTotal = linesDiscountTotal + docDiscountInr;
    const finalTaxableSubTotal = Math.max(0, grossSubTotal - discountTotal);

    const taxScaleFactor = subTotalAfterLineDisc > 0 ? (finalTaxableSubTotal / subTotalAfterLineDisc) : 1;
    const finalCgstTotal = isLutExport ? 0 : (cgstTotal * taxScaleFactor);
    const finalSgstTotal = isLutExport ? 0 : (sgstTotal * taxScaleFactor);
    const finalIgstTotal = isLutExport ? 0 : (igstTotal * taxScaleFactor);

    const taxTotal = finalCgstTotal + finalSgstTotal + finalIgstTotal;
    const grandTotal = Number((finalTaxableSubTotal + taxTotal).toFixed(2));
    const grandTotalInWords = numberToWordsINR(grandTotal);

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
      customerPincode: form.customer_pincode || selectedCustomer?.postal_code || "",
      customerGstin: displayCustomerGstin,
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
      exportType: form.export_type || "DOMESTIC",
      lutNumber: form.lut_number || form.lut_bond_no || "",

      shipperName: form.shipper_name,
      consigneeName: form.consignee_name,
      origin: form.origin,
      destination: form.destination,
      packsQty: form.packs_qty,
      weightKgs: form.weight_kgs,
      volumeCbm: form.volume_cbm,
      freightTerms: form.freight_terms,

      blNumber: form.bl_number || form.hbl_number,
      hblNumber: form.hbl_number,
      thblNumber: form.thbl_number,
      mblNumber: form.mbl_number,
      oceanBlNo: form.ocean_bl_no,
      vesselName: form.vessel_name,
      voyageNo: form.voyage_no || form.vessel_voyage,
      etdDate: form.etd_date,
      etaDate: form.eta_date,

      igmNo: form.igm_no,
      igmDate: form.igm_date,
      igmItemNo: form.igm_item_no,
      fileNo: form.file_no,
      salesRep: form.sales_rep,
      rcmApplicable: form.rcm_applicable,
      containerDetails: form.container_details || form.container_vehicle_no,

      notes: form.notes,
      remarks: form.remarks || form.notes || "",
      terms: form.terms,
      paymentTerms: form.terms,
      tdsNote: form.tds_note,

      items: formattedItems,
      totals: {
        grossSubTotal,
        discountTotal,
        subTotal: finalTaxableSubTotal,
        taxableTotal: finalTaxableSubTotal,
        cgstTotal: finalCgstTotal,
        sgstTotal: finalSgstTotal,
        igstTotal: finalIgstTotal,
        total: grandTotal,
        grandTotal,
        amountPaid: Number(form.amount_paid || 0),
        balanceDue: Math.max(0, grandTotal - Number(form.amount_paid || 0))
      },
      amountPaid: Number(form.amount_paid || 0),
      balanceDue: Math.max(0, grandTotal - Number(form.amount_paid || 0)),
      grand_total_in_words: grandTotalInWords
    };
  }, [form, selectedCustomer, company, customerEntryMode]);

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

    if (form.currency_code && form.currency_code !== "INR") {
      if (!form.exchange_rate || Number(form.exchange_rate) <= 0 || isNaN(Number(form.exchange_rate))) {
        errs.exchange_rate = "Rate of Exchange (ROE) is required for foreign currency.";
      }
    }

    let validItems = 0;
    (form.items || []).forEach((line: any) => {
      const itemText = line.item_name || line.description || "";
      if (itemText.trim() && Number(line.qty) > 0 && Number(line.unit_price) >= 0) validItems++;
    });
    if (validItems === 0) errs.items = "At least one line item with Item Name, Qty > 0, and Unit Price is required.";

    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      toast.showError("Please fill all required fields before saving.");
      return;
    }
    setSaving(true);
    try {
      const customerDisplayName = form.customer_name || selectedCustomer?.display_name || selectedCustomer?.name || "Customer";
      let effectivePartyId = form.party_id;

      if ((customerEntryMode === "manual" || form.save_customer_to_master) && customerDisplayName && customerDisplayName !== "Customer") {
        try {
          const partyRecord = await upsertPartyRemote({
            name: customerDisplayName,
            country: form.customer_country || effectiveCustomerCountry || "India",
            state: form.place_of_supply_state || "",
            city: form.customer_city || "",
            address: form.customer_address || "",
            gstin: form.customer_gstin || "",
            phone: form.customer_phone || "",
            email: form.customer_email || "",
            type: "Customer",
            openingBalance: 0,
            openingBalanceType: "To Pay" as any,
            creditLimit: 0,
            creditLimitDays: 0,
            creditLimitType: "Amount" as any,
            creditLimitEnabled: false,
            attachments: []
          } as any);
          if (partyRecord?.id) {
            effectivePartyId = partyRecord.id;
          }
        } catch (partyErr) {
          console.warn("Notice saving customer to master parties database:", partyErr);
        }
      }

      if (!effectivePartyId) {
        toast.showError("A valid customer (party_id) is required. Please select or save a customer.");
        setSaving(false);
        return;
      }

      const payload = {
        template_id: selectedTemplateKey,
        proforma_no: form.proforma_no || undefined,
        proforma_date: form.proforma_date,
        valid_till: form.valid_till || undefined,
        due_date: form.due_date || undefined,
        party_id: effectivePartyId || undefined,
        customer_ref: form.customer_ref || undefined,
        place_of_supply_state: form.place_of_supply_state || undefined,
        currency_code: form.currency_code || "INR",
        exchange_rate: Number(form.exchange_rate || 1.0),
        roe: Number(form.exchange_rate || 1.0),
        export_type: form.export_type || "DOMESTIC",
        lut_number: form.lut_number || form.lut_bond_no || undefined,
        lut_bond_no: form.lut_bond_no || undefined,

        customer_name: customerDisplayName,
        customer_company_name: form.customer_company_name || undefined,
        customer_country: form.customer_country || effectiveCustomerCountry || undefined,
        customer_address: form.customer_address || undefined,
        customer_city: form.customer_city || undefined,
        customer_pincode: form.customer_pincode || undefined,
        customer_gstin: form.customer_gstin || undefined,
        customer_phone: form.customer_phone || undefined,
        customer_email: form.customer_email || undefined,
        save_customer_to_master: Boolean(form.save_customer_to_master),
        amount_paid: Number(form.amount_paid || 0),

        shipper_name: form.shipper_name || undefined,
        consignee_name: form.consignee_name || undefined,
        origin: form.origin || undefined,
        destination: form.destination || undefined,
        packs_qty: form.packs_qty || undefined,
        weight_kgs: form.weight_kgs ? Number(form.weight_kgs) : undefined,
        volume_cbm: form.volume_cbm ? Number(form.volume_cbm) : undefined,
        freight_terms: form.freight_terms || "Collect",

        bl_number: form.bl_number || form.hbl_number || undefined,
        hbl_number: form.hbl_number || undefined,
        thbl_number: form.thbl_number || undefined,
        mbl_number: form.mbl_number || undefined,
        ocean_bl_no: form.ocean_bl_no || undefined,
        vessel_name: form.vessel_name || undefined,
        voyage_no: form.voyage_no || form.vessel_voyage || undefined,
        vessel_voyage: form.vessel_voyage || undefined,
        etd_date: form.etd_date || undefined,
        eta_date: form.eta_date || undefined,

        igm_no: form.igm_no || undefined,
        igm_date: form.igm_date || undefined,
        igm_item_no: form.igm_item_no || undefined,
        file_no: form.file_no || undefined,
        sales_rep: form.sales_rep || undefined,
        rcm_applicable: Boolean(form.rcm_applicable),
        container_details: form.container_details || form.container_vehicle_no || undefined,

        discount_type: form.discount_type || "AMOUNT",
        discount_value: Number(form.discount_value || 0),
        notes: form.notes || undefined,
        remarks: form.remarks || form.notes || undefined,
        terms: form.terms || undefined,
        tds_note: form.tds_note || undefined,

        items: (form.items || []).map((line: any) => {
          const qty = Number(line.qty || 1);
          const unitPrice = Number(line.unit_price || 0);
          const rawTotal = qty * unitPrice;
          const discVal = Number(line.discount_value ?? line.discount_amount ?? line.discount_percent ?? 0);
          const discType = line.discount_type || (Number(line.discount_percent || 0) > 0 ? "PERCENT" : "AMOUNT");
          let discAmount = 0;
          let discPercent = 0;
          if (discType === "PERCENT") {
            discPercent = discVal;
            discAmount = (rawTotal * discPercent) / 100;
          } else {
            discAmount = discVal;
            discPercent = rawTotal > 0 ? (discAmount / rawTotal) * 100 : 0;
          }
          return {
            item_id: line.item_id || undefined,
            description: line.description || "Item",
            hsn_sac: line.hsn_sac || "",
            qty,
            unit: line.unit || "PCS",
            unit_price: unitPrice,
            discount_percent: discPercent,
            discount_amount: discAmount,
            tax_rate: form.export_type === "LUT" ? 0 : Number(line.tax_rate || 0),
            cgst_rate: form.export_type === "LUT" ? 0 : Number(line.cgst_rate || 0),
            sgst_rate: form.export_type === "LUT" ? 0 : Number(line.sgst_rate || 0),
            igst_rate: form.export_type === "LUT" ? 0 : Number(line.igst_rate || 0),
            place_of_supply: line.place_of_supply || undefined,
            currency: line.currency || form.currency_code || "INR"
          };
        })
      };

      let res: any;
      if (isNew) {
        res = await apiClient.createProforma(payload);
      } else {
        res = await apiClient.updateProforma(form.id, payload);
      }

      const savedNo = res?.proforma_no || res?.proformaNo || form.proforma_no || "PI-0001";
      queryClient.invalidateQueries({ queryKey: ["proformas"] });

      toast.showSuccess(`Pro Forma Invoice ${savedNo} saved successfully!`);
      navigate("/app/sales/proformas/history");
    } catch (err: any) {
      const msg = err.message || "Failed to save Pro Forma invoice";
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handlePrintPdf = () => {
    const container = document.getElementById("proforma-preview-container");
    if (!container) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.showError("Failed to open print window. Please allow popups.");
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Pro Forma ${form.proforma_no || "Invoice"}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 20px; background: white; color: #1e293b; }
            @media print { body { padding: 0; } }
          </style>
          <link rel="stylesheet" href="${window.location.origin}/src/index.css" />
        </head>
        <body>
          <div>${container.innerHTML}</div>
          <script>
            window.onload = function() {
              setTimeout(function() {
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

  const commonInputStyle = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-2xs focus:border-sky-500 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 disabled:bg-slate-100 disabled:text-slate-500";
  const labelStyle = "block text-xs font-bold text-slate-700 mb-1";

  return (
    <div className="min-h-screen bg-slate-50/50 pb-16 text-slate-800">
      <PageHeader
        title={isNew ? "Create Pro Forma Invoice" : isReadOnly ? `View Pro Forma ${form.proforma_no}` : `Edit Pro Forma ${form.proforma_no}`}
        subtitle="Generate, preview, and save professional Pro Forma quotes for customers"
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/app/sales/proformas/history")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <ArrowLeft className="w-4 h-4 text-slate-500" /> Back to History
            </button>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* LEFT FORM COLUMN (7 COLS) */}
          <div className="lg:col-span-7 space-y-6">

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
                  <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">1. Document Details</h3>
                </div>
                {openSections.invoiceDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>

              {openSections.invoiceDetails && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Pro Forma Number" required />
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={form.proforma_no}
                        onChange={(e) => handleInputChange("proforma_no", e.target.value)}
                        disabled={isReadOnly}
                        className={commonInputStyle}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Pro Forma Date" required />
                    </label>
                    <DateInput
                      value={form.proforma_date}
                      onChange={(val) => handleInputChange("proforma_date", val)}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Valid Until Date" />
                    </label>
                    <DateInput
                      value={form.valid_till}
                      placeholder="Valid Till Date"
                      onChange={(val) => handleInputChange("valid_till", val)}
                      disabled={isReadOnly}
                    />
                  </div>

                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Customer PO / Reference" />
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. PO-998231 / Ref #123"
                      value={form.customer_ref}
                      onChange={(e) => handleInputChange("customer_ref", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>

                  {/* EXPORT TYPE SELECTOR */}
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Export Type / GST Scheme" required />
                    </label>
                    <select
                      value={form.export_type || "DOMESTIC"}
                      onChange={(e) => handleExportTypeChange(e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    >
                      <option value="DOMESTIC">Domestic Supply</option>
                      <option value="LUT">Export under LUT (0% IGST)</option>
                      <option value="TAX_PAYMENT">Export with payment of IGST</option>
                    </select>
                  </div>

                  {/* LUT NUMBER INPUT (Shown when Export under LUT is selected) */}
                  {form.export_type === "LUT" && (
                    <div>
                      <label className={labelStyle}>
                        <FieldLabelText label="LUT / Bond Number" />
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. LUT/2026-27/001"
                        value={form.lut_number}
                        onChange={(e) => handleInputChange("lut_number", e.target.value)}
                        disabled={isReadOnly}
                        className={commonInputStyle}
                      />
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* SECTION 2: CUSTOMER SELECTION */}
            <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
              <div
                className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
                onClick={() => toggleSection("customerDetails")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">2. Customer Details</h3>
                </div>
                {openSections.customerDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>

              {openSections.customerDetails && (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                    <button
                      type="button"
                      onClick={() => setCustomerEntryMode("existing")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${customerEntryMode === "existing" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                        }`}
                    >
                      Select Customer
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerEntryMode("manual")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${customerEntryMode === "manual" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                        }`}
                    >
                      Enter Manually
                    </button>
                  </div>

                  {customerEntryMode === "existing" && (
                    <div className="space-y-3">
                      <div>
                        <select
                          value={form.party_id}
                          onChange={handleCustomerSelect}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="">-- Select Customer from Database --</option>
                          {filteredCustomers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.display_name || c.name} {c.phone ? `· 📞 ${c.phone}` : ""} {c.state_name ? `· 📍 ${c.state_name}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {customerEntryMode === "manual" && (
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
                          <FieldLabelText label="Company Name" />
                        </label>
                        <input
                          type="text"
                          placeholder="Company / Business Name"
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
                          onChange={(e) => handleInputChange("customer_country", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="">-- Select Country --</option>
                          {allCountries.map((c) => (
                            <option key={c.isoCode} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="State / Place of Supply" />
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. MAHARASHTRA"
                          value={form.place_of_supply_state}
                          onChange={(e) => handleInputChange("place_of_supply_state", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="City" />
                        </label>
                        <input
                          type="text"
                          placeholder="City"
                          value={form.customer_city}
                          onChange={(e) => handleInputChange("customer_city", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Pincode" />
                        </label>
                        <input
                          type="text"
                          placeholder="Pincode / Postal code"
                          value={form.customer_pincode}
                          onChange={(e) => handleInputChange("customer_pincode", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="GSTIN" />
                        </label>
                        <input
                          type="text"
                          placeholder="27AAAAA0000A1Z5"
                          value={form.customer_gstin}
                          onChange={(e) => handleInputChange("customer_gstin", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Phone" />
                        </label>
                        <input
                          type="text"
                          placeholder="+91 9876543210"
                          value={form.customer_phone}
                          onChange={(e) => handleInputChange("customer_phone", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>
                          <FieldLabelText label="Email" />
                        </label>
                        <input
                          type="email"
                          placeholder="customer@example.com"
                          value={form.customer_email}
                          onChange={(e) => handleInputChange("customer_email", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelStyle}>
                          <FieldLabelText label="Billing Address" />
                        </label>
                        <textarea
                          rows={2}
                          placeholder="Full Street Address"
                          value={form.customer_address}
                          onChange={(e) => handleInputChange("customer_address", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div className="sm:col-span-2 pt-1">
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(form.save_customer_to_master)}
                            onChange={(e) => handleInputChange("save_customer_to_master", e.target.checked)}
                            disabled={isReadOnly}
                            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          />
                          <span>Save Customer to Master Database</span>
                        </label>
                      </div>
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
                      <FieldLabelText label="HBL / BL Number" />
                    </label>
                    <input
                      type="text"
                      placeholder="Enter HBL / BL number"
                      value={form.bl_number}
                      onChange={(e) => {
                        handleInputChange("bl_number", e.target.value);
                        handleInputChange("hbl_number", e.target.value);
                      }}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Vessel & Voyage" />
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Vessel Express / V.102"
                      value={form.vessel_name}
                      onChange={(e) => handleInputChange("vessel_name", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="ETD Date" />
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
                      <FieldLabelText label="ETA Date" />
                    </label>
                    <DateInput
                      value={form.eta_date}
                      placeholder="DD/MM/YYYY"
                      onChange={(val) => handleInputChange("eta_date", val)}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Rate of Exchange (ROE)" required />
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      placeholder="1.0000"
                      value={form.exchange_rate}
                      onChange={(e) => handleInputChange("exchange_rate", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
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
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Origin" />
                    </label>
                    <input
                      type="text"
                      placeholder="Port / Place of Origin"
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
                      placeholder="Port / Place of Destination"
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
                      placeholder="e.g. 50 Packages / Boxes"
                      value={form.packs_qty}
                      onChange={(e) => handleInputChange("packs_qty", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Weight (Kgs)" />
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Weight in Kgs"
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
                      placeholder="Volume in CBM"
                      value={form.volume_cbm}
                      onChange={(e) => handleInputChange("volume_cbm", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="Freight Terms" />
                    </label>
                    <select
                      value={form.freight_terms || "Collect"}
                      onChange={(e) => handleInputChange("freight_terms", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    >
                      <option value="Collect">Collect</option>
                      <option value="Prepaid">Prepaid</option>
                    </select>
                  </div>
                </div>
              )}
            </Card>

            {/* SECTION 4: LINE ITEMS */}
            <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                    <ListOrdered className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">4. Line Items</h3>
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

              <div className="mt-4 space-y-4">
                {form.items.map((line: any, idx: number) => (
                  <div key={line.id || idx} className="p-4 sm:p-5 bg-slate-50/70 rounded-2xl border border-slate-200/80 space-y-4 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-sky-700">Line Item #{idx + 1}</span>
                      {!isReadOnly && form.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLineItem(idx)}
                          className="text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 transition-colors"
                          title="Remove line item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div>
                        <label className={labelStyle}>Select Item Master</label>
                        <select
                          value={line.item_id || (line.item_mode === "manual" ? "MANUAL_ENTRY" : "")}
                          onChange={(e) => handleLineItemSelect(idx, e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="">-- Select Item from Master --</option>
                          <option value="MANUAL_ENTRY">✍️ Enter Custom / Manual Item</option>
                          {itemsMaster.map((it: any) => (
                            <option key={it.id} value={it.id}>
                              {it.item_name || it.name} ({it.sale_price ? `₹${it.sale_price}` : ""})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelStyle}>Description</label>
                        <input
                          type="text"
                          value={line.description}
                          onChange={(e) => handleLineItemChange(idx, "description", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>HSN / SAC</label>
                        <input
                          type="text"
                          value={line.hsn_sac}
                          onChange={(e) => handleLineItemChange(idx, "hsn_sac", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>Place of Supply</label>
                        <input
                          type="text"
                          placeholder={form.place_of_supply_state || "Default POS"}
                          value={line.place_of_supply || ""}
                          onChange={(e) => handleLineItemChange(idx, "place_of_supply", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                      <div>
                        <label className={labelStyle}>Currency</label>
                        <select
                          value={line.currency || form.currency_code || "INR"}
                          onChange={(e) => handleLineItemChange(idx, "currency", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="INR">INR (₹)</option>
                          <option value="USD">USD ($)</option>
                          <option value="EUR">EUR (€)</option>
                          <option value="GBP">GBP (£)</option>
                          <option value="AED">AED</option>
                          <option value="SGD">SGD</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelStyle}>Qty</label>
                        <input
                          type="number"
                          value={line.qty}
                          onChange={(e) => handleLineItemChange(idx, "qty", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>Unit</label>
                        <input
                          type="text"
                          placeholder="PCS"
                          value={line.unit}
                          onChange={(e) => handleLineItemChange(idx, "unit", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>Unit Price</label>
                        <input
                          type="number"
                          value={line.unit_price}
                          onChange={(e) => handleLineItemChange(idx, "unit_price", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>Disc Type</label>
                        <select
                          value={line.discount_type || "PERCENT"}
                          onChange={(e) => handleLineItemChange(idx, "discount_type", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        >
                          <option value="PERCENT">%</option>
                          <option value="AMOUNT">₹ Amount</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelStyle}>Disc Value</label>
                        <input
                          type="number"
                          value={line.discount_value}
                          onChange={(e) => handleLineItemChange(idx, "discount_value", e.target.value)}
                          disabled={isReadOnly}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>GST %</label>
                        <input
                          type="number"
                          value={form.export_type === "LUT" ? "0" : line.tax_rate}
                          onChange={(e) => handleLineItemChange(idx, "tax_rate", e.target.value)}
                          disabled={isReadOnly || form.export_type === "LUT"}
                          className={commonInputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>Total (₹)</label>
                        <div className="px-3 py-2 bg-slate-100 rounded-xl font-bold text-xs text-slate-900 truncate">
                          {formatDecimalByPreference(previewData?.items?.[idx]?.amountInr || 0)}
                        </div>
                      </div>
                    </div>

                    {form.export_type !== "LUT" && (
                      <div className="flex items-center gap-4 text-[11px] font-semibold text-slate-500 bg-white p-2.5 rounded-xl border border-slate-200/60">
                        <span>CGST: <strong className="text-slate-800">{line.cgst_rate || 0}%</strong></span>
                        <span>SGST: <strong className="text-slate-800">{line.sgst_rate || 0}%</strong></span>
                        <span>IGST: <strong className="text-slate-800">{line.igst_rate || 0}%</strong></span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            {/* SECTION 5: SHIPPING DETAILS */}
            <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
              <div
                className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
                onClick={() => toggleSection("shippingDetails")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                    <Ship className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">5. Shipping Details</h3>
                </div>
                {openSections.shippingDetails ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>

              {openSections.shippingDetails && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelStyle}>BL Number</label>
                    <input
                      type="text"
                      placeholder="BL Number"
                      value={form.bl_number}
                      onChange={(e) => handleInputChange("bl_number", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>HBL Number</label>
                    <input
                      type="text"
                      placeholder="House BL Number"
                      value={form.hbl_number}
                      onChange={(e) => handleInputChange("hbl_number", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>THBL Number</label>
                    <input
                      type="text"
                      placeholder="THBL Number"
                      value={form.thbl_number}
                      onChange={(e) => handleInputChange("thbl_number", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>MBL Number</label>
                    <input
                      type="text"
                      placeholder="Master BL Number"
                      value={form.mbl_number}
                      onChange={(e) => handleInputChange("mbl_number", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Ocean BL No</label>
                    <input
                      type="text"
                      placeholder="Ocean BL No"
                      value={form.ocean_bl_no}
                      onChange={(e) => handleInputChange("ocean_bl_no", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Vessel Name</label>
                    <input
                      type="text"
                      placeholder="Vessel Name"
                      value={form.vessel_name}
                      onChange={(e) => handleInputChange("vessel_name", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Voyage No</label>
                    <input
                      type="text"
                      placeholder="Voyage No"
                      value={form.voyage_no}
                      onChange={(e) => handleInputChange("voyage_no", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>ETD Date</label>
                    <DateInput
                      value={form.etd_date}
                      placeholder="DD/MM/YYYY"
                      onChange={(val) => handleInputChange("etd_date", val)}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>ETA Date</label>
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

            {/* SECTION 6: OPERATIONS & CUSTOMS */}
            <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
              <div
                className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
                onClick={() => toggleSection("operationsCustoms")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">6. Operations & Customs</h3>
                </div>
                {openSections.operationsCustoms ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>

              {openSections.operationsCustoms && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelStyle}>IGM Number</label>
                    <input
                      type="text"
                      placeholder="IGM No"
                      value={form.igm_no}
                      onChange={(e) => handleInputChange("igm_no", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>
                      <FieldLabelText label="IGM Date" />
                    </label>
                    <DateInput
                      value={form.igm_date}
                      placeholder="DD/MM/YYYY"
                      onChange={(val) => handleInputChange("igm_date", val)}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>IGM Item Number</label>
                    <input
                      type="text"
                      placeholder="IGM Item No"
                      value={form.igm_item_no}
                      onChange={(e) => handleInputChange("igm_item_no", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>File Number</label>
                    <input
                      type="text"
                      placeholder="File No"
                      value={form.file_no}
                      onChange={(e) => handleInputChange("file_no", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Sales Representative</label>
                    <input
                      type="text"
                      placeholder="Sales Rep Name"
                      value={form.sales_rep}
                      onChange={(e) => handleInputChange("sales_rep", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelStyle}>Container / Vehicle Details</label>
                    <input
                      type="text"
                      placeholder="Container No / Vehicle No"
                      value={form.container_details}
                      onChange={(e) => handleInputChange("container_details", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div className="sm:col-span-2 pt-1">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(form.rcm_applicable)}
                        onChange={(e) => handleInputChange("rcm_applicable", e.target.checked)}
                        disabled={isReadOnly}
                        className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span>Reverse Charge Mechanism (RCM) Applicable</span>
                    </label>
                  </div>
                </div>
              )}
            </Card>

            {/* OVERALL INVOICE DISCOUNT */}
            <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
              <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase mb-3">Overall Invoice Discount</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelStyle}>Discount Type</label>
                  <select
                    value={form.discount_type || "AMOUNT"}
                    onChange={(e) => handleInputChange("discount_type", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  >
                    <option value="AMOUNT">Flat Amount (₹)</option>
                    <option value="PERCENT">Percentage (%)</option>
                  </select>
                </div>
                <div>
                  <label className={labelStyle}>Discount Value</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={form.discount_value}
                    onChange={(e) => handleInputChange("discount_value", e.target.value)}
                    disabled={isReadOnly}
                    className={commonInputStyle}
                  />
                </div>
              </div>
            </Card>

            {/* SECTION 7: NOTES, TERMS & ADVANCE */}
            <Card padding="p-5 sm:p-6" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
              <div
                className="flex items-center justify-between cursor-pointer select-none border-b border-slate-100 pb-3"
                onClick={() => toggleSection("notesTerms")}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-xs shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">7. Notes, Terms & Advance</h3>
                </div>
                {openSections.notesTerms ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </div>

              {openSections.notesTerms && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className={labelStyle}>Amount Paid / Advance Received (₹)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={form.amount_paid}
                      onChange={(e) => handleInputChange("amount_paid", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Customer Notes</label>
                    <textarea
                      rows={2}
                      placeholder="Notes visible to customer"
                      value={form.notes}
                      onChange={(e) => handleInputChange("notes", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Remarks</label>
                    <textarea
                      rows={2}
                      placeholder="Shipment remarks / operations notes"
                      value={form.remarks}
                      onChange={(e) => handleInputChange("remarks", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>Terms & Conditions</label>
                    <textarea
                      rows={3}
                      placeholder="Payment terms, late fee terms..."
                      value={form.terms}
                      onChange={(e) => handleInputChange("terms", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                  <div>
                    <label className={labelStyle}>TDS Note</label>
                    <input
                      type="text"
                      placeholder="e.g. Kindly deduct T.D.S on Invoice amount excluding GST amount."
                      value={form.tds_note}
                      onChange={(e) => handleInputChange("tds_note", e.target.value)}
                      disabled={isReadOnly}
                      className={commonInputStyle}
                    />
                  </div>
                </div>
              )}
            </Card>

            {/* ACTION BUTTONS */}
            {!isReadOnly && (
              <div className="flex items-center justify-end gap-3 pt-4">
                <GradientButton
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 font-bold text-xs shadow-md"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? "Saving..." : "Save Pro Forma Invoice"}
                </GradientButton>
              </div>
            )}

          </div>

          {/* RIGHT PREVIEW COLUMN (5 COLS) */}
          <div className="lg:col-span-5 sticky top-6 space-y-4">
            <Card padding="p-4 sm:p-5" className="border-slate-200/90 shadow-sm rounded-2xl bg-white">
              <InvoiceTemplateSelector
                selectedTemplateKey={selectedTemplateKey}
                onSelectTemplate={(key) => setSelectedTemplateKey(key)}
                invoiceData={previewData}
                disabled={isReadOnly}
              />
            </Card>

            <Card padding="p-4 sm:p-5" className="border-slate-200/90 shadow-md rounded-2xl bg-slate-900 text-white">
              <div className="flex items-center justify-between border-b border-slate-700 pb-3 mb-4">
                <h3 className="font-bold text-xs uppercase tracking-wider text-sky-400">Document Live Preview</h3>
                <button
                  onClick={handlePrintPdf}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-700"
                >
                  <Printer className="w-3.5 h-3.5 text-sky-400" /> Print / PDF
                </button>
              </div>

              <div id="proforma-preview-container" className="overflow-x-auto rounded-xl bg-white text-slate-800 p-2 shadow-inner">
                <InvoicePreview
                  templateId={selectedTemplateKey}
                  styleConfig={{}}
                  invoiceData={previewData}
                />
              </div>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
