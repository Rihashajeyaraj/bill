import React, { useEffect, useMemo, useState } from "react";
import { Command, CornerDownLeft, Search } from "lucide-react";
import { useAppShell } from "../../context/AppShellContext";
import { partiesList } from "../../services/parties.service";
import { itemsList } from "../../services/items.service";
import { invoicesList } from "../../services/invoices.service";

function useDynamicCommands(open) {
  return useMemo(() => {
    if (!open) return [];

    const parties = partiesList()
      .slice(0, 5)
      .map((party) => ({
        id: `party_${party.id}`,
        title: party.name,
        subtitle: `Party • ${party.type || "Unknown"}`,
        keywords: `${party.name} party customer supplier ${party.phone || ""}`,
        to: "/app/parties"
      }));

    const items = itemsList()
      .slice(0, 5)
      .map((item) => ({
        id: `item_${item.id}`,
        title: item.name,
        subtitle: `Item • ${item.type || "Product"}`,
        keywords: `${item.name} item sku ${item.sku || ""}`,
        to: "/app/items"
      }));

    const invoices = invoicesList()
      .slice(0, 4)
      .map((invoice) => ({
        id: `invoice_${invoice.id}`,
        title: invoice.invoiceNo || invoice.id || "Invoice",
        subtitle: `Sales Invoice • ${invoice.partyName || "Customer"}`,
        keywords: `${invoice.invoiceNo || ""} invoice ${invoice.partyName || ""}`,
        to: "/app/sales/invoice"
      }));

    return [...parties, ...items, ...invoices];
  }, [open]);
}

export default function CommandPalette() {
  const { commandOpen, setCommandOpen, commandItems, navigateTo } = useAppShell();
  const dynamicCommands = useDynamicCommands(commandOpen);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const combined = useMemo(() => [...commandItems, ...dynamicCommands], [commandItems, dynamicCommands]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return combined;
    return combined.filter((entry) => {
      const text = `${entry.title} ${entry.subtitle || ""} ${entry.keywords || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [combined, query]);

  useEffect(() => {
    if (!commandOpen) {
      setQuery("");
      setActiveIndex(0);
      return;
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setCommandOpen(false);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length));
        return;
      }

      if (event.key === "Enter") {
        const active = filtered[activeIndex];
        if (active?.to) {
          navigateTo(active.to);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandOpen, filtered, activeIndex, navigateTo, setCommandOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!commandOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[8vh] sm:p-6">
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={() => setCommandOpen(false)} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search modules, actions, parties, items..."
            className="w-full border-none bg-transparent text-sm text-slate-800 outline-none"
          />
          <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-auto py-2">
          {filtered.length ? (
            filtered.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => navigateTo(entry.to)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition ${
                  index === activeIndex ? "bg-blue-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{entry.title}</p>
                  {entry.subtitle ? <p className="truncate text-xs text-slate-500">{entry.subtitle}</p> : null}
                </div>
                <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </button>
            ))
          ) : (
            <div className="px-4 py-10 text-center">
              <Command className="mx-auto h-6 w-6 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No matching commands</p>
              <p className="mt-1 text-xs text-slate-500">Try searching by module name, party, item, or invoice.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
