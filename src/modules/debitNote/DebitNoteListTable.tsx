import React, { useEffect, useState } from "react";
import { Download, Eye, FilePenLine, MoreHorizontal } from "lucide-react";
import { createPortal } from "react-dom";
import type { DebitNoteRecord } from "./store";

interface DebitNoteListTableProps {
  notes: DebitNoteRecord[];
  page: number;
  pageSize: number;
  onPageChange: (next: number) => void;
  onView: (noteId: string) => void;
  onEdit: (noteId: string) => void;
  onDownloadPdf: (noteId: string) => void;
}

function statusClass(status: DebitNoteRecord["status"]) {
  if (status === "Applied") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "Issued") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function DebitNoteListTable({
  notes,
  page,
  pageSize,
  onPageChange,
  onView,
  onEdit,
  onDownloadPdf
}: DebitNoteListTableProps) {
  const [actionMenu, setActionMenu] = useState<{
    noteId: string;
    top: number;
    left: number;
    canEdit: boolean;
  } | null>(null);

  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-debit-note-actions-root='true']")) return;
      if (target?.closest?.("[data-debit-note-actions-menu='true']")) return;
      setActionMenu(null);
    }
    window.addEventListener("pointerdown", handleClickOutside);
    return () => window.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  useEffect(() => {
    function closeMenu() {
      setActionMenu(null);
    }
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(notes.length / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const rows = notes.slice(start, start + pageSize);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="px-4 py-3 font-semibold text-slate-700">Debit Note No</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Date</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Supplier / Vendor</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Linked Purchase Invoice</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Reason</th>
              <th className="px-4 py-3 font-semibold text-slate-700 text-right">Debit Amount</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 font-semibold text-slate-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((note) => (
                <tr key={note.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-semibold text-slate-900">{note.debitNoteNo}</td>
                  <td className="px-4 py-3 text-slate-700">{note.debitNoteDate}</td>
                  <td className="px-4 py-3 text-slate-700">{note.supplierName}</td>
                  <td className="px-4 py-3 text-slate-700">{note.linkedPurchaseInvoiceNo}</td>
                  <td className="px-4 py-3 text-slate-700">{note.reason}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {note.currency} {note.totals.total.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(note.status)}`}>
                      {note.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative inline-flex" data-debit-note-actions-root="true">
                      <button
                        type="button"
                        onClick={(event) => {
                          const triggerRect = event.currentTarget.getBoundingClientRect();
                          const menuWidth = 144;
                          const menuHeight = 132;
                          const left = Math.min(
                            window.innerWidth - menuWidth - 8,
                            Math.max(8, triggerRect.right - menuWidth)
                          );
                          const preferredTop = triggerRect.bottom + 4;
                          const top =
                            preferredTop + menuHeight > window.innerHeight - 8
                              ? Math.max(8, triggerRect.top - menuHeight - 8)
                              : preferredTop;
                          setActionMenu((current) =>
                            current?.noteId === note.id
                              ? null
                              : {
                                  noteId: note.id,
                                  top,
                                  left,
                                  canEdit: note.status !== "Applied"
                                }
                          );
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        aria-label="Open actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-4 py-20 text-center text-slate-500">
                  No debit notes found for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500">
          Showing {rows.length ? start + 1 : 0}-{start + rows.length} of {notes.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-xs font-semibold text-slate-600">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {actionMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              data-debit-note-actions-menu="true"
              className="fixed z-[140] w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
              style={{ top: actionMenu.top, left: actionMenu.left }}
            >
              <button
                type="button"
                onClick={() => {
                  const noteId = actionMenu.noteId;
                  setActionMenu(null);
                  onView(noteId);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Eye className="h-3.5 w-3.5" />
                View
              </button>
              <button
                type="button"
                onClick={() => {
                  const noteId = actionMenu.noteId;
                  setActionMenu(null);
                  onEdit(noteId);
                }}
                disabled={!actionMenu.canEdit}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FilePenLine className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  const noteId = actionMenu.noteId;
                  setActionMenu(null);
                  onDownloadPdf(noteId);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
