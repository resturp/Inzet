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
- Subtaak zonder eigen coordinators erft coordinators van parent.
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
