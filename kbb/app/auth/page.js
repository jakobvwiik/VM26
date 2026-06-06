"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase";
import { APP_NAME, isAdminEmail, VIPPS_NUMBER } from "../../lib/config";

export default function AuthPage() {
  const supabase = createClient();
  const router = useRouter();
  const [mode, setMode] = useState("register"); // or "login"
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [paid, setPaid] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
  }, []);

  async function submit() {
    setMsg(""); setBusy(true);
    try {
      if (mode === "register") {
        if (!name.trim() || !email.trim() || pass.length < 6) {
          setMsg("Navn, e-post og passord med minst 6 tegn er påkrevd."); setBusy(false); return;
        }
        const isAdmin = isAdminEmail(email);
        if (!isAdmin && !paid) {
          setMsg("Du må bekrefte at du har sendt 200 NOK i innskudd til Henrik før du blir med."); setBusy(false); return;
        }
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password: pass,
          options: { data: { name: name.trim(), nick: nick.trim(), paid: isAdmin ? false : paid } },
        });
        if (error) { setMsg(error.message); setBusy(false); return; }
        // If email confirmation is OFF (recommended for friends), a session exists now.
        const { data } = await supabase.auth.getSession();
        if (data.session) { router.replace("/"); return; }
        setMsg("Konto opprettet. Sjekk e-posten din for å bekrefte, kom så tilbake og logg inn.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(), password: pass,
        });
        if (error) { setMsg(error.message); setBusy(false); return; }
        router.replace("/");
      }
    } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  }

  async function forgotPassword() {
    setMsg("");
    if (!email.trim()) { setMsg("Skriv inn e-posten din først, så sender vi en tilbakestillingslenke."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/reset` : undefined,
    });
    if (error) setMsg(error.message);
    else setMsg("Sjekk e-posten din — vi har sendt en lenke for å sette nytt passord.");
    setBusy(false);
  }

  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 440, width: "100%" }}>
        <div className="logo" style={{ marginBottom: 4 }}>Kælles <span className="g">kule</span></div>
        <div className="sub" style={{ marginBottom: 18 }}>Privat VM 2026 tippeliga</div>

        <div className="nav" style={{ marginTop: 0 }}>
          <button className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>Registrer</button>
          <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Logg inn</button>
        </div>

        {mode === "register" && (
          <>
            <div className="field"><label>Navn *</label>
              <input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="Fullt navn" /></div>
            <div className="field"><label>Kallenavn (valgfritt)</label>
              <input className="inp" value={nick} onChange={e => setNick(e.target.value)} placeholder="f.eks. Orakelet" /></div>
          </>
        )}
        <div className="field"><label>E-post *</label>
          <input className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" /></div>
        <div className="field"><label>Passord *</label>
          <input className="inp" type="password" value={pass} onChange={e => setPass(e.target.value)}
            placeholder="minst 6 tegn" onKeyDown={e => e.key === "Enter" && submit()} /></div>

        {mode === "register" && !isAdminEmail(email) && (
          <div style={{ background: "rgba(255,206,58,.07)", border: "1px solid #6a5410", borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 12 }}>
              Innskuddet er <strong style={{ color: "var(--gold)" }}>200 kr</strong>. Vipps til <strong style={{ color: "var(--gold)" }}>{VIPPS_NUMBER}</strong> før du blir med.
            </div>
            <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer", color: "var(--ink)" }}>
              <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)}
                style={{ width: 26, height: 26, flexShrink: 0, accentColor: "var(--teal)", cursor: "pointer", marginTop: 1 }} />
              <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>
                Jeg bekrefter at jeg har vippset 200 kr til {VIPPS_NUMBER}.
              </span>
            </label>
          </div>
        )}

        <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={submit}>
          {busy ? "…" : mode === "register" ? "Opprett konto →" : "Gå inn →"}
        </button>

        {mode === "login" && (
          <button onClick={forgotPassword} disabled={busy}
            style={{ background: "none", border: "none", color: "var(--teal)", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, marginTop: 12, padding: 0, width: "100%", textAlign: "center" }}>
            Glemt passord?
          </button>
        )}

        {msg && <p className="note" style={{ marginTop: 12, color: "var(--accent2)" }}>{msg}</p>}
        <div className="hint">Alle deler én liga. Registrer deg én gang, så følger tipsene dine deg på alle enheter du logger inn fra.</div>
      </div>
    </div>
  );
}
