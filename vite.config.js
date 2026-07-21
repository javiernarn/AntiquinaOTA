import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650, // pdf-export chunk (jsPDF + html2canvas) is lazy-loaded on demand, not part of initial load
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("jspdf") || id.includes("html2canvas") || id.includes("dompurify")) {
              return "pdf-export"; // lazy-loaded on demand, kept out of the main bundle
            }
            return "vendor";
          }
        },
      },
    },
  },
});
