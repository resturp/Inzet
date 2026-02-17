# Ontwerp: meerdere coordinators per taak

## Doel
- Meer dan 1 coordinator op een taak toestaan.
- Punten van een taak gelijk verdelen over de effectieve coordinators.

## Datamodel
- `Task.coordinatorAlias` vervangen door koppelmodel `TaskCoordinator(taskId, userAlias)`.
- Expliciete coordinators staan op de taak zelf in `TaskCoordinator`.
- Inheritance blijft bestaan:
  - heeft een taak expliciete coordinators, dan zijn die effectief;
  - anders erft de taak de effectieve coordinators van de parent.

## Autorisatie
- Beheerrecht op een taak = alias zit in de effectieve coordinator-set.
- Root-eigenaarchecks gebruiken dezelfde setlogica.

## Workflow open voorstellen
- `proposer == proposed`: elke effectieve coordinator van de taak mag beslissen.
- `proposer != proposed`: voorgesteld lid beslist.
- Accept voegt het voorgestelde lid toe aan de effectieve coordinator-set (i.p.v. vervangen).

## Puntverdeling
- Taakwaarde wordt nog steeds boom-gebaseerd berekend.
- Extra regel: per taak wordt `waarde / aantal_effectieve_coordinators` getoond als aandeel per coordinator.
- Rapportage endpoint levert dit als `pointsPerCoordinator`.

## Compatibiliteit
- API `/api/tasks` levert naast `coordinatorAliases` ook `coordinatorAlias` (eerste alias) voor backward-compatibility.

## Gevolgen voor beheer
- Leden-sync verwijdert coordinatorschappen van gedeactiveerde leden per taak.
- Alleen als een taak na verwijdering geen effectieve coordinator meer heeft, wordt fallback-bestuur toegewezen.
