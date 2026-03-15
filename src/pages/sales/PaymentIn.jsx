import React, { useMemo, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import DateInput from "../../components/DateInput";
import { partiesByType } from "../../services/parties.service";
import { paymentsCreate } from "../../services/payments.service";

export default function PaymentIn() {
  const customers = partiesByType("Customer");
  const [partyId, setPartyId] = useState(customers[0]?.id || "");
  const party = useMemo(() => customers.find((x) => x.id === partyId) || null, [customers, partyId]);

  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState("Cash");
  const [date, setDate] = useState("");

  function save() {
    paymentsCreate({ direction: "IN", partyId, partyName: party?.name || "", amount, mode, date });
    alert("Payment In saved (localStorage).");
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="Sales • Payment In" subtitle="Record payments (partial/full) • mock storage" />
      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Customer">
            <select
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
            <ArrowDownToLine className="h-4 w-4" />
            Save Payment In
          </GradientButton>
        </div>
      </Card>
    </div>
  );
}
