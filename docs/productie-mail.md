# Productie-mail

De applicatie verstuurt magic links via de `sendmail`-interface binnen de `web` container. In productie levert een aparte Postfix-container de mail naar buiten af, zonder mail van internet te accepteren en zonder open relay te zijn.

## Applicatieconfiguratie

Gebruik deze waarden op de server:

```dotenv
MAIL_FROM="Inzet <info@frii.nl>"
MAIL_ENVELOPE_FROM="info@frii.nl"
MAIL_MESSAGE_ID_DOMAIN="frii.nl"
SENDMAIL_PATH="/usr/sbin/sendmail"
SENDMAIL_IN_DEV="false"
SMTPHOST="mail:25"
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

Gooi het volume niet weg om dit op te lossen; dan verlies je productiegegevens.

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

## Test

Stuur op de productieserver een testmail via dezelfde interface als de app:

```sh
docker compose exec -T web /usr/sbin/sendmail -i -f info@frii.nl -- jouw-adres@example.com <<'MAIL'
From: Inzet <info@frii.nl>
To: jouw-adres@example.com
Subject: Inzet mailtest

Test vanaf de Inzet server.
MAIL
```

Bekijk logs bij fouten:

```sh
docker compose logs --tail=100 mail
```

Als de app in Docker draait, gebruik dan `SMTPHOST=mail:25` en controleer dat de interne `mail` service bereikbaar is vanaf de container.
