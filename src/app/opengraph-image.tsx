import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_DOMAIN, BRAND_NAME } from "@/lib/brand";
import { DISPLAY_NAME_AR, DISPLAY_NAME_EN } from "@/lib/gold";

export const alt = `${BRAND_NAME} — ${DISPLAY_NAME_AR} recommendations`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(name: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "src/app/_fonts", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export default async function OpenGraphImage() {
  const [arabic, latin, mark] = await Promise.all([
    loadFont("cairo-arabic-600.ttf"),
    loadFont("cairo-latin-600.ttf"),
    readFile(join(process.cwd(), "public/brand/aichart-mark-dark.png")),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0c0a09",
          color: "#f5f5f4",
          padding: "64px 72px",
          fontFamily: "Cairo",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: "#c9a227",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={markSrc} width={72} height={72} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 36, letterSpacing: -0.5 }}>{BRAND_NAME}</div>
            <div style={{ fontSize: 20, color: "#a8a29e" }}>{BRAND_DOMAIN}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 54, lineHeight: 1.2 }}>
            شارت حي وتوصيات {DISPLAY_NAME_AR}
          </div>
          <div style={{ fontSize: 28, color: "#d6d3d1", lineHeight: 1.35 }}>
            Live chart and {DISPLAY_NAME_EN} recommendations — review cards, not
            trade execution.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {["الذهب", "توصيات", "بدون تنفيذ"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                border: "1px solid #44403c",
                borderRadius: 999,
                padding: "8px 18px",
                fontSize: 22,
                color: "#e7e5e4",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Cairo", data: arabic, weight: 600, style: "normal" },
        { name: "Cairo", data: latin, weight: 600, style: "normal" },
      ],
    },
  );
}
