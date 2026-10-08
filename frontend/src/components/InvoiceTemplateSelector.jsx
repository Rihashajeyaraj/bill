import React, { useEffect, useState } from "react";
import {
  Check,
  Star,
  Eye,
  Layout,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Upload,
  Plus,
  Trash2,
  Edit3,
  FileText,
  FileCode,
  AlertCircle
} from "lucide-react";
import Modal from "./Modal";
import InvoicePreview from "./InvoicePreview";
import {
  fetchTenantTemplates,
  setTemplateAsDefault,
  toggleTemplateActive,
  saveCustomTemplate,
  renameCustomTemplate,
  deleteCustomTemplate,
  BUILTIN_TEMPLATES
} from "../services/templateService";

export default function InvoiceTemplateSelector({
  selectedTemplateKey,
  onSelectTemplate,
  invoiceData = null,
  disabled = false
}) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [expanded, setExpanded] = useState(true);

  // Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [fileContent, setFileContent] = useState("");
  const [fileType, setFileType] = useState("html");
  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [savingUpload, setSavingUpload] = useState(false);

  // Rename Modal State
  const [renameTpl, setRenameTpl] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [renameDesc, setRenameDesc] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  // Delete Confirm State
  const [deleteTpl, setDeleteTpl] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await fetchTenantTemplates();
      setTemplates(data);
    } catch {
      setTemplates(BUILTIN_TEMPLATES);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleSetDefault = async (e, key) => {
    e.stopPropagation();
    try {
      const updated = await setTemplateAsDefault(key);
      setTemplates(updated);
    } catch {
      // Best effort update
    }
  };

  const handleToggleActive = async (e, key, currentActive) => {
    e.stopPropagation();
    try {
      const updated = await toggleTemplateActive(key, !currentActive);
      setTemplates(updated);
    } catch {
      // Best effort update
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setUploadError("");
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    if (!["html", "htm", "pdf", "txt"].includes(ext)) {
      setUploadError("Invalid file format. Please upload a PDF or HTML file.");
      return;
    }

    setUploadFile(file);
    setFileName(file.name);
    setFileType(ext === "pdf" ? "pdf" : "html");
    if (!uploadName) {
      const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
      setUploadName(nameWithoutExt.replace(/[-_]/g, " ").toUpperCase());
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setFileContent(event.target.result || "");
    };
    if (ext === "pdf") {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  };

  const handleSaveUpload = async (e) => {
    e.preventDefault();
    if (!uploadName.trim()) {
      setUploadError("Please provide a template name.");
      return;
    }
    if (!uploadFile) {
      setUploadError("Please select a PDF or HTML template file to upload.");
      return;
    }

    setSavingUpload(true);
    setUploadError("");

    try {
      const updated = await saveCustomTemplate({
        name: uploadName.trim(),
        description: uploadDesc.trim() || "Uploaded custom invoice template layout.",
        fileName,
        fileType,
        fileContent,
        previewColor: "#4F46E5"
      });

      setTemplates(updated);
      setShowUploadModal(false);
      setUploadName("");
      setUploadDesc("");
      setUploadFile(null);
      setFileContent("");

      // Automatically select newly uploaded template
      const newlyAdded = updated[updated.length - 1];
      if (newlyAdded && newlyAdded.template_key) {
        onSelectTemplate(newlyAdded.template_key);
      }
    } catch (err) {
      setUploadError(err.message || "Failed to save uploaded template.");
    } finally {
      setSavingUpload(false);
    }
  };

  const handleSaveRename = async (e) => {
    e.preventDefault();
    if (!renameName.trim() || !renameTpl) return;
    setSavingRename(true);
    try {
      const updated = await renameCustomTemplate(renameTpl.template_key, renameName.trim(), renameDesc.trim());
      setTemplates(updated);
      setRenameTpl(null);
    } catch {
      // Best effort update
    } finally {
      setSavingRename(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTpl) return;
    setDeleting(true);
    try {
      const updated = await deleteCustomTemplate(deleteTpl.template_key);
      setTemplates(updated);
      if (selectedTemplateKey === deleteTpl.template_key) {
        const fallback = updated[0]?.template_key || "modern_gst";
        onSelectTemplate(fallback);
      }
      setDeleteTpl(null);
    } catch (err) {
      alert(err.message || "Could not delete template.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-sm space-y-3">
      {/* SELECTOR HEADER */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
            <Layout className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-sm tracking-wide uppercase">Select Invoice Template</h3>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> {templates.length} Designs Available
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Choose visual layout format or upload custom template for dynamic billing & PDF generation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* UPLOAD TEMPLATE BUTTON */}
          <button
            type="button"
            onClick={() => {
              setUploadError("");
              setShowUploadModal(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors"
            title="Upload custom invoice template file (PDF / HTML)"
          >
            <Upload className="w-3.5 h-3.5" /> + Upload Template
          </button>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            title={expanded ? "Collapse Templates" : "Expand Templates"}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* VISUAL CARDS GRID */}
      {expanded && (
        <div className="pt-2">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {/* UPLOAD NEW TEMPLATE CARD */}
              <div
                onClick={() => {
                  setUploadError("");
                  setShowUploadModal(true);
                }}
                className="group relative rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/20 hover:bg-emerald-50/60 p-4 cursor-pointer transition-all duration-200 flex flex-col items-center justify-center text-center min-h-[160px] space-y-2 hover:border-emerald-500"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h4 className="font-extrabold text-emerald-900 text-xs uppercase tracking-wide">+ Upload Template</h4>
                  <p className="text-[10px] text-emerald-700 mt-0.5">Supported: PDF / HTML</p>
                </div>
              </div>

              {/* TEMPLATES LOOP */}
              {templates.map((tmpl) => {
                const isSelected = selectedTemplateKey === tmpl.template_key;
                const isDef = tmpl.is_default;
                const isActive = tmpl.is_active !== false;
                const isCustom = Boolean(tmpl.is_custom);

                return (
                  <div
                    key={tmpl.template_key}
                    onClick={() => {
                      if (!disabled && isActive) {
                        onSelectTemplate(tmpl.template_key);
                      }
                    }}
                    className={`group relative rounded-xl border p-3 cursor-pointer transition-all duration-200 flex flex-col justify-between ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-200 shadow-md"
                        : isActive
                        ? "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                        : "border-slate-100 bg-slate-50/60 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    {/* VISUAL THUMBNAIL PREVIEW */}
                    <div className="mb-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2 overflow-hidden relative min-h-[90px] flex flex-col justify-between shadow-2xs group-hover:border-emerald-300 transition-colors">
                      {/* ACCENT BARS */}
                      {isCustom ? (
                        <div className="h-2 w-full bg-indigo-600 rounded-t text-[7px] text-indigo-100 font-extrabold flex items-center px-1 justify-between">
                          <span>CUSTOM LAYOUT</span>
                          <span>{(tmpl.template_type || "HTML").toUpperCase()}</span>
                        </div>
                      ) : tmpl.template_key === "new_globe_export" ? (
                        <div className="h-2 w-full bg-blue-950 rounded-t text-[7px] text-blue-200 font-extrabold flex items-center px-1">
                          EXPRESS LOGISTICS
                        </div>
                      ) : tmpl.template_key === "anvase_exim_import" ? (
                        <div className="h-2 w-full bg-red-900 rounded-t text-[7px] text-red-100 font-extrabold flex items-center px-1">
                          IMPORT & CUSTOMS
                        </div>
                      ) : tmpl.template_key === "uprichard_international" ? (
                        <div className="h-2 w-full bg-teal-800 rounded-t text-[7px] text-teal-100 font-bold flex items-center px-1">
                          INTERNATIONAL VAT
                        </div>
                      ) : tmpl.template_key === "pga_shipping_draft" ? (
                        <div className="h-2 w-full bg-slate-900 rounded-t text-[7px] text-amber-400 font-black flex items-center px-1">
                          SHIPPING DRAFT
                        </div>
                      ) : tmpl.template_key === "modern_gst" ? (
                        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-t" />
                      ) : tmpl.template_key === "classic" ? (
                        <div className="h-1.5 w-full bg-slate-800 rounded-t" />
                      ) : tmpl.template_key === "professional" ? (
                        <div className="h-4 w-full bg-slate-900 rounded-t text-[7px] text-white flex items-center px-1 font-bold">
                          HEADER
                        </div>
                      ) : (
                        <div className="h-1.5 w-full bg-slate-500 rounded-t" />
                      )}

                      {/* SKELETON CONTENT */}
                      <div className="space-y-1 my-1">
                        <div className="flex justify-between items-center">
                          <div className="h-2 w-12 bg-slate-300 rounded" />
                          <div className="h-2 w-8 bg-slate-300 rounded" />
                        </div>
                        <div className="h-1.5 w-full bg-slate-200 rounded" />
                        <div className="h-1.5 w-3/4 bg-slate-200 rounded" />
                      </div>

                      {/* MINI TABLE MOCK */}
                      <div className="border-t border-slate-200 pt-1 space-y-0.5">
                        <div className="h-1.5 w-full bg-slate-300 rounded" />
                        <div className="h-1 w-full bg-slate-200 rounded" />
                        <div className="h-1 w-full bg-slate-200 rounded" />
                      </div>

                      {/* SELECTED BADGE CHECKMARK */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-emerald-600 text-white p-1 rounded-full shadow-md">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </div>

                    {/* TEMPLATE META */}
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <h4 className="font-bold text-slate-900 text-xs truncate">{tmpl.name}</h4>
                        <div className="flex items-center gap-1 shrink-0">
                          {isCustom && (
                            <span className="bg-indigo-100 text-indigo-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                              Custom
                            </span>
                          )}
                          {isDef && (
                            <span className="bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <Star className="w-2.5 h-2.5 fill-amber-600 stroke-amber-600" /> Default
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5 leading-tight">{tmpl.description}</p>
                    </div>

                    {/* ACTIONS BAR */}
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                      {/* PREVIEW BUTTON */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewTemplate(tmpl);
                        }}
                        className="text-slate-600 hover:text-emerald-700 font-semibold flex items-center gap-1 hover:underline"
                      >
                        <Eye className="w-3 h-3" /> Preview
                      </button>

                      <div className="flex items-center gap-1.5">
                        {/* CUSTOM ACTIONS (RENAME & DELETE) */}
                        {isCustom && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenameTpl(tmpl);
                                setRenameName(tmpl.name);
                                setRenameDesc(tmpl.description || "");
                              }}
                              className="text-slate-400 hover:text-blue-600 p-0.5"
                              title="Rename Custom Template"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTpl(tmpl);
                              }}
                              className="text-slate-400 hover:text-red-600 p-0.5"
                              title="Delete Custom Template"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}

                        {/* SET AS DEFAULT BUTTON */}
                        {!isDef && isActive && (
                          <button
                            type="button"
                            onClick={(e) => handleSetDefault(e, tmpl.template_key)}
                            className="text-slate-400 hover:text-amber-600 font-medium"
                            title="Set as Default Template for Company"
                          >
                            Set Default
                          </button>
                        )}

                        {/* ACTIVE TOGGLE */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleActive(e, tmpl.template_key, isActive)}
                          className={`font-semibold ${
                            isActive ? "text-emerald-600 hover:text-slate-400" : "text-slate-400 hover:text-emerald-600"
                          }`}
                          title={isActive ? "Deactivate Template" : "Activate Template"}
                        >
                          {isActive ? "Active" : "Inactive"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* UPLOAD TEMPLATE MODAL */}
      {showUploadModal && (
        <Modal
          title="Upload Invoice Template"
          open={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          size="lg"
        >
          <form onSubmit={handleSaveUpload} className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Dynamic Custom Invoice Template</p>
                <p className="text-[11px] text-emerald-800 mt-0.5">
                  Uploaded templates remain 100% dynamic. Company branding logo, customer details, line items, dynamic GST calculation engine, totals & PDF generation will be dynamically bound to your template.
                </p>
              </div>
            </div>

            {uploadError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Template Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="e.g. CUSTOM CORPORATE EXPORT LAYOUT"
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Upload Template File <span className="text-red-500">*</span>
              </label>
              <div className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl p-4 text-center cursor-pointer transition-colors bg-slate-50 hover:bg-emerald-50/30 relative">
                <input
                  type="file"
                  accept=".html,.htm,.pdf,.txt"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex flex-col items-center justify-center space-y-1">
                  {fileType === "pdf" ? (
                    <FileText className="w-8 h-8 text-red-500" />
                  ) : fileType === "html" ? (
                    <FileCode className="w-8 h-8 text-emerald-600" />
                  ) : (
                    <Upload className="w-8 h-8 text-slate-400" />
                  )}
                  <p className="text-xs font-bold text-slate-800">
                    {fileName ? fileName : "Click or drag & drop file to upload template"}
                  </p>
                  <span className="inline-block bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase my-1">
                    Choose File / Browse
                  </span>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Supported formats: PDF / HTML
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Optional Description
              </label>
              <textarea
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                placeholder="Describe layout features, font styles, or usage guidelines..."
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* PREVIEW BOX */}
            {fileName && (
              <div className="bg-slate-100 rounded-xl p-3 border border-slate-200 text-xs space-y-1">
                <div className="flex justify-between items-center text-slate-700 font-bold">
                  <span>Uploaded File Preview</span>
                  <span className="text-[10px] text-emerald-700 font-extrabold uppercase">{fileType}</span>
                </div>
                <p className="text-[11px] text-slate-600 truncate">File: {fileName}</p>
                {fileContent && (
                  <div className="bg-white p-2 rounded border border-slate-200 text-[10px] text-slate-600 font-mono max-h-24 overflow-y-auto">
                    {fileContent.slice(0, 300)}...
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingUpload}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-soft disabled:opacity-50 flex items-center gap-1.5"
              >
                {savingUpload ? "Saving Template..." : "Save Template"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* RENAME MODAL */}
      {renameTpl && (
        <Modal
          title={`Rename Template: ${renameTpl.name}`}
          open={!!renameTpl}
          onClose={() => setRenameTpl(null)}
          size="md"
        >
          <form onSubmit={handleSaveRename} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Template Name
              </label>
              <input
                type="text"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Description
              </label>
              <textarea
                value={renameDesc}
                onChange={(e) => setRenameDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRenameTpl(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingRename}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-soft"
              >
                {savingRename ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* DELETE CONFIRM MODAL */}
      {deleteTpl && (
        <Modal
          title="Delete Custom Template"
          open={!!deleteTpl}
          onClose={() => setDeleteTpl(null)}
          size="sm"
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-700">
              Are you sure you want to delete custom template <strong>"{deleteTpl.name}"</strong>? This action cannot be undone.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTpl(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteTemplate}
                disabled={deleting}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold hover:bg-red-700 shadow-soft"
              >
                {deleting ? "Deleting..." : "Delete Template"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* PREVIEW MODAL */}
      {previewTemplate && (
        <Modal
          title={`Preview Template: ${previewTemplate.name}`}
          open={!!previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          size="5xl"
        >
          <div className="p-4 bg-slate-100/80 rounded-2xl border border-slate-200 max-h-[75vh] overflow-y-auto">
            <InvoicePreview
              templateId={previewTemplate.template_key}
              invoiceData={invoiceData || {
                title: "PREVIEW INVOICE",
                isProforma: true,
                companyName: "",
                companyAddress: "",
                companyGstin: "",
                customerName: "",
                customerAddress: "",
                proformaNo: "-",
                proformaDate: new Date().toISOString().slice(0, 10),
                currencyCode: "INR",
                items: [],
                totals: { subTotal: 0, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, total: 0 },
                grand_total_in_words: ""
              }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">{previewTemplate.description}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectTemplate(previewTemplate.template_key);
                  setPreviewTemplate(null);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 shadow-soft"
              >
                Use This Template
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
