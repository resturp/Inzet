import type { Metadata } from "next";
import { CsrfFetchBridge } from "@/components/csrf-fetch-bridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inzet - VC Zwolle",
  description: "Vrijwilligersportaal voor taken en coordinatie"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body suppressHydrationWarning>
        <CsrfFetchBridge />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
