import type { CountryCode, CreditType } from "./countryConfig";
import type { CreditLineDraft } from "./store";

export type ViewMode = "list" | "create" | "edit" | "view";

export interface CreditNoteFormState {
  id?: string;
  country: CountryCode;
  creditNoteDate: string;
  customerId: string;
  customerInput: string;
  linkedInvoiceId: string;
  reason: string;
  creditType: CreditType;
  taxRate: number;
  placeOfSupply: string;
  registrationNumber: string;
  hmrcReference: string;
  salesTaxState: string;
  internalNotes: string;
  customerNotes: string;
  returnToStock: boolean;
  refundMode: "FULL" | "PARTIAL" | "NONE";
  partialRefundAmount: string;
  discountPercent: string;
  partialAmountCap: string;
  priceAdjustmentAmount: string;
  lines: CreditLineDraft[];
}

