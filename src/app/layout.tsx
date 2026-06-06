import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Script from "next/script";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Private Fund Manager",
  description: "Admin panel for managing private investment funds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen bg-background`} suppressHydrationWarning>
        <Script id="remove-extension-hydration-attrs" strategy="beforeInteractive">
          {`
            (() => {
              const clean = (root) => {
                if (!root || !root.querySelectorAll) return;
                root.querySelectorAll("[bis_skin_checked]").forEach((node) => {
                  node.removeAttribute("bis_skin_checked");
                });
              };
              clean(document);
              new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                  if (mutation.type === "attributes" && mutation.attributeName === "bis_skin_checked") {
                    mutation.target.removeAttribute("bis_skin_checked");
                  }
                  for (const node of mutation.addedNodes) clean(node);
                }
              }).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
            })();
          `}
        </Script>
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
