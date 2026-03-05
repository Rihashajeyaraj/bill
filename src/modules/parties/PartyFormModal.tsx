import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal from "../../components/Modal";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import type { PartyAttachment, PartyDraft, PartyType } from "./types";
import { defaultOpeningBalanceType, parseNumber } from "./utils";
import {
  composeFullMobileNumber,
  COUNTRY_DIAL_OPTIONS,
  mobileLengthHint,
  phoneDigits,
  resolveDefaultDialCodeFromCountry,
  splitFullMobileNumber,
  validateMobileNumber
} from "./phone";
import { useOrganization } from "../../context/OrganizationContext";
import { normalizeContactType, validateContactTax } from "../../services/customerTax";
import {
  getCanonicalCountryName,
  listAllCountries,
  listStatesByCountry,
  resolveCountryIsoCode
} from "../../lib/geoData";

interface PartyFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialParty: PartyDraft | null;
  onClose: () => void;
  onSave: (party: PartyDraft) => void;
}

type CreateFlowStep = "quick" | "details";

function createDraft(type: PartyType): PartyDraft {
  return {
    type,
    contactType: "Individual",
    customerType: "Individual",
    name: "",
    phone: "",
    email: "",
    country: "",
    state: "",
    address: "",
    taxId: "",
    openingBalance: 0,
    openingBalanceType: defaultOpeningBalanceType(type),
    creditLimit: 0,
    creditLimitDays: 0,
    creditLimitType: "Amount",
    creditLimitEnabled: false,
    notes: "",
    attachments: []
  };
}

function withNormalizedContactType(draft: PartyDraft): PartyDraft {
  const normalized = normalizeContactType(
    draft.contactType ?? draft.customerType,
    draft.taxId || draft.gstin || ""
  );
  return {
    ...draft,
    contactType: normalized,
    customerType: draft.type === "Customer" ? normalized : draft.customerType
  };
}

function formatDecimalAmount(value: unknown) {
  return parseNumber(value).toFixed(2);
}

function sanitizeDecimalInput(value: string) {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  if (!cleaned) return "";

  const firstDot = cleaned.indexOf(".");
  const normalized =
    firstDot === -1 ? cleaned : `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, "")}`;
  const [rawInteger = "", rawDecimal = ""] = normalized.split(".");
  const integer = (rawInteger || "0").replace(/^0+(?=\d)/, "") || "0";
  const decimal = rawDecimal.slice(0, 2);

  return normalized.includes(".") ? `${integer}.${decimal}` : integer;
}

export default function PartyFormModal({
  open,
  mode,
  initialParty,
  onClose,
  onSave
}: PartyFormModalProps) {
  const { profile: organizationProfile = {}, country: organizationCountry = "" } = useOrganization();
  const organizationCountryValue = organizationCountry || organizationProfile?.country || "";
  const [form, setForm] = useState<PartyDraft>(() =>
    initialParty
      ? withNormalizedContactType({ ...createDraft(initialParty.type || "Customer"), ...initialParty })
      : createDraft("Customer")
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [openingBalanceInput, setOpeningBalanceInput] = useState(() => formatDecimalAmount(0));
  const [creditLimitInput, setCreditLimitInput] = useState(() => formatDecimalAmount(0));
  const [countryCode, setCountryCode] = useState(() =>
    resolveDefaultDialCodeFromCountry(organizationCountryValue)
  );
  const [mobileNumber, setMobileNumber] = useState("");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  const [createStep, setCreateStep] = useState<CreateFlowStep>("quick");
  const contentRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setWarning("");
    const nextForm = initialParty
      ? withNormalizedContactType({ ...createDraft(initialParty.type || "Customer"), ...initialParty })
      : createDraft("Customer");
    const fallbackDialCode = resolveDefaultDialCodeFromCountry(
      nextForm.country || organizationCountryValue
    );
    const parsedPhone = splitFullMobileNumber(nextForm.phone || "", fallbackDialCode);
    nextForm.phone = parsedPhone.fullNumber;
    setOpeningBalanceInput(formatDecimalAmount(nextForm.openingBalance));
    setCreditLimitInput(formatDecimalAmount(nextForm.creditLimit));
    setCountryCode(parsedPhone.countryCode || fallbackDialCode);
    setMobileNumber(parsedPhone.mobileNumber || "");
    setCountryMenuOpen(false);
    setStateMenuOpen(false);
    setFieldErrors({});
    setCreateStep(mode === "create" ? "quick" : "details");
    setForm(nextForm);
  }, [open, initialParty, mode, organizationCountryValue]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    const scrollContainer = contentRootRef.current?.parentElement;
    if (!scrollContainer) return;
    scrollContainer.scrollTop = 0;
  }, [createStep, open, mode]);

  useEffect(() => {
    if (form.creditLimitType !== "Amount") return;
    setCreditLimitInput(formatDecimalAmount(form.creditLimit));
  }, [form.creditLimitType]);

  const orgContext = useMemo(
    () => ({
      ...organizationProfile,
      country: organizationCountryValue
    }),
    [organizationProfile, organizationCountryValue]
  );
  const allCountries = useMemo(() => listAllCountries(), []);
  const stateOptions = useMemo(() => listStatesByCountry(form.country), [form.country]);
  const countryQuery = String(form.country || "")
    .trim()
    .toLowerCase();
  const stateQuery = String(form.state || "")
    .trim()
    .toLowerCase();
  const countryMatches = useMemo(() => {
    if (!countryQuery) return [];
    return allCountries.filter((country) => country.name.toLowerCase().includes(countryQuery)).slice(0, 8);
  }, [allCountries, countryQuery]);
  const stateMatches = useMemo(() => {
    if (!stateQuery) return [];
    return stateOptions.filter((state) => state.name.toLowerCase().includes(stateQuery)).slice(0, 8);
  }, [stateOptions, stateQuery]);
  const selectedContactType = normalizeContactType(form.contactType ?? form.customerType, form.taxId);
  const isIndiaCountry = resolveCountryIsoCode(form.country) === "IN";
  const showGSTINField = selectedContactType === "Business" && isIndiaCountry;
  const phoneHint = mobileLengthHint(countryCode);
  const entityLabel = form.type === "Customer" ? "Customer" : "Supplier";
  const modalTitle = mode === "edit" ? `Edit ${entityLabel}` : `Create ${entityLabel}`;
  const submitLabel = mode === "edit" ? `Update ${entityLabel}` : `Create ${entityLabel}`;
  const showQuickSections = mode === "edit" || createStep === "quick";
  const showAdvancedSections = mode === "edit" || createStep === "details";
  const showSupplierAttachments = mode === "edit" && form.type !== "Customer";
  const inputClassName =
    "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100";
  const mutedInputClassName = `${inputClassName} disabled:bg-slate-50 disabled:text-slate-500`;
  const suggestionMenuClassName =
    "absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl";
  const creditLimitDaysValue = Math.max(0, Math.trunc(parseNumber(form.creditLimitDays)));

  function clearFieldError(fieldKey: string) {
    setFieldErrors((prev) => {
      if (!prev?.[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function updateField<K extends keyof PartyDraft>(key: K, value: PartyDraft[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addAttachments(files: FileList | null) {
    if (!files || !files.length) return;
    const incoming: PartyAttachment[] = Array.from(files).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream"
    }));
    setForm((prev) => ({
      ...prev,
      attachments: [...(prev.attachments || []), ...incoming]
    }));
  }

  function removeAttachment(name: string) {
    setForm((prev) => ({
      ...prev,
      attachments: (prev.attachments || []).filter((file) => file.name !== name)
    }));
  }

  function applyCountry(nextCountry: string) {
    const canonicalCountry = getCanonicalCountryName(nextCountry);
    const previousCountryCode = resolveCountryIsoCode(form.country);
    const nextCountryCode = resolveCountryIsoCode(canonicalCountry);

    updateField("country", canonicalCountry);
    if (previousCountryCode !== nextCountryCode) {
      updateField("state", "");
    }
    if (nextCountryCode !== "IN") {
      updateField("taxId", "");
    }
    if (!mobileNumber) {
      const defaultDialCode = resolveDefaultDialCodeFromCountry(canonicalCountry);
      setCountryCode(defaultDialCode);
      updateField("phone", composeFullMobileNumber(defaultDialCode, ""));
    }
    setCountryMenuOpen(false);
  }

  function applyState(nextState: string) {
    updateField("state", nextState);
    setStateMenuOpen(false);
  }

  function handleSave(flow: CreateFlowStep = "details") {
    const nextFieldErrors: Record<string, string> = {};
    if (!form.name.trim()) {
      nextFieldErrors.name = "This field is required";
    }
    if (!phoneDigits(mobileNumber)) {
      nextFieldErrors.mobile = "This field is required";
    }
    if (showGSTINField && !String(form.taxId || "").trim()) {
      nextFieldErrors.taxId = "This field is required";
    }
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      setError("");
      return;
    }

    const phoneValidation = validateMobileNumber(countryCode, mobileNumber);
    if (phoneValidation.error) {
      setFieldErrors((prev) => ({ ...prev, mobile: phoneValidation.error }));
      setError("");
      return;
    }

    setFieldErrors({});
    const normalized: PartyDraft = {
      ...form,
      name: form.name.trim(),
      phone: phoneValidation.fullNumber,
      email: form.email?.trim() || "",
      country: form.country?.trim() || "",
      state: form.state?.trim() || "",
      address: form.address?.trim() || "",
      taxId: form.taxId?.trim() || "",
      contactType: normalizeContactType(form.contactType ?? form.customerType, form.taxId),
      customerType:
        form.type === "Customer"
          ? normalizeContactType(form.contactType ?? form.customerType, form.taxId)
          : "Business",
      openingBalance: Math.abs(parseNumber(form.openingBalance)),
      creditLimit: Math.max(0, parseNumber(form.creditLimit)),
      creditLimitDays: Math.max(0, Math.trunc(parseNumber(form.creditLimitDays))),
      creditLimitEnabled: !!form.creditLimitEnabled
    };
    if (normalized.creditLimitEnabled) {
      const missingCreditFields: string[] = [];
      if (!normalized.phone) missingCreditFields.push("phone");
      if (!normalized.email) missingCreditFields.push("email");
      if (!normalized.country) missingCreditFields.push("country");
      if (!normalized.state) missingCreditFields.push("state / region");
      if (!normalized.address) missingCreditFields.push("address");

      const contactType = normalizeContactType(normalized.contactType ?? normalized.customerType, normalized.taxId);
      const needsGstin = resolveCountryIsoCode(normalized.country) === "IN" && contactType === "Business";
      if (needsGstin && !normalized.taxId) missingCreditFields.push("GSTIN");

      if (normalized.creditLimitType === "Amount" && normalized.creditLimit <= 0) {
        missingCreditFields.push("credit limit amount");
      }
      if (normalized.creditLimitType === "Days" && normalized.creditLimitDays <= 0) {
        missingCreditFields.push("credit limit days");
      }

      if (missingCreditFields.length) {
        setError(`Enable credit only after filling: ${missingCreditFields.join(", ")}.`);
        return;
      }
    }
    const normalizedCountryCode = resolveCountryIsoCode(normalized.country);
    const normalizedContactType = normalizeContactType(
      normalized.contactType ?? normalized.customerType,
      normalized.taxId
    );
    const shouldValidateGST = normalizedCountryCode === "IN" && normalizedContactType === "Business";
    const validationOrgContext = shouldValidateGST ? { ...orgContext, country: "India" } : { ...orgContext, country: "" };
    const taxValidation = validateContactTax(normalized, validationOrgContext);
    if (taxValidation.error) {
      if (showGSTINField && /gstin|tax/i.test(taxValidation.error)) {
        setFieldErrors((prev) => ({ ...prev, taxId: taxValidation.error }));
      }
      setError(taxValidation.error);
      return;
    }
    setWarning(flow === "quick" ? "" : taxValidation.warning || "");
    normalized.contactType = taxValidation.contactType;
    normalized.customerType = taxValidation.contactType;
    normalized.taxId = taxValidation.normalizedTaxId;
    normalized.gstin = taxValidation.normalizedTaxId;

    if (normalized.creditLimitType === "Amount") {
      normalized.creditLimitDays = 0;
    } else {
      normalized.creditLimit = 0;
    }
    onSave(normalized);
  }

  return (
    <Modal
      open={open}
      title={modalTitle}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}
            {!error && warning ? <p className="text-xs font-semibold text-amber-600">{warning}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            {mode === "create" && createStep === "details" ? (
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setWarning("");
                  setCreateStep("quick");
                }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Back
              </button>
            ) : null}
            {mode === "create" && createStep === "quick" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setWarning("");
                    setCreateStep("details");
                  }}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Next
                </button>
                <GradientButton onClick={() => handleSave("quick")}>
                  Create {entityLabel}
                </GradientButton>
              </>
            ) : (
              <GradientButton onClick={() => handleSave("details")}>
                {submitLabel}
              </GradientButton>
            )}
          </div>
        </div>
      }
    >
      <div ref={contentRootRef} className="space-y-4">
        {showQuickSections ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Basic Details</p>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Name" required error={fieldErrors.name} className="md:col-span-2">
                  <input
                    value={form.name}
                    onChange={(event) => {
                      setError("");
                      clearFieldError("name");
                      updateField("name", event.target.value);
                    }}
                    className={inputClassName}
                    placeholder="Party legal name"
                  />
                </FormField>

                <FormField label="Contact Type">
                  <select
                    value={selectedContactType}
                    onChange={(event) => {
                      const nextType = event.target.value as PartyDraft["contactType"];
                      setError("");
                      setWarning("");
                      updateField("contactType", nextType);
                      if (form.type === "Customer") {
                        updateField("customerType", nextType as PartyDraft["customerType"]);
                      }
                      if (nextType === "Individual") {
                        clearFieldError("taxId");
                        updateField("taxId", "");
                      }
                    }}
                    className={inputClassName}
                  >
                    <option value="Individual">Individual</option>
                    <option value="Business">Business</option>
                  </select>
                </FormField>

                <FormField label="Mobile Number" required error={fieldErrors.mobile} hint={phoneHint}>
                  <div className="grid grid-cols-[130px_1fr] gap-2">
                    <select
                      value={countryCode}
                      onChange={(event) => {
                        const nextCountryCode = event.target.value;
                        setError("");
                        setWarning("");
                        clearFieldError("mobile");
                        setCountryCode(nextCountryCode);
                        updateField("phone", composeFullMobileNumber(nextCountryCode, mobileNumber));
                      }}
                      className={inputClassName}
                    >
                      {COUNTRY_DIAL_OPTIONS.map((option) => (
                        <option key={`${option.isoCode}_${option.dialCode}`} value={option.dialCode}>
                          {option.dialCode} ({option.country})
                        </option>
                      ))}
                    </select>
                    <input
                      value={mobileNumber}
                      onChange={(event) => {
                        const nextMobileNumber = phoneDigits(event.target.value);
                        setError("");
                        setWarning("");
                        clearFieldError("mobile");
                        setMobileNumber(nextMobileNumber);
                        updateField("phone", composeFullMobileNumber(countryCode, nextMobileNumber));
                      }}
                      className={inputClassName}
                      placeholder="Enter mobile number"
                      inputMode="numeric"
                      autoComplete="off"
                      pattern="[0-9]*"
                      maxLength={15}
                    />
                  </div>
                </FormField>

                <FormField label="Email" className="md:col-span-2">
                  <input
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    className={inputClassName}
                    placeholder="finance@party.com"
                  />
                </FormField>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Address And Tax</p>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Country">
                  <div className="relative">
                    <input
                      value={form.country}
                      onChange={(event) => {
                        updateField("country", event.target.value);
                        setCountryMenuOpen(true);
                      }}
                      onFocus={() => setCountryMenuOpen(true)}
                      onBlur={(event) => {
                        applyCountry(event.target.value);
                        setTimeout(() => setCountryMenuOpen(false), 80);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setCountryMenuOpen(false);
                      }}
                      className={inputClassName}
                      placeholder="Type country name"
                    />
                    {countryMenuOpen && countryQuery ? (
                      <div className={suggestionMenuClassName}>
                        {countryMatches.length ? (
                          countryMatches.map((country) => (
                            <button
                              key={country.isoCode}
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applyCountry(country.name);
                              }}
                              className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                            >
                              {country.name}
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-500">No matching countries</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </FormField>

                <FormField
                  label="State / Region"
                  hint={stateOptions.length ? `${stateOptions.length} options available` : "Type manually"}
                >
                  <div className="relative">
                    <input
                      value={form.state}
                      onChange={(event) => {
                        updateField("state", event.target.value);
                        if (stateOptions.length) setStateMenuOpen(true);
                      }}
                      onFocus={() => {
                        if (stateOptions.length) setStateMenuOpen(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => setStateMenuOpen(false), 80);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setStateMenuOpen(false);
                      }}
                      className={inputClassName}
                      placeholder={stateOptions.length ? "Type state / region" : "State, province, or region"}
                    />
                    {stateMenuOpen && stateQuery && stateOptions.length ? (
                      <div className={suggestionMenuClassName}>
                        {stateMatches.length ? (
                          stateMatches.map((state) => (
                            <button
                              key={`${state.isoCode}_${state.name}`}
                              type="button"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applyState(state.name);
                              }}
                              className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                            >
                              {state.name}
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-500">No matching states/regions</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </FormField>

                {showGSTINField ? (
                  <FormField
                    label="GSTIN"
                    required
                    error={fieldErrors.taxId}
                    hint="Shown only for Business + India"
                    className="md:col-span-2"
                  >
                    <input
                      value={form.taxId}
                      onChange={(event) => {
                        setError("");
                        setWarning("");
                        clearFieldError("taxId");
                        updateField("taxId", event.target.value);
                      }}
                      className={inputClassName}
                      placeholder="15 character GSTIN"
                    />
                  </FormField>
                ) : null}

                <FormField label="Address" className="md:col-span-2">
                  <textarea
                    value={form.address}
                    onChange={(event) => updateField("address", event.target.value)}
                    className={inputClassName}
                    rows={2}
                    placeholder="Street, city, zip/postal"
                  />
                </FormField>
              </div>
            </section>
          </>
        ) : null}

        {showAdvancedSections ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Accounting</p>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Opening Balance">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={openingBalanceInput}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => {
                      const sanitized = sanitizeDecimalInput(event.target.value);
                      setOpeningBalanceInput(sanitized);
                      updateField("openingBalance", parseNumber(sanitized || 0));
                    }}
                    onBlur={() => {
                      const formatted = formatDecimalAmount(openingBalanceInput || 0);
                      setOpeningBalanceInput(formatted);
                      updateField("openingBalance", parseNumber(formatted));
                    }}
                    className={inputClassName}
                    placeholder="0.00"
                  />
                </FormField>

                <FormField label="Credit Monitoring" hint="Amount or overdue days">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={form.creditLimitEnabled}
                      onChange={(event) => updateField("creditLimitEnabled", event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Enable limit checks
                  </label>

                  <select
                    value={form.creditLimitType}
                    onChange={(event) => {
                      const nextType = event.target.value as PartyDraft["creditLimitType"];
                      setForm((prev) => ({
                        ...prev,
                        creditLimitType: nextType,
                        creditLimitDays:
                          nextType === "Days"
                            ? Math.max(0, Math.trunc(parseNumber(prev.creditLimitDays)))
                            : prev.creditLimitDays
                      }));
                    }}
                    disabled={!form.creditLimitEnabled}
                    className={`mt-2 ${mutedInputClassName}`}
                  >
                    <option value="Amount">By Amount</option>
                    <option value="Days">By Overdue Days</option>
                  </select>

                  {form.creditLimitType === "Days" ? (
                    <input
                      key="credit-days-input"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={creditLimitDaysValue === 0 ? "" : creditLimitDaysValue}
                      onChange={(event) =>
                        updateField("creditLimitDays", Math.max(0, Math.trunc(parseNumber(event.target.value))))
                      }
                      disabled={!form.creditLimitEnabled}
                      className={`mt-2 ${mutedInputClassName}`}
                      placeholder="Allowed overdue days"
                    />
                  ) : (
                    <input
                      key="credit-amount-input"
                      type="text"
                      inputMode="decimal"
                      value={creditLimitInput}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => {
                        const sanitized = sanitizeDecimalInput(event.target.value);
                        setCreditLimitInput(sanitized);
                        updateField("creditLimit", parseNumber(sanitized || 0));
                      }}
                      onBlur={() => {
                        const formatted = formatDecimalAmount(creditLimitInput || 0);
                        setCreditLimitInput(formatted);
                        updateField("creditLimit", parseNumber(formatted));
                      }}
                      disabled={!form.creditLimitEnabled}
                      className={`mt-2 ${mutedInputClassName}`}
                      placeholder="0.00"
                    />
                  )}
                </FormField>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                {showSupplierAttachments ? "Notes And Files" : "Notes"}
              </p>
              <div className="mt-3 space-y-4">
                <FormField label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(event) => updateField("notes", event.target.value)}
                    className={inputClassName}
                    rows={3}
                    placeholder="Internal notes, contact preferences, or reminders."
                  />
                </FormField>

                {showSupplierAttachments ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">Attachments</p>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(event) => addAttachments(event.target.files)}
                        />
                        <Plus className="h-3.5 w-3.5" />
                        Add Files
                      </label>
                    </div>
                    {form.attachments?.length ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {form.attachments.map((file) => (
                          <div
                            key={file.name}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                          >
                            <div>
                              <p className="font-semibold text-slate-700">{file.name}</p>
                              <p>
                                {(file.size / 1024).toFixed(1)} KB | {file.type || "document"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeAttachment(file.name)}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">Upload KYC docs, agreements, or compliance files.</p>
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          </>
        ) : null}

        {showAdvancedSections && form.audit ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Audit Trail</p>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <p>Created: {form.audit.createdAt} by {form.audit.createdBy}</p>
              <p>Updated: {form.audit.updatedAt} by {form.audit.updatedBy}</p>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
