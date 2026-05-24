import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

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
        <Script
          id="strip-extension-hydration-attrs"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                const clean = (root) => {
                  if (!root || !root.querySelectorAll) return;
                  root.querySelectorAll("[bis_skin_checked]").forEach((node) => {
                    node.removeAttribute("bis_skin_checked");
                  });
                };

                clean(document);

                const observer = new MutationObserver((mutations) => {
                  for (const mutation of mutations) {
                    if (mutation.type === "attributes" && mutation.attributeName === "bis_skin_checked") {
                      mutation.target.removeAttribute("bis_skin_checked");
                    }
                    for (const node of mutation.addedNodes) {
                      if (node.nodeType === 1) {
                        node.removeAttribute?.("bis_skin_checked");
                        clean(node);
                      }
                    }
                  }
                });

                observer.observe(document.documentElement, {
                  attributes: true,
                  attributeFilter: ["bis_skin_checked"],
                  childList: true,
                  subtree: true,
                });

                window.addEventListener("load", () => {
                  clean(document);
                  window.setTimeout(() => observer.disconnect(), 5000);
                }, { once: true });
              })();
            `,
          }}
        />
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
