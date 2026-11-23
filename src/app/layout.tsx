import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACI Audit and Fix",
  description:
    "ACI Audit and Fix — Zero-Trust Cisco ACI Policy Auditing & Declarative Terraform/OPA Remediation powered by Model Context Protocol (MCP) and Groq.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f4f6f9] text-slate-800 antialiased selection:bg-[#049fd9]/20 selection:text-[#0d274d]">
        {children}
      </body>
    </html>
  );
}
