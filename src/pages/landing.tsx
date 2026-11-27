import { FormEvent, useEffect, useState } from "react";
import { Icon, Logo } from "../shared";
import {
  sendPasswordReset,
  signInWithPassword,
  signInWithGoogle,
  signUp,
} from "../lib/api";
import { errorMessage, supabase } from "../lib/supabase";
import {
  installPlatform,
  launchedAsApp,
  promptInstall,
  useInstallPrompt,
  type InstallPlatform,
} from "../lib/pwa";
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

const scrollToInstall = () =>
  document.getElementById("install")?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Landing({ onChoose }: { onChoose: (role: Role) => void }) {
  const { canPrompt, installed } = useInstallPrompt();
  // One-tap install where the browser supports it; otherwise jump to the step-by-step guide.
  const install = async () => {
    if ((await promptInstall()) === "unavailable") scrollToInstall();
  };
  return (
    <main className="landing">
      <header className="landing-nav content-width">
        <Logo />
        <nav>
          <a href="#portals">Portals</a>
          <a href="#how">How it works</a>
          {!installed && (
            <button
              className="button button-soft nav-install"
              onClick={() => void install()}
              aria-label="Install app"
              title="Install the Ailyn's Express app"
            >
              <Icon name="download" size={18} />
              <span>Install app</span>
            </button>
          )}
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

      {!launchedAsApp && (
        <InstallSection canPrompt={canPrompt} installed={installed} onInstall={() => void install()} />
      )}

      <footer className="landing-footer content-width">
        <Logo compact />
        <span>© {new Date().getFullYear()} Ailyn's Express · Your everyday food and grocery partner</span>
        <nav className="legal-links" aria-label="Legal">
          <a href="/privacy">Privacy Policy</a>
          <a href="/data-deletion">Data Deletion</a>
        </nav>
      </footer>
    </main>
  );
}

const installGuides: Record<InstallPlatform, { label: string; steps: React.ReactNode[]; note: string }> = {
  ios: {
    label: "iPhone & iPad",
    steps: [
      <>
        Open this page in <b>Safari</b>.
      </>,
      <>
        Tap the{" "}
        <span className="install-key">
          <Icon name="share" size={14} /> Share
        </span>{" "}
        button in the toolbar.
      </>,
      <>
        Scroll down, tap{" "}
        <span className="install-key">
          <Icon name="addbox" size={14} /> Add to Home Screen
        </span>
        , then tap <b>Add</b>.
      </>,
    ],
    note: "On iOS 16.4 and later, Chrome and Edge also have Add to Home Screen in their Share menu.",
  },
  android: {
    label: "Android",
    steps: [
      <>
        Open this page in <b>Chrome</b>.
      </>,
      <>
        Tap the{" "}
        <span className="install-key">
          <Icon name="dots" size={14} /> menu
        </span>{" "}
        at the top right.
      </>,
      <>
        Tap <b>Install app</b> (or <b>Add to Home screen</b>), then confirm.
      </>,
    ],
    note: "Samsung Internet: open the menu, then Add page to → Home screen.",
  },
  desktop: {
    label: "Computer",
    steps: [
      <>
        Open this page in <b>Chrome</b> or <b>Edge</b> on Windows, Mac or Chromebook.
      </>,
      <>
        Click the{" "}
        <span className="install-key">
          <Icon name="download" size={14} /> install
        </span>{" "}
        icon at the right end of the address bar, or look for <b>Install</b> in the browser menu.
      </>,
      <>
        Click <b>Install</b>. Ailyn's Express opens in its own window and gets a desktop shortcut.
      </>,
    ],
    note: "Safari on Mac: File → Add to Dock. Firefox can't install web apps yet, so use Chrome or Edge.",
  },
};

function InstallSection({
  canPrompt,
  installed,
  onInstall,
}: {
  canPrompt: boolean;
  installed: boolean;
  onInstall: () => void;
}) {
  const [device, setDevice] = useState<InstallPlatform>(installPlatform);
  const guide = installGuides[device];
  return (
    <section className="install-section content-width" id="install" aria-labelledby="install-title">
      <div className="install-copy">
        <p className="eyebrow">GET THE APP</p>
        <h2 id="install-title">
          Ailyn's Express, <em>right on your home screen.</em>
        </h2>
        <p>
          Install it in a few seconds, with no app store and no big download. It opens full-screen like
          any other app on your phone, tablet or computer.
        </p>
        <ul className="install-perks">
          <li>
            <span>
              <Icon name="bolt" size={18} />
            </span>
            <div>
              <strong>Opens in one tap</strong>
              <small>From your home screen, dock or taskbar</small>
            </div>
          </li>
          <li>
            <span>
              <Icon name="smartphone" size={18} />
            </span>
            <div>
              <strong>Full-screen view</strong>
              <small>No browser bars around your order</small>
            </div>
          </li>
          <li>
            <span>
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>One app, three portals</strong>
              <small>For customers, riders and admins</small>
            </div>
          </li>
        </ul>

        {installed ? (
          <p className="install-done" role="status">
            <Icon name="check" size={18} /> Installed! Open Ailyn's Express from your home screen or app list.
          </p>
        ) : (
          <>
            {canPrompt && (
              <div className="install-cta">
                <button className="button button-primary button-large" onClick={onInstall}>
                  <Icon name="download" /> Install Ailyn's Express
                </button>
                <small>Free · takes a few seconds</small>
              </div>
            )}
            <div className="install-guide">
              <div className="role-switch" role="group" aria-label="Show install steps for">
                {(Object.keys(installGuides) as InstallPlatform[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={device === key}
                    className={device === key ? "active" : ""}
                    onClick={() => setDevice(key)}
                  >
                    {installGuides[key].label}
                  </button>
                ))}
              </div>
              <ol className="install-steps">
                {guide.steps.map((step, i) => (
                  <li key={i}>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="install-note">{guide.note}</p>
            </div>
          </>
        )}
      </div>

      <div className="install-visual" aria-hidden="true">
        <div className="phone">
          <div className="phone-screen">
            <div className="phone-status">
              <span>10:30</span>
              <i />
              <b />
            </div>
            <div className="phone-head">
              <span className="logo-mark">AE</span>
              <div>
                <small>DELIVER TO</small>
                <strong>Home</strong>
              </div>
            </div>
            <img src="/assets/ailyns-hero.png" alt="" />
            <div className="phone-card">
              <span>
                <Icon name="bike" size={15} />
              </span>
              <div>
                <small>RIDER ON THE WAY</small>
                <strong>Arriving in about 18 min</strong>
              </div>
            </div>
            <div className="phone-grid">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="phone-tabs">
              <Icon name="home" size={17} />
              <Icon name="food" size={17} />
              <Icon name="bag" size={17} />
              <Icon name="orders" size={17} />
              <Icon name="cart" size={17} />
            </div>
          </div>
        </div>
        <div className="home-icon">
          <img src="/icons/icon-192.png" alt="" />
          <span>Ailyn's</span>
        </div>
      </div>
    </section>
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
  noticeIsError = false,
  onBack,
  onSwitchRole,
}: {
  role: Role;
  notice?: string;
  noticeIsError?: boolean;
  onBack: () => void;
  onSwitchRole: (role: Role) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  // A problem from the previous sign-in attempt (e.g. a failed Google redirect).
  const [banner, setBanner] = useState(noticeIsError ? (notice ?? "") : "");
  const [info, setInfo] = useState(noticeIsError ? "" : (notice ?? ""));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!notice) return;
    if (noticeIsError) setBanner(notice);
    else setInfo(notice);
  }, [notice, noticeIsError]);
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
    setBanner("");
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

  const googleSignIn = async () => {
    setError("");
    setBanner("");
    try {
      await signInWithGoogle(role);
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
                  setBanner("");
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
          {banner && (
            <p className="form-error" role="alert">
              {banner}
            </p>
          )}
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
                  : "Login"}
            </button>
          </form>
          <div className="divider">
            <span>or continue with</span>
          </div>
          <div className="social-row">
            <button className="button button-outline" onClick={googleSignIn}>
              <GoogleMark /> Google
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
