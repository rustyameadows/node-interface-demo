import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Node Interface Demo",
  description: "Local-first node-based image/video/text generation studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
