# Handleiding Hele Systeem - Inzet (VC Zwolle)

Laatste update: 1 maart 2026

## 1. Doel van dit document
Deze handleiding beschrijft het volledige systeem zoals nu in code is geimplementeerd:

- functionele werking voor leden, coordinators en bestuur;
- technische opbouw (frontend, API, database, notificaties);
- installatie, beheer, testen en troubleshooting.

## 2. Systeem in 1 oogopslag
Inzet is een vrijwilligersportaal voor VC Zwolle met:

- accountaanmaak via magic link + wachtwoord;
- inloggen met e-mailadres + wachtwoord;
- taakboom met subtaken;
- coordinatie- en voorstelprocessen;
- audit logging en e-mailnotificaties.

### Technische stack
- Next.js 15 (App Router, TypeScript)
- React 19
- Prisma ORM
- PostgreSQL 16
- Node.js 22
- Docker Compose (optioneel voor lokale run)

## 3. Architectuur
### Frontend
- Paginaroutes:
  - `/` (landing)
  - `/login` (auth + registratieflow)
  - `/tasks` (hoofdapp)
- Hoofdclient: `src/app/tasks/tasks-client.tsx`
  - takenoverzicht, focusmodus, voorstellen, account/profiel.

### Backend API
- Alle businesslogica zit in App Router API routes onder `src/app/api/**/route.ts`.
- Private API-routes worden bewaakt door `middleware.ts` met sessiecookie.

### Dataopslag
- Prisma schema: `prisma/schema.prisma`.
- Migraties: `prisma/migrations/*`.
- Seed: `prisma/seed.ts`.

### Ondersteunende libraries
- Rechten/ownership: `src/lib/authorization.ts`
- Voorstelregels: `src/lib/rules.ts`
- Puntenlogica: `src/lib/task-points.ts`
- Notificaties/digests: `src/lib/notifications.ts`
- Audit logging: `src/lib/audit.ts`
- Sessies: `src/lib/session.ts` + `src/lib/api-session.ts`

## 4. Datamodel (kernentiteiten)
### User
- Identiteit: `alias` (PK), `bondsnummer`, `email`.
- Security: `passwordHash`, `emailVerifiedAt`, `isActive`.
- Profiel: `aboutMe`, `profilePhotoData`.
- Relaties: coordinatorrollen, voorstellen, notificatievoorkeuren, subscriptions.
- Opmerking seedgedrag: precreated aliassen krijgen een placeholder-bondsnummer (`PENDING-...`) tot de gebruiker zelf registreert met geldige relatiecode.

### Task
- Taakboom: `parentId` + children.
- Inhoud: titel, beschrijving, lange beschrijving, team, locatie.
- Planning: `date`, `startTime`, `endTime`.
- Status: `BESCHIKBAAR`, `TOEGEWEZEN`, `GEREED`.
- Coördinatietype: `DELEGEREN` of `ORGANISEREN` (of overerven via `null`).

### TaskCoordinator
- Koppelt taak aan 1 of meer expliciete coordinatoren (`taskId`, `userAlias`).
- Zonder expliciete coordinatoren erft een taak effectief coordinatoren uit de parentketen.

### OpenTask
- Voorstelrecord voor taakinschrijving/voordracht.
- Belangrijke velden: `proposerAlias`, `proposedAlias`, `status`.

### AliasChangeProposal
- Voorstel voor aliaswijziging.
- Door bestuur te accepteren/af te wijzen.

### TaskTemplate
- Legacy entiteit in de database, niet meer actief in de applicatieflow.

### TaskSubscription
- Abonnement op een taak voor notificaties over nieuwe subtaken in de onderliggende boom.

### NotificationPreference + NotificationEvent
- Instellingen per categorie (uit/direct/digest).
- Eventqueue voor digest-verzending.

### AuditLog + MagicLinkToken
- Auditspoor op kritieke mutaties.
- Tijdelijke magic-link tokens (hash + expiry + usedAt).

## 5. Rollen, rechten en ownership
### Rollen in de praktijk
- Formeel bestaan `LID`, `COORDINATOR`, `BESTUUR`.
- Bestuursrechten worden functioneel bepaald via ownership op de taakstructuur (bestuur/root-owners).

### Rechtenmodel per taak
- `READ` en `OPEN`: beschikbaar zodra er effectieve coordinatoren in de keten zijn.
- `MANAGE`: alleen voor effectieve coordinatoren van die taak.

### Coordinatietypes
- `DELEGEREN`: expliciete child-coordinatoren nemen beheer over.
- `ORGANISEREN`: coordinatoren kunnen cumuleren door de keten heen.
- `null`: erft type van bovenliggende context.

### Root/bestuur
- Root-taak: `Besturen vereniging`.
- Root-owners mogen root-taken maken en leden syncen.

## 6. Authenticatie en accountflow
### Sessie
- Cookie: `inzet_alias` (`httpOnly`, `sameSite=lax`, 7 dagen).

### Eerste keer gebruiker
1. Gebruiker voert relatiecode + e-mailadres in.
2. `POST /api/auth/request-magic-link` controleert relatiecode in allowlist (`data/relatienummers.csv`, fallback `data/relatiecodes.csv`).
3. Magic link opent `/login?flow=create-account&token=...`.
4. `GET /api/auth/registration-options` geeft claimbare (precreated) aliases.
5. `POST /api/auth/complete-registration`:
   - kiest bestaande alias of nieuwe alias;
   - zet wachtwoord (min. 8);
   - logt direct in.

### Bestaande gebruiker
- Inloggen met e-mailadres + wachtwoord via `POST /api/auth/login-password`.
- Uniekheidsregel: combinatie e-mailadres + wachtwoord mag niet op meerdere accounts uitkomen.

### Magic-link login/verificatie
- `POST /api/auth/verify-magic-link`.
- Eerste activatie zonder bestaand wachtwoord vereist `setPassword`.

### Uitloggen
- `POST /api/auth/logout`.

## 7. Taakproces en businessregels
### Taakaanmaak
- Root-taak maken: alleen root-owner.
- Subtaak maken: alleen manager van parent.
- Punten worden als gehele getallen opgeslagen.
- Bij te weinig parentpunten wordt nieuwe (sub)taak op 0 gezet.

### Taakstatus
- `BESCHIKBAAR`: open voor aanmelding/voorstel.
- `TOEGEWEZEN`: actief toegewezen.
- `GEREED`: afgerond (status is aanwezig in model/rapportage).

### Inschrijven op taak
- Endpoint: `POST /api/tasks/:id/register`.
- Alleen bij `BESCHIKBAAR`.
- Bij `ORGANISEREN`: niet-beheerder mag alleen op bladtaken inschrijven.

### Iemand voorstellen op taak
- Endpoint: `POST /api/tasks/:id/propose`.
- Alleen door taakmanager.
- Bestaande actieve alias: maakt open voorstel.
- Nieuwe alias (nog niet geclaimd): kan direct precreated/pending gebruiker maken en auto-toewijzen.

### Beslisregels voorstellen
- Als `proposer == proposed`: coordinator beslist.
- Als `proposer != proposed`: coordinator of voorgesteld lid beslist.
- Afwijzing blijft zichtbaar voor proposer tot acknowledgement.

### Taak vrijgeven
- Endpoint: `POST /api/tasks/:id/release`.
- Zet status terug naar `BESCHIKBAAR`.
- Verwijdert actor uit effectieve coordinatorset volgens release-regels.

### Bewerken, verplaatsen, kopieren, verwijderen
- Bewerken: `PATCH /api/tasks/:id`
  - taakdetails, coordinators, planning, locatie;
  - coordinatorlijst bewerken is beperkt tot organisatorische context.
- Verplaatsen: `POST /api/tasks/:id/move`
  - alleen subtaken;
  - geen cycles;
  - alleen naar parent met beheersrecht en gelijk team of parent zonder team;
  - punten worden tussen bron- en doelparent verrekend.
- Kopieren: `POST /api/tasks/:id/copy`
  - recursieve subboomcopy;
  - optionele datumshift;
  - optionele root overrides.
- Verwijderen: `DELETE /api/tasks/:id`
  - verwijdert complete subtree + bijbehorende open task records.

## 8. Voorstellen (open tasks + aliaswijzigingen)
### Open voorstellen overzicht
- `GET /api/open-tasks` combineert:
  - taakvoorstellen (`OpenTask`);
  - aliaswijzigingsvoorstellen (`AliasChangeProposal`).

### Accept/reject/acknowledge
- `POST /api/open-tasks/:id/accept`
- `POST /api/open-tasks/:id/reject`
- `POST /api/open-tasks/:id/acknowledge`

### Aliaswijziging
- Aanvragen: `POST /api/account/alias-change-proposals`.
- Beslissen: via open-tasks accept/reject (bestuur-only).
- Na afwijzing kan requester de melding sluiten via acknowledge.

## 9. Notificaties
### Categorieen
- `NEW_PROPOSAL`
- `PROPOSAL_ACCEPTED`
- `TASK_CHANGED_AS_COORDINATOR`
- `TASK_BECAME_AVAILABLE_AS_COORDINATOR`
- `SUBTASK_CREATED_IN_SUBSCRIPTION`

### Leveringsmodi
- `OFF`, `IMMEDIATE`, `HOURLY`, `DAILY`, `WEEKLY`, `MONTHLY`.

### Werking
- Direct: meteen e-mail.
- Digest: events in `NotificationEvent`; periodiek verstuurd zodra interval verstreken is.
- Flush van due digests gebeurt o.a. bij sessieopbouw (`getSessionUser`) en na eventcreatie.
- Notificaties gebruiken een vaste opbouw met:
  - aanhef (`Beste {alias}`);
  - contextzin waarom de ontvanger dit bericht krijgt;
  - afsluiting met verenigingsboodschap;
  - verwijzing naar accountinstellingen op `vczwolle.frii.nl`.
- Waar mogelijk bevatten notificaties deeplinks naar:
  - accounttab met notificatie-instellingen;
  - specifieke taak;
  - specifiek openstaand voorstel.
- Volledige inhoudstemplate: `docs/notificaties.txt`.

## 10. API-overzicht
### Publiek
- `GET /api/health`
- `POST /api/auth/request-magic-link`
- `POST /api/auth/verify-magic-link`
- `POST /api/auth/login-password`
- `POST /api/auth/logout`

### Private (sessie vereist)
- Account:
  - `GET /api/account`
  - `PATCH /api/account`
  - `POST /api/account/alias-change-proposals`
- Taken:
  - `GET/POST /api/tasks`
  - `PATCH/DELETE /api/tasks/:id`
  - `POST /api/tasks/:id/register`
  - `POST /api/tasks/:id/propose`
  - `POST /api/tasks/:id/release`
  - `POST /api/tasks/:id/move`
  - `POST /api/tasks/:id/copy`
  - `POST/DELETE /api/tasks/:id/subscription`
- Open voorstellen:
  - `GET /api/open-tasks`
  - `POST /api/open-tasks/:id/accept`
  - `POST /api/open-tasks/:id/reject`
  - `POST /api/open-tasks/:id/acknowledge`
- Overig:
  - `GET /api/users`
  - `POST /api/admin/members/sync`
  - `GET /api/reports/tasks`
  - `GET /api/reports/tasks/:id/points-csv?view=SUMMARY|DETAIL&at=...`
  - `GET /api/version`
  - `GET /api/version/watch`
  - `GET /api/auth/registration-options?token=...`
  - `POST /api/auth/request-email-verification` (alleen met sessie, momenteel niet in hoofd-UI gebruikt)

## 11. UI-overzicht
### Loginpagina
- Modi:
  - account bestaat al (email+wachtwoord),
  - eerste keer (relatiecode+email),
  - bestaande magic link.
- Dev-ondersteuning: debug magic link/token in niet-productie.

### Takenpagina
- Menu:
  - Openstaande taken
  - Toegewezen taken
  - Openstaande voorstellen
- Focusmodus op taak met breadcrumb.
- Inline acties: open, bewerk, verplaats, verwijder, inschrijven, voorstellen, vrijgeven.
- Subtaakbeheer: toevoegen, kopieren, punten aanpassen.
- CSV rapportage per taak:
  - split-knop met floppy (`💾`) en pijltje (`▾`);
  - `Zonder details`: totalen per relatiecode;
  - `Met details`: pad, taak, alias, relatiecode, totaal, start, eind, deel.
- Accountdialoog:
  - email/wachtwoord;
  - notificatievoorkeuren;
  - aliaswijzigingsvoorstel.
- Profieldialoog:
  - profielfoto (max 2MB data URL);
  - “Wie ben ik”.

## 12. Configuratie en omgevingsvariabelen
Gebruik minimaal:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `MAIL_FROM`
- `MAIL_ENVELOPE_FROM`
- `MAIL_MESSAGE_ID_DOMAIN`
- `SENDMAIL_PATH`

Zie `.env.example` voor defaults.

## 13. Lokale installatie
### NPM-setup
1. `cp .env.example .env`
2. `npm install`
3. `npm run db:generate`
4. `npm run db:migrate`
5. `npm run db:seed`
6. `npm run dev`

### Docker Compose
- `docker compose up --build`
- Start web op `http://localhost:3000`, PostgreSQL op `localhost:5432`.

### Volledige schone reset
- `npm run dev:reset`
- Script doet:
  - `docker compose down -v --remove-orphans`
  - verwijdert `.next`
  - bouwt stack opnieuw op.

## 14. Data en beheerbestanden
### CSV-bronnen
- `data/relatienummers.csv` (of fallback `data/relatiecodes.csv`): toegestane relatiecodes voor registratie.
- `data/alias.csv`: precreated aliases die claimbaar zijn in registratieflow.
- `data/task.csv`, `data/coord.csv`: gebruikt door seed/importlogica.

### Leden sync
- Endpoint: `POST /api/admin/members/sync` met lijst bondsnummers.
- Effect:
  - update allowlist;
  - activeert/deactiveert gebruikers;
  - herverdeelt coordinator-eigenaarschap waar nodig.

## 15. Monitoring, versie en audit
### Health
- `GET /api/health` geeft `ok`, servicenaam en timestamp.

### Data-versie polling
- `GET /api/version` geeft huidige versie.
- `GET /api/version/watch?since=...` long-poll (tot 25s) voor wijzigingen.
- UI gebruikt dit voor near-realtime refresh.

### Audit
- Kritieke mutaties schrijven naar `AuditLog`:
  - taak CRUD/move/copy/release/proposal;
  - leden sync;
  - aliaswijzigingsflow;
  - subscriptions.

## 16. Testen en kwaliteit
### Beschikbare tests
- `tests/task-permissions.test.ts`
- `tests/proposal-rules.test.ts`
- `tests/task-points.test.ts`

Uitvoeren:
- `npm run test`

### Lint/build
- `npm run lint`
- `npm run build`

## 17. Veelvoorkomende problemen
### 401 op private API
- Oorzaak: geen geldige sessiecookie (`inzet_alias`).
- Oplossing: opnieuw inloggen via `/login`.

### Magic link werkt niet
- Controleer:
  - token niet verlopen (20 min),
  - juiste flow (`create-account` vs `magic`),
  - `NEXT_PUBLIC_APP_URL` correct.

### Geen e-mails
- Controleer lokale MTA en `SENDMAIL_PATH`.
- In development is debug link/token zichtbaar op loginpagina.

### Geen rechten op actie
- Controleer effectieve coordinatoren en coordinatietype in taakketen.
- Controleer of je root-owner bent voor root- en syncfuncties.

## 18. Beveiligings- en privacynotities
- Sessie via `httpOnly` cookie.
- Wachtwoorden opgeslagen met scrypt-hash.
- In UI is alias leidend; persoonsgegevens zijn beperkt zichtbaar.
- Input sanitization aanwezig voor tekstvelden.

## 19. Aanbevolen vervolgstappen
- Integratietests toevoegen voor complete API-flows (accept/reject, copy/move, sync).
- Productie-e-maildeliverability monitoren (bounces, SPF/DKIM/DMARC).
- Eventuele background worker toevoegen voor digest-notificaties los van user traffic.
