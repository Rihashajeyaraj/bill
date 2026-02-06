import React from "react";
import { X } from "lucide-react";
import type { PaymentInRecord } from "./store";

interface AuditDrawerProps {
  open: boolean;
  record: PaymentInRecord | null;
  onClose: () => void;
}

export default function AuditDrawer({ open, record, onClose }: AuditDrawerProps) {
  return (
    <div className={`fixed inset-0 z-50 transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-slate-900/30 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-md transform bg-white shadow-xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Audit Timeline</p>
            <p className="text-xs text-slate-500">{record?.receiptNo || "No receipt selected"}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="h-[calc(100%-58px)] overflow-auto p-4">
          {record ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p>Created by <span className="font-semibold text-slate-800">{record.audit.createdBy}</span></p>
                <p className="mt-1">At {record.audit.createdAt}</p>
              </div>
              {record.history.map((entry, index) => (
                <div key={`${entry.at}_${index}`} className="relative pl-5">
                  <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-slate-700" />
                  {index < record.history.length - 1 ? <span className="absolute left-[4px] top-4 h-[calc(100%+8px)] w-px bg-slate-200" /> : null}
                  <p className="text-sm font-semibold text-slate-900">{entry.status}</p>
                  <p className="text-xs text-slate-500">{entry.note}</p>
                  <p className="text-[11px] text-slate-400">{entry.at} | {entry.by}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No audit data available.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
