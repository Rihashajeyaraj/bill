import React, { useState } from "react";
import { Wallet } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import { expensesCreate } from "../../services/expenses.service";

export default function Expense() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("Office");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  async function save() {
    try {
      await expensesCreate({ date, category, amount, note });
      alert("Expense saved successfully.");
    } catch (error) {
      alert(error?.message || "Failed to save expense.");
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="Purchase • Expense" subtitle="Expense entry • mock storage" />
      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>

          <FormField label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none"
            >
              <option>Office</option>
              <option>Travel</option>
              <option>Utilities</option>
              <option>Marketing</option>
              <option>Maintenance</option>
            </select>
          </FormField>

          <FormField label="Amount">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>

          <FormField label="Note">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <GradientButton onClick={save}>
            <Wallet className="h-4 w-4" />
            Save Expense
          </GradientButton>
        </div>
      </Card>
    </div>
  );
}
