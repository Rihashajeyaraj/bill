import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("country-state-city")) {
              return "geo-data";
            }
            if (id.includes("recharts") || id.includes("d3-")) {
              return "charts";
            }
            if (id.includes("html2canvas") || id.includes("jspdf") || id.includes("pdfjs-dist")) {
              return "pdf-tools";
            }
            if (id.includes("xlsx") || id.includes("tesseract.js")) {
              return "heavy-vendor";
            }
            if (id.includes("lucide-react")) {
              return "icons";
            }
            if (id.includes("@supabase")) {
              return "supabase";
            }
            if (id.includes("react-router-dom") || id.includes("@tanstack")) {
              return "router-query";
            }
            if (id.includes("react") || id.includes("react-dom")) {
              return "react-core";
            }
          }
        }
      }
    }
  }
});
