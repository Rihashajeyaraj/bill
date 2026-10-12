import React, { useEffect, useState } from "react";
import Card from "../../components/Card";
import PageHeader from "../../components/PageHeader";
import GradientButton from "../../components/GradientButton";
import { Users, UserPlus, Shield, UserCheck, Mail, Clock, CheckCircle2, XCircle, AlertCircle, PlusCircle, Sparkles } from "lucide-react";
import { apiGet, apiPost } from "../../services/apiClient";
import { useOrganization } from "../../context/OrganizationContext";

export default function TenantCompanyUsers() {
  const { role, organizationId, organization } = useOrganization();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  
  // Seat Request State
  const [requestCount, setRequestCount] = useState(1);
  const [requestReason, setRequestReason] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState("");
  const [requestError, setRequestError] = useState("");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [userRole, setUserRole] = useState("employee");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canManage = ["owner", "admin"].includes(String(role || "").toLowerCase());
  const settingsData = organization?.settings || {};
  const maxSeats = settingsData.max_users_limit || 1;
  const userRequests = settingsData.user_requests || [];

  async function loadUsers() {
    try {
      const data = await apiGet("/api/v1/users");
      setUsers(data || []);
    } catch (err) {
      setError(err?.message || "Failed to load company users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleInvite(e) {
    e.preventDefault();
    if (!email) return;

    if (users.length >= maxSeats) {
      alert(`Seat limit reached (${users.length}/${maxSeats} seats used). Please request an additional login seat from Super Admin.`);
      setShowInviteModal(false);
      setShowRequestModal(true);
      return;
    }

    setSaving(true);
    try {
      await apiPost("/api/v1/users", { email, name, role: userRole });
      setShowInviteModal(false);
      setEmail("");
      setName("");
      loadUsers();
    } catch (err) {
      alert(err?.message || "Failed to invite user.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitSeatRequest(e) {
    e.preventDefault();
    setRequestError("");
    setRequestSuccess("");
    setRequesting(true);

    try {
      await apiPost("/super-admin/requests/submit", {
        organization_id: organizationId,
        requested_count: Number(requestCount),
        reason: requestReason.trim() || "Additional login seat requested for team expansion"
      });
      setRequestSuccess("Your login seat request has been submitted to Super Admin!");
      setShowRequestModal(false);
      setRequestReason("");
      setTimeout(() => setRequestSuccess(""), 5000);
    } catch (err) {
      setRequestError(err?.message || "Failed to submit seat request.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="px-5 py-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Company Users & Login Seats"
        subtitle="Manage team members, login seat allocation, and request additional user seats."
        right={
          canManage && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRequestModal(true)}
                className="px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-800 text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs"
              >
                <PlusCircle className="w-4 h-4 text-purple-600" />
                <span>Request Additional Seat</span>
              </button>
              <GradientButton onClick={() => {
                if (users.length >= maxSeats) {
                  setShowRequestModal(true);
                } else {
                  setShowInviteModal(true);
                }
              }}>
                <UserPlus className="w-4 h-4 mr-1.5" />
                Add User
              </GradientButton>
            </div>
          )
        }
      />

      {/* Seat Allocation Banner */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 text-white rounded-2xl p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/20">
            <Users className="w-6 h-6 text-purple-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-white">Login Seat Allocation</h3>
              <span className="bg-purple-500/30 text-purple-200 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-400/30">
                {users.length} / {maxSeats} Seats Used
              </span>
            </div>
            <p className="text-xs text-purple-200/80 mt-0.5 font-medium">
              Default 1 seat allocated. Submit a seat request to Super Admin to enable additional user logins.
            </p>
          </div>
        </div>

        {canManage && (
          <button
            onClick={() => setShowRequestModal(true)}
            className="px-4 py-2 bg-white text-purple-900 hover:bg-purple-50 rounded-xl text-xs font-extrabold shadow-sm transition-all self-start md:self-auto shrink-0"
          >
            + Request Extra Login Seat
          </button>
        )}
      </div>

      {requestSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3 text-xs font-semibold">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{requestSuccess}</span>
        </div>
      )}

      {/* Active Users Table */}
      <Card className="p-4 border-slate-200/80">
        <div className="flex items-center justify-between mb-3 px-2">
          <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">Active Team Users ({users.length})</h4>
        </div>
        {loading ? (
          <div className="p-6 text-center text-xs text-slate-500">Loading company team...</div>
        ) : error ? (
          <div className="p-3 text-xs text-rose-600 bg-rose-50 rounded-xl">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">User Email</th>
                  <th className="py-3 px-4 text-center">Role</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Permissions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {users.map((u) => (
                  <tr key={u.id || Math.random()} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
                      <Mail className="w-4 h-4 text-sky-600 shrink-0" />
                      {u.email || u.user_id || "User"}
                    </td>
                    <td className="py-3 px-4 text-center font-bold uppercase text-slate-700">
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] tracking-wider text-slate-700">
                        {u.role || "employee"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                        {u.status || "active"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-500">
                      {u.role === "owner" ? "Full Access" : u.role === "admin" ? "Operational Admin" : u.role === "accountant" ? "Billing & Reports" : "View / Create Sales"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Submitted Seat Requests Tracking */}
      {userRequests.length > 0 && (
        <Card className="p-4 border-slate-200/80 space-y-3">
          <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider px-2">
            Submitted Login Seat Requests ({userRequests.length})
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Requested By</th>
                  <th className="py-3 px-4 text-center">Seats</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Submitted Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {userRequests.map((req, idx) => (
                  <tr key={req.id || idx} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900">{req.requested_by}</td>
                    <td className="py-3 px-4 text-center font-bold text-purple-700">+{req.requested_count} Seat</td>
                    <td className="py-3 px-4 text-slate-600">{req.reason}</td>
                    <td className="py-3 px-4">
                      {req.status === "PENDING" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock className="w-3 h-3 text-amber-500" /> Pending Approval
                        </span>
                      )}
                      {req.status === "APPROVED" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Approved (+{req.requested_count} Seat)
                        </span>
                      )}
                      {req.status === "REJECTED" && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          <XCircle className="w-3 h-3 text-rose-600" /> Rejected
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      {req.created_at ? new Date(req.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* REQUEST SEAT MODAL */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-purple-600" />
                <h3 className="text-base font-extrabold text-slate-900">Request Additional Login Seat</h3>
              </div>
              <button onClick={() => setShowRequestModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <p className="text-xs text-slate-500 font-medium">
              Submit a request to Super Admin to unlock additional user login seats for your company.
            </p>

            {requestError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {requestError}
              </div>
            )}

            <form onSubmit={handleSubmitSeatRequest} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Additional Seats Requested *</label>
                <select
                  value={requestCount}
                  onChange={(e) => setRequestCount(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-bold text-slate-900 outline-none focus:border-purple-500 bg-slate-50"
                >
                  <option value={1}>+1 Additional Login Seat</option>
                  <option value={2}>+2 Additional Login Seats</option>
                  <option value={5}>+5 Additional Login Seats</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Reason / Note for Super Admin *</label>
                <textarea
                  required
                  rows={3}
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="e.g. Adding a new accountant to manage daily invoicing and statements"
                  className="w-full rounded-xl border border-slate-200 p-3 text-slate-900 outline-none focus:border-purple-500 bg-slate-50"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <GradientButton type="submit" loading={requesting}>Submit Request</GradientButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INVITE USER MODAL */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">Add Team User</h3>
            <form onSubmit={handleInvite} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">User Email *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Role *</label>
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-semibold outline-none focus:border-sky-500"
                >
                  <option value="admin">Admin</option>
                  <option value="accountant">Accountant</option>
                  <option value="employee">Employee</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <GradientButton type="submit" loading={saving}>Save User</GradientButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
