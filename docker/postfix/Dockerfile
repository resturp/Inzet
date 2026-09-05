FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postfix \
  && rm -rf /var/lib/apt/lists/*

COPY main.cf /etc/postfix/main.cf
COPY start-postfix.sh /usr/local/bin/start-postfix

RUN chmod +x /usr/local/bin/start-postfix

EXPOSE 25

CMD ["/usr/local/bin/start-postfix"]
