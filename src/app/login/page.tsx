"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CSRF_FIELD_NAME } from "@/lib/csrf";
import { readCsrfTokenFromCookie } from "@/lib/csrf-client";

type LoginMode = "password" | "request" | "create" | "magic" | "setupLoginName";

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

  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [requestBondsnummer, setRequestBondsnummer] = useState("");
  const [requestEmail, setRequestEmail] = useState("");

  const [token, setToken] = useState("");
  const [magicAlias, setMagicAlias] = useState("");
  const [setupLoginName, setSetupLoginName] = useState("");
  const [claimableAliases, setClaimableAliases] = useState<string[]>([]);
  const [selectedAlias, setSelectedAlias] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [createLoginName, setCreateLoginName] = useState("");
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
  const hasAttemptedMagicVerify = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flow = params.get("flow");
    const modeFromQuery = params.get("mode");
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

    if (flow === "setup-login-name" && tokenFromQuery && aliasFromQuery) {
      setMode("setupLoginName");
      setStatus("Verplichte stap: stel nu je loginnaam in.");
      return;
    }

    if ((flow === "magic" || (aliasFromQuery && tokenFromQuery)) && tokenFromQuery) {
      setMode("magic");
      setStatus("Magic link geladen. Verificatie loopt...");
      return;
    }

    if (
      modeFromQuery === "password" ||
      modeFromQuery === "request" ||
      modeFromQuery === "magic"
    ) {
      setMode(modeFromQuery);
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
          setNewAlias("");
          setStatus("Kies een bestaande alias of vul een nieuwe alias in.");
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

  useEffect(() => {
    if (mode !== "magic" || !token || !magicAlias || hasAttemptedMagicVerify.current) {
      return;
    }
    hasAttemptedMagicVerify.current = true;

    let isCancelled = false;

    async function verifyMagicLink() {
      setIsVerifyingMagic(true);
      try {
        const response = await fetch("/api/auth/verify-magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alias: magicAlias,
            token
          })
        });
        const payload = await readApiPayload(response);
        if (!response.ok) {
          if (!isCancelled) {
            setStatus(payload.error ?? `Magic link verificatie mislukt (${response.status})`);
          }
          return;
        }
        if (!isCancelled) {
          setStatus(payload.message ?? "Ingelogd");
          router.push("/tasks");
        }
      } catch {
        if (!isCancelled) {
          setStatus("Netwerkfout bij verificatie.");
        }
      } finally {
        if (!isCancelled) {
          setIsVerifyingMagic(false);
        }
      }
    }

    void verifyMagicLink();

    return () => {
      isCancelled = true;
    };
  }, [magicAlias, mode, router, token]);

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
        body: JSON.stringify({ loginName, password: loginPassword })
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

      setStatus(
        payload.message ??
          "Magic link verstuurd. Open de link uit je e-mail om accountaanmaak te starten."
      );
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

    const hasSelectedAlias = selectedAlias.trim().length > 0;
    const hasNewAlias = newAlias.trim().length > 0;
    if (hasSelectedAlias && hasNewAlias) {
      setStatus("Kies een bestaande alias of vul een nieuwe alias in, niet allebei.");
      return;
    }
    if (!hasSelectedAlias && !hasNewAlias) {
      setStatus("Kies een bestaande alias of vul een nieuwe alias in.");
      return;
    }

    const alias = hasSelectedAlias ? selectedAlias.trim() : newAlias.trim();
    const normalizedLoginName = createLoginName.trim().toLowerCase();
    if (!normalizedLoginName) {
      setStatus("Loginnaam is verplicht.");
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
          bondsnummer: createBondsnummer,
          alias,
          loginName: normalizedLoginName,
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

  async function onSetupLoginName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    const normalizedLoginName = setupLoginName.trim().toLowerCase();
    if (!normalizedLoginName) {
      setStatus("Loginnaam is verplicht.");
      return;
    }

    setIsCreatingAccount(true);
    try {
      const response = await fetch("/api/auth/complete-login-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: magicAlias,
          token,
          loginName: normalizedLoginName
        })
      });
      const payload = await readApiPayload(response);

      if (!response.ok) {
        setStatus(payload.error ?? `Loginnaam instellen mislukt (${response.status})`);
        return;
      }

      setStatus(payload.message ?? "Loginnaam ingesteld.");
      router.push("/tasks");
    } catch {
      setStatus("Netwerkfout bij instellen van loginnaam.");
    } finally {
      setIsCreatingAccount(false);
    }
  }

  return (
    <div className="grid">
      <h1>Inloggen</h1>

      {(mode === "password" || mode === "request") && (
        <section className="card grid">
          <h2>Kies je situatie</h2>
          <p className="muted">
            Je hebt al een account: log in met loginnaam + wachtwoord. Eerste keer op de
            website: vul je Nevobo relatiecode en e-mailadres in. Je ontvangt dan een magic
            link per e-mail om je account aan te maken.
          </p>
          <p className="muted">
            Privacy: verwerk geen persoonsgegevens in alias of loginnaam. Voor herkenbaarheid
            binnen de club heeft alleen je voornaam in alias de voorkeur.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" onClick={() => setMode("password")}>
              Ik heb al een account
            </button>
            <button type="button" onClick={() => setMode("request")}>
              Eerste keer
            </button>
          </div>
        </section>
      )}

      {mode === "password" && (
        <form className="card grid" onSubmit={onPasswordLogin}>
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} readOnly />
          <h2>Login met loginnaam + wachtwoord</h2>
          <label>
            Loginnaam
            <input
              type="text"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="bijv. jan.vrijwilliger"
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
            Meerdere aliassen mogen aan dezelfde relatiecode hangen.
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
            Gebruik geen persoonsgegevens in loginnaam of alias. Voor herkenbaarheid binnen
            de club heeft alleen je voornaam in alias de voorkeur.
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
            <strong>Kies bestaande alias of maak nieuwe alias.</strong>
            {isLoadingCreateOptions ? <p className="muted">Beschikbare aliassen laden...</p> : null}

            {claimableAliases.length > 0 ? (
              <label>
                Bestaande alias claimen (optioneel)
                <select
                  value={selectedAlias}
                  onChange={(event) => {
                    const nextAlias = event.target.value;
                    setSelectedAlias(nextAlias);
                    if (nextAlias) {
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
              <p className="muted">Geen claimbare bestaande aliassen gevonden.</p>
            )}

            <label>
              Nieuwe alias (optioneel)
              <input
                type="text"
                value={newAlias}
                onChange={(event) => {
                  const nextAlias = event.target.value;
                  setNewAlias(nextAlias);
                  if (nextAlias.trim().length > 0) {
                    setSelectedAlias("");
                  }
                }}
                placeholder="bijv. Jan"
              />
            </label>
          </div>

          <label>
            Loginnaam (geheim)
            <input
              type="text"
              value={createLoginName}
              onChange={(e) => setCreateLoginName(e.target.value)}
              placeholder="bijv. jan.vrijwilliger"
              required
            />
          </label>
          <p className="muted">
            Gebruik 3-32 tekens: kleine letters, cijfers, punt, _ of -.
          </p>

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

      {mode === "setupLoginName" && (
        <form className="card grid" onSubmit={onSetupLoginName}>
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} readOnly />
          <h2>Stel je loginnaam in</h2>
          <p className="muted">
            Je kwam binnen via e-mailadres + wachtwoord. Voor dit account is nu eerst een
            loginnaam verplicht.
          </p>
          <p className="muted">
            Gebruik geen persoonsgegevens. Voor herkenbaarheid binnen de club heeft alleen je
            voornaam in alias de voorkeur.
          </p>
          <label>
            Loginnaam (geheim)
            <input
              type="text"
              value={setupLoginName}
              onChange={(e) => setSetupLoginName(e.target.value)}
              placeholder="bijv. jan.vrijwilliger"
              required
            />
          </label>
          <p className="muted">
            Gebruik 3-32 tekens: kleine letters, cijfers, punt, _ of -.
          </p>
          <button type="submit" disabled={isCreatingAccount}>
            {isCreatingAccount ? "Opslaan..." : "Stel loginnaam in"}
          </button>
        </form>
      )}

      {mode === "magic" ? (
        <section className="card grid">
          <h2>Magic link verificatie</h2>
          <p className="muted">
            {!token || !magicAlias
              ? "Open de magic link uit je e-mail. Daarin staan token en alias."
              : isVerifyingMagic
              ? "Bezig met inloggen via magic link..."
              : "Even geduld, verificatie wordt verwerkt."}
          </p>
        </section>
      ) : null}

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
