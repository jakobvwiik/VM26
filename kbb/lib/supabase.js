"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        // Implicit flow puts tokens in the URL hash and needs no stored code-verifier,
        // so password-recovery links work even when opened in a different browser/webview.
        flowType: "implicit",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    }
  );
}
