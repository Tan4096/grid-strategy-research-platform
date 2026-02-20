import * as echarts from "echarts/core";
import {
  CandlestickChart,
  LineChart,
  type CandlestickSeriesOption,
  type LineSeriesOption
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
>;

export { echarts };
