import { FormEvent, useEffect, useState } from "react";
import { Icon, Logo } from "../shared";
import {
  sendPasswordReset,
  signInWithPassword,
  signInWithProvider,
  signUp,
} from "../lib/api";
import { errorMessage, supabase } from "../lib/supabase";
import type { Role } from "../lib/types";

const portals: {
  role: Role;
  icon: string;
  tag: string;
  title: string;
  copy: string;
  perks: string[];
  cta: string;
}[] = [
  {
    role: "customer",
    icon: "cart",
    tag: "ORDER",
    title: "Customer",
    copy: "Order meals and groceries, pay on delivery or with GCash, and follow your rider to the door.",
    perks: ["Food & grocery in one basket", "Live order tracking on the map", "Order history & quick reorders"],
    cta: "Continue as customer",
  },
  {
    role: "rider",
    icon: "bike",
    tag: "DELIVER",
    title: "Rider",
    copy: "Pick up open delivery jobs, navigate to customers and update every drop-off as it happens.",
    perks: ["Accept jobs near you", "Share your live location", "Track deliveries & earnings"],
    cta: "Continue as rider",
  },
  {
    role: "admin",
    icon: "shield",
    tag: "MANAGE",
    title: "Admin",
    copy: "Confirm orders, dispatch riders, manage the catalog and watch the business in real time.",
    perks: ["Order & rider dispatch", "Products & inventory", "Sales and rider reports"],
    cta: "Continue as admin",
  },
];

const flow = [
  ["cart", "Customer orders", "Food and groceries checked out in one basket."],
  ["shield", "Admin confirms", "The store confirms, prepares and dispatches a rider."],
  ["bike", "Rider delivers", "The rider accepts, picks up and shares a live location."],
  ["location", "Customer tracks", "Every update lands on the customer's timeline instantly."],
];

export function Landing({ onChoose }: { onChoose: (role: Role) => void }) {
  return (
    <main className="landing">
      <header className="landing-nav content-width">
        <Logo />
        <nav>
          <a href="#portals">Portals</a>
          <a href="#how">How it works</a>
          <button className="button button-primary" onClick={() => onChoose("customer")}>
            Order now
          </button>
        </nav>
      </header>

      <section className="landing-hero content-width">
        <div className="landing-copy">
          <p className="eyebrow">FOOD · GROCERY · EVERYDAY</p>
          <h1>
            Everything you need,
            <br />
            <em>delivered with care.</em>
          </h1>
          <p>
            One connected platform: customers order, our team prepares, riders deliver, and
            everyone follows the same order live.
          </p>
          <div className="landing-actions">
            <button className="button button-primary button-large" onClick={() => onChoose("customer")}>
              Start ordering <Icon name="arrow" />
            </button>
            <a className="button button-soft button-large" href="#portals">
              Choose a portal
            </a>
          </div>
          <dl className="landing-stats">
            <div>
              <dt>30–45 min</dt>
              <dd>Typical delivery</dd>
            </div>
            <div>
              <dt>Live</dt>
              <dd>Rider tracking</dd>
            </div>
            <div>
              <dt>3 portals</dt>
              <dd>One shared order</dd>
            </div>
          </dl>
        </div>
        <div className="landing-photo">
          <img src="/assets/ailyns-hero.png" alt="Chicken adobo and fresh groceries" />
          <div className="delivery-pill">
            <span>
              <Icon name="bike" size={18} />
            </span>
            <div>
              <small>RIDER ON THE WAY</small>
              <strong>Arriving in about 18 min</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="role-section content-width" id="portals">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CHOOSE YOUR PORTAL</p>
            <h2>Who's signing in today?</h2>
          </div>
        </div>
        <div className="role-grid">
          {portals.map((portal) => (
            <article key={portal.role} className={`role-card role-${portal.role}`}>
              <div className="role-card-top">
                <span className="role-icon">
                  <Icon name={portal.icon} size={24} />
                </span>
                <small>{portal.tag}</small>
              </div>
              <h3>{portal.title}</h3>
              <p>{portal.copy}</p>
              <ul>
                {portal.perks.map((perk) => (
                  <li key={perk}>
                    <Icon name="check" size={15} /> {perk}
                  </li>
                ))}
              </ul>
              <button className="role-cta" onClick={() => onChoose(portal.role)}>
                {portal.cta} <Icon name="arrow" size={18} />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="flow-section content-width" id="how">
        <p className="eyebrow">HOW IT CONNECTS</p>
        <h2>One order. Three people. One live timeline.</h2>
        <ol className="flow-steps">
          {flow.map(([icon, title, copy], i) => (
            <li key={title}>
              <span className="flow-icon">
                <Icon name={icon} />
              </span>
              <small>STEP {i + 1}</small>
              <strong>{title}</strong>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="landing-footer content-width">
        <Logo compact />
        <span>© {new Date().getFullYear()} Ailyn's Express · Your everyday food and grocery partner</span>
      </footer>
    </main>
  );
}

const authCopy: Record<Role, { eyebrow: string; title: React.ReactNode; body: string }> = {
  customer: {
    eyebrow: "MADE FOR EVERYDAY MOMENTS",
    title: (
      <>
        Good food.
        <br />
        Fresh finds.
        <br />
        <em>One delivery.</em>
      </>
    ),
    body: "From warm family meals to your weekly grocery list, it's all here, tracked to your door.",
  },
  rider: {
    eyebrow: "AILYN'S EXPRESS RIDERS",
    title: (
      <>
        Ride with us.
        <br />
        <em>Deliver smiles.</em>
      </>
    ),
    body: "Accept open jobs, navigate to customers and keep them updated with your live location.",
  },
  admin: {
    eyebrow: "AILYN'S EXPRESS OPERATIONS",
    title: (
      <>
        Manage every order,
        <br />
        <em>from one place.</em>
      </>
    ),
    body: "Orders, riders, products, inventory and insights, designed for clear daily operations.",
  },
};

export function RoleAuth({
  role,
  notice,
  onBack,
  onSwitchRole,
}: {
  role: Role;
  notice?: string;
  onBack: () => void;
  onSwitchRole: (role: Role) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(notice ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (notice) setInfo(notice);
  }, [notice]);
  const canRegister = role !== "admin";
  const registering = canRegister && mode === "register";
  const copy = authCopy[role];

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get("password") ?? "");
    if (!email.includes("@") || password.length < 6) {
      setError("Enter a valid email and a password with at least 6 characters.");
      return;
    }
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (registering) {
        const { needsConfirmation } = await signUp(email, password, role as "customer" | "rider", {
          full_name: String(data.get("name") ?? "").trim(),
          phone: String(data.get("phone") ?? "").trim(),
          vehicle: String(data.get("vehicle") ?? "").trim() || undefined,
          plate_number: String(data.get("plate") ?? "").trim() || undefined,
        });
        if (needsConfirmation) {
          setInfo(`Check ${email} for a confirmation link, then sign in here.`);
          setMode("login");
        }
      } else {
        await signInWithPassword(email, password, role);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (provider: "google" | "facebook") => {
    setError("");
    try {
      await signInWithProvider(provider, role);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const forgot = async () => {
    if (!email.includes("@")) {
      setError("Type your email address first, then choose “Forgot password?”.");
      return;
    }
    try {
      await sendPasswordReset(email);
      setInfo(`Password reset link sent to ${email}.`);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <main className={`auth-page auth-${role}`}>
      <section className="auth-visual">
        <button className="auth-back" onClick={onBack}>
          <Icon name="back" size={18} /> All portals
        </button>
        <Logo light />
        <div className="auth-quote">
          <p className="eyebrow light">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <div className="auth-mobile-logo">
            <button className="auth-back dark" onClick={onBack}>
              <Icon name="back" size={18} /> All portals
            </button>
            <Logo />
          </div>
          <div className="role-switch" role="tablist" aria-label="Portal">
            {(["customer", "rider", "admin"] as Role[]).map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={r === role}
                className={r === role ? "active" : ""}
                onClick={() => {
                  setMode("login");
                  setError("");
                  setInfo("");
                  onSwitchRole(r);
                }}
              >
                {r === "customer" ? "Customer" : r === "rider" ? "Rider" : "Admin"}
              </button>
            ))}
          </div>
          <p className="eyebrow">
            {role === "customer" ? "WELCOME TO AILYN'S" : role === "rider" ? "RIDER PORTAL" : "ADMIN PORTAL"}
          </p>
          <h1>
            {registering
              ? role === "rider"
                ? "Become a rider"
                : "Create your account"
              : "Welcome back"}
          </h1>
          <p className="muted">
            {registering
              ? role === "rider"
                ? "An admin reviews new riders before you can accept jobs."
                : "Join Ailyn's Express in just a minute."
              : role === "admin"
                ? "Sign in with your administrator account."
                : role === "rider"
                  ? "Sign in to see open delivery jobs."
                  : "Sign in to continue your next delivery."}
          </p>
          {info && <p className="form-info">{info}</p>}
          <form onSubmit={submit}>
            {registering && (
              <>
                <label>
                  Full name
                  <input name="name" placeholder="Juan Dela Cruz" required autoComplete="name" />
                </label>
                <label>
                  Mobile number
                  <input name="phone" placeholder="+63 917 123 4567" required autoComplete="tel" />
                </label>
                {role === "rider" && (
                  <div className="field-pair">
                    <label>
                      Vehicle
                      <select name="vehicle" defaultValue="Motorcycle">
                        <option>Motorcycle</option>
                        <option>Bicycle</option>
                        <option>E-bike</option>
                        <option>Car</option>
                      </select>
                    </label>
                    <label>
                      Plate number
                      <input name="plate" placeholder="ABC 1234" />
                    </label>
                  </div>
                )}
              </>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <span className="password-wrap">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 6 characters"
                  required
                  autoComplete={registering ? "new-password" : "current-password"}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            {error && <p className="form-error">{error}</p>}
            {!registering && (
              <div className="form-options">
                <span />
                <button type="button" className="link" onClick={forgot}>
                  Forgot password?
                </button>
              </div>
            )}
            <button className="button button-primary button-full" type="submit" disabled={busy}>
              {busy
                ? "Please wait…"
                : registering
                  ? role === "rider"
                    ? "Apply as rider"
                    : "Create my account"
                  : role === "admin"
                    ? "Login to dashboard"
                    : "Login to my account"}
            </button>
          </form>
          <div className="divider">
            <span>or continue with</span>
          </div>
          <div className="social-row">
            <button className="button button-outline" onClick={() => oauth("google")}>
              <GoogleMark /> Google
            </button>
            <button className="button button-outline" onClick={() => oauth("facebook")}>
              <FacebookMark /> Facebook
            </button>
          </div>
          {canRegister ? (
            <p className="switch-auth">
              {mode === "login"
                ? role === "rider"
                  ? "Want to ride with us?"
                  : "New to Ailyn's Express?"
                : "Already have an account?"}{" "}
              <button
                onClick={() => {
                  setError("");
                  setMode(mode === "login" ? "register" : "login");
                }}
              >
                {mode === "login" ? (role === "rider" ? "Apply now" : "Create account") : "Sign in"}
              </button>
            </p>
          ) : (
            <p className="switch-auth">Admin accounts are issued by the system owner.</p>
          )}
        </div>
      </section>
    </main>
  );
}

export function ResetPassword({ onDone }: { onDone: (message: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else onDone("Password updated");
  };
  return (
    <div className="modal-backdrop">
      <form className="info-modal" onSubmit={submit}>
        <div className="modal-title">
          <div>
            <p className="eyebrow">ACCOUNT RECOVERY</p>
            <h2>Set a new password</h2>
          </div>
        </div>
        <div className="field-grid single">
          <label>
            New password
            <input name="password" type="password" autoComplete="new-password" required />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-buttons">
          <button className="button button-primary" disabled={busy}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </div>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"
      />
    </svg>
  );
}
