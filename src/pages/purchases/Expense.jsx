import React, { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import {
  expenseCategoriesList,
  expenseCategoriesSyncFromRemote,
  expensesCreate,
  expensesList,
  expensesSyncFromRemote
} from "../../services/expenses.service";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";

function money(n) {
  return formatNumberByPreference(Number(n || 0), { maximumFractionDigits: 2 });
}

function formatDate(value) {
  return formatDateByPreference(value, String(value || "-"));
}

export default function Expense() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("Office");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [categories, setCategories] = useState(() => expenseCategoriesList());
  const [historyRows, setHistoryRows] = useState(() => expensesList());

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoadingHistory(true);
      try {
        const [nextHistory, nextCategories] = await Promise.all([
          expensesSyncFromRemote(),
          expenseCategoriesSyncFromRemote()
        ]);
        if (!mounted) return;
        setHistoryRows(Array.isArray(nextHistory) ? nextHistory : expensesList());
        setCategories(Array.isArray(nextCategories) ? nextCategories : expenseCategoriesList());
      } catch {
        if (!mounted) return;
        setHistoryRows(expensesList());
        setCategories(expenseCategoriesList());
      } finally {
        if (mounted) setLoadingHistory(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const historyTotal = useMemo(
    () => historyRows.reduce((sum, entry) => sum + Number(entry?.totalAmount || entry?.amount || 0), 0),
    [historyRows]
  );

  async function save() {
    const cleanCategory = String(category || "").trim();
    const numericAmount = Number(amount || 0);
    if (!cleanCategory) {
      alert("Category is required.");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      alert("Enter a valid amount.");
      return;
    }

    setSaving(true);
    try {
      const updated = await expensesCreate({
        date,
        category: cleanCategory,
        amount: numericAmount,
        note
      });
      setHistoryRows(Array.isArray(updated) ? updated : expensesList());
      try {
        const nextCategories = await expenseCategoriesSyncFromRemote();
        setCategories(Array.isArray(nextCategories) ? nextCategories : expenseCategoriesList());
      } catch {
        setCategories(expenseCategoriesList());
      }
      setAmount("");
      setNote("");
      alert("Expense saved successfully.");
    } catch (error) {
      alert(error?.message || "Failed to save expense.");
    } finally {
      setSaving(false);
    }
  }

  function useHistoryEntry(row) {
    setDate(row?.date || new Date().toISOString().slice(0, 10));
    setCategory(row?.category || "");
    setAmount(String(Number(row?.amount || 0)));
    setNote(row?.note || "");
  }

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Purchase - Expense" subtitle="Expense entry and history" />
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Date">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>

          <FormField label="Category">
            <input
              list="expense-category-options"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              onBlur={(event) => setCategory(String(event.target.value || "").trim())}
              placeholder="Search or type category"
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
            <datalist id="expense-category-options">
              {categories.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </FormField>

          <FormField label="Amount">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>

          <FormField label="Note">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <GradientButton onClick={save} disabled={saving}>
            <Wallet className="h-4 w-4" />
            {saving ? "Saving..." : "Save Expense"}
          </GradientButton>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Expense History</h2>
            <p className="text-xs text-slate-500">Auto refreshes after every expense entry.</p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {historyRows.length} entries | Total {money(historyTotal)}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[860px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Category</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold">Note</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingHistory ? (
                <tr className="border-t border-slate-100">
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    Loading expense history...
                  </td>
                </tr>
              ) : historyRows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    No expenses saved yet.
                  </td>
                </tr>
              ) : (
                historyRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 text-slate-700">{formatDate(row?.date)}</td>
                    <td className="px-3 py-3 font-medium text-slate-900">{row?.category || "-"}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-900">{money(row?.amount)}</td>
                    <td className="px-3 py-3 text-slate-600">{row?.note || "-"}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => useHistoryEntry(row)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
