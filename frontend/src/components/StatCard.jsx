import React from "react";
import Card from "./Card";

export default function StatCard({ title, value, icon: Icon, hint }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium app-muted-text">{title}</p>
          <p className="mt-2 text-2xl font-semibold app-main-text">{value}</p>
          {hint ? <p className="mt-1 text-xs app-muted-text">{hint}</p> : null}
        </div>
        <div className="app-stat-icon h-10 w-10 rounded-2xl border flex items-center justify-center">
          {Icon ? <Icon className="h-5 w-5" /> : null}
        </div>
      </div>
    </Card>
  );
}
