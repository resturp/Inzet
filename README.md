# Inzet - Vrijwilligersportaal VC Zwolle

Fase 1 bootstrap van de MVP op basis van:
- `/Users/thomas/Projects/Inzet/docs/requirements-vrijwilligersportaal-vczwolle.md`
- `/Users/thomas/Projects/Inzet/docs/fase1-mvp-uitwerking.md`

## Wat staat er nu
- Next.js App Router skeleton (TypeScript).
- Prisma schema met kernentiteiten (`User`, `Task`, `OpenTask`, `TaskTemplate`, `AuditLog`, `MagicLinkToken`).
- API-routes voor:
  - magic link request/verify
  - taken aanmaken/bewerken
  - aanmelden/proposen/releasen
  - accept/reject van open tasks
  - leden sync (bestuur)
  - taakrapportage
- Seed script voor root data (`Bestuur`, `Besturen vereniging`, `Top level Sjabloon`).

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

## Productie mail (lokale MTA)
- De endpoint `POST /api/auth/request-magic-link` verzendt e-mail via lokale `sendmail`.
- Vereiste env vars:
  - `MAIL_FROM` (bijv. `Inzet VC Zwolle <noreply@vczwolle.frii.nl>`)
  - `MAIL_ENVELOPE_FROM` (bijv. `noreply@vczwolle.frii.nl`)
  - `MAIL_MESSAGE_ID_DOMAIN` (bijv. `vczwolle.frii.nl`)
  - `SENDMAIL_PATH` (standaard `/usr/sbin/sendmail`)
- Op de server moet een MTA aanwezig zijn die `sendmail -t -i` ondersteunt (bijv. Postfix).

## Docker Compose
- `docker compose up --build`

## Schone testinstallatie (aanrader)
- Volledige reset van containers/volumes + herstart:
  - `npm run dev:reset`
- Ook leden-allowlist resetten (`data/bondsnummers.json` verwijderen):
  - `npm run dev:reset -- --wipe-allowlist`

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
- Exact 1 coordinator per taak.
- Subtaak zonder coordinator erft coordinator van parent.
- Leden sync kan eigenaarschap van verwijderde leden herverdelen naar parent-eigenaar.
- API-afscherming via sessiecookie op alle private API-routes (middleware).
- Uitzonderingen op API-auth: `/api/auth/request-magic-link`, `/api/auth/verify-magic-link`, `/api/health`.

## Bekende TODO's
- Sessiebeheer/auth-afhandeling afronden na verify endpoint.
- Volledige UI voor coordinatoren en ledenflows.
- Integratietests toevoegen.
