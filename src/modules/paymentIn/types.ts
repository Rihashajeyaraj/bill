import type { CountryCode, PaymentMode } from "./countryConfig";
import type { PaymentAllocationDraft } from "./store";

export interface PaymentAttachmentMeta {
  name: string;
  size: number;
  type: string;
}

export interface PaymentInFormState {
  id?: string;
  country: CountryCode;
  paymentDate: string;
  customerId: string;
  customerInput: string;
  currency: string;
  amountReceived: string;
  paymentMode: PaymentMode;
  referenceNo: string;
  chequeNo: string;
  bankName: string;
  bankAccount: string;
  transactionId: string;
  paymentReference: string;
  registrationNumber: string;
  internalNotes: string;
  customerNotes: string;
  attachment: PaymentAttachmentMeta | null;
  allocations: PaymentAllocationDraft[];
}
