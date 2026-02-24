import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inzet - VC Zwolle",
  description: "Vrijwilligersportaal voor taken en coordinatie"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body suppressHydrationWarning>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
