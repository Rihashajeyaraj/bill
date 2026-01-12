import React from "react";
import Card from "./Card";
import { UI } from "../theme/tokens";

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <Card className="p-8 text-center">
      <div
        className="mx-auto h-14 w-14 rounded-2xl border border-slate-100 flex items-center justify-center"
        style={{ background: UI.COLORS.cream }}
      >
        {Icon ? <Icon className="h-7 w-7" style={{ color: UI.COLORS.deepRed }} /> : null}
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </Card>
  );
}
