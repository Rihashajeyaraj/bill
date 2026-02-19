import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgePercent,
  Banknote,
  BarChart3,
  Boxes,
  Building2,
  Cloud,
  FileText,
  LifeBuoy,
  LayoutDashboard,
  LayoutTemplate,
  ReceiptIndianRupee,
  Settings,
  Users,
  Wallet
} from "lucide-react";

export const APP_NAV_ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", shortcut: "G D", section: "Overview" },
  { to: "/app/company-setup", icon: Building2, label: "Company Setup", shortcut: "G C", section: "Setup" },
  { to: "/invoice-template-setup", icon: LayoutTemplate, label: "Invoice Template", section: "Setup" },

  { to: "/app/parties", icon: Users, label: "Parties", shortcut: "G P", section: "Masters" },
  { to: "/app/items", icon: Boxes, label: "Items", shortcut: "G I", section: "Masters" },

  { to: "/app/sales/invoice", icon: ReceiptIndianRupee, label: "Sales Invoice", section: "Sales" },
  { to: "/app/sales/credit-note", icon: BadgePercent, label: "Credit Note", section: "Sales" },
  { to: "/app/sales/payment-in", icon: ArrowDownToLine, label: "Payment In", section: "Sales" },

  { to: "/app/purchase/bill", icon: FileText, label: "Purchase Bill", section: "Purchases" },
  { to: "/app/purchase/debit-note", icon: BadgePercent, label: "Debit Note", section: "Purchases" },
  { to: "/app/purchases/payment-out", icon: ArrowUpFromLine, label: "Payment Out", section: "Purchases" },
  { to: "/app/purchase/expense", icon: Wallet, label: "Expense", section: "Purchases" },

  { to: "/app/reports", icon: BarChart3, label: "Reports", shortcut: "G R", section: "Finance" },
  { to: "/app/cash-bank", icon: Banknote, label: "Cash & Bank", section: "Finance" },
  { to: "/app/company-settings", icon: Settings, label: "Settings", shortcut: "G S", section: "Admin" },
  { to: "/app/backup", icon: Cloud, label: "Backup", section: "Admin" },
  { to: "/app/help", icon: LifeBuoy, label: "Help", section: "Admin" }
];

export const APP_SHORTCUTS = [
  { label: "Open global search", keys: "Ctrl + K" },
  { label: "Open notifications", keys: "Alt + N" },
  { label: "Toggle theme", keys: "Alt + D" },
  { label: "Go to Dashboard", keys: "G then D" },
  { label: "Go to Reports", keys: "G then R" }
];
