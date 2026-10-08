import React from "react";
import { authGetRole } from "../services/auth.service";
import { isAccounterRole, isStaffRole } from "../services/roles";
import OwnerDashboard from "./OwnerDashboard";
import AccounterDashboard from "./AccounterDashboard";
import StaffDashboard from "./StaffDashboard";

export default function Dashboard() {
  const role = authGetRole();

  if (isStaffRole(role)) return <StaffDashboard />;
  if (isAccounterRole(role)) return <AccounterDashboard />;
  return <OwnerDashboard />;
}
