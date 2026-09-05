# Productie-mail

De applicatie verstuurt magic links in Docker via SMTP naar de interne `mail` container. Die aparte Postfix-container levert de mail naar buiten af, zonder mail van internet te accepteren en zonder open relay te zijn.

## Applicatieconfiguratie

Gebruik deze waarden op de server:

```dotenv
MAIL_FROM="Inzet <info@frii.nl>"
MAIL_ENVELOPE_FROM="info@frii.nl"
MAIL_MESSAGE_ID_DOMAIN="frii.nl"
SENDMAIL_IN_DEV="false"
SMTPHOST="mail:25"
# Fallback buiten Docker, alleen gebruikt als SMTPHOST leeg is:
SENDMAIL_PATH="/usr/sbin/sendmail"
```

Zet `NEXT_PUBLIC_APP_URL` op de publieke HTTPS-url van de applicatie, anders bevat de magic link een lokale of verkeerde host.

Op je MacBook hoef je geen lokale MTA te installeren. In development verstuurt de app standaard geen e-mail zolang `SENDMAIL_IN_DEV=false`; de loginpagina toont dan een dev magic link.

## Bestaande database

Bij een bestaand Postgres-volume verandert `POSTGRES_PASSWORD` de database niet meer. Als `web` crasht met Prisma `P1000`, gebruikt de applicatie een ander wachtwoord dan de bestaande database.

Zet op de server in `.env` dezelfde credentials voor Docker:

```dotenv
POSTGRES_DB="inzet"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="BESTAAND_DATABASE_WACHTWOORD"
DOCKER_DATABASE_URL="postgresql://postgres:BESTAAND_DATABASE_WACHTWOORD@db:5432/inzet?schema=public"
```

Als het wachtwoord onbekend is, herstel alleen de loginrol:

```sh
./scripts/repair-postgres-login.sh
```

Het script stopt `web` en `db`, zet de bestaande PostgreSQL-rol opnieuw op `LOGIN` met een nieuw wachtwoord, en print de `.env` regels die je moet overnemen. Het verwijdert geen volumes en wist geen productiegegevens.

## Postfix in Docker

Docker Compose start een aparte `mail` service met Postfix. Deze service heeft geen `ports:` mapping, dus TCP/25 wordt niet gepubliceerd naar internet. Alleen containers op het interne Compose-netwerk kunnen de SMTP-poort bereiken.

De `web` service gebruikt:

```dotenv
SMTPHOST="mail:25"
```

De Postfix-container gebruikt deze basisinstellingen:

```ini
myhostname = mail.frii.nl
myorigin = frii.nl
inet_interfaces = all
inet_protocols = all
mydestination =
mynetworks = 127.0.0.0/8 [::1]/128 172.16.0.0/12
smtpd_relay_restrictions = permit_mynetworks,reject_unauth_destination
smtpd_recipient_restrictions = permit_mynetworks,reject
local_transport = error:local delivery disabled
smtp_tls_security_level = may
```

De uitgaande Postfix-services `smtp/unix` en `relay/unix` draaien bewust niet in chroot. Docker zet DNS in `/etc/resolv.conf` op `127.0.0.11`; een gechroote Postfix SMTP-client ziet die resolver niet betrouwbaar en kan dan geldige MX-records missen.

Controleer dat de mailservice niet naar de host wordt gepubliceerd:

```sh
docker compose ps mail
```

De service mag in de `PORTS` kolom geen `0.0.0.0:25->25/tcp` tonen. Controleer daarna de interne verbinding:

```sh
docker compose exec web getent hosts mail
docker compose exec web sh -lc 'nc -vz mail 25'
```

Uitgaand TCP/25 vanaf de Docker-host moet wel open zijn, anders kan Postfix geen mail naar ontvangende mailservers afleveren. Inkomend TCP/25 vanaf internet hoeft niet open te staan voor deze applicatie.

De standaardconfiguratie accepteert `172.16.0.0/12`, het gebruikelijke bereik voor Docker bridge-netwerken. Omdat de `mail` service geen hostpoort publiceert, is deze SMTP-poort niet vanaf internet bereikbaar.

## DNS voor `info@frii.nl`

Status gemeten op 2026-09-05:

- `frii.nl` heeft MX `10 mail.frii.nl`.
- `frii.nl` en `mail.frii.nl` wijzen naar `185.158.165.15` en `2a07:ae80:100:0:185:158:165:15`.
- `_dmarc.frii.nl` bestaat met `v=DMARC1;p=reject`.
- Er is geen SPF TXT-record zichtbaar op `frii.nl`.
- De selectors `default`, `mail` en `selector1` hebben geen zichtbaar DKIM-record.

Voeg minimaal SPF toe als deze server de enige toegestane verzender voor `frii.nl` is:

```dns
frii.nl.  TXT  "v=spf1 ip4:185.158.165.15 ip6:2a07:ae80:100:0:185:158:165:15 -all"
```

Als ook andere partijen namens `frii.nl` mailen, voeg die expliciet toe met `include:` of extra `ip4:`/`ip6:` waarden voordat je `-all` gebruikt.

Voeg DKIM toe via OpenDKIM of een vergelijkbare signer. Gebruik bijvoorbeeld selector `inzet`:

```dns
inzet._domainkey.frii.nl.  TXT  "v=DKIM1; k=rsa; p=PUBLIC_KEY_ZONDER_SPATIES"
```

Laat Postfix alle applicatiemail ondertekenen met `d=frii.nl` en `s=inzet`. Met DMARC op `p=reject` moet SPF of DKIM aligned slagen, anders kunnen ontvangende servers de magic-link mails weigeren.

## Extern relay (aanbevolen, omzeilt DMARC-vertraging)

Direct vanaf de VPS versturen vereist dat ontvangende servers (Gmail, etc.) het verse SPF-record voor `frii.nl` al vertrouwen; dat kan door DNS/anti-spoof-caching bij grote providers langer duren dan de TTL doet vermoeden. Sneller en betrouwbaarder: laat de `mail`-container relayen via het bestaande, al vertrouwde SMTP-account van `info@frii.nl` bij de hostingpartij (zelfde server als in Gmail's "verzenden als"-instelling):

```dotenv
MAIL_RELAY_HOST="linux2210.webawere.nl"
MAIL_RELAY_PORT="465"
MAIL_RELAY_USERNAME="info@frii.nl"
MAIL_RELAY_PASSWORD="HET_WACHTWOORD_VAN_INFO_AT_FRII_NL"
```

Zet deze in `.env` op de server (niet in git). `start-postfix.sh` configureert dan automatisch `relayhost`, implicte TLS (poort 465) en SASL-auth, en genereert `/etc/postfix/sasl_passwd` bij het opstarten van de container. Laat je `MAIL_RELAY_HOST` leeg, dan valt de container terug op rechtstreeks verzenden (het oude gedrag).

Herstart na het zetten van deze variabelen:

```sh
docker compose up -d --build mail
```

## Test

Stuur op de productieserver een test via dezelfde API-route als de app:

```sh
curl -i -X POST http://127.0.0.1:3000/api/auth/request-magic-link \
  -H 'content-type: application/json' \
  --data '{"bondsnummer":"JOUW_RELATIECODE","email":"jouw-adres@example.com"}'
```

Bekijk logs bij fouten:

```sh
docker compose logs --tail=100 mail
docker compose exec -T mail postqueue -p
docker compose exec -T mail sh -lc 'for domain in gmail.com outlook.com icloud.com proton.me; do echo "--- $domain"; host -t MX "$domain"; done'
```

Als de app in Docker draait, gebruik dan `SMTPHOST=mail:25` en controleer dat de interne `mail` service bereikbaar is vanaf de container.
