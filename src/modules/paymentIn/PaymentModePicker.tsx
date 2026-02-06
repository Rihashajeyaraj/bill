import React from "react";
import { Building2, CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";
import clsx from "clsx";
import type { PaymentMode } from "./countryConfig";

interface PaymentModePickerProps {
  options: PaymentMode[];
  value: PaymentMode;
  onChange: (next: PaymentMode) => void;
}

function iconFor(mode: PaymentMode) {
  if (mode === "Cash") return Wallet;
  if (mode === "Bank Transfer") return Landmark;
  if (mode === "Cheque") return Building2;
  if (mode === "Card") return CreditCard;
  return Smartphone;
}

export default function PaymentModePicker({ options, value, onChange }: PaymentModePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((mode) => {
        const Icon = iconFor(mode);
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={clsx(
              "rounded-2xl border px-3 py-3 text-left text-xs font-semibold transition sm:text-sm",
              active
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            <Icon className="mb-2 h-4 w-4" />
            {mode}
          </button>
        );
      })}
    </div>
  );
}
