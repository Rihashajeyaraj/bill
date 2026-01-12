import React from "react";
import { Wallet } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";

export default function CashBank() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Cash & Bank" subtitle="UI skeleton" />
      <EmptyState
        icon={Wallet}
        title="Cash & Bank"
        description="Add bank accounts, cash in hand, transfers, and reconciliation later."
      />
    </div>
  );
}
