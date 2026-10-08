export type PartyType = "Customer" | "Supplier";
export type CustomerType = "Individual" | "Business";

export type OpeningBalanceType = "Receivable" | "Payable";
export type CreditLimitType = "Amount" | "Days";

export interface PartyAttachment {
  name: string;
  size: number;
  type: string;
}

export interface PartyAudit {
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PartyRecord {
  id: string;
  type: PartyType;
  contactType?: CustomerType;
  customerType?: CustomerType;
  name: string;
  phone?: string;
  email?: string;
  country?: string;
  city?: string;
  state?: string;
  address?: string;
  taxId?: string;
  taxIdType?: string;
  gstin?: string;
  vatNo?: string;
  trn?: string;
  openingBalance: number;
  openingBalanceType: OpeningBalanceType;
  creditLimit: number;
  creditLimitDays: number;
  creditLimitType: CreditLimitType;
  creditLimitEnabled: boolean;
  notes?: string;
  attachments: PartyAttachment[];
  audit: PartyAudit;
}

export interface PartyDraft extends Omit<PartyRecord, "id" | "audit"> {
  id?: string;
  audit?: PartyAudit;
}

export type StatementDocType =
  | "Invoice"
  | "Payment"
  | "Credit Note"
  | "Debit Note"
  | "Opening Balance";

export interface LedgerEntry {
  id: string;
  date: string;
  type: StatementDocType;
  documentNo: string;
  debit: number;
  credit: number;
  balance?: number;
}

export interface OutstandingBreakdown {
  openingBalance: number;
  invoices: number;
  payments: number;
  creditNotes: number;
  debitNotes: number;
}

export interface PartyFinancials {
  outstanding: number;
  breakdown: OutstandingBreakdown;
  creditLimit: number;
  creditLimitDays: number;
  creditLimitType: CreditLimitType;
  creditLimitEnabled: boolean;
  maxOverdueDays: number;
  amountExceeded: boolean;
  overdueExceeded: boolean;
  creditExceeded: boolean;
  creditOverBy: number;
  overdueByDays: number;
}
