import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? "http://localhost", key ?? "missing-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});

/** Explain an auth failure that came back in the redirect URL (OAuth or email link). */
export function friendlyAuthError(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes("expired") || text.includes("invalid")) {
    return "That sign-in link is invalid or has expired. Please sign in again or request a new link.";
  }
  if (text.includes("flow state") || text.includes("code verifier") || text.includes("code challenge")) {
    return "That sign-in link expired or was opened in a different browser. Please sign in again from this page.";
  }
  if (text.includes("access_denied") || text.includes("denied") || text.includes("cancel")) {
    return "Sign-in was cancelled. Choose a sign-in option to try again.";
  }
  return `Sign-in failed: ${raw}`;
}

/** Turn a Supabase / Postgres error into a sentence a person can act on. */
export function errorMessage(error: unknown): string {
  if (!error) return "Something went wrong.";
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: string }).message);
  }
  return "Something went wrong.";
}
