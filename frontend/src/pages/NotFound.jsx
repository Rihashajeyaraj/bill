import React from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import Card from "../components/Card";

export default function NotFound() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Page not found" subtitle="Route does not exist" />
      <Card className="p-6">
        <p className="text-sm text-slate-600">Go back to dashboard.</p>
        <Link
          to="/dashboard"
          className="inline-flex mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Dashboard
        </Link>
      </Card>
    </div>
  );
}
