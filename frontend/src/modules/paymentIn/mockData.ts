import type { CountryCode } from "./countryConfig";

export interface MockCustomer {
  id: string;
  name: string;
  country: CountryCode;
  registrationNumber: string;
  email: string;
  state?: string;
}

export interface MockOpenInvoice {
  id: string;
  invoiceNo: string;
  country: CountryCode;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  invoiceAmount: number;
  balanceDue: number;
}

export const MOCK_CUSTOMERS: MockCustomer[] = [
  {
    id: "mock_pay_cus_sl_1",
    name: "Colombo Retail Hub",
    country: "SL",
    registrationNumber: "123456789V",
    email: "finance@colomboretail.lk",
    state: "Western"
  },
  {
    id: "mock_pay_cus_in_1",
    name: "Bangalore Tech Mart",
    country: "IN",
    registrationNumber: "29ABCDE1234F1Z5",
    email: "accounts@btm.in",
    state: "Karnataka"
  },
  {
    id: "mock_pay_cus_ae_1",
    name: "Dubai Trade Link",
    country: "AE",
    registrationNumber: "100123456700003",
    email: "ap@dubaitradelink.ae",
    state: "Dubai"
  },
  {
    id: "mock_pay_cus_sg_1",
    name: "Jurong Office Supply",
    country: "SG",
    registrationNumber: "M12345678X",
    email: "finance@jurongoffice.sg"
  },
  {
    id: "mock_pay_cus_uk_1",
    name: "Manchester Design Studio",
    country: "UK",
    registrationNumber: "GB123456789",
    email: "accounts@mds.co.uk"
  },
  {
    id: "mock_pay_cus_us_1",
    name: "Austin Enterprise Goods",
    country: "US",
    registrationNumber: "TX-4789102",
    email: "billing@austinenterprise.us",
    state: "Texas"
  }
];

export const MOCK_OPEN_INVOICES: MockOpenInvoice[] = [
  {
    id: "mock_pay_inv_sl_1",
    invoiceNo: "INV-SL-2044",
    country: "SL",
    customerId: "mock_pay_cus_sl_1",
    customerName: "Colombo Retail Hub",
    invoiceDate: "2026-01-10",
    invoiceAmount: 188000,
    balanceDue: 156000
  },
  {
    id: "mock_pay_inv_in_1",
    invoiceNo: "INV-IN-7721",
    country: "IN",
    customerId: "mock_pay_cus_in_1",
    customerName: "Bangalore Tech Mart",
    invoiceDate: "2026-01-18",
    invoiceAmount: 322000,
    balanceDue: 245000
  },
  {
    id: "mock_pay_inv_ae_1",
    invoiceNo: "INV-UAE-4932",
    country: "AE",
    customerId: "mock_pay_cus_ae_1",
    customerName: "Dubai Trade Link",
    invoiceDate: "2026-01-21",
    invoiceAmount: 108000,
    balanceDue: 98200
  },
  {
    id: "mock_pay_inv_sg_1",
    invoiceNo: "INV-SG-2819",
    country: "SG",
    customerId: "mock_pay_cus_sg_1",
    customerName: "Jurong Office Supply",
    invoiceDate: "2026-01-19",
    invoiceAmount: 88400,
    balanceDue: 78000
  },
  {
    id: "mock_pay_inv_uk_1",
    invoiceNo: "INV-UK-9305",
    country: "UK",
    customerId: "mock_pay_cus_uk_1",
    customerName: "Manchester Design Studio",
    invoiceDate: "2026-01-16",
    invoiceAmount: 26500,
    balanceDue: 24500
  },
  {
    id: "mock_pay_inv_us_1",
    invoiceNo: "INV-US-6612",
    country: "US",
    customerId: "mock_pay_cus_us_1",
    customerName: "Austin Enterprise Goods",
    invoiceDate: "2026-01-12",
    invoiceAmount: 35800,
    balanceDue: 31000
  }
];
