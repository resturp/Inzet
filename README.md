# Inzet - Vrijwilligersportaal VC Zwolle

Fase 1 bootstrap van de MVP op basis van:
- `/Users/thomas/Projects/Inzet/docs/requirements-vrijwilligersportaal-vczwolle.md`
- `/Users/thomas/Projects/Inzet/docs/fase1-mvp-uitwerking.md`

## Wat staat er nu
- Next.js App Router skeleton (TypeScript).
- Prisma schema met kernentiteiten (`User`, `Task`, `OpenTask`, `AuditLog`, `MagicLinkToken`).
- API-routes voor:
  - magic link request/verify
  - taken aanmaken/bewerken
  - aanmelden/proposen/releasen
  - accept/reject van open tasks
  - leden sync (bestuur)
  - taakrapportage
- Seed script voor root data (`Bestuur`, `Besturen vereniging`).

## Lokale start
1. Maak `.env` op basis van `.env.example`. Zet `SESSION_SECRET` (`openssl rand -hex 32`); zonder die waarde gebruikt development een vaste fallback en weigert productie te starten.
2. Installeer dependencies:
   - `npm install`
3. Genereer Prisma client:
   - `npm run db:generate`
4. Draai migraties:
   - `npm run db:migrate`
5. Seed basisdata:
   - `npm run db:seed`
6. Start app:
   - `npm run dev`

## Productie mail (Docker Postfix)
- De endpoint `POST /api/auth/request-magic-link` verzendt e-mail in Docker via SMTP naar de interne `mail` service.
- Vereiste env vars:
  - `MAIL_FROM` (bijv. `Inzet <info@frii.nl>`)
  - `MAIL_ENVELOPE_FROM` (bijv. `info@frii.nl`)
  - `MAIL_MESSAGE_ID_DOMAIN` (bijv. `frii.nl`)
  - `SMTPHOST` (`mail:25` wanneer Docker Compose wordt gebruikt)
  - `SENDMAIL_PATH` (fallback als `SMTPHOST` leeg is; standaard `/usr/sbin/sendmail`)
  - `SENDMAIL_IN_DEV` (`true` om in development toch echt e-mail te versturen; standaard `false`)
- Docker Compose start een interne Postfix-service zonder gepubliceerde poort 25. De `web` container verstuurt via `mail:25`.
- Zie `docs/productie-mail.md` voor de outbound-only Docker/Postfixconfiguratie en DNS-checklist voor `info@frii.nl`.

## Docker Compose
- Gebruik Docker Compose 2.24.4 of nieuwer (productie gebruikt `!reset` om de databasepoort te verwijderen).
- Lokaal: `docker compose up --build`
- Productie: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
- Lokaal is PostgreSQL alleen via `127.0.0.1:5432` bereikbaar. Productie publiceert geen databasepoort en gebruikt een apart intern netwerk zonder internettoegang voor `db`.
- Docker gebruikt uitsluitend `POSTGRES_DB`, `POSTGRES_USER` en `POSTGRES_PASSWORD`. De verbindings-URL wordt inclusief escaping opgebouwd voor alle Node-processen, ook Prisma-commando's via `compose exec`. `DOCKER_DATABASE_URL` wordt niet meer gebruikt; `DATABASE_URL` is alleen voor draaien buiten Docker.

## Productie service (systemd)
- De systemd-unit staat in `deploy/systemd/inzet.service`.
- Productie gebruikt `docker-compose.yml` plus `docker-compose.prod.yml`, zodat de server `next build` en `next start` draait in plaats van `next dev`.
- Stel op de server `POSTGRES_PASSWORD` expliciet in `.env` in; productie weigert te starten als het ontbreekt. Bij een bestaande database moet dit het opgeslagen wachtwoord zijn. Gebruik enkele aanhalingstekens bij `$` in het wachtwoord, zodat Compose niets interpoleert.
- Installeer en start op Debian:
  - `./scripts/install-systemd-service.sh`
- Deploy daarna nieuwe versies met:
  - `./scripts/deploy-prod.sh`
  - of `sudo systemctl reload inzet`
- Wacht na deploy tot `web` `healthy` is; tijdens `next build` kan poort 3000 nog resetten.
- Controleer status en logs:
  - `sudo systemctl status inzet --no-pager`
  - `docker compose ps`
  - `docker compose logs --tail=100 web mail`
- Bij `Service Unavailable`:
  - `./scripts/diagnose-prod.sh`
  - controleer of `web` draait en of `/api/health` HTTP 200 geeft
  - bij Prisma `P1000`: controleer database-authenticatie en recente databasefouten met `./scripts/diagnose-prod.sh`; `/api/health` test nu ook een echte databasequery
  - alleen bij een verklaarbare configuratiefout: `./scripts/repair-postgres-login.sh` herstelt `LOGIN` en gebruikt het ingestelde `POSTGRES_PASSWORD`; daarna `./scripts/compose-prod-up.sh`
  - bij onverwacht `NOLOGIN`, onbekende rollen of pogingen tot systeemcommando's: volg [database-incidentherstel](docs/database-incidentherstel.md); wachtwoordherstel verwijdert geen aanvallerstoegang uit een aangetaste database
  - controleer of je reverse proxy naar `127.0.0.1:3000` wijst
  - controleer proxylogs, bijvoorbeeld `sudo journalctl -u nginx -n 100 --no-pager` of `sudo journalctl -u apache2 -n 100 --no-pager`

## Schone testinstallatie (aanrader)
- Volledige reset van containers/volumes + herstart:
  - `npm run dev:reset`

Na reset:
- Web: `http://localhost:3000`
- DB: `localhost:5432`

## Testen zonder mailserver
- In development toont `/login` na "Stuur magic link" een blok `Dev magic link`.
- Daar kun je:
  - de magic link URL kopiëren en openen, of
  - alleen token kopiëren en in het verificatieformulier plakken.

## Database-regressietest
- `npm run test:database` test met een tijdelijk, afzonderlijk Compose-project: productie-isolatie, echte authenticatie, herstarten, wachtwoordherstel, `NOLOGIN`, behoud van gegevens en foutafhandeling. De test verwijdert alleen zijn eigen tijdelijke volume.

## Belangrijke MVP-regels die al in code zitten
- `proposer == proposed` -> taakcoordinator beslist accept/reject.
- `proposer != proposed` -> proposer beslist accept/reject.
- Meerdere coordinators per taak mogelijk.
- Subtaak zonder eigen coordinators erft coordinators van parent.
- Punten worden bij meerdere coordinators gelijk verdeeld in rapportage/UI.
- Leden sync kan eigenaarschap van verwijderde leden herverdelen naar parent-eigenaar.
- API-afscherming via een HMAC-ondertekende sessiecookie (`inzet_session`) op alle private API-routes (middleware + `getSessionUser`). Het token is gebonden aan het wachtwoord: een wachtwoordwijziging of een nieuwe `SESSION_SECRET` logt alle sessies uit.
- Uitzonderingen op API-auth: de `/api/auth/*`-routes, `/api/csrf` en `/api/health`. Die zijn wel rate-limited.

## Beveiliging
- Productie vereist `SESSION_SECRET` en een sterk `POSTGRES_PASSWORD` in `.env`; `docker compose config` faalt anders.
- De database wordt in productie nooit gepubliceerd (`docker-compose.prod.yml` reset de poortmapping) en zit op een intern Docker-netwerk. De app luistert alleen op `127.0.0.1:3000` voor de reverse proxy.
- De middleware (CSRF-check, API-sessiegate) staat in `src/middleware.ts`; op de repositoryroot wordt hij door Next.js genegeerd.
- Bij een incident: `docs/database-incidentherstel.md` (strategie) en `docs/incident-2026-09-06-postgres.md` (commando's, controle-SQL, rotatie, leden).

## Bekende TODO's
- Sessiebeheer/auth-afhandeling afronden na verify endpoint.
- Volledige UI voor coordinatoren en ledenflows.
- Integratietests toevoegen.
