export type ChartVisionSource = "client" | "server" | "text";

export function chartVisionLabelAr(source: ChartVisionSource): string | null {
  switch (source) {
    case "client":
      return "تحليل من الشارت المعروض";
    case "server":
      return "تحليل من لقطة الخادم";
    case "text":
      return "تحليل نصي — لم تُلتقط صورة";
    default:
      return null;
  }
}
