import React from "react";
import Card from "./Card";
import { UI } from "../theme/tokens";

export default function StatCard({ title, value, icon: Icon, hint }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <div
          className="h-10 w-10 rounded-2xl border border-slate-100 flex items-center justify-center"
          style={{ background: UI.COLORS.cream }}
        >
          {Icon ? <Icon className="h-5 w-5" style={{ color: UI.COLORS.deepRed }} /> : null}
        </div>
      </div>
    </Card>
  );
}
