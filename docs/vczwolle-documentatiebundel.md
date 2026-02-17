# VC Zwolle Vrijwilligersportaal - Documentatiebundel

## 1. Requirements

# Requirementsdocument Vrijwilligersportaal VC Zwolle

Laatste update: 15 februari 2026

## 1. Doel en context
VC Zwolle wil een webapplicatie waarin leden vrijwilligerstaken kunnen bekijken, claimen, voorstellen, beheren en overdragen binnen een taakboom.

Dit document bevat de functionele en technische eisen voor MVP fase 1, inclusief aangescherpte afspraken uit de implementatie- en testrondes.

## 2. Doelgroep
- Leden (vrijwilligers)
- Taakcoordinatoren (eigenaren van taken)
- Bestuur

## 3. Scope (MVP)
- Authenticatie met magic link en wachtwoord.
- Takenboom met parent-child relaties.
- Inschrijven op open taken en voorstel-flow.
- Taakbeheer (bewerken, verplaatsen, kopieren van subboom, subtaken aanmaken).
- Bestuursbeheer voor ledenlijst-updates.
- Audit logging op kritieke mutaties.

## 4. Functionele eisen

### 4.1 Identiteit en authenticatie
- `Must`: Voor ieder bestaand bondsnummer mag precies 1 account bestaan.
- `Must`: Accountaanmaak gebeurt via magic-link aanvraag (`bondsnummer`, `email`, en bij eerste keer `alias`).
- `Must`: Er is geen aparte losse frontend-flow `Maak account`.
- `Must`: Inloggen ondersteunt:
  - alias + wachtwoord, of
  - magic link verificatie.
- `Must`: Bij magic-link verificatie moet direct een wachtwoord worden gezet (niet optioneel).
- `Must`: Alle private API-routes vereisen een geldige sessiecookie (`httpOnly`).

### 4.2 Privacy en zichtbaarheid
- `Must`: Leden zien in UI alleen alias van andere leden.
- `Must`: Bondsnummer en e-mail zijn niet zichtbaar voor gewone leden.
- `Must`: Alleen beheerflows tonen noodzakelijke persoonsgegevens, met rolcontrole.

### 4.3 Taakmodel en eigenaarschap
- `Must`: Elke taak heeft 1 of meer coordinators/eigenaren.
- `Must`: Een subtaak zonder expliciete coordinators erft coordinators van parent.
- `Must`: Root-taak `Besturen vereniging` bestaat altijd en heeft altijd een eigenaar.
- `Must`: Het eerste aangemaakte account wordt eigenaar van `Besturen vereniging`.
- `Must`: Alleen bestuur mag root-taken maken.

### 4.4 Taakstatus en voorstelregels
- `Must`: Taakstatussen: `BESCHIKBAAR`, `TOEGEWEZEN`, `GEREED`.
- `Must`: Voorstelworkflow gebruikt alleen regels in `open_tasks` (geen aparte taakstatus `VOORGESTELD`).
- `Must`: Als `proposer == proposed`, beslist coordinator van de taak.
- `Must`: Als `proposer != proposed`, beslist proposer.
- `Must`: Dubbele actieve open-task records voor dezelfde combinatie worden voorkomen.

### 4.5 Taakweergave en bediening (UI)
- `Must`: Navigatie via hamburgermenu met minimaal:
  - Openstaande taken
  - Toegewezen taken
  - Openstaande voorstellen
  - Sjablonen (alleen indien bevoegd)
- `Must`: Openstaande voorstellen en sjablonen zijn alleen zichtbaar als die menuoptie actief is.
- `Must`: In bovenbalk staan `Menu`, `Aangemeld als ...` en `Log uit`.
- `Must`: Gebruiker kan een taak `Openen` (focus-modus op 1 taak).
- `Must`: In focus-modus toont UI een klikbare breadcrumb van hoogste eigen stap naar huidige taak.
- `Must`: Subtaken staan compact in lijst.
- `Must`: Vanuit een geopende taak kan coordinator met `+ Subtaak` een subtaak aanmaken zonder parent-keuze (parent = huidige taak).
- `Must`: Per subtaak zijn acties `Open` en `Kopieer` beschikbaar (afhankelijk van rechten).

### 4.6 Taak bewerken, verplaatsen en kopieren
- `Must`: `Bewerk`-modus toont taakvelden zonder subtaken en zonder parent-wijziging.
- `Must`: Taakverplaatsing voorkomt cycles.
- `Must`: Taakverplaatsing is alleen toegestaan als:
  - eigenaar gelijk is, en
  - doel-parent hetzelfde team heeft of geen team heeft.
- `Must`: `Kopieer` op een subtaak maakt een nieuwe subboom (recursief alle onderliggende subtaken), geen verwijzing naar bestaande records.
- `Must`: Bij kopieren mogen root-gegevens van de nieuwe kopie vooraf aangepast worden.

### 4.7 Datums en tijden
- `Must`: Begin en einde worden in formulieren als losse velden ingevoerd:
  - begindatum (`date`)
  - begintijd (`time`)
  - einddatum (`date`)
  - eindtijd (`time`)
- `Must`: Backend bewaart deze als datetime-waarden.

### 4.8 Puntenlogica
- `Must`: Punten worden intern niet afgerond.
- `Must`: UI toont punten visueel op 2 decimalen.
- `Must`: In subtakenlijst wordt getoond:
  - ingevoerde punten per subtaak,
  - totaal ingevoerde punten van sibling-subtaken.
- `Must`: In taakweergave toont hoofdtaak de berekende waarde:
  `child = parent * (child_input / som_input_siblings)`.

### 4.9 Bestuursbeheer leden
- `Must`: Bestuur heeft knop/endpoint `Update leden` voor nieuwe en verwijderde bondsnummers.
- `Must`: Bij verwijderen van een bondsnummer vervallen taken van dat lid aan eigenaar van parent-taak.

### 4.10 Communicatie
- `Must`: MVP-notificaties lopen via e-mail.
- `Opmerking`: In dev zonder mailserver wordt magic-link debug-url/token getoond en kopieerbaar gemaakt.

### 4.11 Logging en autorisatie
- `Must`: Auditlog voor taakaanmaak, wijziging, verplaatsing, kopie, voorstelacties.
- `Must`: Alle write-acties zijn server-side geautoriseerd op ownership/rol.

## 5. Niet-functionele eisen

### 5.1 Gebruiksvriendelijkheid
- `Must`: Responsive, mobile-first.
- `Must`: Nederlands als primaire taal.
- `Must`: Formulieren hebben labels en toegankelijke basiseisen.

### 5.2 Prestatie en schaal
- `Must`: Pagina's laden binnen 2 seconden bij normaal gebruik.
- `Must`: Ontworpen voor ~400 leden en ~400 taakuren per week.

### 5.3 Beveiliging
- `Must`: HTTPS via reverse proxy.
- `Must`: Wachtwoorden gehasht opslaan (Argon2/bcrypt).
- `Must`: Dataminimalisatie en AVG-conforme verwerking.

## 6. Technische eisen

### 6.1 Stack
- Frontend/Backend: Next.js (App Router) + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Sessies: `httpOnly` cookie
- Runtime: Docker Compose

### 6.2 Datamodel (MVP)
- `User`: alias (pk), bondsnummer (unique), email, role, is_active, password_hash.
- `Task`: id, title, description, parent_id, points, date, start_time, end_time, location, team_name, template_id, status.
- `TaskCoordinator`: task_id, user_alias.
- `OpenTask`: id, task_id, proposer_alias, proposed_alias, status.
- `TaskTemplate`: id, title, description, parent_template_id, default_points.
- `AuditLog`: id, actor_alias, action_type, entity_type, entity_id, payload_json, created_at.

## 7. API (MVP)
- Publiek:
  - `POST /api/auth/request-magic-link`
  - `POST /api/auth/verify-magic-link`
  - `POST /api/auth/login-password`
  - `POST /api/auth/logout`
  - `GET /api/health`
- Private (sessie vereist):
  - `GET/POST /api/tasks`
  - `PATCH /api/tasks/:id`
  - `POST /api/tasks/:id/register`
  - `POST /api/tasks/:id/propose`
  - `POST /api/tasks/:id/release`
  - `POST /api/tasks/:id/move`
  - `POST /api/tasks/:id/copy`
  - `POST /api/open-tasks/:id/accept`
  - `POST /api/open-tasks/:id/reject`
  - `GET/POST /api/templates`
  - `POST /api/templates/:id/apply`
  - `GET /api/users`
  - `POST /api/admin/members/sync`

## 8. Wireframes (low-fi)

### 8.1 Login
```text
+-------------------------------------------------------+
| Vrijwilligersportaal - Inloggen                       |
+-------------------------------------------------------+
| [ Login met wachtwoord ] [ Vraag magic link ] [ Gebruik magic link ]
|
| (Wachtwoord)
| Alias:      [_____________]
| Wachtwoord: [_____________]
| [ Log in ]
|
| (Magic link aanvragen)
| Bondsnummer: [_____________]
| Alias (eerste keer verplicht): [_____________]
| E-mail: [_____________]
| [ Stuur magic link ]
|
| (Magic link gebruiken)
| Alias: [_____________]
| Token: [_____________]
| Nieuw wachtwoord: [_____________]
| Herhaal wachtwoord: [_____________]
| [ Inloggen ]
+-------------------------------------------------------+
```

### 8.2 Takenoverzicht met menu
```text
+--------------------------------------------------------------------------------+
| [☰ Menu] Weergave: Openstaande taken           Aangemeld als: Thomas [Log uit] |
+--------------------------------------------------------------------------------+
| (menu open)                                                                    |
| [Openstaande taken] [Toegewezen taken]                                        |
| [Openstaande voorstellen] [Sjablonen*]                                         |
+--------------------------------------------------------------------------------+
| Kaart: Technische commissie                                                    |
| Team: - | Parent: Besturen vereniging                                          |
| Start: ... | Einde: ... | Waarde (berekend): ...                               |
| [Open taak] [Bewerk] [Verplaats]                                               |
+--------------------------------------------------------------------------------+
```

### 8.3 Taak-focus met breadcrumb en subtaken
```text
+--------------------------------------------------------------------------------+
| [Terug naar lijst]  Pad: Besturen vereniging > Technische commissie > TC Meiden|
+--------------------------------------------------------------------------------+
| Taakdetails                                                                     |
| ...                                                                             |
| Subtaken (3)                                                [ + Subtaak ]      |
| - Teamfoto maken | beschikbaar | Invoerpunten: 10.00            [Open][Kopieer]|
| - Coachen        | toegewezen  | Invoerpunten: 20.00            [Open][Kopieer]|
| Totaal invoerpunten subtaken: 30.00                                          |
+--------------------------------------------------------------------------------+
| (bij + Subtaak / Kopieer)                                                       |
| Titel, beschrijving, team, punten                                               |
| Begindatum [date]  Begintijd [time]                                             |
| Einddatum  [date]  Eindtijd  [time]                                             |
| [Subtaak aanmaken] of [Kopieer taak]                                            |
+--------------------------------------------------------------------------------+
```

## 9. Acceptatiecriteria MVP
- Gebruiker kan zonder sessie geen private data/API benaderen.
- Gebruiker kan met magic link + verplicht wachtwoord account activeren en inloggen.
- Coordinator kan subtaken aanmaken vanuit geopende taak zonder parent-select.
- Verplaatsen accepteert zelfde eigenaar + (zelfde team of parent zonder team) en blokkeert cycles.
- Kopieren maakt recursief nieuwe subboom, zonder verwijzing naar bestaande taken.
- Focus-modus toont klikbare breadcrumb vanaf hoogste eigen stap.
- Datum/tijd invoer werkt via losse date/time velden en wordt correct opgeslagen.

## 10. Open punten na fase 1
- Productie e-mailprovider koppelen.
- Integratietests uitbreiden voor move/copy/breadcrumb flows.
- Fijnslijpen UI spacing en consistentie per breakpoints.


---

## 2. Fase 1 Uitwerking

# Fase 1 Uitwerking MVP - Vrijwilligersportaal VC Zwolle

Laatste update: 15 februari 2026

## 1. Doel van fase 1
Een bruikbare MVP opleveren waarmee leden en coordinatoren taken veilig en praktisch kunnen beheren, inclusief taakboom, voorstellen, verplaatsen en recursief kopieren.

## 2. In scope (definitief)
- Login met alias+wachtwoord.
- Accountaanmaak/activatie via magic link.
- Verplichte wachtwoordzetting bij magic-link verificatie.
- Takenboom met exacte ownership-regels.
- Subtaken aanmaken vanuit geopende parent-taak (`+ Subtaak`).
- Taak focus-modus met klikbare breadcrumb.
- Verplaatsen met cycle-preventie.
- Recursief kopieren van subboom.
- Bestuursactie `Update leden` met eigenaarschapsherverdeling.

## 3. Buiten scope (later)
- Externe koppelingen met bonds-/wedstrijdsystemen.
- Notificaties via WhatsApp/Telegram.
- Geavanceerde analytics dashboards.

## 4. Kernbesluiten uit implementatie

### 4.1 Auth en accountflow
- Geen aparte UI-flow `Maak account`.
- Magic-link aanvraag doet eerste accountaanmaak (alias verplicht bij eerste keer).
- Magic-link verificatie vereist altijd nieuw wachtwoord.
- Alle private API-routes vereisen sessie.

### 4.2 Autorisatie en eigenaarschap
- Een taak heeft 1 of meer eigenaren/coordinators.
- Subtaak zonder coordinator erft coordinator van parent.
- `proposer == proposed`: coordinator beslist.
- `proposer != proposed`: proposer beslist.
- Root `Besturen vereniging` heeft altijd eigenaar.

### 4.3 Verplaatsen en kopieren
- Verplaatsen alleen bij:
  - zelfde eigenaar
  - en (zelfde team of doel-parent zonder team)
  - en geen cycle
- Kopieren op subtaak maakt recursief een nieuwe subboom (nieuwe records, geen referenties).

### 4.4 UI-gedrag
- Hamburger-menu met views:
  - Openstaande taken
  - Toegewezen taken
  - Openstaande voorstellen
  - Sjablonen (bevoegd)
- Openstaande voorstellen en sjablonen alleen zichtbaar in geselecteerde menuview.
- Bovenbalk bevat menu, ingelogde alias en logout.
- Taakkaart toont berekende waarde.
- Subtaken tonen ingevoerde punten + totaal invoerpunten.

### 4.5 Datum/tijd
- Formulieren gebruiken losse velden:
  - begindatum + begintijd
  - einddatum + eindtijd

## 5. Datamodel MVP
- `users`, `tasks`, `open_tasks`, `task_templates`, `audit_logs`, `magic_link_tokens`.
- Essentieel: `tasks.parent_id` boomstructuur, taakcoordinatoren via koppelmodel, audit op mutaties.

## 6. API-opzet MVP
- Auth: request magic link, verify magic link, login-password, logout.
- Tasks: list/create/update/register/propose/release/move/copy.
- Open tasks: accept/reject.
- Templates: create/list/apply.
- Admin: members sync.

## 7. Wireframes (fase 1)
Zie uitgebreide wireframes in:
- `/Users/thomas/Projects/Inzet/docs/requirements-vrijwilligersportaal-vczwolle.md` (sectie 8)

## 8. Definition of done fase 1
- Core-flows zijn werkend in UI en API.
- Autorisatie en cycle-preventie server-side afgedwongen.
- Recursieve kopie van taaksubboom beschikbaar.
- Private routes niet toegankelijk zonder sessie.
- Build en lint slagen op Docker runtime.

## 9. Status
- MVP fase 1 is functioneel actief op huidige dev-stack.
- Open vervolgstappen:
  - e-mailprovider koppelen
  - integratietestdekking uitbreiden
  - UI-polish per scherm (spacing/consistentie)
