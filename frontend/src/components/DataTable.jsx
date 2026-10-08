import React from "react";
import Card from "./Card";

export default function DataTable({ columns, rows, emptyText = "No data", allowOverflow = false }) {
  return (
    <Card className={allowOverflow ? "overflow-visible" : "overflow-hidden"}>
      <div
        className={allowOverflow ? "overflow-x-auto overflow-y-visible rounded-2xl" : "overflow-x-auto rounded-2xl"}
        data-table-scroll="true"
      >
        <table className="app-table w-full text-left text-sm sm:min-w-[640px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="font-semibold sm:whitespace-nowrap">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.id || idx}>
                  {columns.map((c) => (
                    <td key={c.key} className="align-top sm:whitespace-nowrap">
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
