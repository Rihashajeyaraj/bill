import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authGetRole, authGetToken } from "../services/auth.service";
import { companyIsCompleted } from "../services/company.service";
import { invoiceTemplateIsCompleted } from "../lib/templateStore";
import { canAccessSettings } from "../services/roles";
import { canAccessPathForRole } from "../services/accessControl";
import { useOrganization } from "../context/OrganizationContext";

export function AuthGuard() {
  const loc = useLocation();
  const token = authGetToken();
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

export function SetupGuard() {
  const loc = useLocation();
  const role = authGetRole();
  const { organizationId } = useOrganization();
  const setupComplete = companyIsCompleted();
  const invoiceTemplateSelected = invoiceTemplateIsCompleted();

  if (!organizationId && loc.pathname !== "/organization-select") {
    return <Navigate to="/organization-select" replace />;
  }

  if (canAccessSettings(role) && !setupComplete) {
    return <Navigate to="/company-setup" replace />;
  }

  if (
    canAccessSettings(role) &&
    setupComplete &&
    !invoiceTemplateSelected &&
    loc.pathname !== "/invoice-template-setup"
  ) {
    return <Navigate to="/invoice-template-setup" replace />;
  }

  if (
    canAccessSettings(role) &&
    setupComplete &&
    invoiceTemplateSelected &&
    loc.pathname === "/app/company-setup"
  ) {
    return <Navigate to="/app/company-settings" replace />;
  }

  return <Outlet />;
}

export function AppRouteAccessGuard() {
  const { organizationId } = useOrganization();
  const role = authGetRole();
  const loc = useLocation();
  void organizationId;

  if (!canAccessPathForRole(role, loc.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

export function InvoiceTemplateGuard() {
  const { organizationId } = useOrganization();
  const role = authGetRole();
  const setupComplete = companyIsCompleted();

  if (!organizationId) return <Navigate to="/organization-select" replace />;
  if (!canAccessSettings(role)) return <Navigate to="/dashboard" replace />;
  if (!setupComplete) return <Navigate to="/company-setup" replace />;

  return <Outlet />;
}

export function CompanySetupGuard() {
  const loc = useLocation();
  const { organizationId } = useOrganization();
  const role = authGetRole();
  const setupComplete = companyIsCompleted();
  const invoiceTemplateSelected = invoiceTemplateIsCompleted();
  const createMode = new URLSearchParams(loc.search).get("mode") === "create";

  if (!canAccessSettings(role)) return <Navigate to="/dashboard" replace />;
  if (createMode) return <Outlet />;
  if (!organizationId) return <Navigate to="/organization-select" replace />;
  if (setupComplete && !invoiceTemplateSelected) return <Navigate to="/invoice-template-setup" replace />;
  if (setupComplete && invoiceTemplateSelected) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
