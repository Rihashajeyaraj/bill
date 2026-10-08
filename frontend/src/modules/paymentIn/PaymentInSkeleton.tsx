import React from "react";

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-100 ${className}`} />;
}

export default function PaymentInSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Pulse className="h-28" />
        <Pulse className="h-28" />
        <Pulse className="h-28" />
      </div>
      <Pulse className="h-16" />
      <Pulse className="h-[380px]" />
    </div>
  );
}

