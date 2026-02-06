import type { CountryCode } from "./countryConfig";

export interface MockCustomer {
  id: string;
  name: string;
  country: CountryCode;
  registrationNumber: string;
  email: string;
  state?: string;
}

export interface MockInvoiceLine {
  id: string;
  itemName: string;
  quantity: number;
  rate: number;
  taxRate: number;
  hsnSac?: string;
}

export interface MockInvoice {
  id: string;
  invoiceNo: string;
  country: CountryCode;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  remainingBalance: number;
  balanceAmount: number;
  status: string;
  placeOfSupply?: string;
  lines: MockInvoiceLine[];
}

export const MOCK_CUSTOMERS: MockCustomer[] = [
  {
    id: "mock_cust_sl_1",
    name: "Colombo Retail Hub",
    country: "SL",
    registrationNumber: "123456789V",
    email: "finance@colomboretail.lk",
    state: "Western"
  },
  {
    id: "mock_cust_in_1",
    name: "Bangalore Tech Mart",
    country: "IN",
    registrationNumber: "29ABCDE1234F1Z5",
    email: "accounts@btm.in",
    state: "Karnataka"
  },
  {
    id: "mock_cust_ae_1",
    name: "Dubai Trade Link",
    country: "AE",
    registrationNumber: "100123456700003",
    email: "ap@dubaitradelink.ae",
    state: "Dubai"
  },
  {
    id: "mock_cust_sg_1",
    name: "Jurong Office Supply",
    country: "SG",
    registrationNumber: "M12345678X",
    email: "finance@jurongoffice.sg"
  },
  {
    id: "mock_cust_uk_1",
    name: "Manchester Design Studio",
    country: "UK",
    registrationNumber: "GB123456789",
    email: "accounts@mds.co.uk"
  },
  {
    id: "mock_cust_us_1",
    name: "Austin Enterprise Goods",
    country: "US",
    registrationNumber: "TX-4789102",
    email: "billing@austinenterprise.us",
    state: "Texas"
  }
];

export const MOCK_INVOICES: MockInvoice[] = [
  {
    id: "mock_inv_sl_1",
    invoiceNo: "INV-SL-2044",
    country: "SL",
    customerId: "mock_cust_sl_1",
    customerName: "Colombo Retail Hub",
    invoiceDate: "2026-01-10",
    remainingBalance: 156000,
    balanceAmount: 156000,
    status: "Issued",
    placeOfSupply: "Western",
    lines: [
      { id: "line_1", itemName: "Retail Shelving", quantity: 4, rate: 28000, taxRate: 18 },
      { id: "line_2", itemName: "Delivery Service", quantity: 1, rate: 12000, taxRate: 18 }
    ]
  },
  {
    id: "mock_inv_in_1",
    invoiceNo: "INV-IN-7721",
    country: "IN",
    customerId: "mock_cust_in_1",
    customerName: "Bangalore Tech Mart",
    invoiceDate: "2026-01-18",
    remainingBalance: 245000,
    balanceAmount: 245000,
    status: "Partially Paid",
    placeOfSupply: "Karnataka",
    lines: [
      { id: "line_1", itemName: "Thermal Printer", quantity: 5, rate: 18000, taxRate: 18, hsnSac: "84433210" },
      { id: "line_2", itemName: "Implementation Service", quantity: 1, rate: 60000, taxRate: 18, hsnSac: "998313" }
    ]
  },
  {
    id: "mock_inv_ae_1",
    invoiceNo: "INV-UAE-4932",
    country: "AE",
    customerId: "mock_cust_ae_1",
    customerName: "Dubai Trade Link",
    invoiceDate: "2026-01-21",
    remainingBalance: 98200,
    balanceAmount: 98200,
    status: "Issued",
    placeOfSupply: "Dubai",
    lines: [
      { id: "line_1", itemName: "POS Terminal", quantity: 2, rate: 42000, taxRate: 5 },
      { id: "line_2", itemName: "Training", quantity: 1, rate: 9800, taxRate: 5 }
    ]
  },
  {
    id: "mock_inv_sg_1",
    invoiceNo: "INV-SG-2819",
    country: "SG",
    customerId: "mock_cust_sg_1",
    customerName: "Jurong Office Supply",
    invoiceDate: "2026-01-19",
    remainingBalance: 78000,
    balanceAmount: 78000,
    status: "Issued",
    placeOfSupply: "Singapore",
    lines: [
      { id: "line_1", itemName: "Office Chair", quantity: 12, rate: 2400, taxRate: 9 },
      { id: "line_2", itemName: "Desk Assembly", quantity: 1, rate: 6400, taxRate: 9 }
    ]
  },
  {
    id: "mock_inv_uk_1",
    invoiceNo: "INV-UK-9305",
    country: "UK",
    customerId: "mock_cust_uk_1",
    customerName: "Manchester Design Studio",
    invoiceDate: "2026-01-16",
    remainingBalance: 24500,
    balanceAmount: 24500,
    status: "Issued",
    placeOfSupply: "England",
    lines: [
      { id: "line_1", itemName: "Design License", quantity: 10, rate: 1800, taxRate: 20 },
      { id: "line_2", itemName: "Support Retainer", quantity: 1, rate: 2500, taxRate: 20 }
    ]
  },
  {
    id: "mock_inv_us_1",
    invoiceNo: "INV-US-6612",
    country: "US",
    customerId: "mock_cust_us_1",
    customerName: "Austin Enterprise Goods",
    invoiceDate: "2026-01-12",
    remainingBalance: 31000,
    balanceAmount: 31000,
    status: "Issued",
    placeOfSupply: "Texas",
    lines: [
      { id: "line_1", itemName: "Warehouse Scanner", quantity: 4, rate: 6200, taxRate: 8.25 },
      { id: "line_2", itemName: "Calibration Service", quantity: 1, rate: 3200, taxRate: 8.25 }
    ]
  }
];
