import React from "react";

import Modal from "./Modal";

export default function ActionStatusDialog({
  open,
  title,
  message,
  tone = "success",
  buttonLabel = "OK",
  onClose
}) {
  const buttonClassName =
    tone === "error"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : "bg-emerald-600 text-white hover:bg-emerald-700";

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${buttonClassName}`}
          >
            {buttonLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm text-slate-700">{message}</p>
    </Modal>
  );
}
