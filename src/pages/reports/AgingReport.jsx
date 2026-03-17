import React from "react";
import { Navigate } from "react-router-dom";

export default function AgingReport() {
  return <Navigate to="/app/reports?report=aging-report" replace />;
}
