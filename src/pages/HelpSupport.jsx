import React from "react";
import { LifeBuoy } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";

export default function HelpSupport() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Help & Support" subtitle="Placeholders for docs, FAQs, contact" />
      <EmptyState icon={LifeBuoy} title="Support center" description="Add FAQs, tutorials, and contact ticket UI later." />
    </div>
  );
}
