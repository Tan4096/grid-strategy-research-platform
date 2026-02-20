import * as echarts from "echarts/core";
import { RadarChart, type RadarSeriesOption } from "echarts/charts";
import {
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  type LegendComponentOption,
  type RadarComponentOption,
  type TitleComponentOption,
  type TooltipComponentOption
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([TitleComponent, TooltipComponent, LegendComponent, RadarComponent, RadarChart, CanvasRenderer]);

export type RadarChartOption = echarts.ComposeOption<
  TitleComponentOption | TooltipComponentOption | LegendComponentOption | RadarComponentOption | RadarSeriesOption
>;

export { echarts };
