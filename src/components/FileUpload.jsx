import React, { useState } from "react";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/svg+xml"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const ACCEPT_ATTR = "image/png,image/jpeg,image/jpg,image/svg+xml,.png,.jpg,.jpeg,.svg";

export default function FileUpload({ value, onChange, onError }) {
  const [error, setError] = useState("");

  function isAllowedImageFile(file) {
    const mime = String(file?.type || "").toLowerCase();
    if (mime && ALLOWED_IMAGE_TYPES.has(mime)) return true;
    const name = String(file?.name || "").toLowerCase();
    const dotIndex = name.lastIndexOf(".");
    const ext = dotIndex >= 0 ? name.slice(dotIndex) : "";
    return ALLOWED_IMAGE_EXTENSIONS.has(ext);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isAllowedImageFile(file)) {
      const msg = "Only PNG, JPG, JPEG or SVG files are allowed.";
      setError(msg);
      onError?.(msg);
      e.target.value = "";
      return;
    }

    setError("");
    onError?.("");

    const reader = new FileReader();
    reader.onload = () => onChange?.(reader.result, file);
    reader.onerror = () => {
      const msg = "Unable to read selected image.";
      setError(msg);
      onError?.(msg);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2">
      <div className="grid max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden">
        <input
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handleFile}
          className="min-w-0 w-full text-sm"
        />
        <div className="shrink-0">
          {value ? (
            <img
              src={value}
              alt="logo"
              className="h-10 w-10 rounded-xl border border-slate-100 object-contain bg-white p-1"
            />
          ) : (
            <span className="text-xs text-slate-500">No logo</span>
          )}
        </div>
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
