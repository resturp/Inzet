# Herstel na ongeautoriseerde databasetoegang

De serverlogs van 6 september 2026 tonen ingelogde SQL-sessies die C-functies en systeemcommando's proberen uit te voeren, onbekende accounts benaderen en wachtwoorden wijzigen. De rol `wog` bestaat volgens de logs al; `postgres` mag niet meer inloggen. Dit bewijst ongeautoriseerde SQL-activiteit. De getoonde fouten bij het laden van `libc` bewijzen niet dat uitvoering van malware op het besturingssysteem is gelukt; andere acties kunnen buiten dit logfragment vallen.

## Direct indammen

Stop vanuit de serverprojectmap de betrokken containers, zodat bestaande aanvallerssessies worden afgebroken:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop web db
```

Bewaar de bestaande volumes en containerlogs. Maak via de VPS-provider een snapshot voor onderzoek voordat je containers vervangt. Bewaar logs op de server, zonder ze allemaal te hoeven plakken:

```sh
umask 077
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --no-color web db > database-incident-20260906.log
```

Blokkeer TCP/5432 ook in de externe firewall van de VPS-provider, voor IPv4 en IPv6. De oude Compose-configuratie publiceerde deze poort op alle interfaces. Alleen een wachtwoord wijzigen beëindigt bestaande SQL-sessies niet. Alleen een container opnieuw aanmaken verwijdert ongeautoriseerde rollen, functies en wijzigingen in het databasevolume niet.

## Betrouwbaar herstellen

Gebruik een schone server/installatie en een gecontroleerde backup van vóór de ongeautoriseerde toegang. Houd de oude installatie geïsoleerd voor onderzoek. Gebruik bij de nieuwe installatie de aangepaste Compose-configuratie: geen gepubliceerde databasepoort, een intern databasenetwerk, een expliciet sterk databasewachtwoord en een healthcheck die werkelijk inlogt.

Herstel de applicatietabellen in een vers PostgreSQL-volume met het schema uit de vertrouwde repository. Neem geen rollen, functies, triggers, extensies of PostgreSQL-configuratie uit de aangetaste installatie ongecontroleerd over. Een volledige SQL-dump kan zulke wijzigingen meebrengen. De JSON-takenbackup bevat niet automatisch alle accounts en overige applicatiegegevens; controleer de dekking voordat je die als herstelbron kiest.

Vervang het databasewachtwoord door een uniek nieuw wachtwoord en roteer andere mogelijk blootgestelde geheimen, waaronder SMTP-gegevens. Behandel bestaande sessies en authenticatietokens als mogelijk blootgesteld. Laat de reikwijdte van het incident onderzoeken voordat de oude omgeving opnieuw wordt vertrouwd.

`scripts/repair-postgres-login.sh` herstelt uitsluitend `LOGIN` en het ingestelde wachtwoord. Het verwijdert geen ongeautoriseerde accounts of malware en is daarom geen zelfstandig herstel van dit incident.

## Controle na herstel

```sh
./scripts/compose-prod-up.sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps db web
curl -fsS http://127.0.0.1:3000/api/health
```

Bij `db` mag geen hostmapping naar 5432 staan (een losse vermelding `5432/tcp` is geen gepubliceerde poort). De healthcheck moet HTTP 200 geven en inloggen in de applicatie moet werken. Controleer vanaf een andere machine dat de databasepoort gesloten is. Deze controles bevestigen werking en netwerkafscherming; ze bewijzen geen opschoning van de oude database.

Bronnen: [Docker-poortpublicatie](https://docs.docker.com/engine/network/port-publishing/), [PostgreSQL C-functies en privileges](https://www.postgresql.org/docs/16/sql-createfunction.html).
