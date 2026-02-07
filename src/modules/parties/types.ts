export type PartyType = "Customer" | "Supplier";

export type OpeningBalanceType = "Receivable" | "Payable";

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
  name: string;
  phone?: string;
  email?: string;
  country?: string;
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
  creditLimitEnabled: boolean;
  autoBlock: boolean;
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
  creditLimitEnabled: boolean;
  autoBlock: boolean;
  creditExceeded: boolean;
  creditOverBy: number;
}
