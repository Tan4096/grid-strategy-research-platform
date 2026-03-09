import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id, { getModuleInfo }) {
          const moduleId = normalizePath(id);
          if (moduleId.includes("node_modules/zrender")) {
            return "vendor-zrender";
          }
          if (moduleId.includes("node_modules/echarts-for-react")) {
            return "vendor-echarts-react";
          }
          if (moduleId.includes("src/lib/echarts-candle")) {
            return "chart-candle-runtime";
          }
          if (moduleId.includes("components/PriceGridChart")) {
            return "chart-candle-ui";
          }
          if (moduleId.includes("src/lib/echarts-heatmap") || moduleId.includes("components/OptimizationHeatmap")) {
            return "chart-heatmap";
          }
          if (
            moduleId.includes("src/lib/echarts-radar") ||
            moduleId.includes("components/StrategyRadarChart") ||
            moduleId.includes("components/OptimizationRobustnessReport")
          ) {
            return "chart-radar";
          }

          if (moduleId.includes("node_modules/echarts/")) {
            if (
              moduleId.includes("/chart/candlestick/") ||
              moduleId.endsWith("/chart/candlestick.js") ||
              moduleId.includes("/chart/line/") ||
              moduleId.endsWith("/chart/line.js") ||
              moduleId.includes("/component/dataZoom")
            ) {
              return "vendor-echarts-candle";
            }
            if (
              moduleId.includes("/chart/heatmap/") ||
              moduleId.endsWith("/chart/heatmap.js") ||
              moduleId.includes("/component/visualMap")
            ) {
              return "vendor-echarts-heatmap";
            }
            if (
              moduleId.includes("/chart/radar/") ||
              moduleId.endsWith("/chart/radar.js") ||
              moduleId.includes("/coord/radar/") ||
              moduleId.includes("/component/radar/")
            ) {
              return "vendor-echarts-radar";
            }
            const visited = new Set<string>();
            const queue: string[] = [moduleId];
            let fromCandle = false;
            let fromHeatmap = false;
            let fromRadar = false;

            while (queue.length > 0 && (!fromCandle || !fromHeatmap || !fromRadar)) {
              const current = queue.pop();
              if (!current || visited.has(current)) {
                continue;
              }
              visited.add(current);
              const info = getModuleInfo(current);
              if (!info) {
                continue;
              }

              const importerList = [...info.importers, ...info.dynamicImporters].map(normalizePath);
              for (const importer of importerList) {
                if (importer.includes("src/lib/echarts-candle") || importer.includes("components/PriceGridChart")) {
                  fromCandle = true;
                }
                if (
                  importer.includes("src/lib/echarts-heatmap") ||
                  importer.includes("components/OptimizationHeatmap")
                ) {
                  fromHeatmap = true;
                }
                if (
                  importer.includes("src/lib/echarts-radar") ||
                  importer.includes("components/StrategyRadarChart") ||
                  importer.includes("components/OptimizationRobustnessReport")
                ) {
                  fromRadar = true;
                }
                if (!visited.has(importer)) {
                  queue.push(importer);
                }
              }
            }

            if (fromCandle && !fromHeatmap && !fromRadar) {
              return "vendor-echarts-candle";
            }
            if (fromHeatmap && !fromCandle && !fromRadar) {
              return "vendor-echarts-heatmap";
            }
            if (fromRadar && !fromCandle && !fromHeatmap) {
              return "vendor-echarts-radar";
            }
            return "vendor-echarts-shared";
          }

          if (moduleId.includes("node_modules/react") || moduleId.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          if (moduleId.includes("src/components/Optimization")) {
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
