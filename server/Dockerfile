# Backend-Abbild fuer den Server. Node 22 = aktuelles LTS (dein PC laeuft auf 26,
# aber auf einem Server will man die Version, die zwei Jahre Sicherheits-Updates
# bekommt).
FROM node:22-alpine

WORKDIR /app

# Erst nur die Paketlisten kopieren, dann installieren. Docker legt jede Zeile
# als eigene Schicht ab: solange sich package-lock.json nicht aendert, ueberspringt
# der naechste Bau das `npm ci` komplett und ist in Sekunden fertig.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Gemeinsame Listen von App, Laravel und Node (shared/ im Repo): gesperrte
# Begriffe, haeufige Passwoerter. Sie liegen AUSSERHALB von server/ und damit
# ausserhalb dieses Baukontexts - deploy/docker-compose.yml reicht den Ordner als
# zweiten, benannten Kontext `shared` herein. Ziel /shared, weil der Code die
# Dateien zwei Ebenen ueber src/ sucht (/app/src -> /shared), genau wie im Repo.
#
# Ohne den Kontext bricht der Bau hier ab - gewollt: Ohne die Liste gesperrter
# Begriffe startet der Server ohnehin nicht. Von Hand bauen:
#   docker build --build-context shared=../shared .
COPY --from=shared . /shared/

# storage/ liegt im Compose als Bind-Mount darueber. Das Anlegen hier ist fuer den
# Fall, dass jemand das Abbild ohne Mount startet – sonst wirft express.static
# beim ersten Bild-Aufruf.
RUN mkdir -p storage/avatars storage/banners storage/evidence \
             storage/posts storage/stories storage/user-banners

# Nicht als root laufen. Das Abbild bringt den Benutzer `node` schon mit; er
# braucht Schreibrecht auf storage/, weil dort die Uploads landen.
RUN chown -R node:node /app/storage

# Production build: the server checks its required settings before it starts and refuses to
# run without them (src/config.js). The compose sets the same value.
ENV NODE_ENV=production
USER node

EXPOSE 8000

CMD ["node", "src/index.js"]
