import React, { useEffect, useState } from "react";
import {
  Users, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, Check, X, ShieldAlert, Sparkles, UserPlus
} from "lucide-react";
import { apiGet, apiPost } from "../../services/apiClient";

export default function SuperAdminRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL, PENDING, APPROVED, REJECTED
  const [processingId, setProcessingId] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const loadRequests = () => {
    setLoading(true);
    setError("");
    apiGet("/super-admin/requests")
      .then((d) => setRequests(d || []))
      .catch((e) => setError(e?.message || "Failed to load requests."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const handleApprove = async (companyId, requestId) => {
    setProcessingId(requestId);
    setActionSuccess("");
    try {
      await apiPost(`/super-admin/requests/${companyId}/${requestId}/approve`, {});
      setActionSuccess("Request approved! Tenant login seat limit incremented.");
      loadRequests();
      setTimeout(() => setActionSuccess(""), 4000);
    } catch (err) {
      setError(err?.message || "Failed to approve request.");
    } finally {
      setProcessingId("");
    }
  };

  const handleReject = async (companyId, requestId) => {
    setProcessingId(requestId);
    setActionSuccess("");
    try {
      await apiPost(`/super-admin/requests/${companyId}/${requestId}/reject`, {});
      setActionSuccess("Request rejected.");
      loadRequests();
      setTimeout(() => setActionSuccess(""), 4000);
    } catch (err) {
      setError(err?.message || "Failed to reject request.");
    } finally {
      setProcessingId("");
    }
  };

  const filteredRequests = requests.filter((r) => {
    if (filter === "ALL") return true;
    return (r.status || "PENDING").toUpperCase() === filter;
  });

  const pendingCount = requests.filter((r) => (r.status || "PENDING").toUpperCase() === "PENDING").length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              Tenant Login Seat Requests
            </h1>
            {pendingCount > 0 && (
              <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5 rounded-full border border-amber-300">
                {pendingCount} Pending
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-500 mt-1">
            Review and approve additional user login seat requests submitted by tenant companies.
          </p>
        </div>

        <button
          onClick={loadRequests}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors shadow-sm self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-purple-600" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Action Banner */}
      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3 text-sm font-semibold animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-3 text-sm font-semibold">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        {[
          { id: "ALL", label: "All Requests", count: requests.length },
          { id: "PENDING", label: "Pending", count: pendingCount },
          { id: "APPROVED", label: "Approved", count: requests.filter((r) => r.status === "APPROVED").length },
          { id: "REJECTED", label: "Rejected", count: requests.filter((r) => r.status === "REJECTED").length }
        ].map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                active
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${active ? "bg-purple-700 text-purple-100" : "bg-slate-200 text-slate-700"}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table / List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 font-medium text-sm">
            Loading tenant seat requests...
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 text-center text-slate-400 font-medium text-sm">
            No seat requests found under <b>{filter}</b>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="py-3.5 px-4">Company</th>
                  <th className="py-3.5 px-4">Requested By</th>
                  <th className="py-3.5 px-4 text-center">Additional Seats</th>
                  <th className="py-3.5 px-4">Reason / Note</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Submitted</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredRequests.map((req) => {
                  const statusUpper = (req.status || "PENDING").toUpperCase();
                  const isPending = statusUpper === "PENDING";
                  const isApproved = statusUpper === "APPROVED";

                  return (
                    <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {req.company_name}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-semibold">
                        {req.requested_by}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center gap-1 font-extrabold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
                          <UserPlus className="w-3 h-3 text-purple-600" />
                          +{req.requested_count} Seat
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 max-w-xs truncate" title={req.reason}>
                        {req.reason || "Additional user seat requested"}
                      </td>
                      <td className="py-3.5 px-4">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3 text-amber-500" /> Pending
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Approved
                          </span>
                        )}
                        {!isPending && !isApproved && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <XCircle className="w-3 h-3 text-rose-600" /> Rejected
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {req.created_at ? new Date(req.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A"}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleApprove(req.organization_id, req.id)}
                              disabled={processingId === req.id}
                              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-sm inline-flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => handleReject(req.organization_id, req.id)}
                              disabled={processingId === req.id}
                              className="px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 font-bold text-[11px] transition-colors inline-flex items-center gap-1"
                            >
                              <X className="w-3 h-3" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-semibold text-[11px]">No actions</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
