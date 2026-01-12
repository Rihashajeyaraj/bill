import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authGetToken } from "../services/auth.service";
import { companyIsCompleted } from "../services/company.service";
import { invoiceTemplateIsCompleted } from "../lib/templateStore";

export function AuthGuard() {
  const loc = useLocation();
  const token = authGetToken();
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

export function SetupGuard() {
  const done = companyIsCompleted();
  if (!done) return <Navigate to="/company-setup" replace />;
  return <Outlet />;
}

export function InvoiceTemplateGuard() {
  const done = invoiceTemplateIsCompleted();
  if (!done) return <Navigate to="/invoice-template-setup" replace />;
  return <Outlet />;
}
