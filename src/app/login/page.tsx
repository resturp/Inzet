"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CSRF_FIELD_NAME } from "@/lib/csrf";
import { readCsrfTokenFromCookie } from "@/lib/csrf-client";

type LoginMode = "password" | "request" | "create" | "magic";

type RegistrationOptions = {
  email: string;
  bondsnummer: string;
  claimableAliases: string[];
};

type ApiPayload = {
  message?: string;
  error?: string;
  alias?: string;
  data?: RegistrationOptions;
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

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [requestBondsnummer, setRequestBondsnummer] = useState("");
  const [requestEmail, setRequestEmail] = useState("");

  const [token, setToken] = useState("");
  const [magicAlias, setMagicAlias] = useState("");
  const [magicSetPassword, setMagicSetPassword] = useState("");
  const [magicSetPasswordConfirm, setMagicSetPasswordConfirm] = useState("");

  const [claimableAliases, setClaimableAliases] = useState<string[]>([]);
  const [selectedAlias, setSelectedAlias] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createBondsnummer, setCreateBondsnummer] = useState("");

  const [magicLink, setMagicLink] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState("");

  const [isPasswordLogin, setIsPasswordLogin] = useState(false);
  const [isRequestingMagicLink, setIsRequestingMagicLink] = useState(false);
  const [isLoadingCreateOptions, setIsLoadingCreateOptions] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isVerifyingMagic, setIsVerifyingMagic] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flow = params.get("flow");
    const tokenFromQuery = params.get("token");
    const aliasFromQuery = params.get("alias");

    if (tokenFromQuery) {
      setToken(tokenFromQuery);
    }
    if (aliasFromQuery) {
      setMagicAlias(aliasFromQuery);
    }

    if (flow === "create-account" && tokenFromQuery) {
      setMode("create");
      setStatus("Magic link geladen. Maak nu je account af.");
      return;
    }

    if ((flow === "magic" || (aliasFromQuery && tokenFromQuery)) && tokenFromQuery) {
      setMode("magic");
      setStatus("Magic link uit URL geladen. Klik op Inloggen.");
    }
  }, []);

  useEffect(() => {
    setCsrfToken(readCsrfTokenFromCookie());
  }, []);

  useEffect(() => {
    if (mode !== "create" || !token) {
      return;
    }

    let isCancelled = false;

    async function loadCreateOptions() {
      setIsLoadingCreateOptions(true);
      try {
        const response = await fetch(
          `/api/auth/registration-options?token=${encodeURIComponent(token)}`
        );
        const payload = await readApiPayload(response);

        if (!response.ok || !payload.data) {
          if (!isCancelled) {
            setStatus(payload.error ?? `Magic link laden mislukt (${response.status})`);
          }
          return;
        }

        if (!isCancelled) {
          setCreateEmail(payload.data.email);
          setCreateBondsnummer(payload.data.bondsnummer);
          setClaimableAliases(
            [...payload.data.claimableAliases].sort((left, right) =>
              left.localeCompare(right, "nl-NL", { sensitivity: "base" })
            )
          );
          setSelectedAlias("");
          setStatus("Kies een bestaande alias of verzin een nieuwe alias.");
        }
      } catch {
        if (!isCancelled) {
          setStatus("Netwerkfout bij laden van account-aanmaak.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingCreateOptions(false);
        }
      }
    }

    void loadCreateOptions();

    return () => {
      isCancelled = true;
    };
  }, [mode, token]);

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(successMessage);
    } catch {
      setStatus("Kopieren niet gelukt. Selecteer en kopieer handmatig.");
    }
  }

  function validatePasswordPair(password: string, confirm: string): boolean {
    if (password.length < 8) {
      setStatus("Wachtwoord moet minimaal 8 tekens zijn.");
      return false;
    }
    if (password !== confirm) {
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
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const payload = await readApiPayload(response);

      if (!response.ok) {
        setStatus(payload.error ?? `Inloggen mislukt (${response.status})`);
        return;
      }

      setStatus(payload.message ?? "Ingelogd");
      router.push("/tasks");
    } catch {
      setStatus("Netwerkfout bij inloggen.");
    } finally {
      setIsPasswordLogin(false);
    }
  }

  async function onRequestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setIsRequestingMagicLink(true);

    try {
      const response = await fetch("/api/auth/request-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bondsnummer: requestBondsnummer,
          email: requestEmail
        })
      });
      const payload = await readApiPayload(response);

      if (!response.ok) {
        setStatus(payload.error ?? `Magic link aanvragen mislukt (${response.status})`);
        return;
      }

      setStatus(payload.message ?? "Magic link verstuurd.");
      setMagicLink(payload.debugMagicLink ?? "");

      if (payload.debugToken) {
        setToken(payload.debugToken);
        setMode("create");
      }
    } catch {
      setStatus("Netwerkfout, probeer opnieuw.");
    } finally {
      setIsRequestingMagicLink(false);
    }
  }

  async function onCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    const hasSelectedExistingAlias = selectedAlias.trim().length > 0;
    const hasNewAlias = newAlias.trim().length > 0;
    if (hasSelectedExistingAlias && hasNewAlias) {
      setStatus("Kies een bestaande alias of vul een nieuwe alias in, niet allebei.");
      return;
    }
    if (!hasSelectedExistingAlias && !hasNewAlias) {
      setStatus("Kies een bestaande alias of vul een nieuwe alias in.");
      return;
    }
    if (!validatePasswordPair(createPassword, createPasswordConfirm)) {
      return;
    }

    setIsCreatingAccount(true);
    try {
      const response = await fetch("/api/auth/complete-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          existingAlias: hasSelectedExistingAlias ? selectedAlias.trim() : undefined,
          newAlias: hasNewAlias ? newAlias.trim() : undefined,
          password: createPassword
        })
      });
      const payload = await readApiPayload(response);

      if (!response.ok) {
        setStatus(payload.error ?? `Account aanmaken mislukt (${response.status})`);
        return;
      }

      setStatus(payload.message ?? "Account aangemaakt.");
      router.push("/tasks");
    } catch {
      setStatus("Netwerkfout bij account-aanmaak.");
    } finally {
      setIsCreatingAccount(false);
    }
  }

  async function onVerifyMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    const hasPasswordUpdate =
      magicSetPassword.length > 0 || magicSetPasswordConfirm.length > 0;
    if (hasPasswordUpdate && !validatePasswordPair(magicSetPassword, magicSetPasswordConfirm)) {
      return;
    }

    setIsVerifyingMagic(true);
    try {
      const response = await fetch("/api/auth/verify-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: magicAlias,
          token,
          setPassword: hasPasswordUpdate ? magicSetPassword : undefined
        })
      });
      const payload = await readApiPayload(response);

      if (!response.ok) {
        setStatus(payload.error ?? `Magic link verificatie mislukt (${response.status})`);
        return;
      }

      setStatus(payload.message ?? "Ingelogd");
      router.push("/tasks");
    } catch {
      setStatus("Netwerkfout bij verificatie.");
    } finally {
      setIsVerifyingMagic(false);
    }
  }

  return (
    <div className="grid">
      <h1>Inloggen</h1>

      <section className="card grid">
        <h2>Kies je situatie</h2>
        <p className="muted">
          Je hebt al een account: log in met e-mailadres + wachtwoord. Eerste keer op de
          website: vul je Nevobo relatiecode en e-mailadres in en maak daarna je account.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setMode("password")}>
            Ik heb al een account
          </button>
          <button type="button" onClick={() => setMode("request")}>
            Eerste keer
          </button>
          <button type="button" onClick={() => setMode("magic")}>
            Ik heb een magic link
          </button>
        </div>
      </section>

      {mode === "password" && (
        <form className="card grid" onSubmit={onPasswordLogin}>
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} readOnly />
          <h2>Login met e-mailadres + wachtwoord</h2>
          <label>
            E-mailadres
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="jouw@email.nl"
              required
            />
          </label>
          <label>
            Wachtwoord
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
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
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} readOnly />
          <h2>Eerste keer: vraag je magic link aan</h2>
          <label>
            Nevobo relatiecode
            <input
              type="text"
              value={requestBondsnummer}
              onChange={(e) => setRequestBondsnummer(e.target.value)}
              placeholder="bijv. CQS3S1J"
              required
            />
          </label>
          <label>
            E-mailadres
            <input
              type="email"
              value={requestEmail}
              onChange={(e) => setRequestEmail(e.target.value)}
              placeholder="jouw@email.nl"
              required
            />
          </label>
          <p className="muted">
            Een e-mailadres mag bij meerdere accounts horen. Elke account heeft een eigen
            alias.
          </p>
          <button type="submit" disabled={isRequestingMagicLink}>
            {isRequestingMagicLink ? "Versturen..." : "Stuur magic link"}
          </button>
        </form>
      )}

      {mode === "create" && (
        <form className="card grid" onSubmit={onCreateAccount}>
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} readOnly />
          <h2>Maak account</h2>
          <p className="muted">
            Van sommige vrijwilligers hebben we alvast hun voornaam als alias aangemaakt,
            zodat we bestaande taken konden registreren. Je kunt in deze lijst kijken of dat
            voor jou van toepassing is.
          </p>

          <label>
            E-mailadres uit magic link
            <input type="text" value={createEmail} readOnly />
          </label>
          <label>
            Relatiecode uit magic link
            <input type="text" value={createBondsnummer} readOnly />
          </label>

          <div className="grid" style={{ gap: "0.4rem" }}>
            <strong>Kies een bestaande alias of verzin een nieuwe.</strong>
            {isLoadingCreateOptions ? <p className="muted">Beschikbare aliassen laden...</p> : null}
            {claimableAliases.length > 0 ? (
              <label>
                Bestaande alias claimen (optioneel)
                <select
                  value={selectedAlias}
                  onChange={(e) => {
                    setSelectedAlias(e.target.value);
                    if (e.target.value) {
                      setNewAlias("");
                    }
                  }}
                >
                  <option value="">Geen bestaande alias kiezen</option>
                  {claimableAliases.map((aliasOption) => (
                    <option key={aliasOption} value={aliasOption}>
                      {aliasOption}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted">Er zijn geen ongeclaimde aliassen gevonden voor deze relatiecode.</p>
            )}

            <label>
              Nieuwe alias (optioneel)
              <input
                type="text"
                value={newAlias}
                onChange={(e) => {
                  setNewAlias(e.target.value);
                  if (e.target.value.trim()) {
                    setSelectedAlias("");
                  }
                }}
                placeholder="bijv. JanA2"
              />
            </label>
          </div>

          <label>
            Wachtwoord
            <input
              type="password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              required
            />
          </label>
          <label>
            Herhaal wachtwoord
            <input
              type="password"
              value={createPasswordConfirm}
              onChange={(e) => setCreatePasswordConfirm(e.target.value)}
              required
            />
          </label>

          <button type="submit" disabled={isCreatingAccount || isLoadingCreateOptions}>
            {isCreatingAccount ? "Aanmaken..." : "Maak account"}
          </button>
        </form>
      )}

      {mode === "magic" && (
        <form className="card grid" onSubmit={onVerifyMagicLink}>
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} readOnly />
          <h2>Inloggen met bestaande magic link</h2>
          <label>
            Alias
            <input
              type="text"
              value={magicAlias}
              onChange={(e) => setMagicAlias(e.target.value)}
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
            Nieuw wachtwoord (optioneel)
            <input
              type="password"
              value={magicSetPassword}
              onChange={(e) => setMagicSetPassword(e.target.value)}
            />
          </label>
          <label>
            Herhaal nieuw wachtwoord (optioneel)
            <input
              type="password"
              value={magicSetPasswordConfirm}
              onChange={(e) => setMagicSetPasswordConfirm(e.target.value)}
            />
          </label>
          <button type="submit" disabled={isVerifyingMagic}>
            {isVerifyingMagic ? "Verifieren..." : "Inloggen"}
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
          {token ? (
            <>
              <label>
                Token
                <input type="text" value={token} readOnly />
              </label>
              <button type="button" onClick={() => copyText(token, "Token gekopieerd")}>
                Kopieer token
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {status ? <p className="muted">{status}</p> : null}
    </div>
  );
}
