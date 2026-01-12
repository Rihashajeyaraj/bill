import React from "react";
import { BadgePercent } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import EmptyState from "../../components/EmptyState";

export default function DebitNote() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Purchase • Debit Note" subtitle="UI skeleton (adjustment logic later)" />
      <EmptyState
        icon={BadgePercent}
        title="Debit Note UI"
        description="Add supplier selection, reference purchase, adjustment items, and totals preview."
      />
    </div>
  );
}
