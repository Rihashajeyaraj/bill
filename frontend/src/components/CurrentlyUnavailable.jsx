import React from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ArrowLeft, Sparkles } from "lucide-react";
import PageHeader from "./PageHeader";
import Card from "./Card";

export default function CurrentlyUnavailable({ moduleName = "This module" }) {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto py-6">
      <PageHeader
        title={moduleName !== "This module" ? `${moduleName} — Currently Unavailable` : "Module Unavailable"}
        subtitle="Feature reserved for upcoming V2 release"
      />
      
      <Card className="mt-4 p-8 sm:p-12 text-center flex flex-col items-center justify-center border border-slate-200/80 shadow-sm rounded-3xl bg-white">
        <div className="h-16 w-16 rounded-full bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-600 mb-6 shadow-sm">
          <Lock className="h-8 w-8" />
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 mb-4">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span>V1 Product Scope</span>
        </div>

        <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-3">
          Currently Unavailable
        </h2>

        <p className="text-slate-600 max-w-md text-sm leading-relaxed mb-8">
          This module is not available in the current version of <strong className="text-slate-800">Twite Billing V1</strong>.
          We are working on bringing this feature in a future release.
        </p>

        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 active:scale-[0.98] transition-all shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Go Back</span>
        </button>
      </Card>
    </div>
  );
}
