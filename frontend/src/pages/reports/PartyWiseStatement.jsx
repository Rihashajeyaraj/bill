import React from "react";
import { Navigate } from "react-router-dom";

export default function PartyWiseStatement() {
  return <Navigate to="/app/reports?report=party-statement" replace />;
}
