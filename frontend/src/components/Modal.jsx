import React, { useEffect } from "react";
import { X } from "lucide-react";
import Card from "./Card";

export default function Modal({ open, isOpen, title, onClose, children, footer, size }) {
  const activeOpen = Boolean(open ?? isOpen);

  useEffect(() => {
    function onEsc(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (activeOpen) window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [activeOpen, onClose]);

  useEffect(() => {
    if (!activeOpen) return;
    const scrollY = window.scrollY;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [activeOpen]);

  if (!activeOpen) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 app-modal-backdrop" onClick={onClose} />
      <div className="absolute inset-0 flex items-end justify-center p-0 sm:items-center sm:px-4 sm:py-6">
        <Card className="flex max-h-[100svh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl sm:max-h-[88vh] sm:rounded-3xl">
          <div className="flex items-center justify-between border-b px-5 py-4 app-modal-divider sm:px-6">
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
          <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">{children}</div>
          {footer ? <div className="border-t px-5 py-4 app-modal-footer sm:px-6 sm:py-5">{footer}</div> : null}
        </Card>
      </div>
    </div>
  );
}
