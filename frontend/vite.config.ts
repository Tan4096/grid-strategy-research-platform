import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/echarts-for-react")) {
            return "vendor-echarts-react";
          }
          if (id.includes("src/lib/echarts-candle") || id.includes("components/PriceGridChart")) {
            return "chart-candle";
          }
          if (id.includes("src/lib/echarts-heatmap") || id.includes("components/OptimizationHeatmap")) {
            return "chart-heatmap";
          }
          if (id.includes("src/lib/echarts-radar") || id.includes("components/StrategyRadarChart") || id.includes("components/OptimizationRobustnessReport")) {
            return "chart-radar";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          if (id.includes("src/components/Optimization")) {
            return "optimize-ui";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    host: "0.0.0.0"
  }
});
