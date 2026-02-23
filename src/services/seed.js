import { LS_KEYS, lsGetOrganizationScoped, lsSetOrganizationScoped } from "./storage";

export function ensureSeeded() {
  if (!Array.isArray(lsGetOrganizationScoped(LS_KEYS.parties, null))) {
    lsSetOrganizationScoped(LS_KEYS.parties, [
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

  if (!Array.isArray(lsGetOrganizationScoped(LS_KEYS.items, null))) {
    lsSetOrganizationScoped(LS_KEYS.items, [
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

  if (!Array.isArray(lsGetOrganizationScoped(LS_KEYS.invoices, null))) {
    lsSetOrganizationScoped(LS_KEYS.invoices, []);
  }
  if (!Array.isArray(lsGetOrganizationScoped(LS_KEYS.creditNotes, null))) {
    lsSetOrganizationScoped(LS_KEYS.creditNotes, []);
  }
  if (!Array.isArray(lsGetOrganizationScoped(LS_KEYS.purchases, null))) {
    lsSetOrganizationScoped(LS_KEYS.purchases, []);
  }
  if (!Array.isArray(lsGetOrganizationScoped(LS_KEYS.payments, null))) {
    lsSetOrganizationScoped(LS_KEYS.payments, []);
  }
  if (!Array.isArray(lsGetOrganizationScoped(LS_KEYS.expenses, null))) {
    lsSetOrganizationScoped(LS_KEYS.expenses, []);
  }
}
