import React, { useMemo, useState } from "react";
import { ArrowUpFromLine } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import DateInput from "../../components/DateInput";
import { partiesByType } from "../../services/parties.service";
import { paymentsCreate } from "../../services/payments.service";

export default function PaymentOut() {
  const suppliers = partiesByType("Supplier");
  const [partyId, setPartyId] = useState(suppliers[0]?.id || "");
  const party = useMemo(() => suppliers.find((x) => x.id === partyId) || null, [suppliers, partyId]);

  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState("Cash");
  const [date, setDate] = useState("");

  function save() {
    paymentsCreate({ direction: "OUT", partyId, partyName: party?.name || "", amount, mode, date });
    alert("Payment Out saved (localStorage).");
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="Purchase • Payment Out" subtitle="Record payments • mock storage" />
      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Supplier">
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Date">
            <DateInput
              value={date}
              onChange={(nextValue) => setDate(nextValue)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>

          <FormField label="Amount">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>

          <FormField label="Mode">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none"
            >
              <option>Cash</option>
              <option>Card</option>
              <option>Bank</option>
              <option>UPI</option>
            </select>
          </FormField>
        </div>

        <div className="mt-4">
          <GradientButton onClick={save}>
            <ArrowUpFromLine className="h-4 w-4" />
            Save Payment Out
          </GradientButton>
        </div>
      </Card>
    </div>
  );
}
