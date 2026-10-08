import React from "react";
import Card from "./Card";

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <Card className="p-8 text-center">
      <div className="app-empty-state-icon mx-auto h-14 w-14 rounded-2xl border flex items-center justify-center">
        {Icon ? <Icon className="h-7 w-7" /> : null}
      </div>
      <h3 className="mt-4 text-base font-semibold app-main-text">{title}</h3>
      {description ? <p className="mt-1 text-sm app-muted-text">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </Card>
  );
}
