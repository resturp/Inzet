#!/bin/sh
set -eu

postconf -e "myhostname = ${MAIL_HOSTNAME:-mail.frii.nl}"
postconf -e "mydomain = ${MAIL_DOMAIN:-frii.nl}"
postconf -e "myorigin = ${MAIL_DOMAIN:-frii.nl}"
postconf -e "mynetworks = ${MAIL_ALLOWED_NETWORKS:-127.0.0.0/8 [::1]/128 172.16.0.0/12}"
postconf -F smtp/unix/chroot=n
postconf -F relay/unix/chroot=n

if [ -n "${MAIL_RELAY_HOST:-}" ]; then
  postconf -e "relayhost = [${MAIL_RELAY_HOST}]:${MAIL_RELAY_PORT:-465}"
  postconf -e "smtp_tls_wrappermode = yes"
  postconf -e "smtp_tls_security_level = encrypt"
  postconf -e "smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt"
  postconf -e "smtp_sasl_auth_enable = yes"
  postconf -e "smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd"
  postconf -e "smtp_sasl_security_options = noanonymous"
  printf '[%s]:%s %s:%s\n' "${MAIL_RELAY_HOST}" "${MAIL_RELAY_PORT:-465}" "${MAIL_RELAY_USERNAME}" "${MAIL_RELAY_PASSWORD}" \
    > /etc/postfix/sasl_passwd
  chmod 600 /etc/postfix/sasl_passwd
  postmap /etc/postfix/sasl_passwd
fi

exec postfix start-fg
