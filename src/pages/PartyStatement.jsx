import React from "react";
import { useParams, Link } from "react-router-dom";
import { FileText } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { partyGet } from "../services/parties.service";

export default function PartyStatement() {
  const { id } = useParams();
  const party = partyGet(id);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Statement"
        subtitle={party ? `${party.name} • UI skeleton` : "Party not found"}
        right={
          <Link
            to="/app/parties"
            className="rounded-2xl border border-slate-100 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            Back
          </Link>
        }
      />

      <EmptyState
        icon={FileText}
        title="Statement UI coming soon"
        description="Here you will show date filters, opening balance, transactions table, and export actions."
      />
    </div>
  );
}
