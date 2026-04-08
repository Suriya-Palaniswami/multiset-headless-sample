import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthGate } from "@/components/AuthGate";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Multiset AR Editor",
  description: "Web-based AR authoring for Multiset maps",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-zinc-950 text-zinc-100 antialiased`}>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
