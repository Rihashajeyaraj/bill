import React, { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Card from "../../components/Card";
import FormField from "../../components/FormField";
import GradientButton from "../../components/GradientButton";
import DateInput from "../../components/DateInput";
import { useFinancialYears } from "../../context/FinancialYearContext";
import {
  expenseCategoriesList,
  expenseCategoriesSyncFromRemote,
  expensesCreate,
  expensesList,
  expensesSyncFromRemote
} from "../../services/expenses.service";
import { formatDateByPreference, formatNumberByPreference } from "../../lib/formatPreferences";
import { sortHistoryRowsByDate } from "../../lib/historySort";

function money(n) {
  return formatNumberByPreference(Number(n || 0), { maximumFractionDigits: 2 });
}

function formatDate(value) {
  return formatDateByPreference(value, String(value || "-"));
}

export default function Expense() {
  const { activeRange, selectedYear } = useFinancialYears();
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("Office");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [note, setNote] = useState("");
  const [categoryOptions, setCategoryOptions] = useState(() => expenseCategoriesList());
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyRows, setHistoryRows] = useState(() => expensesList(activeRange));
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoadingHistory(true);
      try {
        const [nextCategories, nextHistory] = await Promise.all([
          expenseCategoriesSyncFromRemote().catch(() => expenseCategoriesList()),
          expensesSyncFromRemote(activeRange)
        ]);
        if (!mounted) return;
        setCategoryOptions(Array.isArray(nextCategories) ? nextCategories : expenseCategoriesList());
        setHistoryRows(Array.isArray(nextHistory) ? nextHistory : expensesList(activeRange));
      } catch {
        if (!mounted) return;
        setCategoryOptions(expenseCategoriesList());
        setHistoryRows(expensesList(activeRange));
      } finally {
        if (mounted) setLoadingHistory(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [activeRange?.fromDate, activeRange?.toDate]);

  const historyTotal = useMemo(
    () => historyRows.reduce((sum, entry) => sum + Number(entry?.totalAmount || entry?.amount || 0), 0),
    [historyRows]
  );
  const sortedHistoryRows = useMemo(
    () =>
      sortHistoryRowsByDate(
        historyRows,
        (entry) => entry?.date || entry?.created_at || entry?.createdAt,
        (entry) => entry?.id || entry?.note || entry?.category
      ),
    [historyRows]
  );
  const categoryHistoryOptions = useMemo(() => {
    const unique = new Set();
    sortedHistoryRows.forEach((row) => {
      const value = String(row?.category || "").trim();
      if (value) unique.add(value);
    });
    return [...unique].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [sortedHistoryRows]);
  const paymentHistoryOptions = useMemo(() => {
    const unique = new Set();
    sortedHistoryRows.forEach((row) => {
      const value = String(row?.paymentMode || "").trim();
      if (value) unique.add(value);
    });
    return [...unique];
  }, [sortedHistoryRows]);
  const filteredByControls = useMemo(() => {
    return sortedHistoryRows.filter((row) => {
      const rowDate = String(row?.date || "").trim();
      const categoryValue = String(row?.category || "").trim();
      const paymentModeValue = String(row?.paymentMode || "").trim();
      if (fromDate && rowDate && rowDate < fromDate) return false;
      if (toDate && rowDate && rowDate > toDate) return false;
      if (categoryFilter && categoryValue !== categoryFilter) return false;
      if (paymentFilter && paymentModeValue !== paymentFilter) return false;
      return true;
    });
  }, [categoryFilter, fromDate, paymentFilter, sortedHistoryRows, toDate]);
  const filteredHistoryRows = useMemo(() => {
    const query = String(searchQuery || "").trim().toLowerCase();
    if (!query) return filteredByControls;
    return filteredByControls.filter((row) => {
      const values = [row?.date, row?.category, row?.paymentMode, row?.amount, row?.note];
      return values.some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [filteredByControls, searchQuery]);
  const filteredCategoryOptions = useMemo(() => {
    const query = String(category || "").trim().toLowerCase();
    const source = Array.isArray(categoryOptions) ? categoryOptions : [];
    if (!query) return source.slice(0, 8);
    return source.filter((option) => option.toLowerCase().includes(query)).slice(0, 8);
  }, [category, categoryOptions]);

  function applyCategoryOption(option) {
    setCategory(String(option || "").trim());
    setShowCategorySuggestions(false);
  }

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
        paymentMode,
        note
      });
      setHistoryRows(Array.isArray(updated) ? updated : expensesList(activeRange));
      setCategoryOptions(expenseCategoriesList());
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
    setDate(row?.date || "");
    setCategory(row?.category || "");
    setAmount(String(Number(row?.amount || 0)));
    setPaymentMode(row?.paymentMode || "Cash");
    setNote(row?.note || "");
  }

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Purchase - Expense"
        subtitle={`Expense entry and history${selectedYear?.label ? ` for FY ${selectedYear.label}` : ""}`}
      />
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Date">
            <DateInput
              value={date}
              onChange={(nextValue) => setDate(nextValue)}
              className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
            />
          </FormField>

          <FormField label="Category">
            <div className="relative">
              <input
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setShowCategorySuggestions(true);
                }}
                onFocus={() => setShowCategorySuggestions(true)}
                onBlur={(event) => {
                  setCategory(String(event.target.value || "").trim());
                  window.setTimeout(() => setShowCategorySuggestions(false), 120);
                }}
                placeholder="Enter category"
                className="w-full rounded-2xl border border-slate-100 px-3 py-2.5 text-sm outline-none"
              />
              {showCategorySuggestions && filteredCategoryOptions.length ? (
                <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg">
                  {filteredCategoryOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyCategoryOption(option)}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
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

          <FormField label="Payment Method">
            <select
              value={paymentMode}
              onChange={(event) => setPaymentMode(event.target.value)}
              className="w-full rounded-2xl border border-slate-100 bg-white px-3 py-2.5 text-sm outline-none"
            >
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
            </select>
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
            {filteredHistoryRows.length} entries | Total {money(historyTotal)}
          </div>
        </div>

        <div className="mt-4">
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search date, category, payment method, note"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <DateInput
            value={fromDate}
            onChange={setFromDate}
            placeholder="From date"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          />
          <DateInput
            value={toDate}
            onChange={setToDate}
            placeholder="To date"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          />
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          >
            <option value="">All Categories</option>
            {categoryHistoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={paymentFilter}
            onChange={(event) => setPaymentFilter(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none"
          >
            <option value="">All Payment Methods</option>
            {paymentHistoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[860px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 font-semibold">Date</th>
                <th className="px-3 py-3 font-semibold">Category</th>
                <th className="px-3 py-3 font-semibold">Payment Method</th>
                <th className="px-3 py-3 font-semibold text-right">Amount</th>
                <th className="px-3 py-3 font-semibold">Note</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingHistory ? (
                <tr className="border-t border-slate-100">
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    Loading expense history...
                  </td>
                </tr>
              ) : filteredHistoryRows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    {searchQuery ? "No matching expenses found." : "No expenses saved yet."}
                  </td>
                </tr>
              ) : (
                filteredHistoryRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 text-slate-700">{formatDate(row?.date)}</td>
                    <td className="px-3 py-3 font-medium text-slate-900">{row?.category || "-"}</td>
                    <td className="px-3 py-3 text-slate-600">{row?.paymentMode || "-"}</td>
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
