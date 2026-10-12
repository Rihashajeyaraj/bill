import React from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Users, Package, ChevronRight } from "lucide-react";
import PageHeader from "../components/PageHeader";

export default function Settings() {
  const navigate = useNavigate();

  const cards = [
    {
      id: "settings-company-card",
      title: "Company",
      description: "Manage business identity, GST details, bank accounts, print templates, and organizational preferences.",
      icon: Building2,
      to: "/app/company-settings",
      badge: "Configuration",
      color: "from-blue-500/10 to-indigo-500/10 text-blue-600 border-blue-200"
    },
    {
      id: "settings-customers-card",
      title: "Customers",
      description: "Manage party directory, billing and shipping addresses, GSTIN numbers, and customer ledger records.",
      icon: Users,
      to: "/app/parties",
      badge: "Master Data",
      color: "from-emerald-500/10 to-teal-500/10 text-emerald-600 border-emerald-200"
    },
    {
      id: "settings-items-card",
      title: "Items",
      description: "Manage catalog products and services, HSN/SAC codes, pricing, units of measurement, and GST rates.",
      icon: Package,
      to: "/app/items",
      badge: "Catalog Master",
      color: "from-amber-500/10 to-orange-500/10 text-amber-600 border-amber-200"
    }
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6" id="settings-page">
      <PageHeader
        title="Settings & Masters"
        subtitle="Configure company details and maintain core business master data"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2" id="settings-cards-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.id}
              id={card.id}
              onClick={() => navigate(card.to)}
              className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs hover:shadow-md hover:border-slate-300 transition-all duration-200 cursor-pointer overflow-hidden"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className={`p-3 rounded-xl border bg-gradient-to-br ${card.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="text-[11px] font-semibold tracking-wide uppercase px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                    {card.badge}
                  </span>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                    {card.title}
                  </h3>
                  <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                    {card.description}
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 group-hover:text-blue-600">
                <span>Manage {card.title}</span>
                <ChevronRight className="h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
