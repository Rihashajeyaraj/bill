import React from "react";
import Card from "./Card";

export default function DataTable({ columns, rows, emptyText = "No data" }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={columns.length}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.id || idx} className="border-t border-slate-100 hover:bg-slate-50/60">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {typeof c.render === "function" ? c.render(r) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
