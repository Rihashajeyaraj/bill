import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, Plus, Trash2 } from "lucide-react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import GradientButton from "../components/GradientButton";
import Modal from "../components/Modal";
import {
  authDeleteOrganization,
  authGetRole
} from "../services/auth.service";
import { isOwnerRole } from "../services/roles";
import { useOrganization } from "../context/OrganizationContext";

function pathForNext(next) {
  if (next === "organization_setup") return "/company-setup";
  if (next === "invoice_template_setup") return "/invoice-template-setup";
  return "/dashboard";
}

export default function OrganizationSelect() {
  const navigate = useNavigate();
  const role = authGetRole();
  const isOwner = isOwnerRole(role);
  const {
    organizationId,
    organizations,
    organizationsLoading,
    switchingOrganizationId,
    refreshOrganizations,
    switchOrganization
  } = useOrganization();
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function loadOrganizations() {
      setError("");
      try {
        await refreshOrganizations();
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError?.message || "Unable to load organizations.");
      }
    }

    void loadOrganizations();
    return () => {
      mounted = false;
    };
  }, [refreshOrganizations]);

  async function handleSelectOrganization(organizationId) {
    if (!organizationId) return;
    setError("");
    try {
      const selected = await switchOrganization(organizationId);
      navigate(pathForNext(selected?.next), { replace: true });
    } catch (selectError) {
      setError(selectError?.message || "Unable to open selected organization.");
    }
  }

  function openDeleteModal(organization) {
    setDeleteTarget(organization || null);
  }

  function closeDeleteModal() {
    if (deletingId) return;
    setDeleteTarget(null);
  }

  async function handleDeleteOrganization() {
    const targetId = String(deleteTarget?.organizationId || "").trim();
    if (!targetId) return;
    setDeletingId(targetId);
    setError("");
    try {
      await authDeleteOrganization(targetId);
      await refreshOrganizations();
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(deleteError?.message || "Unable to delete selected organization.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate("/login", { replace: true })}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <PageHeader
        title="Select Company"
        subtitle="Choose the company you want to work with."
        right={isOwner ? (
          <GradientButton onClick={() => navigate("/company-setup?mode=create")}>
            <Plus className="h-4 w-4" />
            Create Company
          </GradientButton>
        ) : null}
      />

      {error ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {organizationsLoading ? (
        <Card className="p-6 text-sm text-slate-500">Loading organizations...</Card>
      ) : null}

      {!organizationsLoading && !organizations.length ? (
        <Card className="p-6">
          <p className="text-sm font-semibold text-slate-900">No company found</p>
          <p className="mt-1 text-sm text-slate-500">
            {isOwner ? "Create your first company to continue." : "No company has been assigned to your account yet."}
          </p>
          {isOwner ? (
            <div className="mt-4">
              <GradientButton onClick={() => navigate("/company-setup", { replace: true })}>
                <Plus className="h-4 w-4" />
                Create First Company
              </GradientButton>
            </div>
          ) : null}
        </Card>
      ) : null}

      {!organizationsLoading && organizations.length ? (
        <div className="grid grid-cols-1 gap-3">
          {organizations.map((organization) => (
            <Card key={organization.organizationId} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-slate-500" />
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {organization.companyName}
                    </p>
                    {String(organizationId || "").trim() === String(organization.organizationId || "").trim() ? (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        Current
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {organization.countryCode} | Role: {organization.role}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => openDeleteModal(organization)}
                      disabled={switchingOrganizationId === organization.organizationId || deletingId === organization.organizationId}
                      className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deletingId === organization.organizationId ? "Deleting..." : "Delete Company"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleSelectOrganization(organization.organizationId)}
                    disabled={switchingOrganizationId === organization.organizationId || deletingId === organization.organizationId}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {switchingOrganizationId === organization.organizationId ? "Opening..." : "Open"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <Modal
        open={!!deleteTarget}
        title="Delete Company"
        onClose={closeDeleteModal}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteModal}
              disabled={!!deletingId}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDeleteOrganization();
              }}
              disabled={!!deletingId}
              className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deletingId ? "Deleting..." : "Delete Company"}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>This action will remove this company from your list. This cannot be undone.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Company</p>
            <p className="text-sm font-semibold text-slate-900">{deleteTarget?.companyName || "-"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {deleteTarget?.countryCode || "-"} | Role: {deleteTarget?.role || "-"}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
