import React, { Suspense, lazy } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { AppRouteAccessGuard, AuthGuard, CompanySetupGuard, InvoiceTemplateGuard, SetupGuard } from "./guards";

import AppLayout from "../layouts/AppLayout";
import Login from "../pages/Login";

const ForgotPassword = lazy(() => import("../pages/ForgotPassword"));
const ResetPassword = lazy(() => import("../pages/ResetPassword"));
const CompanySetup = lazy(() => import("../pages/CompanySetup"));
const OrganizationSelect = lazy(() => import("../pages/OrganizationSelect"));
const InvoiceTemplateSetup = lazy(() => import("../pages/InvoiceTemplateSetup"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const Parties = lazy(() => import("../pages/Parties"));
const PartyStatement = lazy(() => import("../pages/PartyStatement"));
const Items = lazy(() => import("../pages/Items"));
const ItemCreate = lazy(() => import("../pages/ItemCreate"));

const InvoiceHistory = lazy(() => import("../pages/sales/InvoiceHistory"));
const InvoiceCreate = lazy(() => import("../pages/sales/InvoiceCreate"));
const InvoiceReadOnlyView = lazy(() => import("../pages/sales/InvoiceReadOnlyView"));
const SalesProformasList = lazy(() => import("../pages/sales/SalesProformasList"));
const SalesProformaEditor = lazy(() => import("../pages/sales/SalesProformaEditor"));
const ProformaVerificationView = lazy(() => import("../pages/sales/ProformaVerificationView"));
const PaymentIn = lazy(() => import("../pages/sales/PaymentInPremium"));

const Reports = lazy(() => import("../pages/Reports"));
const PartyWiseStatement = lazy(() => import("../pages/reports/PartyWiseStatement"));
const AgingReport = lazy(() => import("../pages/reports/AgingReport"));
const SettingsPage = lazy(() => import("../pages/Settings"));
const CompanySettings = lazy(() => import("../pages/CompanySettings"));
const TenantCompanyUsers = lazy(() => import("../pages/settings/TenantCompanyUsers"));
const NotFound = lazy(() => import("../pages/NotFound"));

const SuperAdminDashboard = lazy(() => import("../pages/super-admin/SuperAdminDashboard"));
const SuperAdminCompanies = lazy(() => import("../pages/super-admin/SuperAdminCompanies"));
const SuperAdminActivity = lazy(() => import("../pages/super-admin/SuperAdminActivity"));
const SuperAdminRequests = lazy(() => import("../pages/super-admin/SuperAdminRequests"));
const SuperAdminLayout = lazy(() => import("../pages/super-admin/SuperAdminLayout"));

function LazyWrapper({ component: Component }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

function SalesInvoiceRoute() {
  const [searchParams] = useSearchParams();
  const previewId = searchParams.get("preview") || searchParams.get("id");
  if (previewId) {
    return <LazyWrapper component={InvoiceReadOnlyView} />;
  }
  const editId = searchParams.get("edit");
  const printId = searchParams.get("print");
  if (editId || printId) {
    return <LazyWrapper component={InvoiceCreate} />;
  }
  return <Navigate to="/app/sales/invoice/history" replace />;
}

export const routes = [
  { path: "/login", element: <Login /> },
  { path: "/forgot-password", element: <LazyWrapper component={ForgotPassword} /> },
  { path: "/verify/proforma/:token", element: <LazyWrapper component={ProformaVerificationView} /> },
  { path: "/verify/invoice/:token", element: <LazyWrapper component={ProformaVerificationView} /> },
  { path: "/verify/tax-invoice/:token", element: <LazyWrapper component={ProformaVerificationView} /> },

  {
    element: <AuthGuard />,
    children: [
      { path: "/organization-select", element: <LazyWrapper component={OrganizationSelect} /> },
      {
        element: <InvoiceTemplateGuard />,
        children: [{ path: "/invoice-template-setup", element: <LazyWrapper component={InvoiceTemplateSetup} /> }]
      },
      {
        element: <CompanySetupGuard />,
        children: [{ path: "/company-setup", element: <LazyWrapper component={CompanySetup} /> }]
      }
    ]
  },

  {
    element: <AuthGuard />,
    children: [
      {
        element: <SetupGuard />,
        children: [
          {
            element: <AppRouteAccessGuard />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { path: "/", element: <Navigate to="/dashboard" replace /> },
                  { path: "/dashboard", element: <LazyWrapper component={Dashboard} /> },
                  { path: "/app/dashboard", element: <LazyWrapper component={Dashboard} /> },
                  { path: "/app/company-setup", element: <LazyWrapper component={CompanySetup} /> },
                  { path: "/app/invoice-template-setup", element: <LazyWrapper component={InvoiceTemplateSetup} /> },

                  { path: "/app/parties", element: <LazyWrapper component={Parties} /> },
                  { path: "/app/parties/:id/statement", element: <LazyWrapper component={PartyStatement} /> },

                  { path: "/app/items", element: <LazyWrapper component={Items} /> },
                  { path: "/items", element: <LazyWrapper component={Items} /> },
                  { path: "/items/new", element: <LazyWrapper component={ItemCreate} /> },

                  { path: "/app/sales/invoice", element: <SalesInvoiceRoute /> },
                  { path: "/app/sales/invoice/view/:id", element: <LazyWrapper component={InvoiceReadOnlyView} /> },
                  { path: "/app/sales/invoice/view", element: <LazyWrapper component={InvoiceReadOnlyView} /> },
                  { path: "/app/sales/invoice/history", element: <LazyWrapper component={InvoiceHistory} /> },
                  { path: "/app/sales/proformas", element: <Navigate to="/app/sales/proformas/history" replace /> },
                  { path: "/app/sales/proformas/history", element: <LazyWrapper component={SalesProformasList} /> },
                  { path: "/app/sales/proformas/new", element: <LazyWrapper component={SalesProformaEditor} /> },
                  { path: "/app/sales/proformas/:id", element: <LazyWrapper component={SalesProformaEditor} /> },
                  { path: "/sales/proformas", element: <Navigate to="/app/sales/proformas/history" replace /> },
                  { path: "/sales/proformas/history", element: <LazyWrapper component={SalesProformasList} /> },
                  { path: "/sales/proformas/new", element: <LazyWrapper component={SalesProformaEditor} /> },
                  { path: "/sales/proformas/:id", element: <LazyWrapper component={SalesProformaEditor} /> },
                  { path: "/app/sales/payment-in", element: <LazyWrapper component={PaymentIn} /> },

                  { path: "/app/reports", element: <LazyWrapper component={Reports} /> },
                  { path: "/app/reports/customer-statement", element: <LazyWrapper component={PartyWiseStatement} /> },
                  { path: "/app/reports/party-wise-statement", element: <LazyWrapper component={PartyWiseStatement} /> },
                  { path: "/app/reports/aging-report", element: <LazyWrapper component={AgingReport} /> },

                  { path: "/app/settings", element: <LazyWrapper component={SettingsPage} /> },
                  { path: "/settings", element: <Navigate to="/app/settings" replace /> },
                  { path: "/app/company-settings", element: <LazyWrapper component={CompanySettings} /> },
                  { path: "/app/settings/users", element: <LazyWrapper component={TenantCompanyUsers} /> },

                  { path: "*", element: <LazyWrapper component={NotFound} /> }
                ]
              }
            ]
          }
        ]
      }
    ]
  },

  // ── Super Admin Portal (standalone layout)
  {
    element: <AuthGuard />,
    children: [
      {
        element: <LazyWrapper component={SuperAdminLayout} />,
        children: [
          { path: "/super-admin",           element: <LazyWrapper component={SuperAdminDashboard} /> },
          { path: "/super-admin/companies", element: <LazyWrapper component={SuperAdminCompanies} /> },
          { path: "/super-admin/requests",  element: <LazyWrapper component={SuperAdminRequests} /> },
          { path: "/super-admin/activity",  element: <LazyWrapper component={SuperAdminActivity} /> },
        ]
      }
    ]
  },

  { path: "*", element: <Navigate to="/login" replace /> }
];
