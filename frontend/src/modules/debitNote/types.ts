import type { CountryCode, DebitType } from "./countryConfig";
import type { DebitLineDraft } from "./store";

export type ViewMode = "list" | "create" | "edit" | "view";

export interface DebitNoteFormState {
  id?: string;
  country: CountryCode;
  debitNoteDate: string;
  supplierId: string;
  supplierInput: string;
  linkedPurchaseInvoiceId: string;
  reason: string;
  debitType: DebitType;
  taxRate: number;
  placeOfSupply: string;
  registrationNumber: string;
  hmrcReference: string;
  salesTaxState: string;
  internalNotes: string;
  supplierNotes: string;
  partialAmountCap: string;
  priceAdjustmentAmount: string;
  additionalChargesAmount: string;
  taxAdjustmentAmount: string;
  lines: DebitLineDraft[];
}

