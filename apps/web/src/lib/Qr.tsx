import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A scannable QR code (inline SVG, dark on white with a quiet zone so TVs and glare still scan). */
export function Qr({ url, size = 160, className }: { url: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(""));
    return () => {
      live = false;
    };
  }, [url]);
  return <div className={`qr ${className ?? ""}`} style={{ width: size, height: size }} title={url} dangerouslySetInnerHTML={{ __html: svg }} />;
}
