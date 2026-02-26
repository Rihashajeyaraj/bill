import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, FileClock, ReceiptIndianRupee, Users } from "lucide-react";
import Card from "../components/Card";
import { invoicesList, invoicesSyncFromRemote } from "../services/invoices.service";
import { paymentsList, paymentsSyncFromRemote } from "../services/payments.service";
import { listParties, syncPartiesFromRemote } from "../modules/parties/store";
import { useOrganization } from "../context/OrganizationContext";
import { lsGetOrganizationScoped } from "../services/storage";

function money(n) {
  const value = Number(n || 0);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const COUNTRY_ALIAS = {
  india: "india",
  in: "india",
  "sri lanka": "sri lanka",
  lk: "sri lanka",
  sl: "sri lanka",
  uae: "uae",
  ae: "uae",
  usa: "usa",
  us: "usa",
  "united states": "usa",
  uk: "uk",
  gb: "uk",
  "united kingdom": "uk",
  ireland: "ireland",
  ie: "ireland",
  singapore: "singapore",
  sg: "singapore"
};

function normalizeCountryKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return COUNTRY_ALIAS[key] || key;
}

function recordCountry(record) {
  if (!record || typeof record !== "object") return "";
  return record.country || record.countryCode || record?.metadata?.country || record?.companySnapshot?.country || "";
}

function countryMatches(recordValue, targetCountry) {
  const target = normalizeCountryKey(targetCountry);
  const source = normalizeCountryKey(recordValue);
  if (!source) return true;
  return source === target;
}

export default function AccounterDashboard() {
  const { currency = "INR", country = "India", countryCode = "IN" } = useOrganization();
  const [invoices, setInvoices] = useState(() => invoicesList());
  const [payments, setPayments] = useState(() => paymentsList());
  const [parties, setParties] = useState(() => listParties());
  const [paymentInPremium, setPaymentInPremium] = useState(() =>
    lsGetOrganizationScoped("paymentInPremiumV1", [])
  );
  const [paymentOutPremium, setPaymentOutPremium] = useState(() =>
    lsGetOrganizationScoped("paymentOutPremiumV1", [])
  );

  useEffect(() => {
    let mounted = true;
    async function syncDashboardData() {
      try {
        const [syncedInvoices, syncedPayments, syncedParties] = await Promise.all([
          invoicesSyncFromRemote(),
          paymentsSyncFromRemote(),
          syncPartiesFromRemote()
        ]);
        if (!mounted) return;
        setInvoices(Array.isArray(syncedInvoices) ? syncedInvoices : invoicesList());
        setPayments(Array.isArray(syncedPayments) ? syncedPayments : paymentsList());
        setParties(Array.isArray(syncedParties) ? syncedParties : listParties());
        setPaymentInPremium(lsGetOrganizationScoped("paymentInPremiumV1", []));
        setPaymentOutPremium(lsGetOrganizationScoped("paymentOutPremiumV1", []));
      } catch {
        if (!mounted) return;
        setInvoices(invoicesList());
        setPayments(paymentsList());
        setParties(listParties());
        setPaymentInPremium(lsGetOrganizationScoped("paymentInPremiumV1", []));
        setPaymentOutPremium(lsGetOrganizationScoped("paymentOutPremiumV1", []));
      }
    }
    syncDashboardData();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const scopedInvoices = invoices.filter((invoice) => countryMatches(recordCountry(invoice), country));
    const scopedPayments = payments.filter((entry) => countryMatches(recordCountry(entry), country));
    const scopedPaymentIn = (Array.isArray(paymentInPremium) ? paymentInPremium : []).filter((entry) =>
      countryMatches(recordCountry(entry), country)
    );
    const scopedPaymentOut = (Array.isArray(paymentOutPremium) ? paymentOutPremium : []).filter((entry) =>
      countryMatches(recordCountry(entry), country)
    );
    const scopedParties = parties.filter((party) => countryMatches(recordCountry(party), country));

    const totalInvoices = scopedInvoices.reduce(
      (sum, invoice) =>
        sum + Number(invoice?.totals?.grandTotal ?? invoice?.totals?.total ?? invoice?.grandTotal ?? 0),
      0
    );
    const pendingInvoices = scopedInvoices.filter((invoice) => {
      const status = String(invoice?.status || invoice?.paymentStatus || "").toLowerCase();
      if (status === "draft" || status === "cancelled" || status === "canceled") return false;
      const outstanding = Number(
        invoice?.totals?.balance ??
          invoice?.remainingBalance ??
          invoice?.balanceAmount ??
          invoice?.totals?.grandTotal ??
          invoice?.totals?.total ??
          0
      );
      return outstanding > 0;
    });

    const incomingLegacy = scopedPayments
      .filter((entry) => {
        const direction = String(entry?.direction || "").toUpperCase();
        if (direction !== "IN") return false;
        const reference = String(entry?.referenceNo || entry?.reference_no || "");
        return !reference.startsWith("PI:");
      })
      .reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);

    const outgoingLegacy = scopedPayments
      .filter((entry) => {
        const direction = String(entry?.direction || "").toUpperCase();
        if (direction !== "OUT") return false;
        const reference = String(entry?.referenceNo || entry?.reference_no || "");
        return !reference.startsWith("PO:");
      })
      .reduce((sum, entry) => sum + Number(entry?.amount || 0), 0);

    const incomingPremium = scopedPaymentIn
      .filter((entry) => String(entry?.status || "").toLowerCase() !== "draft")
      .reduce((sum, entry) => sum + Number(entry?.totals?.amountReceived || 0), 0);

    const outgoingPremium = scopedPaymentOut
      .filter((entry) => String(entry?.status || "").toLowerCase() !== "draft")
      .reduce((sum, entry) => sum + Number(entry?.totals?.amountPaid || 0), 0);

    const incoming = Math.max(0, incomingLegacy + incomingPremium);
    const outgoing = Math.max(0, outgoingLegacy + outgoingPremium);

    const pendingTotal = pendingInvoices.reduce(
      (sum, invoice) =>
        sum +
        Number(
          invoice?.totals?.balance ??
            invoice?.remainingBalance ??
            invoice?.balanceAmount ??
            invoice?.totals?.grandTotal ??
            invoice?.totals?.total ??
            0
        ),
      0
    );

    let customers = 0;
    let suppliers = 0;
    scopedParties.forEach((party) => {
      const type = String(party?.type || "").toLowerCase();
      if (type === "supplier") suppliers += 1;
      else customers += 1;
    });

    return {
      totalInvoices,
      pendingCount: pendingInvoices.length,
      pendingTotal,
      incoming,
      outgoing,
      partyTotal: scopedParties.length,
      customers,
      suppliers
    };
  }, [invoices, payments, paymentInPremium, paymentOutPremium, parties, country]);

  return (
    <div className="dashboard-theme max-w-6xl space-y-4">
      <div className="rounded-2xl bg-slate-100 px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-800">Accounter Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Track receivables, payables, and daily billing operations ({countryCode} {country}).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Total Invoiced</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{currency} {money(stats.totalInvoices)}</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-500">Pending Invoices</p>
          <p className="mt-2 text-lg font-semibold text-amber-600">{stats.pendingCount}</p>
          <p className="text-xs text-slate-500">{currency} {money(stats.pendingTotal)}</p>
        </Card>

        <Card className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Payment In</p>
            <p className="mt-2 text-lg font-semibold text-emerald-600">{currency} {money(stats.incoming)}</p>
          </div>
          <ArrowDownCircle className="h-6 w-6 text-emerald-600" />
        </Card>

        <Card className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Payment Out</p>
            <p className="mt-2 text-lg font-semibold text-rose-600">{currency} {money(stats.outgoing)}</p>
          </div>
          <ArrowUpCircle className="h-6 w-6 text-rose-600" />
        </Card>

        <Card className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Parties</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{stats.partyTotal}</p>
            <p className="text-xs text-slate-500">C {stats.customers} | S {stats.suppliers}</p>
          </div>
          <Users className="h-6 w-6 text-indigo-600" />
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-slate-700">
          <FileClock className="h-4 w-4" />
          <p className="text-sm font-semibold">Today&apos;s Accounter Focus</p>
        </div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
          <li>Collect pending customer dues and reconcile payment-in entries.</li>
          <li>Review supplier dues before due-date to avoid penalties.</li>
          <li>Check GST/VAT impact in today&apos;s invoices and purchase bills.</li>
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2 text-slate-700">
          <ReceiptIndianRupee className="h-4 w-4" />
          <p className="text-sm font-semibold">Organization Billing Rules</p>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Tax and invoice numbering are read from organization settings. Use Company Setup and Company
          Settings to keep India GST details correct.
        </p>
      </Card>
    </div>
  );
}
