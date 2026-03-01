# Gebruikershandleiding op Basis van User Stories - Inzet

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
