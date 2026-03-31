export const reportSections = [
  {
    id: "transaction-reports",
    title: "Transaction Reports",
    description: "Core sales, purchases, and movement reports for daily operations.",
    items: [
      {
        id: "sale-report",
        label: "Sale Report",
        description: "Invoice-wise sales with paid and unpaid visibility."
      },
      {
        id: "purchase-report",
        label: "Purchase Report",
        description: "Supplier bills with paid and pending analysis."
      },
      {
        id: "cash-flow",
        label: "Cash Flow",
        description: "Cash received, cash spent, and net flow across the selected period."
      },
      {
        id: "all-transactions",
        label: "All Transactions",
        description: "Global transaction ledger with search, sorting, and pagination."
      }
    ]
  },
  {
    id: "party-reports",
    title: "Party Reports",
    description: "Receivable and payable visibility across customers and suppliers.",
    items: [
      {
        id: "party-statement",
        label: "Party Statement",
        description: "Opening balance, running balance, and closing balance for a selected party."
      },
      {
        id: "aging-report",
        label: "Aging Report",
        description: "Outstanding invoices grouped into aging buckets."
      },
      {
        id: "all-parties",
        label: "All Parties",
        description: "Master party list with balances and recent activity."
      }
    ]
  },
  {
    id: "finance",
    title: "Finance",
    description: "High-level financial performance without accounting clutter.",
    items: [
      {
        id: "profit-loss",
        label: "Profit & Loss",
        description: "Simple sales, expenses, and net profit summary."
      },
      {
        id: "gst-report",
        label: "GST Report",
        description: "Sales and purchase GST summary with CGST, SGST, and IGST split."
      },
      {
        id: "tds-report",
        label: "TDS Report",
        description: "Customer and supplier TDS deductions captured from Payment In and Payment Out entries."
      }
    ]
  }
];
