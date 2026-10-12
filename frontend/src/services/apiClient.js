import { supabase } from "./supabaseClient";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

async function getAuthHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };

  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  } catch (err) {
    console.warn("Could not retrieve session token for API call:", err);
  }

  const activeOrgId = localStorage.getItem("active_organization_id");
  if (activeOrgId && activeOrgId !== "undefined" && activeOrgId !== "null" && activeOrgId !== "no-organization") {
    headers["X-Organization-Id"] = activeOrgId;
  }

  return headers;
}

const inflightGetRequests = new Map();

export async function apiRequest(endpoint, method = "GET", body = null) {
  let cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (cleanEndpoint.startsWith("/api/v1/")) {
    cleanEndpoint = cleanEndpoint.replace("/api/v1", "");
  }

  // Deduplicate concurrent in-flight GET requests to the same URL
  if (method === "GET") {
    const activeOrgId = localStorage.getItem("active_organization_id") || "default";
    const cacheKey = `${activeOrgId}:${cleanEndpoint}`;
    if (inflightGetRequests.has(cacheKey)) {
      return inflightGetRequests.get(cacheKey);
    }

    const fetchPromise = (async () => {
      try {
        return await executeRequest(cleanEndpoint, method, body);
      } finally {
        inflightGetRequests.delete(cacheKey);
      }
    })();

    inflightGetRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  return executeRequest(cleanEndpoint, method, body);
}

async function executeRequest(cleanEndpoint, method = "GET", body = null) {
  const headers = await getAuthHeaders();
  const config = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const url = `${BASE_URL}${cleanEndpoint}`;
  const response = await fetch(url, config);

  if (!response.ok) {
    let errorDetail = `API Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      if (Array.isArray(errJson.detail)) {
        errorDetail = errJson.detail.map(e => {
          const field = e.loc ? e.loc[e.loc.length - 1] : "";
          if (field && field !== "body" && field !== "payload") {
            const prettyField = field.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
            return `${prettyField}: ${e.msg || e.message}`;
          }
          return e.msg || e.message;
        }).join(". ");
      } else {
        errorDetail = errJson.detail || errJson.message || errorDetail;
      }
    } catch (_) {}
    throw new Error(errorDetail);
  }

  if (response.status === 204) {
    return true;
  }

  return await response.json();
}

export function apiGet(endpoint) { return apiRequest(endpoint, "GET"); }
export function apiPost(endpoint, body) { return apiRequest(endpoint, "POST", body); }
export function apiPut(endpoint, body) { return apiRequest(endpoint, "PUT", body); }
export function apiDelete(endpoint) { return apiRequest(endpoint, "DELETE"); }

export const apiClient = {
  // Dashboard
  getDashboard: () => apiRequest("/dashboard", "GET"),

  // Auth & Context
  getMe: () => apiRequest("/auth/me", "GET"),

  // Parties
  getParties: (type) => apiRequest(`/parties${type ? `?party_type=${type}` : ""}`, "GET"),
  getParty: (id) => apiRequest(`/parties/${id}`, "GET"),
  createParty: (data) => apiRequest("/parties", "POST", data),
  updateParty: (id, data) => apiRequest(`/parties/${id}`, "PUT", data),

  // Items
  getItems: () => apiRequest("/items", "GET"),
  getItem: (id) => apiRequest(`/items/${id}`, "GET"),
  createItem: (data) => apiRequest("/items", "POST", data),
  updateItem: (id, data) => apiRequest(`/items/${id}`, "PUT", data),

  // Pro Forma Invoices
  getProformas: () => apiRequest("/proforma", "GET"),
  getNextProformaNo: () => apiRequest("/proforma/next-number", "GET"),
  getProforma: (id) => apiRequest(`/proforma/${id}`, "GET"),
  createProforma: (data) => apiRequest("/proforma", "POST", data),
  updateProforma: (id, data) => apiRequest(`/proforma/${id}`, "PUT", data),
  convertProforma: (id, payload) => apiRequest(`/proforma/${id}/convert`, "POST", payload),
  cancelProforma: (id) => apiRequest(`/proforma/${id}/cancel`, "POST"),
  verifyProforma: (token) => apiRequest(`/proforma/verify/${token}`, "GET"),
  verifyTaxInvoice: (token) => apiRequest(`/invoices/verify/${token}`, "GET"),
  verifyDocument: (token) => {
    if (token && (token.startsWith("txv_") || token.startsWith("inv_"))) {
      return apiRequest(`/invoices/verify/${token}`, "GET");
    }
    return apiRequest(`/proforma/verify/${token}`, "GET");
  },
  deleteProforma: (id) => apiRequest(`/proforma/${id}`, "DELETE"),
  deleteAllProformas: () => apiRequest("/proforma", "DELETE"),

  // Tax Invoices
  getInvoices: () => apiRequest("/invoices", "GET"),
  getInvoice: (id) => apiRequest(`/invoices/${id}`, "GET"),
  verifyInvoice: (token) => apiRequest(`/invoices/verify/${token}`, "GET"),
  createInvoice: (data) => apiRequest("/invoices", "POST", data),
  updateInvoice: (id, data) => apiRequest(`/invoices/${id}`, "PUT", data),

  // Payments
  getPayments: (params) => {
    if (!params) return apiRequest("/payments", "GET");
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
    });
    const qs = sp.toString();
    return apiRequest(`/payments${qs ? `?${qs}` : ""}`, "GET");
  },
  getPaymentSummary: (params) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    }
    const qs = sp.toString();
    return apiRequest(`/payments/summary${qs ? `?${qs}` : ""}`, "GET");
  },
  getPendingDocuments: (paramsOrCustomerId) => {
    const sp = new URLSearchParams();
    if (paramsOrCustomerId && typeof paramsOrCustomerId === "object") {
      Object.entries(paramsOrCustomerId).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    } else if (paramsOrCustomerId) {
      sp.append("customer_id", String(paramsOrCustomerId));
    }
    const qs = sp.toString();
    return apiRequest(`/payments/pending-documents${qs ? `?${qs}` : ""}`, "GET");
  },
  getTdsHistory: (params) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    }
    const qs = sp.toString();
    return apiRequest(`/payments/tds-history${qs ? `?${qs}` : ""}`, "GET");
  },
  getPayment: (id) => apiRequest(`/payments/${id}`, "GET"),
  createPayment: (data) => apiRequest("/payments", "POST", data),
  reversePayment: (id, reason) => apiRequest(`/payments/${id}/reverse`, "POST", { reason }),
  getReceivables: (params) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    }
    const qs = sp.toString();
    return apiRequest(`/payments/receivables${qs ? `?${qs}` : ""}`, "GET");
  },
  getReceivablesSummary: (params) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    }
    const qs = sp.toString();
    return apiRequest(`/payments/receivables/summary${qs ? `?${qs}` : ""}`, "GET");
  },
  getCustomerReceivables: (params) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    }
    const qs = sp.toString();
    return apiRequest(`/payments/receivables/customers${qs ? `?${qs}` : ""}`, "GET");
  },
  getReceipts: (params) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    }
    const qs = sp.toString();
    return apiRequest(`/payments/receipts${qs ? `?${qs}` : ""}`, "GET");
  },
  applyAdvance: (data) => apiRequest("/payments/apply-advance", "POST", data),
  getCustomerLedger: (customerId, params) => {
    const sp = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") sp.append(k, String(v));
      });
    }
    const qs = sp.toString();
    return apiRequest(`/payments/ledger/${encodeURIComponent(customerId)}${qs ? `?${qs}` : ""}`, "GET");
  },

  // Dashboard
  getDashboard: () => apiRequest("/dashboard", "GET"),

  // Reports
  _buildReportQuery: (paramsOrStartDate, endDate) => {
    const sp = new URLSearchParams();
    if (paramsOrStartDate && typeof paramsOrStartDate === "object") {
      Object.entries(paramsOrStartDate).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
          const s = String(v).trim();
          if (s.toLowerCase() !== "all" && s.toLowerCase() !== "all customers" && s.toLowerCase() !== "all modes") {
            // Map camelCase to snake_case if necessary
            const keyMap = {
              startDate: "start_date",
              endDate: "end_date",
              customerId: "customer_id",
              partyId: "party_id",
              paymentMode: "payment_mode",
              invoiceType: "invoice_type",
              includePaid: "include_paid"
            };
            sp.append(keyMap[k] || k, s);
          }
        }
      });
    } else {
      if (paramsOrStartDate) sp.append("start_date", paramsOrStartDate);
      if (endDate) sp.append("end_date", endDate);
    }
    const q = sp.toString();
    return q ? `?${q}` : "";
  },

  getSalesReport: (startDateOrParams, endDate) => {
    const q = apiClient._buildReportQuery(startDateOrParams, endDate);
    return apiRequest(`/reports/sales${q}`, "GET");
  },
  getCustomerWiseReport: (params) => {
    const q = apiClient._buildReportQuery(params);
    return apiRequest(`/reports/customer-wise${q}`, "GET");
  },
  getPaymentsReport: (paramsOrStart, endDate) => {
    const q = apiClient._buildReportQuery(paramsOrStart, endDate);
    return apiRequest(`/reports/payments${q}`, "GET");
  },
  getAdvanceReceivedReport: (params) => {
    const q = apiClient._buildReportQuery(params);
    return apiRequest(`/reports/advances${q}`, "GET");
  },
  getBalanceDueReport: (params) => {
    const q = apiClient._buildReportQuery(params);
    return apiRequest(`/reports/balance-due${q}`, "GET");
  },
  getProformaReport: (paramsOrStart, endDate) => {
    const q = apiClient._buildReportQuery(paramsOrStart, endDate);
    return apiRequest(`/reports/proforma${q}`, "GET");
  },
  getTaxInvoicesReport: (params) => {
    const q = apiClient._buildReportQuery(params);
    return apiRequest(`/reports/tax-invoices${q}`, "GET");
  },
  getReceivablesReport: () => apiRequest("/reports/receivables", "GET"),
};
