import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURA | Your Daily Wellness Reflection Companion",
  description: "A quiet, private space to reflect on your day. Your words are enough; media is always optional.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}