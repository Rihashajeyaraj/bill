import React from "react";
import Modal from "./Modal";

const UNITS = ["pcs", "box", "kg", "g", "ltr", "ml", "sqft", "sqm", "set", "hour", "day", "month"];

export default function UnitPickerModal({ open, value, onClose, onSelect }) {
  return (
    <Modal
      open={open}
      title="Select Unit"
      onClose={onClose}
      footer={null}
    >
      <div className="grid grid-cols-2 gap-2">
        {UNITS.map((unit) => (
          <button
            key={unit}
            type="button"
            onClick={() => {
              onSelect?.(unit);
              onClose?.();
            }}
            className={`rounded-2xl border px-3 py-2 text-sm font-semibold ${
              value === unit ? "border-slate-400 bg-slate-50" : "border-slate-100 hover:bg-slate-50"
            }`}
          >
            {unit}
          </button>
        ))}
      </div>
    </Modal>
  );
}
