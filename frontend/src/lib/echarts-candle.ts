import * as echarts from "echarts/core";
import {
  CandlestickChart,
  LineChart,
  ScatterChart,
  type CandlestickSeriesOption,
  type LineSeriesOption,
  type ScatterSeriesOption
} from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  type DataZoomComponentOption,
  type GridComponentOption,
  type LegendComponentOption,
  type TitleComponentOption,
  type TooltipComponentOption
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  TitleComponent,
  TooltipComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  LineChart,
  CandlestickChart,
  ScatterChart,
  CanvasRenderer
]);

export type CandleChartOption = echarts.ComposeOption<
  | TitleComponentOption
  | TooltipComponentOption
  | DataZoomComponentOption
  | GridComponentOption
  | LegendComponentOption
  | CandlestickSeriesOption
  | LineSeriesOption
  | ScatterSeriesOption
>;

export { echarts };
