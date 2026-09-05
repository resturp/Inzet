# Gebruikershandleiding voor Functioneel Beheerders - Inzet

Laatste update: 30 mei 2026

## 1. Doel
Deze handleiding is voor functioneel beheerders/coordinatoren die taken structureren en beheren binnen Inzet.

Onderwerpen:
- taken aanmaken;
- taken kopieren en in tijd verschuiven;
- delegeren vs organiseren;
- toewijzen en beschikbaarstellen;
- taken verplaatsen;
- punten toekennen en verdelen.

## 2. Kernbegrippen
### Beheerrechten
Je kunt alleen taken beheren waarvoor je coordinator/beheerder bent in de betreffende taakketen.

### Taakstatus
- `Beschikbaar`: open voor inschrijven of voorstellen.
- `Toegewezen`: actief in beheer/uitvoering.
- `Gereed`: afgerond en vergrendeld (eerst onvoltooid zetten om te wijzigen).

### Werkwijze: Delegeren of Organiseren
- `Delegeren`: expliciete coordinatoren op een subtaak nemen beheer daar over.
- `Organiseren`: coordinatoren kunnen stapelen in de keten; parentcoordinatoren blijven effectief zichtbaar.

## 3. Taken aanmaken
### Root-taak aanmaken
1. Open de takenlijst op rootniveau.
2. Klik op `+` (nieuwe taak).
3. Vul minimaal in: titel, beschrijving, planning, punten.
4. Kies indien nodig werkwijze en coordinatorinstellingen.
5. Sla op.

### Subtaak aanmaken
1. Open de parent-taak.
2. Klik bij subtaken op `+`.
3. Vul gegevens in.
4. Controleer punten en planning.
5. Sla op.

Let op:
- Onder een gereed gemelde taak kun je geen nieuwe subtaken maken.

## 4. Taken kopieren en x weken verplaatsen
1. Open de taak die je wilt kopieren.
2. Kies `Kopieer`.
3. Kies datumgedrag:
   - `Behouden` (datums blijven gelijk),
   - `Verschuiven` (bijvoorbeeld `x` weken vooruit of achteruit).
4. Vul bij verschuiven het aantal en de eenheid in (`weken`).
5. Bevestig.

Resultaat:
- De geselecteerde taakboom wordt gekopieerd inclusief subtaken.
- Bij `Verschuiven` gaan alle datums/tijden in de kopie mee met de gekozen offset.

## 5. Delegeren of organiseren instellen
1. Open taak > `Bewerk`.
2. Kies bij `Werkwijze`:
   - `Delegeren`,
   - `Organiseren`,
   - of `Overerven`.
3. Sla op.

Praktische richtlijn:
- Kies `Delegeren` als je verantwoordelijkheden echt wilt overdragen naar subtaakcoordinatoren.
- Kies `Organiseren` als parentcoordinatoren structureel willen meekijken en mee kunnen sturen.

## 6. Taken toewijzen en beschikbaarstellen
### Taak op toegewezen zetten
Mogelijkheden:
- direct via de takenactie `Zet op toegewezen`;
- of via `Bewerk` en status op `Toegewezen`.

### Taak beschikbaar stellen (opzeggen)
1. Open de taak.
2. Klik `Stel beschikbaar`.

Resultaat:
- Status gaat terug naar `Beschikbaar`.
- In de coordinatorlogica wordt de vrijgave verwerkt.

## 7. Taken verplaatsen
1. Open de taak.
2. Klik `Verplaats`.
3. Kies nieuwe parent.
4. Bevestig.

Regels:
- je kunt alleen subtaken verplaatsen;
- geen cycli (niet naar jezelf of eigen subtree);
- doelparent moet binnen je beheerdomein passen;
- teamcontext moet compatibel zijn.

## 8. Punten toekennen en verdelen
### Punten instellen
- Root- en hoofdtaken: via `Bewerk` punten invullen.
- Subtaken: punten aanpassen vanuit de parentcontext waar dat is toegestaan.

### Hoe punten zichtbaar worden
- Beschikbare punten op een taak = eigen punten minus uitgegeven directe subtaakpunten.
- Bij meerdere toegewezen coordinatoren wordt de beschikbare waarde verdeeld per coordinator.

Tip:
- Houd punten op parentniveau bewust ruim genoeg voordat je veel subtaken uitgeeft.

## 9. Coordinatoren beheren
1. Open taak > `Bewerk`.
2. Ga naar tab `Coordinatoren`.
3. Voeg aliassen toe of verwijder ze.
4. Sla op.

Let op:
- Dit is rechten- en contextafhankelijk (met name bij organiseren/delegeren).

## 10. Handige beheerflow per seizoen
1. Maak seizoenstaak aan (bijv. `2026-2027`).
2. Kopieer basisstructuur van vorig seizoen.
3. Verschuif planning met `x` weken/maanden waar nodig.
4. Controleer werkwijze (`Delegeren/Organiseren`) per cluster.
5. Controleer en verdeel punten.
6. Zet relevante taken op `Toegewezen` of `Beschikbaar`.
7. Controleer openstaande voorstellen en werk ze af.

## 11. Veelvoorkomende problemen
### Ik kan een taak niet bewerken
- Controleer of taak of parent op `Gereed` staat.
- Controleer of je beheerrechten hebt op die taak.

### Verplaatsen lukt niet
- Mogelijk door cycle-regel, teamcontext of onvoldoende rechten op doelparent.

### Puntentotaal voelt niet logisch
- Controleer of er directe subtaken zijn die al punten hebben geconsumeerd.

### Geen knop voor toewijzen/beschikbaarstellen
- Dan heb je op die taak geen beheerdersrechten.

## 12. Wijzigingen veilig doorvoeren
- Werk bij grote wijzigingen eerst op taakniveau (een deelboom), niet direct op volledige seizoensroot.
- Maak vooraf een backup JSON van de betreffende taak.
- Test na bulkacties of notificaties en voorstellen nog logisch lopen.
