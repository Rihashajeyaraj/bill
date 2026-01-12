import { LS_KEYS, lsGet, lsSet } from "./storage";

export function ensureSeeded() {
  if (localStorage.getItem(LS_KEYS.companyProfileCompleted) === null) {
    lsSet(LS_KEYS.companyProfileCompleted, false);
  }
  if (localStorage.getItem(LS_KEYS.invoiceTemplateCompleted) === null) {
    lsSet(LS_KEYS.invoiceTemplateCompleted, false);
  }

  if (!Array.isArray(lsGet(LS_KEYS.parties, null))) {
    lsSet(LS_KEYS.parties, [
      {
        id: "pty_1",
        type: "Customer",
        name: "Kavin Stores",
        phone: "+94 71 111 2222",
        email: "",
        state: "Western",
        balance: 45000
      },
      {
        id: "pty_2",
        type: "Supplier",
        name: "Sunil Suppliers",
        phone: "+94 75 999 8888",
        email: "",
        state: "Western",
        balance: -12000
      }
    ]);
  }

  if (!Array.isArray(lsGet(LS_KEYS.items, null))) {
    lsSet(LS_KEYS.items, [
      {
        id: "itm_1",
        name: "Granite Slab",
        type: "Product",
        price: 8500,
        unit: "sqft",
        taxRate: 18,
        hsn: "2516",
        stockQty: 120
      },
      {
        id: "itm_2",
        name: "Installation",
        type: "Service",
        price: 15000,
        unit: "job",
        taxRate: 18,
        sac: "9954",
        stockQty: 0
      }
    ]);
  }

  if (!Array.isArray(lsGet(LS_KEYS.invoices, null))) lsSet(LS_KEYS.invoices, []);
  if (!Array.isArray(lsGet(LS_KEYS.purchases, null))) lsSet(LS_KEYS.purchases, []);
  if (!Array.isArray(lsGet(LS_KEYS.payments, null))) lsSet(LS_KEYS.payments, []);
  if (!Array.isArray(lsGet(LS_KEYS.expenses, null))) lsSet(LS_KEYS.expenses, []);
}
