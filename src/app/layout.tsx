import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FOOTER, SITE_NAME, TAGLINE } from "@/lib/copy";
import "./globals.css";

// One sans font for everything, and a mono font only for domains and email
// addresses. globals.css maps them to --font-sans and --font-mono.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: SITE_NAME,
  description: TAGLINE,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div className="app">
          {children}
          <footer className="footer">
            <p>{FOOTER}</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
