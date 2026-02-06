export const reportSchema = {
  section: {
    id: "transaction-reports",
    title: "Transaction Reports",
    description: "Sales, purchases, ledgers",
    order: 1
  },
  report: {
    id: "sale",
    label: "Sale",
    description: "Invoice-wise sales register",
    sectionId: "transaction-reports",
    tags: ["sales", "invoice"],
    filters: ["Date Range", "Party", "Status"],
    columns: [
      { key: "date", header: "Date" },
      { key: "party", header: "Party" },
      { key: "amount", header: "Amount" }
    ],
    emptyState: {
      title: "No sales data",
      description: "Select a date range or add sales invoices to populate this report."
    }
  }
};

const baseColumns = [
  { key: "date", header: "Date" },
  { key: "party", header: "Party" },
  { key: "amount", header: "Amount" }
];

export const reportSections = [
  {
    id: "transaction-reports",
    title: "Transaction Reports",
    description: "Sales, purchase, day book, and financial statements.",
    items: [
      {
        id: "sale",
        label: "Sale",
        description: "Invoice-wise sales register",
        tags: ["sales", "invoice"],
        filters: ["Date Range", "Party", "Status"],
        columns: baseColumns
      },
      {
        id: "purchase",
        label: "Purchase",
        description: "Supplier bill register",
        tags: ["purchase", "bill"],
        filters: ["Date Range", "Supplier"],
        columns: baseColumns
      },
      {
        id: "day-book",
        label: "Day Book",
        description: "Daily transaction summary",
        tags: ["daybook"],
        filters: ["Date Range", "Entry Type"],
        columns: baseColumns
      },
      {
        id: "all-transactions",
        label: "All Transactions",
        description: "Combined ledger view",
        tags: ["ledger"],
        filters: ["Date Range", "Voucher Type"],
        columns: baseColumns
      },
      {
        id: "profit-loss",
        label: "Profit and Loss",
        description: "Statement of income",
        tags: ["pl"],
        filters: ["Date Range", "Cost Center"],
        columns: [
          { key: "category", header: "Category" },
          { key: "amount", header: "Amount" },
          { key: "variance", header: "Variance" }
        ]
      },
      {
        id: "bill-wise-profit",
        label: "Bill Wise Profit",
        description: "Profit by invoice",
        tags: ["profit"],
        filters: ["Date Range", "Invoice"],
        columns: [
          { key: "invoice", header: "Invoice" },
          { key: "party", header: "Party" },
          { key: "margin", header: "Margin" }
        ]
      },
      {
        id: "cash-flow",
        label: "Cash Flow",
        description: "Cash in/out movement",
        tags: ["cash"],
        filters: ["Date Range", "Account"],
        columns: [
          { key: "activity", header: "Activity" },
          { key: "inflow", header: "Inflow" },
          { key: "outflow", header: "Outflow" }
        ]
      },
      {
        id: "trial-balance",
        label: "Trial Balance Report",
        description: "Debits and credits",
        tags: ["trial"],
        filters: ["Date Range"],
        columns: [
          { key: "ledger", header: "Ledger" },
          { key: "debit", header: "Debit" },
          { key: "credit", header: "Credit" }
        ]
      },
      {
        id: "balance-sheet",
        label: "Balance Sheet",
        description: "Assets vs liabilities",
        tags: ["balance"],
        filters: ["As Of"],
        columns: [
          { key: "group", header: "Group" },
          { key: "amount", header: "Amount" },
          { key: "share", header: "% Share" }
        ]
      }
    ]
  },
  {
    id: "party-reports",
    title: "Party Reports",
    description: "Statements and party-wise analytics.",
    items: [
      {
        id: "party-statement",
        label: "Party Statement",
        description: "Ledger per party",
        tags: ["party"],
        filters: ["Date Range", "Party"],
        columns: baseColumns
      },
      {
        id: "party-wise-profit-loss",
        label: "Party-wise Profit & Loss",
        description: "Profitability by party",
        tags: ["party", "profit"],
        filters: ["Date Range", "Party"],
        columns: [
          { key: "party", header: "Party" },
          { key: "sales", header: "Sales" },
          { key: "margin", header: "Margin" }
        ]
      },
      {
        id: "all-parties",
        label: "All Parties",
        description: "Master list summary",
        tags: ["party"],
        filters: ["Group", "Status"],
        columns: [
          { key: "party", header: "Party" },
          { key: "group", header: "Group" },
          { key: "balance", header: "Balance" }
        ]
      },
      {
        id: "party-report-by-item",
        label: "Party Report by Item",
        description: "Party purchases by item",
        tags: ["party", "item"],
        filters: ["Date Range", "Item"],
        columns: [
          { key: "party", header: "Party" },
          { key: "item", header: "Item" },
          { key: "qty", header: "Qty" }
        ]
      },
      {
        id: "sale-purchase-by-party",
        label: "Sale Purchase by Party",
        description: "Sales vs purchases",
        tags: ["party"],
        filters: ["Date Range", "Party"],
        columns: [
          { key: "party", header: "Party" },
          { key: "sales", header: "Sales" },
          { key: "purchase", header: "Purchase" }
        ]
      },
      {
        id: "sale-purchase-by-party-group",
        label: "Sale Purchase by Party Group",
        description: "Group wise summary",
        tags: ["party", "group"],
        filters: ["Date Range", "Group"],
        columns: [
          { key: "group", header: "Group" },
          { key: "sales", header: "Sales" },
          { key: "purchase", header: "Purchase" }
        ]
      }
    ]
  },
  {
    id: "stock-item-reports",
    title: "Stock / Item Reports",
    description: "Inventory, items, and profitability.",
    items: [
      {
        id: "stock-summary",
        label: "Stock Summary",
        description: "Overall stock snapshot",
        tags: ["stock"],
        filters: ["Warehouse", "Category"],
        columns: [
          { key: "item", header: "Item" },
          { key: "stock", header: "Stock" },
          { key: "value", header: "Value" }
        ]
      },
      {
        id: "item-report-by-party",
        label: "Item Report by Party",
        description: "Item movement by party",
        tags: ["item"],
        filters: ["Date Range", "Item", "Party"],
        columns: [
          { key: "item", header: "Item" },
          { key: "party", header: "Party" },
          { key: "qty", header: "Qty" }
        ]
      },
      {
        id: "item-wise-profit-loss",
        label: "Item Wise Profit and Loss",
        description: "Item profitability",
        tags: ["profit"],
        filters: ["Date Range", "Item"],
        columns: [
          { key: "item", header: "Item" },
          { key: "sales", header: "Sales" },
          { key: "margin", header: "Margin" }
        ]
      },
      {
        id: "item-category-wise-profit-loss",
        label: "Item Category Wise Profit and Loss",
        description: "Category profitability",
        tags: ["profit"],
        filters: ["Date Range", "Category"],
        columns: [
          { key: "category", header: "Category" },
          { key: "sales", header: "Sales" },
          { key: "margin", header: "Margin" }
        ]
      },
      {
        id: "low-stock-summary",
        label: "Low Stock Summary",
        description: "Reorder alert list",
        tags: ["stock"],
        filters: ["Warehouse"],
        columns: [
          { key: "item", header: "Item" },
          { key: "stock", header: "Stock" },
          { key: "threshold", header: "Threshold" }
        ]
      },
      {
        id: "stock-detail",
        label: "Stock Detail",
        description: "Batch / serial detail",
        tags: ["stock"],
        filters: ["Warehouse", "Item"],
        columns: [
          { key: "item", header: "Item" },
          { key: "batch", header: "Batch" },
          { key: "qty", header: "Qty" }
        ]
      },
      {
        id: "item-detail",
        label: "Item Detail",
        description: "Item ledger breakdown",
        tags: ["item"],
        filters: ["Date Range", "Item"],
        columns: [
          { key: "item", header: "Item" },
          { key: "opening", header: "Opening" },
          { key: "closing", header: "Closing" }
        ]
      },
      {
        id: "sale-purchase-report-by-item-category",
        label: "Sale/Purchase Report by Item Category",
        description: "Category sales vs purchase",
        tags: ["category"],
        filters: ["Date Range", "Category"],
        columns: [
          { key: "category", header: "Category" },
          { key: "sales", header: "Sales" },
          { key: "purchase", header: "Purchase" }
        ]
      },
      {
        id: "stock-summary-by-item-category",
        label: "Stock Summary by Item Category",
        description: "Category stock overview",
        tags: ["stock"],
        filters: ["Category"],
        columns: [
          { key: "category", header: "Category" },
          { key: "stock", header: "Stock" },
          { key: "value", header: "Value" }
        ]
      },
      {
        id: "item-wise-discount",
        label: "Item Wise Discount",
        description: "Discounts by item",
        tags: ["discount"],
        filters: ["Date Range", "Item"],
        columns: [
          { key: "item", header: "Item" },
          { key: "discount", header: "Discount" },
          { key: "value", header: "Value" }
        ]
      }
    ]
  },
  {
    id: "business-status",
    title: "Business Status",
    description: "Banking and discount summaries.",
    items: [
      {
        id: "bank-statement",
        label: "Bank Statement",
        description: "Account activity",
        tags: ["bank"],
        filters: ["Date Range", "Bank"],
        columns: [
          { key: "date", header: "Date" },
          { key: "narration", header: "Narration" },
          { key: "amount", header: "Amount" }
        ]
      },
      {
        id: "discount-report",
        label: "Discount Report",
        description: "Discounts given",
        tags: ["discount"],
        filters: ["Date Range"],
        columns: [
          { key: "party", header: "Party" },
          { key: "discount", header: "Discount" },
          { key: "value", header: "Value" }
        ]
      }
    ]
  },
  {
    id: "taxes",
    title: "Taxes",
    description: "GST and TDS/TCS filings.",
    items: [
      {
        id: "gst-report",
        label: "GST Report",
        description: "GST summary",
        tags: ["gst"],
        filters: ["Period", "Return Type"],
        columns: [
          { key: "type", header: "Type" },
          { key: "taxable", header: "Taxable" },
          { key: "gst", header: "GST" }
        ]
      },
      {
        id: "gst-rate-report",
        label: "GST Rate Report",
        description: "GST by rate",
        tags: ["gst"],
        filters: ["Period", "Rate"],
        columns: [
          { key: "rate", header: "Rate" },
          { key: "taxable", header: "Taxable" },
          { key: "gst", header: "GST" }
        ]
      },
      {
        id: "form-27eq",
        label: "Form No. 27EQ",
        description: "TCS statement",
        tags: ["tcs"],
        filters: ["Period"],
        columns: [
          { key: "section", header: "Section" },
          { key: "amount", header: "Amount" },
          { key: "tcs", header: "TCS" }
        ]
      },
      {
        id: "tcs-receivable",
        label: "TCS Receivable",
        description: "Pending TCS",
        tags: ["tcs"],
        filters: ["Period"],
        columns: [
          { key: "party", header: "Party" },
          { key: "amount", header: "Amount" },
          { key: "tcs", header: "TCS" }
        ]
      },
      {
        id: "tds-payable",
        label: "TDS Payable",
        description: "Payable TDS",
        tags: ["tds"],
        filters: ["Period"],
        columns: [
          { key: "party", header: "Party" },
          { key: "amount", header: "Amount" },
          { key: "tds", header: "TDS" }
        ]
      },
      {
        id: "tds-receivable",
        label: "TDS Receivable",
        description: "Receivable TDS",
        tags: ["tds"],
        filters: ["Period"],
        columns: [
          { key: "party", header: "Party" },
          { key: "amount", header: "Amount" },
          { key: "tds", header: "TDS" }
        ]
      }
    ]
  },
  {
    id: "expense-reports",
    title: "Expense Reports",
    description: "Expense tracking and categories.",
    items: [
      {
        id: "expense",
        label: "Expense",
        description: "Expense ledger",
        tags: ["expense"],
        filters: ["Date Range", "Category"],
        columns: [
          { key: "date", header: "Date" },
          { key: "category", header: "Category" },
          { key: "amount", header: "Amount" }
        ]
      },
      {
        id: "expense-category-report",
        label: "Expense Category Report",
        description: "Spend by category",
        tags: ["expense"],
        filters: ["Date Range"],
        columns: [
          { key: "category", header: "Category" },
          { key: "amount", header: "Amount" },
          { key: "share", header: "% Share" }
        ]
      },
      {
        id: "expense-item-report",
        label: "Expense Item Report",
        description: "Spend by item",
        tags: ["expense"],
        filters: ["Date Range", "Item"],
        columns: [
          { key: "item", header: "Item" },
          { key: "amount", header: "Amount" },
          { key: "count", header: "Count" }
        ]
      }
    ]
  },
  {
    id: "order-reports",
    title: "Sale / Purchase Order Reports",
    description: "Orders and line item summaries.",
    items: [
      {
        id: "sale-purchase-orders",
        label: "Sale/Purchase Orders",
        description: "Orders overview",
        tags: ["orders"],
        filters: ["Date Range", "Status"],
        columns: [
          { key: "order", header: "Order" },
          { key: "party", header: "Party" },
          { key: "amount", header: "Amount" }
        ]
      },
      {
        id: "sale-purchase-order-item",
        label: "Sale/Purchase Order Item",
        description: "Order line items",
        tags: ["orders"],
        filters: ["Date Range", "Item"],
        columns: [
          { key: "order", header: "Order" },
          { key: "item", header: "Item" },
          { key: "qty", header: "Qty" }
        ]
      }
    ]
  }
];
