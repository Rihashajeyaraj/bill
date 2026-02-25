import type { CountryCode } from "./countryConfig";

export interface MockSupplier {
  id: string;
  name: string;
  country: CountryCode;
  registrationNumber: string;
  email: string;
  phone?: string;
  address?: string;
  state?: string;
}

export interface MockPurchaseInvoiceLine {
  id: string;
  itemName: string;
  quantity: number;
  rate: number;
  taxRate: number;
  hsnSac?: string;
}

export interface MockPurchaseInvoice {
  id: string;
  invoiceNo: string;
  country: CountryCode;
  supplierId: string;
  supplierName: string;
  invoiceDate: string;
  remainingBalance: number;
  placeOfSupply?: string;
  lines: MockPurchaseInvoiceLine[];
}

export const MOCK_SUPPLIERS: MockSupplier[] = [
  {
    id: "mock_sup_sl_1",
    name: "Lanka Office Distributors",
    country: "SL",
    registrationNumber: "123456789V",
    email: "accounts@lankadistributors.lk",
    phone: "0717654321",
    address: "128 Baseline Road, Colombo",
    state: "Western"
  },
  {
    id: "mock_sup_in_1",
    name: "Bharat Components Pvt Ltd",
    country: "IN",
    registrationNumber: "29ABCDE1234F1Z5",
    email: "finance@bharatcomponents.in",
    phone: "9988776655",
    address: "Plot 44, Peenya Industrial Estate, Bengaluru",
    state: "Karnataka"
  },
  {
    id: "mock_sup_ae_1",
    name: "Dubai Industrial Traders",
    country: "AE",
    registrationNumber: "100123456700003",
    email: "ap@dubaiindustrial.ae",
    phone: "0582345678",
    address: "Unit 8, Jebel Ali Free Zone",
    state: "Dubai"
  },
  {
    id: "mock_sup_sg_1",
    name: "Jurong Supply Pte Ltd",
    country: "SG",
    registrationNumber: "M12345678X",
    email: "finance@jurongsupply.sg",
    phone: "92345678",
    address: "18 Pioneer Crescent"
  },
  {
    id: "mock_sup_uk_1",
    name: "Manchester Wholesale Ltd",
    country: "UK",
    registrationNumber: "GB123456789",
    email: "accounts@manchesterwholesale.co.uk",
    phone: "07822111222",
    address: "34 Piccadilly, Manchester"
  },
  {
    id: "mock_sup_us_1",
    name: "Austin Warehouse Systems",
    country: "US",
    registrationNumber: "TX-4789102",
    email: "billing@austinwarehouse.us",
    phone: "(737) 555-0198",
    address: "1100 E Howard Ln, Austin",
    state: "Texas"
  }
];

export const MOCK_PURCHASE_INVOICES: MockPurchaseInvoice[] = [
  {
    id: "mock_pinv_sl_1",
    invoiceNo: "PINV-SL-2044",
    country: "SL",
    supplierId: "mock_sup_sl_1",
    supplierName: "Lanka Office Distributors",
    invoiceDate: "2026-01-10",
    remainingBalance: 156000,
    placeOfSupply: "Western",
    lines: [
      { id: "line_1", itemName: "Retail Shelving", quantity: 4, rate: 28000, taxRate: 18 },
      { id: "line_2", itemName: "Delivery Service", quantity: 1, rate: 12000, taxRate: 18 }
    ]
  },
  {
    id: "mock_pinv_in_1",
    invoiceNo: "PINV-IN-7721",
    country: "IN",
    supplierId: "mock_sup_in_1",
    supplierName: "Bharat Components Pvt Ltd",
    invoiceDate: "2026-01-18",
    remainingBalance: 245000,
    placeOfSupply: "Karnataka",
    lines: [
      { id: "line_1", itemName: "Thermal Printer", quantity: 5, rate: 18000, taxRate: 18, hsnSac: "84433210" },
      { id: "line_2", itemName: "Implementation Service", quantity: 1, rate: 60000, taxRate: 18, hsnSac: "998313" }
    ]
  },
  {
    id: "mock_pinv_ae_1",
    invoiceNo: "PINV-UAE-4932",
    country: "AE",
    supplierId: "mock_sup_ae_1",
    supplierName: "Dubai Industrial Traders",
    invoiceDate: "2026-01-21",
    remainingBalance: 98200,
    placeOfSupply: "Dubai",
    lines: [
      { id: "line_1", itemName: "POS Terminal", quantity: 2, rate: 42000, taxRate: 5 },
      { id: "line_2", itemName: "Training", quantity: 1, rate: 9800, taxRate: 5 }
    ]
  },
  {
    id: "mock_pinv_sg_1",
    invoiceNo: "PINV-SG-2819",
    country: "SG",
    supplierId: "mock_sup_sg_1",
    supplierName: "Jurong Supply Pte Ltd",
    invoiceDate: "2026-01-19",
    remainingBalance: 78000,
    placeOfSupply: "Singapore",
    lines: [
      { id: "line_1", itemName: "Office Chair", quantity: 12, rate: 2400, taxRate: 9 },
      { id: "line_2", itemName: "Desk Assembly", quantity: 1, rate: 6400, taxRate: 9 }
    ]
  },
  {
    id: "mock_pinv_uk_1",
    invoiceNo: "PINV-UK-9305",
    country: "UK",
    supplierId: "mock_sup_uk_1",
    supplierName: "Manchester Wholesale Ltd",
    invoiceDate: "2026-01-16",
    remainingBalance: 24500,
    placeOfSupply: "England",
    lines: [
      { id: "line_1", itemName: "Design License", quantity: 10, rate: 1800, taxRate: 20 },
      { id: "line_2", itemName: "Support Retainer", quantity: 1, rate: 2500, taxRate: 20 }
    ]
  },
  {
    id: "mock_pinv_us_1",
    invoiceNo: "PINV-US-6612",
    country: "US",
    supplierId: "mock_sup_us_1",
    supplierName: "Austin Warehouse Systems",
    invoiceDate: "2026-01-12",
    remainingBalance: 31000,
    placeOfSupply: "Texas",
    lines: [
      { id: "line_1", itemName: "Warehouse Scanner", quantity: 4, rate: 6200, taxRate: 8.25 },
      { id: "line_2", itemName: "Calibration Service", quantity: 1, rate: 3200, taxRate: 8.25 }
    ]
  }
];
