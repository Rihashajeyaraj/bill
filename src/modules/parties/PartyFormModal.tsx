import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal from "../../components/Modal";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import { COUNTRIES } from "../../services/company.service";
import type { PartyAttachment, PartyDraft, PartyType } from "./types";
import { defaultOpeningBalanceType, parseNumber, taxIdMeta } from "./utils";

interface PartyFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialParty: PartyDraft | null;
  onClose: () => void;
  onSave: (party: PartyDraft) => void;
}

function createDraft(type: PartyType): PartyDraft {
  return {
    type,
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

export default function PartyFormModal({
  open,
  mode,
  initialParty,
  onClose,
  onSave
}: PartyFormModalProps) {
  const [form, setForm] = useState<PartyDraft>(() =>
    initialParty
      ? { ...createDraft(initialParty.type || "Customer"), ...initialParty }
      : createDraft("Customer")
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(
      initialParty
        ? { ...createDraft(initialParty.type || "Customer"), ...initialParty }
        : createDraft("Customer")
    );
  }, [open, initialParty]);

  const taxMeta = useMemo(() => taxIdMeta(form.country), [form.country]);

  function updateField<K extends keyof PartyDraft>(key: K, value: PartyDraft[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateType(next: PartyType) {
    setForm((prev) => ({
      ...prev,
      type: next,
      openingBalanceType: defaultOpeningBalanceType(next)
    }));
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

  function handleSave() {
    if (!form.name.trim()) {
      setError("Party name is required.");
      return;
    }
    const normalized: PartyDraft = {
      ...form,
      name: form.name.trim(),
      phone: form.phone?.trim() || "",
      email: form.email?.trim() || "",
      country: form.country?.trim() || "",
      state: form.state?.trim() || "",
      address: form.address?.trim() || "",
      taxId: form.taxId?.trim() || "",
      openingBalance: Math.abs(parseNumber(form.openingBalance)),
      creditLimit: Math.max(0, parseNumber(form.creditLimit)),
      creditLimitDays: Math.max(0, parseNumber(form.creditLimitDays)),
      creditLimitEnabled: !!form.creditLimitEnabled
    };
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
      title={mode === "edit" ? "Edit Party" : "Add Party"}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <GradientButton onClick={handleSave}>
              {mode === "edit" ? "Update Party" : "Create Party"}
            </GradientButton>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="Party Type">
          <select
            value={form.type}
            onChange={(event) => updateType(event.target.value as PartyType)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          >
            <option value="Customer">Customer</option>
            <option value="Supplier">Supplier</option>
          </select>
        </FormField>

        <FormField label="Name">
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="Party legal name"
          />
        </FormField>

        <FormField label="Phone">
          <input
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="+1 555 000 1234"
          />
        </FormField>

        <FormField label="Email">
          <input
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="finance@party.com"
          />
        </FormField>

        <FormField label="Country">
          <select
            value={form.country}
            onChange={(event) => updateField("country", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          >
            <option value="">Select country</option>
            {COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="State / Region">
          <input
            value={form.state}
            onChange={(event) => updateField("state", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder="State, province, or region"
          />
        </FormField>

        <FormField label="Address" className="md:col-span-2">
          <textarea
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            rows={2}
            placeholder="Street, city, zip/postal"
          />
        </FormField>

        <FormField label={`Tax ID (${taxMeta.label})`}>
          <input
            value={form.taxId}
            onChange={(event) => updateField("taxId", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            placeholder={taxMeta.placeholder}
          />
        </FormField>

        <FormField label="Opening Balance">
          <input
            type="number"
            min={0}
            value={form.openingBalance}
            onChange={(event) => updateField("openingBalance", parseNumber(event.target.value))}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
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
            onChange={(event) => updateField("creditLimitType", event.target.value as PartyDraft["creditLimitType"])}
            disabled={!form.creditLimitEnabled}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none disabled:bg-slate-50"
          >
            <option value="Amount">By Amount</option>
            <option value="Days">By Overdue Days</option>
          </select>

          {form.creditLimitType === "Days" ? (
            <input
              type="number"
              min={0}
              value={form.creditLimitDays}
              onChange={(event) => updateField("creditLimitDays", parseNumber(event.target.value))}
              disabled={!form.creditLimitEnabled}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none disabled:bg-slate-50"
              placeholder="Allowed overdue days"
            />
          ) : (
            <input
              type="number"
              min={0}
              value={form.creditLimit}
              onChange={(event) => updateField("creditLimit", parseNumber(event.target.value))}
              disabled={!form.creditLimitEnabled}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none disabled:bg-slate-50"
              placeholder="Credit amount limit"
            />
          )}
        </FormField>

        <FormField label="Notes" className="md:col-span-2">
          <textarea
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none"
            rows={3}
            placeholder="Internal notes, contact preferences, or reminders."
          />
        </FormField>

        <div className="md:col-span-2">
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
                    className="h-7 w-7 rounded-full border border-slate-200 bg-white hover:bg-rose-50 flex items-center justify-center"
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

        {form.audit ? (
          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
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
