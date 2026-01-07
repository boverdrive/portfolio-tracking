import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { SettingsProvider } from "@/contexts/SettingsContext";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portfolio Tracker | หุ้น TFEX Crypto",
  description: "ติดตามพอร์ตการลงทุนของคุณ แสดงกำไร/ขาดทุน แบบ Real-time",
  keywords: ["portfolio", "stocks", "crypto", "TFEX", "investment", "tracking"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className={`${inter.variable} antialiased`}>
        <AuthProvider>
          <SettingsProvider>
            {children}
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
