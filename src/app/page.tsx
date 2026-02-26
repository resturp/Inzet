import { cookies } from "next/headers";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { SESSION_COOKIE_NAME } from "@/lib/session";

export default async function HomePage() {
  const cookieStore = await cookies();
  const alias = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return (
    <div className="grid">
      <section>
        <h1>Vrijwilligersportaal VC Zwolle</h1>
        <p className="muted">
          Fase 1 bootstrap: basis voor accountactivatie, takenbeheer, voorstellen en
          coordinator-flow.
        </p>
      </section>

      <section className="grid grid-2">
        <article className="card">
          <h2>Inloggen</h2>
          <p className="muted">
            {alias
              ? `Je bent ingelogd als ${alias}.`
              : "Bestaand account: e-mailadres + wachtwoord. Eerste keer: relatiecode + e-mailadres."}
          </p>
          {!alias ? (
            <p className="muted">
              Een e-mailadres kan bij meerdere accounts horen; een account heeft altijd een
              unieke alias.
            </p>
          ) : null}
          <p>
            <Link href="/login">Ga naar login</Link>
          </p>
          {alias ? <LogoutButton /> : null}
        </article>

        {alias ? (
          <article className="card">
            <h2>Taken</h2>
            <p className="muted">
              Bekijk beschikbare taken en de status van voorstellen/toewijzingen.
            </p>
            <p>
              <Link href="/tasks">Ga naar taken</Link>
            </p>
          </article>
        ) : null}
      </section>
    </div>
  );
}
