import React from "react";
import { Cloud } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";

export default function BackupUtilities() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Backup & Utilities" subtitle="Nice empty states + placeholders" />
      <EmptyState icon={Cloud} title="Backup utilities" description="Add export/import JSON, device sync, and restore flows later." />
    </div>
  );
}
