import type { Metadata } from "next";
import { TRPCProvider } from "@/components/providers";
import "./globals.css";
import {
  Space_Grotesk,
  Inter,
  JetBrains_Mono,
  Newsreader,
  Manrope,
} from "next/font/google";
import { cn } from "@/lib/utils";

// Display / headline font: Space Grotesk
// Geometric precision with enough warmth for editorial UI.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

// Body / UI font: Inter
// High legibility for dense workflow copy and tables.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// Mono / data font: JetBrains Mono
// For IDs, numeric data, and benchmark runtime details.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dashboard-display",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dashboard-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quoin - Benchmarking Platform",
  description:
    "Governed ENERGY STAR Portfolio Manager benchmarking, local utility data governance, and submission workflow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "light font-sans antialiased",
        spaceGrotesk.variable,
        inter.variable,
        jetbrainsMono.variable,
        newsreader.variable,
        manrope.variable,
      )}
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-screen bg-background text-foreground">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
