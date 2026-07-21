import "@oceanleo/ui/theme/globals.css";
import "@oceanleo/ui/theme/ui.css";
import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  applicationName: "OceanLeo Website",
  title: "Website",
  description: "OceanLeo isolated website application",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
