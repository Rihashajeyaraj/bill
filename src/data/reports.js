export const reportSections = [
  {
    id: "transaction-reports",
    title: "Transactions",
    description: "Sales and movement.",
    items: [
      {
        id: "sale-report",
        label: "Sales",
        description: "Paid and unpaid sales."
      },
      {
        id: "purchase-report",
        label: "Purchases",
        description: "Paid and pending bills."
      },
      {
        id: "cash-flow",
        label: "Cash Flow",
        description: "Cash in and out."
      },
      {
        id: "all-transactions",
        label: "All Entries",
        description: "Full transaction list."
      }
    ]
  },
  {
    id: "party-reports",
    title: "Parties",
    description: "Customer and supplier dues.",
    items: [
      {
        id: "party-statement",
        label: "Statement",
        description: "Opening to closing balance."
      },
      {
        id: "aging-report",
        label: "Aging",
        description: "Dues by age."
      },
      {
        id: "all-parties",
        label: "All Parties",
        description: "Party list and balance."
      }
    ]
  },
  {
    id: "finance",
    title: "Finance",
    description: "Profit and tax view.",
    items: [
      {
        id: "profit-loss",
        label: "P&L",
        description: "Sales, expense, profit."
      },
      {
        id: "gst-report",
        label: "GST Report",
        description: "GST summary."
      },
      {
        id: "tds-report",
        label: "TDS Report",
        description: "TDS summary."
      }
    ]
  }
];
