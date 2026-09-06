# Incident 6 september 2026: aanval op de productie-Postgres

Dit draaiboek hoort bij de serverlogs van 6 september 2026: een onbekende partij voerde SQL uit
als Postgres-superuser, probeerde een `system()`-functie aan te maken om een script van
`http://196.251.121.185/systemd` te downloaden en uit te voeren, maakte een rol `wog` aan en
wijzigde wachtwoorden zodat `postgres` niet meer kan inloggen. Het is een bekende
cryptominer/botnet-dropper voor open Postgres-servers ("pg_mem"/"kinsing"-familie).

Voor de herstelstrategie (schone installatie, backup van vóór het incident, wat je niet uit de
oude database mag overnemen) geldt [database-incidentherstel.md](database-incidentherstel.md).
Dit document vult dat aan met de concrete commando's, de controle-SQL, de app-kant
(`SESSION_SECRET`, sessies, leden) en de structurele maatregelen in de code.

Ga ervan uit dat de aanvaller **alle databasegegevens** heeft gelezen: `User` (e-mailadres,
relatiecode, alias, loginnaam, scrypt-wachtwoordhash, profielfoto, "over mij"), taken, auditlog
en magic-link-hashes. Dat het uitvoeren van OS-commando's in het logfragment mislukte
(`libc.so.6` staat op Alpine ergens anders) bewijst niet dat het elders niet lukte.

## Oorzaak

`docker-compose.yml` publiceerde de database met `ports: "5432:5432"`, dus op **0.0.0.0:5432**,
sinds de eerste commit in februari. `docker-compose.prod.yml` overschreef dat niet. Docker zet zulke
poorten met eigen iptables-regels open, ook als `ufw` "deny incoming" heeft. Met een zwak of
standaard `POSTGRES_PASSWORD` was de superuser voor iedereen bereikbaar.

Deze commit sluit dat: de db-service publiceert in productie geen poort meer en zit op een intern
Docker-netwerk, `/tmp` in de container is `noexec`, en de app luistert alleen nog op
`127.0.0.1:3000` voor de reverse proxy.

## Stap 1: afsluiten (direct, nog vóór onderzoek)

```sh
cd ~/Inzet
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

ss -ltnp | grep -E ':(5432|3000)\b'
sudo iptables -t nat -S DOCKER | grep -E '5432|3000'

# Stop de database nu; dat breekt ook de lopende SQL-sessies van de aanvaller af.
$C stop db web

# Belt-and-braces zolang de oude compose nog op de server staat; ook in de firewall van de
# VPS-provider (IPv4 én IPv6).
sudo iptables -I DOCKER-USER -p tcp --dport 5432 -j DROP
```

## Stap 2: bewijs veiligstellen

Doe dit vóór `down`, `up --build` of `git pull`; daarna zijn containerlogs weg. Maak bij de
VPS-provider ook een snapshot van de server.

```sh
umask 077
mkdir -p ~/incident-2026-09-06
$C logs --no-color --timestamps db  > ~/incident-2026-09-06/db.log
$C logs --no-color --timestamps web > ~/incident-2026-09-06/web.log
$C logs --no-color --timestamps mail > ~/incident-2026-09-06/mail.log
sudo journalctl --since "2026-08-01" -o short-iso > ~/incident-2026-09-06/journal.log
last -F > ~/incident-2026-09-06/last.txt
sudo cp /var/log/auth.log* ~/incident-2026-09-06/ 2>/dev/null || true
grep -c 'CREATE OR REPLACE FUNCTION system' ~/incident-2026-09-06/db.log
grep -oE '(connection authorized|password authentication failed)[^"]*' ~/incident-2026-09-06/db.log | sort | uniq -c | sort -rn | head
```

Noteer de eerste en laatste timestamp van de aanvalsregels. De standaardlog toont geen gewone
`SELECT`s, dus de werkelijke periode kan langer zijn.

## Stap 3: schade opnemen

De aanvaller heeft het wachtwoord van `postgres` gewijzigd. Herstel eerst offline de login met
het wachtwoord uit `.env` (single-user mode, geen netwerk), start dan alleen de database en kijk
rond. Alles wat hier niet thuishoort is bewijs.

```sh
./scripts/repair-postgres-login.sh
$C up -d db
$C exec db sh -c 'ls -la /tmp /var/tmp; ps -o pid,user,args'
$C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
-- Actieve verbindingen van buitenaf
SELECT pid, usename, client_addr, backend_start, left(query, 120) AS query
FROM pg_stat_activity WHERE client_addr IS NOT NULL;
-- Rollen (verwacht: alleen jouw POSTGRES_USER als superuser; 'wog' hoort hier niet)
SELECT rolname, rolsuper, rolcreaterole, rolcanlogin, rolvaliduntil FROM pg_roles ORDER BY 1;
-- C-functies buiten pg_catalog (verwacht: geen)
SELECT n.nspname, p.proname, p.probin
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE l.lanname = 'c' AND n.nspname NOT IN ('pg_catalog', 'information_schema');
-- Extensies, databases, tabellen buiten het Prisma-schema
SELECT extname FROM pg_extension;
SELECT datname FROM pg_database;
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2;
-- Gewijzigde of toegevoegde gebruikers en bestuurstoewijzingen
SELECT alias, email, "loginName", "isActive", "createdAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 30;
SELECT t.title, c."userAlias", c."createdAt"
FROM "TaskCoordinator" c JOIN "Task" t ON t.id = c."taskId"
WHERE t."parentId" IS NULL OR lower(t.title) = 'bestuur' ORDER BY c."createdAt" DESC;
SELECT "actorAlias", "actionType", "entityType", "createdAt" FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 50;
SQL
```

Ruim niet op in deze database; ze gaat weg. Noteer wel wat je vindt (rollen, functies, tabellen,
onbekende gebruikers of coördinatoren op de roottaak): dat bepaalt wat je uit een dump nog kunt
vertrouwen.

Controleer ook de host. De db-container heeft geen Docker-socket en geen host-mounts behalve het
datavolume, dus een uitbraak is onwaarschijnlijk, maar kijk toch:

```sh
ps aux | grep -Ei 'kinsing|kdevtmpfsi|xmrig|/tmp/systemd|pg_mem|\./systemd' | grep -v grep
ls -la /tmp /var/tmp /dev/shm
crontab -l; sudo ls -la /etc/cron.d /var/spool/cron/crontabs
cat ~/.ssh/authorized_keys
sudo ss -tulpn
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
```

## Stap 4: herbouwen en roteren

Vertrouw het bestaande datavolume niet. Voorkeur: een backup van vóór de eerste aanvalsregel.
Is die er niet, neem dan **alleen tabeldata** over; nooit rollen, functies, triggers of
extensies. Het schema komt uit de repository.

```sh
# Alleen data van de applicatietabellen (db draait nog uit stap 3)
$C exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --data-only --schema=public --no-owner --no-privileges' \
  > ~/incident-2026-09-06/inzet-data.sql
grep -nE '^COPY public\.' ~/incident-2026-09-06/inzet-data.sql | grep -vE '"(User|Task|TaskTemplate|TaskCompletionSnapshot|TaskCoordinator|OpenTask|AliasChangeProposal|TaskSubscription|NotificationPreference|NotificationEvent|AuditLog|MagicLinkToken)"'
# Elke regel die hierboven overblijft is een tabel van de aanvaller: verwijder dat COPY-blok.

$C down
docker volume ls | grep postgres_data
docker volume rm inzet_postgres_data        # naam kan afwijken, zie de regel hierboven
docker pull postgres:16-alpine
```

Zet nu in `.env` op de server:

```dotenv
POSTGRES_PASSWORD='<nieuw, lang, willekeurig: openssl rand -base64 32>'
SESSION_SECRET="<openssl rand -hex 32>"
```

`SESSION_SECRET` is nieuw en verplicht; zonder die waarde start `docker compose` niet meer.
Een nieuwe `SESSION_SECRET` logt iedereen uit, inclusief eventuele sessies van de aanvaller.
Roteer ook `MAIL_RELAY_PASSWORD` bij de mailprovider.

```sh
git pull --ff-only                          # haalt deze commit binnen
$C config -q                                # faalt als SESSION_SECRET ontbreekt
$C up -d db
until $C exec -T db sh -c 'pg_isready -U "$POSTGRES_USER"' >/dev/null 2>&1; do sleep 1; done
# Schema uit de repository, daarna alleen de gecontroleerde data
$C run --rm --no-deps web npx prisma db push
$C exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction' \
  < ~/incident-2026-09-06/inzet-data.sql
./scripts/compose-prod-up.sh
```

Verwijder daarna de tijdelijke iptables-regel uit stap 1:

```sh
sudo iptables -D DOCKER-USER -p tcp --dport 5432 -j DROP
```

## Stap 5: verifiëren

```sh
$C ps                                       # db: geen PORTS; web: 127.0.0.1:3000->3000
ss -ltnp | grep -E ':(5432|3000)\b'          # alleen 127.0.0.1:3000
curl -fsS http://127.0.0.1:3000/api/health
$C logs --tail=50 db | grep -c 'CREATE OR REPLACE FUNCTION' # verwacht: 0
```

Vanaf een andere machine: `nc -vz <server-ip> 5432` en `nc -vz <server-ip> 3000` moeten beide
weigeren. Log daarna in via de site: oude cookies zijn ongeldig, inloggen geeft een nieuwe
`inzet_session`-cookie, en taken aanmaken/wijzigen werkt (dat bewijst dat de CSRF-middleware
correct door de reverse proxy heen werkt).

## Stap 6: leden en meldplicht

- Informeer de leden: e-mailadres, relatiecode, alias/loginnaam en een wachtwoordhash zijn
  ingezien. Hashes zijn scrypt (N=16384) en niet direct bruikbaar, maar zwakke of hergebruikte
  wachtwoorden moeten worden gewijzigd.
- Dit is een datalek met persoonsgegevens. De vereniging is verwerkingsverantwoordelijke; een
  melding bij de Autoriteit Persoonsgegevens binnen 72 uur na ontdekking is dan meestal
  verplicht. Leg de tijdlijn en de maatregelen uit dit document vast.

## Structurele maatregelen

In deze commit:

- Database niet meer gepubliceerd in productie, intern netwerk, `/tmp` `noexec`, geen
  privilege-escalatie in containers (`no-new-privileges`).
- App alleen op `127.0.0.1:3000`.
- Sessiecookie was de kale alias en dus door iedereen te vervalsen; nu HMAC-ondertekend, met
  vervaltijd, gebonden aan het wachtwoord, en `SESSION_SECRET` is verplicht in productie.
- De middleware (CSRF-check en API-sessiegate) stond op de repositoryroot en werd door Next.js
  nooit gebundeld omdat het project `src/` gebruikt; nu `src/middleware.ts`, met een
  origin-check die achter de reverse proxy werkt.
- CSRF-secret heeft geen hardcoded fallback meer in productie.
- Registratie kan geen bestaande gebruikersrij meer claimen die niet in `data/alias.csv` staat
  (voorkwam dat iemand de placeholder `Bestuur` en daarmee de rootrol kon overnemen).
- Rate limiting op inloggen, magic links en tokenroutes.
- Next.js 15.5.25 (acht advisories), `sharp`, `nanoid`, `postcss`.

Nog te doen (buiten deze commit):

- Laat de app met een niet-superuser databaserol werken (`CREATE ROLE inzet_app LOGIN ...`,
  `GRANT` op het `public`-schema) en houd de superuser alleen voor beheer.
- Host-firewall met een `DOCKER-USER`-regel die alles behalve 22/80/443 blokkeert.
- Vervang `prisma db push --accept-data-loss` in productie door `prisma migrate deploy`.
- Automatische, versleutelde database-backups buiten de server, en `log_connections=on` op
  Postgres zodat een volgende poging zichtbaar is.
