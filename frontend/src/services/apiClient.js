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

export async function apiRequest(endpoint, method = "GET", body = null) {
  const headers = await getAuthHeaders();
  const config = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const url = `${BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const response = await fetch(url, config);

  if (!response.ok) {
    let errorDetail = `API Request failed with status ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errJson.message || errorDetail;
    } catch (_) {}
    throw new Error(errorDetail);
  }

  if (response.status === 204) {
    return true;
  }

  return await response.json();
}

export const apiClient = {
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
  getProforma: (id) => apiRequest(`/proforma/${id}`, "GET"),
  createProforma: (data) => apiRequest("/proforma", "POST", data),
  updateProforma: (id, data) => apiRequest(`/proforma/${id}`, "PUT", data),
  convertProforma: (id) => apiRequest(`/proforma/${id}/convert`, "POST"),

  // Tax Invoices
  getInvoices: () => apiRequest("/invoices", "GET"),
  getInvoice: (id) => apiRequest(`/invoices/${id}`, "GET"),
  createInvoice: (data) => apiRequest("/invoices", "POST", data),
  updateInvoice: (id, data) => apiRequest(`/invoices/${id}`, "PUT", data),

  // Payments
  getPayments: () => apiRequest("/payments", "GET"),
  getPayment: (id) => apiRequest(`/payments/${id}`, "GET"),
  createPayment: (data) => apiRequest("/payments", "POST", data),

  // Dashboard
  getDashboard: () => apiRequest("/dashboard", "GET"),

  // Reports
  getSalesReport: (startDate, endDate) => {
    let q = "";
    if (startDate || endDate) {
      const params = new URLSearchParams();
      if (startDate) params.append("start_date", startDate);
      if (endDate) params.append("end_date", endDate);
      q = `?${params.toString()}`;
    }
    return apiRequest(`/reports/sales${q}`, "GET");
  },
  getProformaReport: (startDate, endDate) => {
    let q = "";
    if (startDate || endDate) {
      const params = new URLSearchParams();
      if (startDate) params.append("start_date", startDate);
      if (endDate) params.append("end_date", endDate);
      q = `?${params.toString()}`;
    }
    return apiRequest(`/reports/proforma${q}`, "GET");
  },
  getPaymentsReport: (startDate, endDate) => {
    let q = "";
    if (startDate || endDate) {
      const params = new URLSearchParams();
      if (startDate) params.append("start_date", startDate);
      if (endDate) params.append("end_date", endDate);
      q = `?${params.toString()}`;
    }
    return apiRequest(`/reports/payments${q}`, "GET");
  },
  getReceivablesReport: () => apiRequest("/reports/receivables", "GET"),
};
