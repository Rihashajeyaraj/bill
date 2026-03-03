import React from "react";
import { Navigate } from "react-router-dom";
import { AppRouteAccessGuard, AuthGuard, CompanySetupGuard, InvoiceTemplateGuard, SetupGuard } from "./guards";

import AppLayout from "../layouts/AppLayout";
import Login from "../pages/Login";
import CompanySetup from "../pages/CompanySetup";
import OrganizationSelect from "../pages/OrganizationSelect";
import InvoiceTemplateSetup from "../pages/InvoiceTemplateSetup";
import Dashboard from "../pages/Dashboard";
import Parties from "../pages/Parties";
import PartyStatement from "../pages/PartyStatement";
import Items from "../pages/Items";
import ItemCreate from "../pages/ItemCreate";

import InvoiceCreate from "../pages/sales/InvoiceCreate";
import InvoiceHistory from "../pages/sales/InvoiceHistory";
import SalesProformasList from "../pages/sales/SalesProformasList";
import SalesProformaEditor from "../pages/sales/SalesProformaEditor";
import CreditNote from "../pages/sales/CreditNotePremium";
import PaymentIn from "../pages/sales/PaymentInPremium";

import PurchaseBill from "../pages/purchases/PurchaseBill";
import PurchaseHistory from "../pages/purchases/PurchaseHistory";
import PurchaseProformasList from "../pages/purchases/PurchaseProformasList";
import PurchaseProformaEditor from "../pages/purchases/PurchaseProformaEditor";
import DebitNote from "../pages/purchases/DebitNotePremium";
import PaymentOutPremium from "../pages/purchases/PaymentOutPremium";
import Expense from "../pages/purchases/Expense";

import Reports from "../pages/Reports";
import Notifications from "../pages/Notifications";
import CompanySettings from "../pages/CompanySettings";
import NotFound from "../pages/NotFound";

export const routes = [
  { path: "/login", element: <Login /> },

  {
    element: <AuthGuard />,
    children: [
      { path: "/organization-select", element: <OrganizationSelect /> },
      {
        element: <InvoiceTemplateGuard />,
        children: [{ path: "/invoice-template-setup", element: <InvoiceTemplateSetup /> }]
      },
      {
        element: <CompanySetupGuard />,
        children: [{ path: "/company-setup", element: <CompanySetup /> }]
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
                  {
                    path: "/dashboard",
                    element: <Dashboard />
                  },
                  { path: "/app/dashboard", element: <Dashboard /> },
                  { path: "/app/company-setup", element: <Navigate to="/company-setup" replace /> },
                  {
                    path: "/app/invoice-template-setup",
                    element: <Navigate to="/invoice-template-setup" replace />
                  },

                  { path: "/app/parties", element: <Parties /> },
                  { path: "/app/parties/:id/statement", element: <PartyStatement /> },

                  { path: "/app/items", element: <Items /> },
                  { path: "/items", element: <Navigate to="/app/items" replace /> },
                  { path: "/items/new", element: <ItemCreate /> },

                  { path: "/app/sales/invoice", element: <InvoiceCreate /> },
                  { path: "/app/sales/invoice/history", element: <InvoiceHistory /> },
                  { path: "/app/sales/proformas", element: <SalesProformasList /> },
                  { path: "/app/sales/proformas/new", element: <SalesProformaEditor /> },
                  { path: "/app/sales/proformas/:id", element: <SalesProformaEditor /> },
                  { path: "/sales/proformas", element: <Navigate to="/app/sales/proformas" replace /> },
                  { path: "/sales/proformas/new", element: <Navigate to="/app/sales/proformas/new" replace /> },
                  { path: "/sales/proformas/:id", element: <SalesProformaEditor /> },
                  { path: "/app/sales/credit-note", element: <CreditNote /> },
                  { path: "/app/sales/payment-in", element: <PaymentIn /> },

                  { path: "/app/purchase/bill", element: <PurchaseBill /> },
                  { path: "/app/purchase/history", element: <PurchaseHistory /> },
                  { path: "/app/purchase/proformas", element: <PurchaseProformasList /> },
                  { path: "/app/purchase/proformas/new", element: <PurchaseProformaEditor /> },
                  { path: "/app/purchase/proformas/:id", element: <PurchaseProformaEditor /> },
                  { path: "/purchase/proformas", element: <Navigate to="/app/purchase/proformas" replace /> },
                  { path: "/purchase/proformas/new", element: <Navigate to="/app/purchase/proformas/new" replace /> },
                  { path: "/purchase/proformas/:id", element: <PurchaseProformaEditor /> },
                  { path: "/app/purchase/debit-note", element: <DebitNote /> },
                  { path: "/app/purchases/payment-out", element: <PaymentOutPremium /> },
                  { path: "/app/purchase/payment-out", element: <Navigate to="/app/purchases/payment-out" replace /> },
                  { path: "/app/purchase/expense", element: <Expense /> },

                  { path: "/app/cash-bank", element: <Navigate to="/dashboard" replace /> },
                  { path: "/app/reports", element: <Reports /> },
                  { path: "/app/notifications", element: <Notifications /> },
                  { path: "/app/company-settings", element: <CompanySettings /> },
                  { path: "/app/backup", element: <Navigate to="/dashboard" replace /> },
                  { path: "/app/help", element: <Navigate to="/dashboard" replace /> },

                  { path: "*", element: <NotFound /> }
                ]
              }
            ]
          }
        ]
      }
    ]
  },

  { path: "*", element: <Navigate to="/login" replace /> }
];
