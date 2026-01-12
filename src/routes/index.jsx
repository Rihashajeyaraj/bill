import React from "react";
import { Navigate } from "react-router-dom";
import { AuthGuard, SetupGuard, InvoiceTemplateGuard } from "./guards";

import AppLayout from "../layouts/AppLayout";
import Login from "../pages/Login";
import CompanySetup from "../pages/CompanySetup";
import InvoiceTemplateSetup from "../pages/InvoiceTemplateSetup";
import Dashboard from "../pages/Dashboard";
import Parties from "../pages/Parties";
import PartyStatement from "../pages/PartyStatement";
import Items from "../pages/Items";
import ItemCreate from "../pages/ItemCreate";

import InvoiceCreate from "../pages/sales/InvoiceCreate";
import CreditNote from "../pages/sales/CreditNote";
import PaymentIn from "../pages/sales/PaymentIn";

import PurchaseBill from "../pages/purchases/PurchaseBill";
import DebitNote from "../pages/purchases/DebitNote";
import PaymentOut from "../pages/purchases/PaymentOut";
import Expense from "../pages/purchases/Expense";

import CashBank from "../pages/CashBank";
import Reports from "../pages/Reports";
import CompanySettings from "../pages/CompanySettings";
import BackupUtilities from "../pages/BackupUtilities";
import HelpSupport from "../pages/HelpSupport";
import NotFound from "../pages/NotFound";

export const routes = [
  { path: "/login", element: <Login /> },

  {
    element: <AuthGuard />,
    children: [{ path: "/company-setup", element: <CompanySetup /> }]
  },

  {
    element: <AuthGuard />,
    children: [
      {
        element: <SetupGuard />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: "/", element: <Navigate to="/dashboard" replace /> },
              {
                element: <InvoiceTemplateGuard />,
                children: [
                  { path: "/dashboard", element: <Dashboard /> },
                  { path: "/app/dashboard", element: <Dashboard /> }
                ]
              },
              { path: "/app/company-setup", element: <CompanySetup /> },
              { path: "/invoice-template-setup", element: <InvoiceTemplateSetup /> },

              { path: "/app/parties", element: <Parties /> },
              { path: "/app/parties/:id/statement", element: <PartyStatement /> },

              { path: "/items", element: <Items /> },
              { path: "/items/new", element: <ItemCreate /> },
              { path: "/app/items", element: <Navigate to="/items" replace /> },

              { path: "/app/sales/invoice", element: <InvoiceCreate /> },
              { path: "/app/sales/credit-note", element: <CreditNote /> },
              { path: "/app/sales/payment-in", element: <PaymentIn /> },

              { path: "/app/purchase/bill", element: <PurchaseBill /> },
              { path: "/app/purchase/debit-note", element: <DebitNote /> },
              { path: "/app/purchase/payment-out", element: <PaymentOut /> },
              { path: "/app/purchase/expense", element: <Expense /> },

              { path: "/app/cash-bank", element: <CashBank /> },
              { path: "/app/reports", element: <Reports /> },
              { path: "/app/company-settings", element: <CompanySettings /> },
              { path: "/app/backup", element: <BackupUtilities /> },
              { path: "/app/help", element: <HelpSupport /> },

              { path: "*", element: <NotFound /> }
            ]
          }
        ]
      }
    ]
  },

  { path: "*", element: <Navigate to="/login" replace /> }
];
