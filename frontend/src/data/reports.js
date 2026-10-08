export const reportSections = [
  {
    id: "v1-reports",
    title: "Twite Billing V1 Reports",
    description: "Core sales, tax invoice, pro forma, payment, and receivable reports.",
    items: [
      {
        id: "sale-report",
        label: "Sales Report",
        description: "Comprehensive sales revenue breakdown."
      },
      {
        id: "tax-invoice-report",
        label: "Tax Invoice Report",
        description: "Issued tax invoices, balances, and payment status."
      },
      {
        id: "proforma-report",
        label: "Pro Forma Invoice Report",
        description: "Pro forma invoices and conversion tracking."
      },
      {
        id: "payment-in-report",
        label: "Payment In Report",
        description: "Customer receipts, allocations, and TDS withholding."
      },
      {
        id: "aging-report",
        label: "Receivables Report",
        description: "Customer outstanding balances and aging buckets."
      }
    ]
  },
  {
    id: "v2-reports",
    title: "Other Financial Reports (Upcoming)",
    description: "Features reserved for future releases.",
    items: [
      {
        id: "purchase-report",
        label: "Purchase Report",
        description: "Vendor bills and payables (V2)",
        unavailable: true
      },
      {
        id: "cash-flow",
        label: "Cash Flow Report",
        description: "Treasury cash in & out (V2)",
        unavailable: true
      },
      {
        id: "profit-loss",
        label: "Profit & Loss",
        description: "Income, COGS & Expense P&L (V2)",
        unavailable: true
      },
      {
        id: "gst-report",
        label: "GST Compliance Report",
        description: "GSTR-1 & GSTR-3B filings (V2)",
        unavailable: true
      },
      {
        id: "tds-report",
        label: "TDS Report",
        description: "Tax deduction register (V2)",
        unavailable: true
      }
    ]
  }
];
