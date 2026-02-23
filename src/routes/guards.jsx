import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authGetOrganizationId, authGetRole, authGetToken } from "../services/auth.service";
import { companyIsCompleted } from "../services/company.service";
import { invoiceTemplateIsCompleted } from "../lib/templateStore";
import { isOwnerRole } from "../services/roles";

export function AuthGuard() {
  const loc = useLocation();
  const token = authGetToken();
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

export function SetupGuard() {
  const loc = useLocation();
  const role = authGetRole();
  const organizationId = authGetOrganizationId();
  const setupComplete = companyIsCompleted();
  const invoiceTemplateSelected = invoiceTemplateIsCompleted();

  if (isOwnerRole(role) && !organizationId && loc.pathname !== "/organization-select") {
    return <Navigate to="/organization-select" replace />;
  }

  if (isOwnerRole(role) && !setupComplete) {
    return <Navigate to="/company-setup" replace />;
  }

  if (isOwnerRole(role) && setupComplete && !invoiceTemplateSelected && loc.pathname !== "/invoice-template-setup") {
    return <Navigate to="/invoice-template-setup" replace />;
  }

  if (
    isOwnerRole(role) &&
    setupComplete &&
    invoiceTemplateSelected &&
    loc.pathname === "/app/company-setup"
  ) {
    return <Navigate to="/app/company-settings" replace />;
  }

  return <Outlet />;
}

export function InvoiceTemplateGuard() {
  const role = authGetRole();
  const setupComplete = companyIsCompleted();

  if (!isOwnerRole(role)) return <Outlet />;
  if (!setupComplete) return <Navigate to="/company-setup" replace />;

  return <Outlet />;
}

export function CompanySetupGuard() {
  const loc = useLocation();
  const role = authGetRole();
  const setupComplete = companyIsCompleted();
  const invoiceTemplateSelected = invoiceTemplateIsCompleted();
  const createMode = new URLSearchParams(loc.search).get("mode") === "create";

  if (!isOwnerRole(role)) return <Navigate to="/dashboard" replace />;
  if (createMode) return <Outlet />;
  if (setupComplete && !invoiceTemplateSelected) return <Navigate to="/invoice-template-setup" replace />;
  if (setupComplete && invoiceTemplateSelected) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
