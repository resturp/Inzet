"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type LoginMode = "password" | "request" | "magic";
type ApiPayload = {
  message?: string;
  error?: string;
  debugAlias?: string;
  debugToken?: string;
  debugMagicLink?: string;
};

async function readApiPayload(response: Response): Promise<ApiPayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as ApiPayload;
    } catch {
      return {};
    }
  }

  const text = await response.text();
  return { error: text || `Serverfout (${response.status})` };
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("password");
  const [bondsnummer, setBondsnummer] = useState("");
  const [requestedAlias, setRequestedAlias] = useState("");
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [magicSetPassword, setMagicSetPassword] = useState("");
  const [magicSetPasswordConfirm, setMagicSetPasswordConfirm] = useState("");
  const [magicLink, setMagicLink] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPasswordLogin, setIsPasswordLogin] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const aliasFromQuery = params.get("alias");
    const tokenFromQuery = params.get("token");
    if (aliasFromQuery) {
      setAlias(aliasFromQuery);
    }
    if (tokenFromQuery) {
      setMode("magic");
      setToken(tokenFromQuery);
      setStatus("Magic link uit URL geladen. Klik op Inloggen.");
    }
  }, []);

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(successMessage);
    } catch {
      setStatus("Kopieren niet gelukt. Selecteer en kopieer handmatig.");
    }
  }

  function validatePasswordPair(a: string, b: string): boolean {
    if (a.length < 8) {
      setStatus("Wachtwoord moet minimaal 8 tekens zijn.");
      return false;
    }
    if (a !== b) {
      setStatus("Wachtwoorden komen niet overeen.");
      return false;
    }
    return true;
  }

  async function onPasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setIsPasswordLogin(true);

    try {
      const response = await fetch("/api/auth/login-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, password })
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        setStatus(payload.error ?? `Inloggen met wachtwoord mislukt (${response.status})`);
      } else {
        setStatus(payload.message ?? "Ingelogd");
        router.push("/tasks");
      }
    } catch {
      setStatus("Netwerkfout bij wachtwoord-login.");
    } finally {
      setIsPasswordLogin(false);
    }
  }

  async function onRequestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setStatus(null);

    try {
      const response = await fetch("/api/auth/request-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bondsnummer,
          email,
          alias: requestedAlias || undefined
        })
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        setStatus(payload.error ?? `Aanvraag mislukt (${response.status})`);
      } else {
        setStatus(payload.message ?? "Magic link verzonden");
        setAlias(payload.debugAlias ?? requestedAlias);
        setToken(payload.debugToken ?? "");
        setMagicLink(payload.debugMagicLink ?? "");
        setMode("magic");
      }
    } catch {
      setStatus("Netwerkfout, probeer opnieuw.");
    } finally {
      setIsLoading(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsVerifying(true);
    setStatus(null);

    if (!validatePasswordPair(magicSetPassword, magicSetPasswordConfirm)) {
      setIsVerifying(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/verify-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias,
          token,
          setPassword: magicSetPassword
        })
      });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        setStatus(payload.error ?? `Verificatie mislukt (${response.status})`);
      } else {
        setStatus(payload.message ?? "Ingelogd");
        router.push("/tasks");
      }
    } catch {
      setStatus("Netwerkfout bij verificatie.");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="grid">
      <h1>Inloggen</h1>
      <section className="card grid">
        <h2>Kies methode</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setMode("password")}>
            Login met wachtwoord
          </button>
          <button type="button" onClick={() => setMode("request")}>
            Vraag magic link
          </button>
          <button type="button" onClick={() => setMode("magic")}>
            Gebruik magic link
          </button>
        </div>
      </section>

      {mode === "password" && (
        <form className="card grid" onSubmit={onPasswordLogin}>
          <h2>Login met alias + wachtwoord</h2>
          <label>
            Alias
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="bijv. JanA2"
              required
            />
          </label>
          <label>
            Wachtwoord
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={isPasswordLogin}>
            {isPasswordLogin ? "Inloggen..." : "Log in"}
          </button>
        </form>
      )}

      {mode === "request" && (
        <form className="card grid" onSubmit={onRequestMagicLink}>
          <h2>Magic link aanvragen</h2>
          <label>
            Bondsnummer
            <input
              type="text"
              value={bondsnummer}
              onChange={(e) => setBondsnummer(e.target.value)}
              placeholder="bijv. ab27386"
              required
            />
          </label>
          <label>
            Alias (verplicht bij eerste keer account aanmaken)
            <input
              type="text"
              value={requestedAlias}
              onChange={(e) => setRequestedAlias(e.target.value)}
              placeholder="bijv. JanA2"
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jouw@email.nl"
              required
            />
          </label>
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Versturen..." : "Stuur magic link"}
          </button>
        </form>
      )}

      {mode === "magic" && (
        <form className="card grid" onSubmit={onVerify}>
          <h2>Inloggen met magic link</h2>
          <label>
            Alias
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="bijv. JanA2"
              required
            />
          </label>
          <label>
            Token
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="magic link token"
              required
            />
          </label>
          <label>
            Nieuw wachtwoord
            <input
              type="password"
              value={magicSetPassword}
              onChange={(e) => setMagicSetPassword(e.target.value)}
              required
            />
          </label>
          <label>
            Herhaal nieuw wachtwoord
            <input
              type="password"
              value={magicSetPasswordConfirm}
              onChange={(e) => setMagicSetPasswordConfirm(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={isVerifying}>
            {isVerifying ? "Verifiëren..." : "Inloggen"}
          </button>
        </form>
      )}

      {magicLink ? (
        <section className="card grid">
          <h2>Dev magic link (zonder mailserver)</h2>
          <label>
            Magic link URL
            <input type="text" value={magicLink} readOnly />
          </label>
          <button
            type="button"
            onClick={() => copyText(magicLink, "Magic link gekopieerd")}
          >
            Kopieer magic link
          </button>
          <label>
            Token
            <input type="text" value={token} readOnly />
          </label>
          <button
            type="button"
            onClick={() => copyText(token, "Token gekopieerd")}
          >
            Kopieer token
          </button>
        </section>
      ) : null}

      {status ? <p className="muted">{status}</p> : null}
    </div>
  );
}
