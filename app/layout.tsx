import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import PhantomSdkProvider from "../components/providers/PhantomSdkProvider";

export const metadata: Metadata = {
  title: "RUNARA",
  description: "Bright atmospheric tactical run prototype.",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <PhantomSdkProvider>{children}</PhantomSdkProvider>
      </body>
    </html>
  );
}
