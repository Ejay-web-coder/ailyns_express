import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Icon, Logo, Spinner } from "./shared";
import { errorMessage, supabase, supabaseConfigured } from "./lib/supabase";
import { becomeRider, clearIntent, fetchMyProfile, peekIntent, signOut } from "./lib/api";
import type { Profile, Role } from "./lib/types";
import { Landing, ResetPassword, RoleAuth } from "./pages/landing";
import { CustomerApp } from "./pages/user";
import { RiderApp } from "./pages/rider";
import { AdminApp } from "./pages/admin";

const FRESH_ACCOUNT_MS = 15 * 60 * 1000;

const initialPortal = (): Role | null => {
  const portal = new URLSearchParams(window.location.search).get("portal");
  return portal === "customer" || portal === "rider" || portal === "admin" ? portal : null;
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [portal, setPortal] = useState<Role | null>(initialPortal);
  const [authNotice, setAuthNotice] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number>();

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setBooting(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setBooting(false);
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
              notify("This account is registered as a customer, so we opened the customer app.");
            }
          }
          if (intent.role === "admin" && p?.role !== "admin") {
            clearIntent();
            await signOut();
            if (!cancelled) {
              setPortal("admin");
              setAuthNotice("That account doesn't have admin access.");
            }
            return;
          }
        }
        clearIntent();
        if (!cancelled) setProfile(p);
      } catch (e) {
        if (!cancelled) notify(errorMessage(e));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, notify]);

  // Drop OAuth / portal query strings once handled so refreshes stay clean.
  useEffect(() => {
    if (window.location.search && session) window.history.replaceState(null, "", window.location.pathname);
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
          notice={authNotice}
          onBack={() => {
            setAuthNotice("");
            setPortal(null);
          }}
          onSwitchRole={(r) => {
            setAuthNotice("");
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
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {toast}
        </div>
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
