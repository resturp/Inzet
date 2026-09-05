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
1. Maak `.env` op basis van `.env.example`.
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
- De endpoint `POST /api/auth/request-magic-link` verzendt e-mail via lokale `sendmail`.
- Vereiste env vars:
  - `MAIL_FROM` (bijv. `Inzet <info@frii.nl>`)
  - `MAIL_ENVELOPE_FROM` (bijv. `info@frii.nl`)
  - `MAIL_MESSAGE_ID_DOMAIN` (bijv. `frii.nl`)
  - `SENDMAIL_PATH` (standaard `/usr/sbin/sendmail`)
  - `SENDMAIL_IN_DEV` (`true` om in development toch echt e-mail te versturen; standaard `false`)
  - `SMTPHOST` (`mail:25` wanneer Docker Compose wordt gebruikt)
- Docker Compose start een interne Postfix-service zonder gepubliceerde poort 25. De `web` container verstuurt via `mail:25`.
- Zie `docs/productie-mail.md` voor de outbound-only Docker/Postfixconfiguratie en DNS-checklist voor `info@frii.nl`.

## Docker Compose
- Lokaal: `docker compose up --build`
- Productie: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

## Productie service (systemd)
- De systemd-unit staat in `deploy/systemd/inzet.service`.
- Productie gebruikt `docker-compose.yml` plus `docker-compose.prod.yml`, zodat de server `next build` en `next start` draait in plaats van `next dev`.
- Controleer op de server eerst `.env`: `DOCKER_DATABASE_URL` moet naar `db:5432` wijzen en hetzelfde wachtwoord gebruiken als het bestaande Postgres-volume.
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
  - bij Prisma `P1000`: zet `POSTGRES_PASSWORD` en `DOCKER_DATABASE_URL` in `.env` gelijk aan het bestaande databasewachtwoord
  - als dat wachtwoord onbekend is: `./scripts/repair-postgres-login.sh`
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

## Belangrijke MVP-regels die al in code zitten
- `proposer == proposed` -> taakcoordinator beslist accept/reject.
- `proposer != proposed` -> proposer beslist accept/reject.
- Meerdere coordinators per taak mogelijk.
- Subtaak zonder eigen coordinators erft coordinators van parent.
- Punten worden bij meerdere coordinators gelijk verdeeld in rapportage/UI.
- Leden sync kan eigenaarschap van verwijderde leden herverdelen naar parent-eigenaar.
- API-afscherming via sessiecookie op alle private API-routes (middleware).
- Uitzonderingen op API-auth: `/api/auth/request-magic-link`, `/api/auth/verify-magic-link`, `/api/health`.

## Bekende TODO's
- Sessiebeheer/auth-afhandeling afronden na verify endpoint.
- Volledige UI voor coordinatoren en ledenflows.
- Integratietests toevoegen.
