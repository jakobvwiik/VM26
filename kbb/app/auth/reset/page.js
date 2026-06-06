"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase";

export default function ResetPage() {
  const supabase = createClient();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // The auth state change fires with a recovery session once the link is processed.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) { setReady(true); setMsg(""); }
    });

    async function establish() {
      // 1) Already have a session?
      const { data: s0 } = await supabase.auth.getSession();
      if (s0.session) { if (!cancelled) setReady(true); return; }

      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const hash = window.location.hash.startsWith("#")
          ? new URLSearchParams(window.location.hash.slice(1)) : null;

        if (code) {
          // PKCE-style link: exchange the code for a session
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (hash && hash.get("access_token")) {
          // Hash-style link: set the session directly from the tokens
          const { error } = await supabase.auth.setSession({
            access_token: hash.get("access_token"),
            refresh_token: hash.get("refresh_token"),
          });
          if (error) throw error;
        }
      } catch (e) {
        if (!cancelled) setMsg(e.message || "Kunne ikke lese tilbakestillingslenken.");
      }

      const { data: s1 } = await supabase.auth.getSession();
      if (!cancelled) {
        setReady(true);
        if (!s1.session) {
          setMsg("Lenken er ugyldig eller utløpt. Be om en ny tilbakestillingslenke fra innloggingssiden.");
        }
      }
    }
    establish();

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  async function save() {
    setMsg("");
    if (pass.length < 6) { setMsg("Passordet må ha minst 6 tegn."); return; }
    if (pass !== pass2) { setMsg("Passordene er ikke like."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    if (error) { setMsg(error.message); setBusy(false); return; }
    setDone(true); setBusy(false);
    setTimeout(() => router.replace("/"), 1500);
  }

  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 440, width: "100%" }}>
        <div className="logo" style={{ marginBottom: 4 }}>Kælles <span className="g">kule</span></div>
        <div className="sub" style={{ marginBottom: 18 }}>Sett nytt passord</div>

        {!ready ? <p className="note">Laster…</p> : done ? (
          <p className="note" style={{ color: "var(--teal)" }}>Passordet er endret. Logger deg inn…</p>
        ) : (
          <>
            <div className="field"><label>Nytt passord</label>
              <input className="inp" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="minst 6 tegn" /></div>
            <div className="field"><label>Gjenta nytt passord</label>
              <input className="inp" type="password" value={pass2} onChange={e => setPass2(e.target.value)}
                placeholder="gjenta" onKeyDown={e => e.key === "Enter" && save()} /></div>
            <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={save}>
              {busy ? "…" : "Lagre nytt passord"}
            </button>
          </>
        )}

        {msg && <p className="note" style={{ marginTop: 12, color: "var(--accent2)" }}>{msg}</p>}
        <div className="hint"><a href="/auth" style={{ color: "var(--teal)" }}>← Tilbake til innlogging</a></div>
      </div>
    </div>
  );
}
