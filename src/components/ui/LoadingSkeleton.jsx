import React from "react";

export default function LoadingSkeleton({ className = "h-4 w-full rounded-lg" }) {
  return <div className={`skeleton ${className}`} />;
}
