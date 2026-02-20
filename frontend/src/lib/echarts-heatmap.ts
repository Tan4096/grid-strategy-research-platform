import * as echarts from "echarts/core";
import { HeatmapChart, type HeatmapSeriesOption } from "echarts/charts";
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
  type GridComponentOption,
  type TitleComponentOption,
  type TooltipComponentOption,
  type VisualMapComponentOption
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  VisualMapComponent,
  HeatmapChart,
  CanvasRenderer
]);

export type HeatmapChartOption = echarts.ComposeOption<
  | TitleComponentOption
  | TooltipComponentOption
  | GridComponentOption
  | VisualMapComponentOption
  | HeatmapSeriesOption
>;

export { echarts };
