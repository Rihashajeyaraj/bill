import React, { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import { partiesByType } from "../../services/parties.service";
import { purchasesCreate } from "../../services/purchases.service";

export default function PurchaseBill() {
  const suppliers = partiesByType("Supplier");
  const [partyId, setPartyId] = useState(suppliers[0]?.id || "");
  const party = useMemo(() => suppliers.find((x) => x.id === partyId) || null, [suppliers, partyId]);

  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(0);

  function save() {
    purchasesCreate({ partyId, partyName: party?.name || "", billDate, totals: { grandTotal: amount } });
    alert("Purchase Bill saved (localStorage).");
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="Purchase • Purchase Bill" subtitle="UI skeleton + minimal save (mock)" />
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
          <FormField label="Bill Date">
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>
          <FormField label="Grand Total (mock)">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <GradientButton onClick={save}>
            <FileText className="h-4 w-4" />
            Save Purchase Bill
          </GradientButton>
        </div>
      </Card>
    </div>
  );
}
