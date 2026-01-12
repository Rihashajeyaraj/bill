import React from "react";

export default function FileUpload({ value, onChange }) {
  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => onChange?.(reader.result);
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-center gap-3">
      <input type="file" accept="image/*" onChange={handleFile} />
      {value ? (
        <img src={value} alt="logo" className="h-10 w-10 rounded-xl border border-slate-100 object-cover" />
      ) : (
        <span className="text-xs text-slate-500">No logo</span>
      )}
    </div>
  );
}
