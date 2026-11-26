import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Icon, Logo, Notify, Spinner, Tone } from "./shared";
import { errorMessage, friendlyAuthError, supabase, supabaseConfigured } from "./lib/supabase";
import { becomeRider, clearIntent, fetchMyProfile, peekIntent, signOut } from "./lib/api";
import type { Profile, Role } from "./lib/types";
import { Landing, ResetPassword, RoleAuth } from "./pages/landing";
import { CustomerApp } from "./pages/user";
import { RiderApp } from "./pages/rider";
import { AdminApp } from "./pages/admin";

const FRESH_ACCOUNT_MS = 15 * 60 * 1000;

const asRole = (value: string | null): Role | null =>
  value === "customer" || value === "rider" || value === "admin" ? value : null;

const initialPortal = (): Role | null => asRole(new URLSearchParams(window.location.search).get("portal"));

/**
 * After start-up, find an auth failure left in the URL: an explicit error from Supabase / the
 * provider, or a PKCE `code` that the client could not exchange (expired, already used, or the
 * link was opened in a different browser than the one that started sign-in).
 */
const readUrlAuthError = (): string | null => {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const raw =
    query.get("error_description") ||
    hash.get("error_description") ||
    query.get("error") ||
    hash.get("error");
  if (raw) return friendlyAuthError(raw);
  if (query.get("code")) return friendlyAuthError("flow state");
  return null;
};

const AUTH_URL_KEYS = ["code", "error", "error_code", "error_description", "portal", "type"];
const cleanAuthParams = () => {
  const url = new URL(window.location.href);
  const hadQuery = AUTH_URL_KEYS.some((k) => url.searchParams.has(k));
  const hadHashAuth = /(^|[#&])(error|access_token|error_description)=/.test(url.hash);
  if (!hadQuery && !hadHashAuth) return;
  for (const k of AUTH_URL_KEYS) url.searchParams.delete(k);
  if (hadHashAuth) url.hash = "";
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
};

type AuthNotice = { text: string; error: boolean };

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [portal, setPortal] = useState<Role | null>(initialPortal);
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback<Notify>((message, tone = "success") => {
    setToast({ message, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "error" ? 5500 : 2800);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setBooting(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) {
        const failure = readUrlAuthError();
        if (failure) {
          setPortal(peekIntent()?.role ?? initialPortal() ?? "customer");
          setAuthNotice({ text: failure, error: true });
          clearIntent();
        }
        setBooting(false);
      }
      cleanAuthParams();
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(next);
      if (!next) {
        setProfile(null);
        setBooting(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setBooting(true);
    (async () => {
      try {
        let p = await fetchMyProfile(userId);
        const intent = peekIntent();
        if (p && intent) {
          // Signed in from the rider portal with a brand-new OAuth account: make it a rider.
          if (intent.role === "rider" && p.role === "customer") {
            if (Date.now() - new Date(p.created_at).getTime() < FRESH_ACCOUNT_MS) {
              await becomeRider({});
              p = await fetchMyProfile(userId);
            } else {
              notify("This account is registered as a customer, so we opened the customer app.", "info");
            }
          }
          if (intent.role === "admin" && p?.role !== "admin") {
            clearIntent();
            await signOut();
            if (!cancelled) {
              setPortal("admin");
              setAuthNotice({ text: "That account doesn't have admin access.", error: true });
            }
            return;
          }
        }
        clearIntent();
        if (!cancelled) {
          setAuthNotice(null);
          setProfile(p);
        }
      } catch (e) {
        if (!cancelled) notify(errorMessage(e), "error");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, notify]);

  // Drop OAuth / portal query strings once signed in so refreshes stay clean.
  useEffect(() => {
    if (session) cleanAuthParams();
  }, [session]);

  let content: React.ReactNode;
  if (!supabaseConfigured) {
    content = (
      <main className="config-error">
        <Logo />
        <h1>Supabase is not configured</h1>
        <p>
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in{" "}
          <code>.env.local</code> (or in the Vercel project settings) and reload.
        </p>
      </main>
    );
  } else if (booting) {
    content = (
      <main className="boot-screen">
        <Logo />
        <Spinner label="Signing you in" />
      </main>
    );
  } else if (!session || !profile) {
    content =
      session && !profile ? (
        <main className="config-error">
          <Logo />
          <h1>We couldn't load your profile</h1>
          <p>Please sign in again. If this keeps happening, contact the Ailyn's Express team.</p>
          <button className="button button-primary" onClick={() => void signOut()}>
            Sign out
          </button>
        </main>
      ) : portal ? (
        <RoleAuth
          key={portal}
          role={portal}
          notice={authNotice?.text}
          noticeIsError={authNotice?.error}
          onBack={() => {
            setAuthNotice(null);
            setPortal(null);
          }}
          onSwitchRole={(r) => {
            setAuthNotice(null);
            setPortal(r);
          }}
        />
      ) : (
        <Landing onChoose={setPortal} />
      );
  } else if (profile.role === "admin") {
    content = <AdminApp profile={profile} setProfile={setProfile} notify={notify} />;
  } else if (profile.role === "rider") {
    content = <RiderApp profile={profile} setProfile={setProfile} notify={notify} />;
  } else {
    content = <CustomerApp profile={profile} setProfile={setProfile} notify={notify} />;
  }

  return (
    <div className="app">
      {toast && (
        <button
          type="button"
          className={`toast toast-${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
          onClick={() => setToast(null)}
          title="Dismiss"
        >
          <Icon name={toast.tone === "error" ? "alert" : toast.tone === "info" ? "info" : "check"} size={17} />
          {toast.message}
        </button>
      )}
      {content}
      {recovery && (
        <ResetPassword
          onDone={(message) => {
            setRecovery(false);
            notify(message);
          }}
        />
      )}
    </div>
  );
}

export default App;
