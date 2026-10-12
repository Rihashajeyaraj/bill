export const REPORT_TYPES = [
  {
    id: "customer-wise",
    label: "Customer-wise Report",
    shortLabel: "Customer-wise",
    description: "Invoice and payment details grouped by customer.",
    badge: "Grouped"
  },
  {
    id: "payment-wise",
    label: "Payment-wise Report",
    shortLabel: "Payment-wise",
    description: "Track actual money receipts and payment allocations.",
    badge: "Receipts"
  },
  {
    id: "advances",
    label: "Advance Received Report",
    shortLabel: "Advance Received",
    description: "Advances received and subsequent application to Tax Invoices.",
    badge: "Advances"
  },
  {
    id: "balance-due",
    label: "Balance Due Report",
    shortLabel: "Balance Due",
    description: "Identify outstanding invoices and overdue balances.",
    badge: "Outstanding"
  },
  {
    id: "proforma",
    label: "Pro Forma Report",
    shortLabel: "Pro Forma",
    description: "Pro Forma values, advances, and Tax Invoice conversion tracking.",
    badge: "Quotations"
  },
  {
    id: "tax-invoices",
    label: "Tax Invoice Report",
    shortLabel: "Tax Invoice",
    description: "Issued Tax Invoices with GST breakdown and collection status.",
    badge: "Invoices"
  }
];

export const reportSections = [
  {
    id: "billing-reports",
    title: "Billing & Payment Reports",
    description: "Core billing, payment, advance, and receivables reports.",
    items: REPORT_TYPES
  }
];
