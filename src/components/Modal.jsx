import React, { useEffect } from "react";
import { X } from "lucide-react";
import Card from "./Card";

export default function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    function onEsc(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (open) window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 app-modal-backdrop" onClick={onClose} />
      <div className="absolute inset-0 flex items-end justify-center p-3 sm:items-center sm:p-4">
        <Card className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden sm:max-h-[88vh]">
          <div className="flex items-center justify-between border-b px-4 py-3 app-modal-divider sm:px-5 sm:py-4">
            <div>
              <h3 className="text-base font-semibold app-main-text">{title}</h3>
              <div className="h-1 w-20 rounded-full mt-2 app-modal-accent" />
            </div>
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-xl border app-modal-close flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">{children}</div>
          {footer ? <div className="border-t px-4 py-3 app-modal-footer sm:px-5 sm:py-4">{footer}</div> : null}
        </Card>
      </div>
    </div>
  );
}
