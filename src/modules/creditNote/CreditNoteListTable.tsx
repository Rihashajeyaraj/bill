import React, { useEffect, useState } from "react";
import { Download, Eye, FilePenLine, MoreHorizontal, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import type { CreditNoteRecord } from "./store";

interface CreditNoteListTableProps {
  notes: CreditNoteRecord[];
  page: number;
  pageSize: number;
  onPageChange: (next: number) => void;
  onView: (noteId: string) => void;
  onEdit: (noteId: string) => void;
  onDelete: (noteId: string) => void;
  onDownloadPdf: (noteId: string) => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

function statusClass(status: CreditNoteRecord["status"]) {
  if (status === "Applied") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "Issued") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function CreditNoteListTable({
  notes,
  page,
  pageSize,
  onPageChange,
  onView,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
  onDownloadPdf
}: CreditNoteListTableProps) {
  const [actionMenu, setActionMenu] = useState<{
    noteId: string;
    top: number;
    left: number;
    canEdit: boolean;
    canDelete: boolean;
  } | null>(null);

  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-credit-note-actions-root='true']")) return;
      if (target?.closest?.("[data-credit-note-actions-menu='true']")) return;
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
        <table className="w-full min-w-[1080px] table-fixed text-left text-sm">
          <colgroup>
            <col style={{ width: "14%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="px-4 py-3 align-middle font-semibold text-slate-700">Credit Note No</th>
              <th className="px-4 py-3 align-middle font-semibold text-slate-700">Date</th>
              <th className="px-4 py-3 align-middle font-semibold text-slate-700">Customer Name</th>
              <th className="px-4 py-3 align-middle font-semibold text-slate-700">Linked Invoice</th>
              <th className="px-4 py-3 align-middle font-semibold text-slate-700">Reason</th>
              <th className="px-4 py-3 align-middle text-right font-semibold text-slate-700">Credit Amount</th>
              <th className="px-4 py-3 align-middle font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 align-middle font-semibold text-slate-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((note) => (
                <tr key={note.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3 align-middle font-semibold text-slate-900">{note.creditNoteNo}</td>
                  <td className="px-4 py-3 align-middle text-slate-700">{note.creditNoteDate}</td>
                  <td className="px-4 py-3 align-middle text-slate-700">{note.customerName}</td>
                  <td className="px-4 py-3 align-middle text-slate-700">{note.linkedInvoiceNo}</td>
                  <td className="px-4 py-3 align-middle text-slate-700">{note.reason}</td>
                  <td className="px-4 py-3 align-middle text-right font-semibold text-slate-900">
                    {note.currency} {note.totals.total.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(note.status)}`}>
                      {note.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="relative inline-flex" data-credit-note-actions-root="true">
                      <button
                        type="button"
                        onClick={(event) => {
                          const triggerRect = event.currentTarget.getBoundingClientRect();
                          const menuWidth = 144;
                          const menuHeight = 168;
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
                                  canEdit: canEdit && note.status !== "Applied",
                                  canDelete: canDelete && note.status !== "Applied"
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
                  No credit notes found for the selected filters.
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
              data-credit-note-actions-menu="true"
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
              <button
                type="button"
                onClick={() => {
                  const noteId = actionMenu.noteId;
                  setActionMenu(null);
                  onDelete(noteId);
                }}
                disabled={!actionMenu.canDelete}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
