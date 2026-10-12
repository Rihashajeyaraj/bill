import React, { useRef, useState } from "react";
import { Upload, Trash2, RefreshCw, PenTool, CheckCircle2, AlertCircle } from "lucide-react";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp"
]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ACCEPT_ATTR = "image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp";

export default function FileUpload({
  value,
  onChange,
  onRemove,
  onError,
  label = "",
  helperText = "",
  assetType = "logo", // "logo" | "signature" | "image"
  maxSizeMB = 5,
  previewHeight = "h-16",
  previewWidth = "w-32",
  disabled = false
}) {
  const fileInputRef = useRef(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [isHovering, setIsHovering] = useState(false);

  const isSignature = assetType === "signature";
  const defaultHelper = `PNG, JPG, or JPEG format (Max ${maxSizeMB}MB)`;

  function isAllowedImageFile(file) {
    const mime = String(file?.type || "").toLowerCase();
    if (mime && ALLOWED_IMAGE_TYPES.has(mime)) return true;
    const name = String(file?.name || "").toLowerCase();
    const dotIndex = name.lastIndexOf(".");
    const ext = dotIndex >= 0 ? name.slice(dotIndex) : "";
    return ALLOWED_IMAGE_EXTENSIONS.has(ext);
  }

  function handleFileSelected(file) {
    if (!file) return;

    if (!isAllowedImageFile(file)) {
      const msg = "Invalid file type. Only PNG, JPG, and JPEG formats are supported.";
      setError(msg);
      onError?.(msg);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      const msg = `File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds the ${maxSizeMB}MB limit.`;
      setError(msg);
      onError?.(msg);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setError("");
    onError?.("");
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      onChange?.(reader.result, file);
    };
    reader.onerror = () => {
      const msg = "Unable to read selected image.";
      setError(msg);
      onError?.(msg);
    };
    reader.readAsDataURL(file);
  }

  function handleInputChange(e) {
    const file = e.target.files?.[0];
    handleFileSelected(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsHovering(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    handleFileSelected(file);
  }

  function handleRemove(e) {
    e.stopPropagation();
    setError("");
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (onRemove) {
      onRemove();
    } else {
      onChange?.("", null);
    }
  }

  function handleReplace(e) {
    e.stopPropagation();
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
      />

      {value ? (
        // Preview State: Display image with Replace and Remove options
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3 sm:p-4 transition-all">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`relative flex items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm overflow-hidden ${
                  isSignature ? "h-16 w-44" : `${previewHeight} ${previewWidth}`
                }`}
              >
                <img
                  src={value}
                  alt={isSignature ? "Authorized Signature" : "Company Logo"}
                  className="max-h-full max-w-full object-contain"
                />
              </div>

              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{isSignature ? "Signature Uploaded" : "Logo Uploaded"}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500 max-w-[200px] truncate">
                  {fileName || "Image attached"}
                </p>
                <p className="text-[10px] text-slate-400">
                  {isSignature ? "Appears in authorized signatory box" : "Appears in invoice header"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                type="button"
                onClick={handleReplace}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none"
              >
                <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                <span>Replace</span>
              </button>

              <button
                type="button"
                onClick={handleRemove}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 hover:text-rose-800 focus:outline-none"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                <span>Remove</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        // Empty Upload Dropzone
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsHovering(true);
          }}
          onDragLeave={() => setIsHovering(false)}
          onDrop={handleDrop}
          className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition-all ${
            isHovering
              ? "border-sky-500 bg-sky-50/50"
              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/60"
          }`}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:scale-105 group-hover:bg-slate-200">
            {isSignature ? (
              <PenTool className="h-5 w-5 text-slate-600" />
            ) : (
              <Upload className="h-5 w-5 text-slate-600" />
            )}
          </div>
          <div className="mt-2.5">
            <span className="text-xs font-semibold text-sky-600 hover:text-sky-700">
              Click to upload {isSignature ? "signature" : "logo"}
            </span>{" "}
            <span className="text-xs text-slate-600">or drag and drop</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {helperText || defaultHelper}
          </p>
        </div>
      )}

      {error ? (
        <div className="flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
