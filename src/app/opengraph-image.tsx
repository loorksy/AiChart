import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_DOMAIN, BRAND_WORDMARK } from "@/lib/brand";
import { OG_DESCRIPTION_AR, OG_TITLE_AR } from "@/lib/seo";
import { shapeOgArabic } from "@/lib/ogArabic";

export const alt = OG_TITLE_AR;
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
  const title = shapeOgArabic(OG_TITLE_AR);
  const description = shapeOgArabic(OG_DESCRIPTION_AR);

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
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: "#c9a227",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              marginRight: 20,
            }}
          >
            <div
              style={{
                display: "block",
                fontSize: 36,
                letterSpacing: 4,
                fontFamily: "CairoLatin",
              }}
            >
              {BRAND_WORDMARK}
            </div>
            <div
              style={{
                display: "block",
                fontSize: 20,
                color: "#a8a29e",
                fontFamily: "CairoLatin",
              }}
            >
              {BRAND_DOMAIN}
            </div>
          </div>
          <img src={markSrc} width={72} height={72} alt="" />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "flex-end",
            }}
          >
            <div
              style={{
                display: "block",
                direction: "ltr",
                fontSize: 56,
                lineHeight: 1.25,
                fontFamily: "CairoArabic",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "flex-end",
              marginTop: 20,
            }}
          >
            <div
              style={{
                display: "block",
                direction: "ltr",
                fontSize: 30,
                color: "#d6d3d1",
                lineHeight: 1.4,
                fontFamily: "CairoArabic",
                whiteSpace: "nowrap",
              }}
            >
              {description}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "flex-end",
          }}
        >
          <div
            style={{
              display: "block",
              fontSize: 20,
              color: "#a8a29e",
              fontFamily: "CairoLatin",
            }}
          >
            {BRAND_DOMAIN}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "CairoArabic", data: arabic, weight: 600, style: "normal" },
        { name: "CairoLatin", data: latin, weight: 600, style: "normal" },
      ],
    },
  );
}
