import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Badge from "../components/Badge";
import DateInput from "../components/DateInput";
import { buildPartyStatement, computePartyFinancials, getParty } from "../modules/parties/store";
import { formatMoney, outstandingMeta } from "../modules/parties/utils";
import { useOrganization } from "../context/OrganizationContext";
import { useFinancialYears } from "../context/FinancialYearContext";

const DOC_TYPES = [
  "Invoice",
  "Payment",
  "Credit Note",
  "Debit Note",
  "Opening Balance"
];

export default function PartyStatement() {
  const { id } = useParams();
  const party = getParty(id);
  const { currency = "" } = useOrganization();
  const { selectedYear } = useFinancialYears();

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [openingDetailsOpen, setOpeningDetailsOpen] = useState(false);

  useEffect(() => {
    if (!selectedYear) return;
    setFromDate(selectedYear.startDate || "");
    setToDate(selectedYear.endDate || "");
  }, [selectedYear?.id, selectedYear?.startDate, selectedYear?.endDate]);

  const financials = useMemo(() => (party ? computePartyFinancials(party) : null), [party]);
  const statement = useMemo(
    () =>
      party
        ? buildPartyStatement(party, {
            from: fromDate,
            to: toDate,
            typeFilter
          })
        : { entries: [], openingBalance: 0, closingBalance: 0 },
    [party, fromDate, toDate, typeFilter]
  );

  if (!party) {
    return (
      <div className="max-w-5xl">
        <PageHeader
          title="Statement"
          subtitle="Party not found"
          right={
            <Link
              to="/app/parties"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              Back
            </Link>
          }
        />
        <EmptyState
          icon={FileText}
          title="No party selected"
          description="Select a party from the Parties list to view the ledger statement."
        />
      </div>
    );
  }

  const balanceMeta = outstandingMeta(party, financials?.outstanding ?? 0);

  return (
    <div className="mx-auto max-w-[1240px] space-y-4 pb-24">
      <PageHeader
        title="Statement"
        subtitle={`${party.name} \u2022 ${party.type}`}
        right={
          <Link
            to="/app/parties"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            Back to Parties
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <p className="text-xs font-semibold text-slate-500">Outstanding Balance</p>
            <p className={`mt-2 text-2xl font-bold ${balanceMeta.color}`}>
              {formatMoney(balanceMeta.absolute, currency)}
            </p>
            <Badge tone={balanceMeta.tone}>{balanceMeta.label}</Badge>
          </div>
          <button
            type="button"
            onClick={() => setOpeningDetailsOpen(true)}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow"
          >
            <p className="text-xs font-semibold text-slate-500">Opening Balance</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formatMoney(statement.openingBalance, currency)}
            </p>
            <p className="text-xs text-slate-500">
              {selectedYear?.label ? `Carry forward into FY ${selectedYear.label}` : "As of selected period start"}
            </p>
            <p className="mt-2 text-[11px] font-semibold text-slate-600">
              Click to view opening balance details
            </p>
          </button>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <p className="text-xs font-semibold text-slate-500">Closing Balance</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {formatMoney(statement.closingBalance, currency)}
            </p>
            <p className="text-xs text-slate-500">After filtered entries</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <p className="text-sm font-semibold text-slate-900">Party Details</p>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            <p>{party.phone || "No phone on file"}</p>
            <p>{party.email || "No email on file"}</p>
            <p>{party.address || "No address added"}</p>
            <p>{party.taxId ? `Tax ID: ${party.taxId}` : "No tax ID"}</p>
            {party.creditLimitEnabled ? (
              party.creditLimitType === "Days" ? (
                <p>
                  Allowed Overdue Days:{" "}
                  <span className="font-semibold text-slate-900">{party.creditLimitDays}</span>
                </p>
              ) : (
                <p>
                  Credit Limit:{" "}
                  <span className="font-semibold text-slate-900">
                    {formatMoney(party.creditLimit, currency)}
                  </span>
                </p>
              )
            ) : (
              <p>Credit limit not enabled</p>
            )}
          </div>
          {party.notes ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">Notes</p>
              <p className="mt-1">{party.notes}</p>
            </div>
          ) : null}
          {party.type !== "Customer" ? (
            party.attachments?.length ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-700">Attachments</p>
                <div className="mt-2 space-y-1">
                  {party.attachments.map((file) => (
                    <p key={file.name}>{file.name}</p>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">No documents attached</p>
            )
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">
            From Date
            <DateInput
              value={fromDate}
              onChange={(nextValue) => setFromDate(nextValue)}
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To Date
            <DateInput
              value={toDate}
              onChange={(nextValue) => setToDate(nextValue)}
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Document Type
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setFromDate(selectedYear?.startDate || "");
                setToDate(selectedYear?.endDate || "");
                setTypeFilter("");
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Reset to Financial Year
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
        <div className="overflow-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">Date</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Document Type</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Document No</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Debit</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Credit</th>
                <th className="px-4 py-3 font-semibold text-slate-700 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.entries.length ? (
                statement.entries.map((entry) => {
                  const rowMeta = outstandingMeta(party, entry.balance ?? 0);
                  return (
                    <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-slate-700">{entry.date || "-"}</td>
                      <td className="px-4 py-3 text-slate-700">{entry.type}</td>
                      <td className="px-4 py-3 text-slate-700">{entry.documentNo}</td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {entry.debit ? formatMoney(entry.debit, currency) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {entry.credit ? formatMoney(entry.credit, currency) : "-"}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${rowMeta.color}`}>
                        {formatMoney(entry.balance ?? 0, currency)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-slate-500">
                    No transactions found for this party.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openingDetailsOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Opening Balance Details</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedYear?.label
                    ? `This opening balance is carried forward into FY ${selectedYear.label}.`
                    : "This opening balance is calculated from the master opening balance and all earlier transactions."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpeningDetailsOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 border-b border-slate-100 px-5 py-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Master Opening Balance</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatMoney(statement.openingBase || 0, currency)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Current Year Opening Balance</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {formatMoney(statement.openingBalance, currency)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500">Carry Forward Entries</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{statement.openingEntries.length}</p>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700">Date</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Type</th>
                    <th className="px-4 py-3 font-semibold text-slate-700">Document No</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Debit</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Credit</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.openingEntries.length ? (
                    statement.openingEntries.map((entry) => (
                      <tr key={`opening_${entry.id}`} className="border-t border-slate-100">
                        <td className="px-4 py-3 text-slate-700">{entry.date || "-"}</td>
                        <td className="px-4 py-3 text-slate-700">{entry.type}</td>
                        <td className="px-4 py-3 text-slate-700">{entry.documentNo || "-"}</td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {entry.debit ? formatMoney(entry.debit, currency) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">
                          {entry.credit ? formatMoney(entry.credit, currency) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {formatMoney(entry.balance ?? 0, currency)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                        No earlier entries were used to build the opening balance.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
