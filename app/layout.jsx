import "./globals.css";
import Providers from "./providers";
import { NavProvider } from "@/components/NavContext";
import { ToastProvider } from "@/components/Toast";
import { ConfirmProvider } from "@/components/Confirm";
import { SuperAdminProvider } from "@/components/SuperAdminContext";
import AppShell from "@/components/AppShell";

export const metadata = {
  title: "Octoscope",
  description: "Read-only auditor for GitHub repo, issue & project hygiene.",
};

// Set the theme class before paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <ToastProvider>
            <ConfirmProvider>
              <NavProvider>
                <SuperAdminProvider>
                  <AppShell>{children}</AppShell>
                </SuperAdminProvider>
              </NavProvider>
            </ConfirmProvider>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
