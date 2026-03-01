# Handleiding Hele Systeem

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

---

# Gebruikershandleiding (User Stories)

Laatste update: 1 maart 2026

## 1. Doel
Deze handleiding beschrijft het gebruik van Inzet via een dekkende set user stories:

- voor vrijwilligers;
- voor coordinators;
- voor bestuur.

Per story staat:

- wie iets wil doen;
- hoe dat in de app werkt;
- wat het verwachte resultaat is;
- welke uitzonderingen je kunt tegenkomen.

## 2. Rollen
- `Vrijwilliger`: bekijkt en claimt taken, beheert account/profiel.
- `Coordinator`: beheert taken en voorstellen binnen eigen verantwoordelijkheden.
- `Bestuur`: beheert ledenbestand en beslist over aliaswijzigingen.

## 3. Story-overzicht

## 3.1 Toegang en account
- `US-01` Account aanmaken met bestaande alias.
- `US-02` Account aanmaken met nieuwe alias.
- `US-03` Inloggen met e-mailadres + wachtwoord.
- `US-04` Uitloggen.
- `US-05` Accountgegevens (e-mail/wachtwoord) aanpassen.
- `US-06` Profiel (foto + over mij) aanpassen.
- `US-07` Aliaswijziging aanvragen.

## 3.2 Vrijwilligersflows
- `US-08` Openstaande taken bekijken.
- `US-09` Taak openen en context begrijpen.
- `US-10` Inschrijven op een taak.
- `US-11` Status van voorstellen volgen.
- `US-12` Afgewezen voorstel als gezien markeren.
- `US-13` Notificatie-abonnement op taak aan/uit zetten.

## 3.3 Coordinatorflows
- `US-14` Subtaak aanmaken.
- `US-15` Subtaak kopieren.
- `US-16` Taak bewerken.
- `US-17` Coordinators op taak beheren (organiseren-context).
- `US-18` Subtaakpunten aanpassen vanuit parent-taak.
- `US-19` Iemand voorstellen voor een taak.
- `US-20` Taak beschikbaar stellen (loslaten).
- `US-21` Taak verplaatsen.
- `US-22` Taak of subtak verwijderen.
- `US-23` Voorstellen accepteren.
- `US-24` Voorstellen afwijzen.

## 3.4 Bestuur- en beheerflows
- `US-26` Aliaswijzigingsvoorstel accepteren.
- `US-27` Aliaswijzigingsvoorstel afwijzen.
- `US-29` Dataveranderingen realtime terugzien in de UI.

## 3.5 Uitzonderingen en randgevallen
- `US-30` Te weinig punten in parent-taak.
- `US-31` Geen rechten op actie.
- `US-32` Verplaatsing veroorzaakt cycle.
- `US-33` Organiseren-taak met subtaken: alleen bladtaken kunnen inschrijven.
- `US-34` Magic link ongeldig of verlopen.
- `US-35` Dubbele of conflicterende alias-/inlogsituaties.
- `US-36` Sessieverlies (401 Niet ingelogd).

## 3.6 Rapportage en notificaties
- `US-37` CSV export van punten per relatiecode.
- `US-38` CSV export met detailregels (pad, taak, alias, relatiecode, etc.).
- `US-39` Vanuit notificatie-e-mail direct naar account, taak of voorstel.

## 4. Uitgewerkte user stories

## US-01 - Account aanmaken met bestaande alias
Als nieuwe gebruiker wil ik een bestaande alias claimen, zodat eerdere taaktoewijzingen aan mij gekoppeld blijven.

Voorwaarde:
Je hebt een geldige Nevobo relatiecode en je weet dat er taken zijn toegewezen aan jou.

Uitleg:
De aliassen die initieel zijn aangemaakt zijn voornamen. Als meedere actieve leden dezelfde voornaam hebben dan hebben we de eerste afwijkende letter van de achternaam er met een _ aangeplakt. Bijvoorbeeld Bas_I.

Door middel van de relatiecode wordt je account gekoppeld aan een spelend lid. Meerdere vrijwilligers, bijvoorbeeld je vader en je moeder, kunnen een eigen account met eigen alias aanmaken en "punten verdienen" voor een spelend lid. Ook kun je met één emailadres meerdere accounts aanmaken met verschillende wachtwoorden. Zo kun je voor verschillende spelende leden punten verzamelen met verschillende aliassen op één emailadres.

Een alias die eenmaal geclaimed is, kan niet nogmaals geclaimt worden.

Stappen:
1. Ga naar `/login`.
2. Kies `Eerste keer`.
3. Vul relatiecode en e-mailadres in.
4. Je ontvangt een e-mail met een magic link. (check je spam als je deze niet meteen ziet binnenkomen.)
5. Open de magic link.
6. Kies bij accountaanmaak een bestaande alias.
7. Stel wachtwoord in.

Resultaat:
Je account is actief en je bent direct ingelogd.

## US-02 - Account aanmaken met nieuwe alias
Als nieuwe gebruiker wil ik een nieuwe alias kiezen, zodat ik een uniek account krijg.

Uitleg:
Een alias is meestal je voornaam, eventueel aangevuld met een _letter. Dit is het enige gegeven dat vrijwillegers van elkaar kunnen zien. Daarnaast is er een profiel waar je een foto en een korte beschrijving van jezelf kunt achterlaten. Op dit moment zijn deze gegevens nog niet zichtbaar voor anderen maar dit kan in de toekomst veranderen. 

Door middel van de relatiecode wordt je account gekoppeld aan een spelend lid. Meerdere vrijwilligers, bijvoorbeeld je vader en je moeder, kunnen een eigen account met eigen alias aanmaken en "punten verdienen" voor een spelend lid. Ook kun je met één emailadres meerdere accounts aanmaken met verschillende wachtwoorden. Zo kun je voor verschillende spelende leden punten verzamelen met verschillende aliassen op één emailadres.

Een alias die eenmaal geclaimed is, kan niet nogmaals geclaimt worden.

Stappen:
1. Ga naar `/login`.
2. Kies `Eerste keer`.
3. Vul relatiecode en e-mailadres in.
4. Je ontvangt een e-mail met een magic link. (check je spam als je deze niet meteen ziet binnenkomen.)
5. Open de magic link.
6. Vul bij accountaanmaak een nietbestaande alias in.
7. Stel wachtwoord in.

Resultaat:
Nieuw account aangemaakt en ingelogd.

## US-03 - Inloggen met e-mailadres + wachtwoord
Als bestaande gebruiker wil ik met e-mailadres en wachtwoord inloggen, zodat ik snel naar mijn taken kan.

Uitleg:
Heb je eenmaal een account gemaakt dan kun je inloggen met je emailadres en wachtwoord. 

Stappen:
1. Ga naar `/login`.
2. Kies `Ik heb al een account`.
3. Vul e-mailadres en wachtwoord in.
4. Klik `Log in`.

Resultaat:
Je bent ingelogged en komt op `/tasks`.

## US-04 - Uitloggen
Als gebruiker wil ik veilig uitloggen, zodat mijn sessie niet actief blijft.

Uitleg:
Uitloggen verwijdert je sessiecookie. Daarna ben je niet meer geauthenticeerd en kom je terug op het inlogscherm.

Stappen:
1. Open rechtsboven het alias-menu.
2. Klik `Log uit`.

Resultaat:
Sessiecookie wordt verwijderd en je gaat naar `/login`.

## US-05 - Accountgegevens aanpassen
Als gebruiker wil ik e-mail en/of wachtwoord kunnen wijzigen, zodat mijn account actueel en veilig blijft.

Uitleg:
Je bent zelf verantwoordelijk om je gegevens actueel te houden. Als je wachtwoord gelekt is en je wilt deze veranderen dan kan dat. Ook als je een nieuw email-adres wil gaan gebruiken dan kan dat. Je kunt ook altijd een nieuw account aanmaken met dezelfde nevobo relatiecode zodat de punten tellen voor het juiste spelend lid.

Stappen:
1. Open alias-menu > `Account`.
2. Tab `Wachtwoord`.
3. Pas e-mail aan.
4. Vul huidig wachtwoord in als je e-mail of wachtwoord wijzigt.
5. Vul optioneel nieuw wachtwoord in en bevestig.
6. Klik `Opslaan`.

Resultaat:
Wijzigingen zijn opgeslagen.

## US-06 - Profiel aanpassen
Als gebruiker wil ik een profielfoto en korte bio toevoegen, zodat anderen een beter beeld van mij hebben.

Uitleg:
Dit kan al maar er wordt nog niets met deze gegevens gedaan. In de toekomst kunnen we een mogelijkheid maken om bij een toegewezen taak een popup te tonen van een gebruiker zodat je een beeld hebt wie deze taak doet of coordineerd.

Stappen:
1. Open alias-menu > `Profiel`.
2. Upload afbeelding (max 2MB).
3. Vul `Wie ben ik` in.
4. Klik `Opslaan`.

Resultaat:
Profielgegevens zijn opgeslagen.

## US-07 - Aliaswijziging aanvragen
Als gebruiker wil ik een nieuwe alias aanvragen, zodat mijn accountnaam beter past.

Uitleg:
We willen herkenbare aliassen zodat we als leden onder elkaar een goed beeld hebben wie wat doet. Aan de andere kant willen we persoonsgegevens niet opslaan om te voorkomen dat we aan extra veiligheidseisen moeten voldoen. Daarom hebben we gekozen om ons tot voornamen te beperken. Maar het kan zijn dat je een andere naam beter vind passen, dit kun je voorleggen aan het bestuur.

Stappen:
1. Open alias-menu > `Account`.
2. Tab `Alias`.
3. Vul gewenste alias in.
4. Klik `Voorleggen aan bestuur`.

Resultaat:
Voorstel verschijnt in `Openstaande voorstellen` en wacht op besluit.

## US-08 - Openstaande taken bekijken
Als vrijwilliger wil ik openstaande taken zien, zodat ik kan aangeveen waar ik kan helpen.

Uitleg:
Taken staan open als ze wel zijn geplant maar er is nog niemand definitief aan toegewezen. Als vrijwilliger kun je je vinger opsteken bij de taak om aan te geven dat je deze graag wil invullen. Eén van de bestaande coordinatoren van deze taak kan je voorstel goedkeuren, dan ben je definitief toegewezen. 

Stappen:
1. Open menu `☰`.
2. Kies `Openstaande taken`.

Resultaat:
Je ziet beschikbare taken met kerninformatie en acties.

## US-09 - Taak openen en context begrijpen
Als vrijwilliger wil ik een taak kunnen openen met pad/breadcrumb, zodat ik context van parent/subtaken begrijp.

Uitleg:
Taken hangen in een boomstructuur. Via het pad zie je waar een taak in de vereniging valt en welke subtaken erbij horen.

Stappen:
1. Klik `Open` bij een taak.
2. Bekijk taakdetails, pad en subtaken.

Resultaat:
Je kunt door de taakstructuur navigeren.

## US-10 - Inschrijven op een taak
Als vrijwilliger wil ik me op een taak inschrijven, zodat ik kan bijdragen.

Uitleg:
Inschrijven is geen directe toewijzing. Er wordt eerst een voorstel aangemaakt dat door een bevoegde beslisser geaccepteerd of afgewezen wordt.

Stappen:
1. Open `Openstaande taken`.
2. Kies taak.
3. Klik `Schrijf in`.

Resultaat:
Er wordt een voorstel aangemaakt dat geaccepteerd of afgewezen kan worden.

## US-11 - Status van voorstellen volgen
Als gebruiker wil ik zien wat er met mijn voorstellen gebeurt, zodat ik weet waar ik aan toe ben.

Uitleg:
In deze lijst zie je zowel taakvoorstellen als aliaswijzigingsvoorstellen die voor jou relevant zijn. Je ontvangt daarnaast notificatiemails met een duidelijke aanhef, context en directe links.

Stappen:
1. Open menu `☰`.
2. Kies `Openstaande voorstellen`.

Resultaat:
Je ziet open en afgewezen voorstellen inclusief status en tijd.

## US-12 - Afgewezen voorstel als gezien markeren
Als gebruiker wil ik afgewezen voorstellen kunnen sluiten, zodat mijn lijst schoon blijft.

Uitleg:
Een afgewezen voorstel blijft zichtbaar totdat je het bevestigt met `Gezien`.

Stappen:
1. Open `Openstaande voorstellen`.
2. Zoek afgewezen item.
3. Klik `Gezien`.

Resultaat:
Melding verdwijnt uit de lijst.

## US-13 - Taakabonnement aan/uit
Als gebruiker wil ik me abonneren op taken, zodat ik updates over nieuwe subtaken ontvang.

Uitleg:
Met een abonnement ontvang je meldingen over nieuwe subtaken onder die taak. De frequentie bepaal je in je accountinstellingen.

Stappen:
1. Zoek taak in overzicht.
2. Klik het notificatie-icoon (aan/uit).

Resultaat:
Abonnement wordt opgeslagen; notificaties volgen je accountinstellingen.

## US-37 - CSV export punten per relatiecode
Als coordinator wil ik een CSV met puntentotaal per relatiecode kunnen downloaden, zodat ik de stand kan delen of controleren.

Uitleg:
De export rekent punten tijdsevenredig:
- taak nog niet gestart: 0 punten;
- taak afgerond: volledige punten;
- taak deels verstreken: deel van de punten naar rato van verstreken tijd;
- uitkomst wordt afgekapt op hele punten.

Stappen:
1. Open een taak waarop je mag rapporteren.
2. Klik op de floppy-knop `💾` voor directe download, of open het menu via pijltje `▾`.
3. Kies `Zonder details`.

Resultaat:
CSV wordt gedownload met totalen per relatiecode.

## US-38 - CSV export met details
Als coordinator wil ik een detail-CSV, zodat ik per regel kan zien hoe de punten zijn opgebouwd.

Uitleg:
De detail-export bevat minimaal: pad, taaknaam, alias, relatiecode, totaalpunten, start, eind en deelpunten.

Stappen:
1. Open een taak waarop je mag rapporteren.
2. Klik op pijltje `▾` naast de floppy-knop.
3. Kies `Met details`.

Resultaat:
CSV wordt gedownload met detailregels per relevante taak/alias.

## US-39 - Deeplinks vanuit notificatiemail
Als gebruiker wil ik vanuit een notificatiemail direct naar de juiste plek in de app kunnen gaan, zodat ik snel kan handelen.

Uitleg:
Notificatiemails bevatten:
- een aanhef (`Beste {alias}`);
- context waarom je de e-mail ontvangt;
- directe link naar accountinstellingen;
- waar mogelijk deeplinks naar taak of openstaand voorstel.

Stappen:
1. Open de notificatiemail.
2. Klik op `Naar voorstel`, `Naar taak` of `Accountpagina`.
3. Log in als daarom wordt gevraagd.

Resultaat:
Je landt direct op de relevante pagina/tab in `/tasks`.

## US-14 - Subtaak aanmaken
Als coordinator wil ik een subtaak aanmaken, zodat werk opgesplitst kan worden.

Uitleg:
Met subtaken verdeel je werk en punten over kleinere, beheersbare onderdelen.

Stappen:
1. Open een beheerde taak.
2. Klik `+` bij subtaken.
3. Vul titel, beschrijving, punten, planning en werkwijze in.
4. Klik `Opslaan`.

Resultaat:
Subtaak staat onder de parent-taak.

## US-15 - Subtaak kopieren
Als coordinator wil ik een bestaande subtaak kopieren, zodat ik sneller vergelijkbare taken kan aanmaken.

Uitleg:
Kopieren neemt structuur en velden over. Je kunt daarna datum/tijd laten staan of als geheel verschuiven.

Stappen:
1. Open parent-taak.
2. Klik `Kopieer` bij een subtaak.
3. Pas velden aan en kies datumbehandeling.
4. Sla op.

Resultaat:
Er wordt een nieuwe gekopieerde taak(subboom) aangemaakt.

## US-16 - Taak bewerken
Als coordinator wil ik taakdetails kunnen wijzigen, zodat planning en inhoud up-to-date blijven.

Uitleg:
Bewerken is bedoeld voor inhoud, planning en coordinatie-instellingen. Wijzigingen worden vastgelegd in de auditlog.

Stappen:
1. Open taak.
2. Klik `Bewerk`.
3. Pas relevante tab(s) aan.
4. Klik `Opslaan`.

Resultaat:
Taak is bijgewerkt en auditlog is vastgelegd.

## US-17 - Coordinators beheren (organiseren-context)
Als coordinator-organisator wil ik coordinatoren op een taak beheren, zodat eigenaarschap goed verdeeld blijft.

Uitleg:
Dit kan alleen in de juiste coordinatiecontext en met voldoende rechten. Anders wordt de wijziging geweigerd.

Stappen:
1. Open taak > `Bewerk`.
2. Ga naar tab `Coordinatoren`.
3. Voeg toe of verwijder alias.
4. Sla op.

Resultaat:
Coordinatorlijst is aangepast (mits rechten/werkwijze dit toestaan).

## US-18 - Subtaakpunten aanpassen vanuit parent
Als coordinator van een parent-taak wil ik subtaakpunten aanpassen, zodat puntenverdeling klopt.

Uitleg:
Je kunt punten direct in de parentweergave bijsturen om snel te herverdelen zonder elke subtaak apart te openen.

Stappen:
1. Open parent-taak.
2. Wijzig puntenveld bij subtaak.
3. Bevestig met Enter of blur.

Resultaat:
Subtaakpunten worden opgeslagen.

## US-19 - Iemand voorstellen voor een taak
Als coordinator wil ik iemand voorstellen voor een taak, zodat overdracht mogelijk is.

Uitleg:
Bij een bestaande actieve alias ontstaat een voorstel. Voor een nieuwe alias kan het systeem de toewijzing direct verwerken.

Stappen:
1. Open taak.
2. Klik `Stel voor`.
3. Vul alias van persoon in.
4. Klik `OK`.

Resultaat:
Voorstel verschijnt in `Openstaande voorstellen`.

## US-20 - Taak beschikbaar stellen (loslaten)
Als coordinator wil ik een taak beschikbaar stellen, zodat anderen zich kunnen inschrijven.

Uitleg:
Loslaten haalt de taak uit actieve toewijzing van de huidige coordinator en zet de taak weer open voor inschrijving.

Stappen:
1. Open toegewezen taak.
2. Klik `Stel beschikbaar`.
3. Bevestig.

Resultaat:
Taakstatus wordt weer `BESCHIKBAAR`.

## US-21 - Taak verplaatsen
Als coordinator wil ik een subtaak naar een andere parent verplaatsen, zodat de structuur logisch blijft.

Uitleg:
Verplaatsen herstructureert de taakboom. Het systeem bewaakt teamconsistentie, rechten en geldige parent-kind-relaties.

Stappen:
1. Open taak.
2. Klik `Verplaats`.
3. Kies doel-parent.
4. Bevestig.

Resultaat:
Taak verhuist; systeem controleert rechten, teamregels en cycles.

## US-22 - Taak/subtaak verwijderen
Als coordinator wil ik taken kunnen verwijderen, zodat verouderde onderdelen verdwijnen.

Uitleg:
Verwijderen werkt op de hele subboom onder de gekozen taak. Gebruik dit alleen als herstel via bewerken of verplaatsen niet passend is.

Stappen:
1. Open taak.
2. Klik `Verwijder`.
3. Bevestig.

Resultaat:
Taak en onderliggende subtaken worden verwijderd.

## US-23 - Voorstel accepteren
Als bevoegde beslisser wil ik voorstellen accepteren, zodat taken goed toegewezen worden.

Uitleg:
Wie mag beslissen hangt af van het type voorstel en de coordinatierelatie op de taak.

Stappen:
1. Open `Openstaande voorstellen`.
2. Kies voorstel.
3. Klik `Accepteren`.

Resultaat:
Taaktoewijzing wordt doorgevoerd.

## US-24 - Voorstel afwijzen
Als bevoegde beslisser wil ik voorstellen afwijzen, zodat onjuiste toewijzingen worden tegengehouden.

Uitleg:
Afwijzen blokkeert de voorgestelde toewijzing. De indiener ziet daarna dat het voorstel is afgewezen.

Stappen:
1. Open `Openstaande voorstellen`.
2. Kies voorstel.
3. Klik `Afwijzen`.

Resultaat:
Voorstelstatus wordt afgewezen.

## US-26 - Aliaswijziging accepteren
Als bestuur wil ik aliaswijzigingen kunnen accepteren, zodat legitieme naamwijzigingen doorgezet worden.

Uitleg:
Alleen bestuur kan aliaswijzigingen definitief doorvoeren.

Stappen:
1. Open `Openstaande voorstellen`.
2. Zoek aliaswijziging.
3. Klik `Accepteren`.

Resultaat:
Alias wordt aangepast.

## US-27 - Aliaswijziging afwijzen
Als bestuur wil ik aliaswijzigingen kunnen afwijzen, zodat conflicterende namen niet worden doorgevoerd.

Uitleg:
Afwijzen houdt de huidige alias in stand en voorkomt naamconflicten of onduidelijkheid.

Stappen:
1. Open `Openstaande voorstellen`.
2. Kies aliaswijziging.
3. Klik `Afwijzen`.

Resultaat:
Voorstel krijgt status afgewezen.

## US-29 - Realtime wijzigingen terugzien
Als gebruiker wil ik wijzigingen snel terugzien zonder handmatig refreshen, zodat ik met actuele data werk.

Uitleg:
De taakpagina kijkt op de achtergrond naar dataveranderingen en ververst waar nodig automatisch.

Stappen:
1. Laat taakscherm open.
2. Wacht op wijzigingen door anderen.

Resultaat:
UI ververst automatisch via versie-watch.

## US-30 - Te weinig punten in parent-taak
Als coordinator wil ik weten wat er gebeurt bij puntentekort, zodat ik planning kan bijsturen.

Uitleg:
Een parent-taak heeft een beperkt puntenbudget. Als dat budget op is, kan een nieuwe subtaak geen positieve punten meer krijgen.

Gedrag:
Nieuwe subtaak wordt aangemaakt met `0` punten.

Aanpak:
1. Herverdeel punten in subtaken.
2. Vraag bovenliggende coordinator om budgetruimte.

## US-31 - Geen rechten op actie
Als gebruiker wil ik begrijpen waarom een actie niet kan, zodat ik weet wie moet handelen.

Uitleg:
Rechten worden bepaald op basis van je effectieve coordinatierol in de taakstructuur.

Gedrag:
Systeem geeft foutmelding zoals `Geen rechten`.

Aanpak:
1. Controleer of je coordinator/eigenaar bent op deze taak.
2. Betrek de juiste coordinator of bestuur.

## US-32 - Verplaatsing veroorzaakt cycle
Als coordinator wil ik beschermd worden tegen ongeldige structuur, zodat de taakboom consistent blijft.

Uitleg:
Een cycle betekent dat een taak (indirect) onder zichzelf zou komen te hangen. Dat maakt de boom ongeldig.

Gedrag:
Verplaatsing wordt geweigerd met cycle-fout.

## US-33 - Organiseren-taak met subtaken
Als vrijwilliger wil ik weten waarom ik soms niet op een hoofdtaak kan inschrijven.

Uitleg:
Bij `ORGANISEREN` wordt werk bedoeld verdeeld over subtaken. Daarom schrijf je in op een concrete bladtaak.

Gedrag:
Bij `ORGANISEREN` en bestaande subtaken kun je alleen op bladtaken inschrijven.

## US-34 - Magic link ongeldig of verlopen
Als gebruiker wil ik snel herstellen van een verlopen link.

Uitleg:
Magic links zijn tijdelijk geldig en eenmalig bruikbaar. Daarna moet je een nieuwe aanvragen.

Aanpak:
1. Vraag een nieuwe magic link aan via `Eerste keer` of passende flow.
2. Gebruik de nieuwste link binnen 20 minuten.

## US-35 - Conflict met alias of inlogcombinatie
Als gebruiker wil ik duidelijke feedback bij conflict, zodat ik een alternatief kan kiezen.

Uitleg:
De app bewaakt uniciteit van aliassen en voorkomt onduidelijke inlogcombinaties.

Voorbeelden:
- Alias al in gebruik.
- Combinatie e-mailadres + wachtwoord al in gebruik.

Aanpak:
Kies een andere alias en/of een ander wachtwoord.

## US-36 - Sessieverlies tijdens gebruik
Als gebruiker wil ik weten wat te doen bij `Niet ingelogd`.

Uitleg:
Bij verlopen of ontbrekende sessie word je automatisch teruggestuurd naar de loginpagina.

Aanpak:
1. Log opnieuw in.
2. Herhaal de laatste actie.

## 5. Aanbevolen schrijfformat voor nieuwe stories
Gebruik voortaan per nieuwe story:

1. `Als [rol] wil ik [actie], zodat [waarde]`.
2. `Voorwaarde` (optioneel).
3. `Stappen` (genummerd).
4. `Resultaat`.
5. `Uitzondering/Aanpak` (optioneel).

Zo blijft de handleiding consistent, uitbreidbaar en direct bruikbaar voor gebruikers.

---

# Notificatie-overzicht

## Vast e-mailtemplate
- Aanhef: `Beste {alias},`
- Redenregel: `Dit bericht ontvang je omdat er een relevante update voor jou is in Inzet.`
- Afsluiting: `Hartelijk dank voor je actieve bijdrage aan de sportiviteit en het plezier binnen onze vereniging.`

## Nieuwe voorstellen
- Nieuw voorstel voor taak
  - Onderwerp: `Nieuw voorstel: {taaktitel}`
  - Bericht (tussen aanhef en afsluiting):
    - `Er staat een voorstel klaar voor taak "{taaktitel}".`
    - `Voorgesteld door: {proposerAlias}`
    - `Voorgesteld aan: {proposedAlias}`
    - `Naar voorstel: {deeplink-voorstel}`
    - `Naar taak: {deeplink-taak}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`
- Nieuw voorstel voor aliaswijziging
  - Onderwerp: `Nieuw voorstel: aliaswijziging {requesterAlias}`
  - Bericht (tussen aanhef en afsluiting):
    - `{requesterAlias} vraagt aliaswijziging aan.`
    - `Nieuwe alias: {requestedAlias}`
    - `Naar voorstel: {deeplink-voorstel}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`

## Reactie op jouw voorstel
- Voorstel geaccepteerd (taak)
  - Onderwerp: `Voorstel geaccepteerd: {taaktitel}`
  - Bericht (tussen aanhef en afsluiting):
    - `{actorAlias} heeft een voorstel voor taak "{taaktitel}" geaccepteerd.`
    - `Naar taak: {deeplink-taak}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`
- Voorstel afgewezen (taak)
  - Onderwerp: `Voorstel afgewezen: {taaktitel}`
  - Bericht (tussen aanhef en afsluiting):
    - `{actorAlias} heeft een voorstel voor taak "{taaktitel}" afgewezen.`
    - `Naar voorstel: {deeplink-voorstel}`
    - `Naar taak: {deeplink-taak}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`
- Voorstel geaccepteerd (aliaswijziging)
  - Onderwerp: `Voorstel geaccepteerd: Aliaswijziging`
  - Bericht (tussen aanhef en afsluiting):
    - `{actorAlias} heeft een voorstel voor taak "Aliaswijziging" geaccepteerd.`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`
- Voorstel afgewezen (aliaswijziging)
  - Onderwerp: `Voorstel afgewezen: Aliaswijziging`
  - Bericht (tussen aanhef en afsluiting):
    - `{actorAlias} heeft een voorstel voor taak "Aliaswijziging" afgewezen.`
    - `Naar voorstel: {deeplink-voorstel}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`

## Wijzigingen op coordinatietaken
- Taak gewijzigd
  - Onderwerp: `Taak gewijzigd: {taaktitel}`
  - Bericht (tussen aanhef en afsluiting):
    - Zonder samenvatting: `{actorAlias} heeft taak "{taaktitel}" gewijzigd.`
    - Met samenvatting: `{actorAlias} heeft taak "{taaktitel}" gewijzigd.` + extra samenvatting op nieuwe regel.
    - `Naar taak: {deeplink-taak}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`

## Beschikbaar gestelde taken
- Taak opnieuw beschikbaar
  - Onderwerp: `Taak beschikbaar: {taaktitel}`
  - Bericht (tussen aanhef en afsluiting):
    - `{actorAlias} heeft taak "{taaktitel}" beschikbaar gesteld.`
    - `Naar taak: {deeplink-taak}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`

## Nieuwe subtaken op abonnementen
- Nieuwe subtaken binnen abonnementen (gegroepeerd)
  - Onderwerp: `Nieuwe subtaken in je abonnementen ({aantal})`
  - Bericht (tussen aanhef en afsluiting): genummerde lijst met regels zoals:
    - `Nieuwe subtaak "{subtaak}" onder "{parentTaak}" (abonnement: "{abonnementTaak}"). Taak: {deeplink-taak}`
    - `Je kunt je notificatie-instellingen wijzigen op de accountpagina van vczwolle.frii.nl.`
    - `Accountpagina: {deeplink-account}`
