import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fira_Sans, Fira_Code } from "next/font/google";
import "./globals.css";

const firaSans = Fira_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-fira-sans", display: "swap" });
const firaCode = Fira_Code({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-fira-code", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Herrero Pianos — Piano Sales & Service in Davao", template: "%s · Herrero Pianos" },
  description:
    "Herrero Pianos is a Davao-based piano sales and service business for tuning, repair, restoration, transport, buying guidance, and acoustic piano care.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`}>
      <body className="bg-paper text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
