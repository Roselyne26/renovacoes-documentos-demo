import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Renovações — Demonstração", description: "Renovações de LTCAT, PGR e PCMSO",
  robots: { index: true, follow: true }
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
