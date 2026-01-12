import React from "react";
import { BadgePercent } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";

export default function CreditNote() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Sales • Credit Note" subtitle="UI skeleton (adjustments logic later)" />
      <EmptyState
        icon={BadgePercent}
        title="Credit Note UI"
        description="Add reference invoice selector, return items, tax adjustments, and preview panel."
      />
    </div>
  );
}
