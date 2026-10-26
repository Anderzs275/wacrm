import { ImageResponse } from "next/og";

// Brand favicon — Unno ocean-blue rounded square with a white "U".
// The colour is the default accent (`--primary` of the "ocean" theme in
// globals.css, #1378aa). Next.js renders this at build time and
// auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1378aa",
          borderRadius: 6,
          color: "#ffffff",
          fontSize: 22,
          fontWeight: 700,
        }}
      >
        U
      </div>
    ),
    { ...size },
  );
}
