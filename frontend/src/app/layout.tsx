import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hệ Thống Camera Live Stream",
  description:
    "WebRTC (WHEP) + MediaMTX – Độ trễ < 0.5s, Passthrough, On-Demand",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
