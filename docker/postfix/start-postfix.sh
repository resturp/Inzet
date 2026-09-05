#!/bin/sh
set -eu

postconf -e "myhostname = ${MAIL_HOSTNAME:-mail.frii.nl}"
postconf -e "mydomain = ${MAIL_DOMAIN:-frii.nl}"
postconf -e "myorigin = ${MAIL_DOMAIN:-frii.nl}"
postconf -e "mynetworks = ${MAIL_ALLOWED_NETWORKS:-127.0.0.0/8 [::1]/128 172.16.0.0/12}"

exec postfix start-fg
