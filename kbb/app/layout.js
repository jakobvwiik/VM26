import "./globals.css";
import { APP_NAME } from "../lib/config";

export const metadata = {
  title: APP_NAME,
  description: "Privat VM 2026 tippeliga",
};
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0e1a" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
