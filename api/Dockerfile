# Laravel-API (api/) als Container-Abbild.
#
# Gebaut wird aus deploy/docker-compose.yml heraus (Baukontext api/, dazu
# shared/ als zweiter Kontext). Von Hand, im Repo-Stamm:
#
#   docker build -f api/Dockerfile --build-context shared=shared -t goenn-api api
#
# ## Warum php:8.4-apache
#
# - 8.4, weil lokal (Herd) dieselbe Version läuft: Was am PC geht, geht hier.
# - Apache mit eingebautem PHP ist EIN Prozess, der PHP ausführt UND Dateien
#   ausliefert (die Bilder unter /storage). Mit php-fpm bräuchte es daneben noch
#   einen zweiten Webserver, der dieselben Dateien sehen muss.
# - Laravel bringt in public/.htaccess die Umleitungen für Apache mit – inklusive
#   der Zeile, die den `Authorization`-Kopf (das Anmelde-Token) an PHP weiterreicht.
#   Ohne sie wäre jede Anfrage der App „nicht angemeldet".

FROM php:8.4-apache

# ---------------------------------------------------------------- PHP-Erweiterungen
# pdo_mysql  Datenbank
# intl       Unicode-Normalisierung im Wortfilter (App\Support\BlockedTerms) –
#            ohne sie rutschen gestylte Buchstaben (𝐟𝐞𝐭𝐭) durch
# bcmath     große Zahlen (TOTP)
# zip        braucht Composer zum Entpacken der Pakete
# opcache    hält übersetzten PHP-Code im Speicher
# mbstring und sodium sind im offiziellen Abbild schon eingebaut.
#
# `install-php-extensions` statt `docker-php-ext-install` von Hand: Es installiert
# die passenden System-Bibliotheken selbst und räumt die Bau-Pakete wieder weg.
# Von Hand müsste man deren Namen hinschreiben – und die ändern sich mit jeder
# Debian-Version des Basis-Abbilds (libicu72 → libicu76 …).
COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_mysql intl bcmath zip opcache

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-goenn.ini

# ---------------------------------------------------------------- Apache
# Wurzel auf public/ – sonst läge der ganze Code samt Konfiguration offen im Netz.
# ${APACHE_DOCUMENT_ROOT} bleibt absichtlich wörtlich stehen: Apache setzt
# Umgebungsvariablen selbst ein (so steht es auch in der Doku des Abbilds).
ENV APACHE_DOCUMENT_ROOT=/var/www/api/public
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && a2enmod rewrite headers
COPY docker/apache.conf /etc/apache2/conf-available/goenn.conf
RUN a2enconf goenn

# ---------------------------------------------------------------- Code
# Liegt unter /var/www/api, shared/ direkt daneben unter /var/www/shared:
# App\Support\BlockedTerms und PasswordPolicy suchen die Listen eine Ebene über
# api/ (dirname(__DIR__, 3)) – genau wie im Repo.
WORKDIR /var/www/api

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Erst nur die Paketlisten: Solange sich composer.lock nicht ändert, überspringt
# der nächste Bau diesen langsamen Schritt (Docker-Schichten-Cache).
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction --no-progress --prefer-dist

COPY . .
COPY --from=shared . /var/www/shared/

# Jetzt mit dem Code: Autoloader bauen, Laravels Paket-Erkennung laufen lassen und
# die Ordner anlegen, in die Laravel schreiben muss.
RUN composer dump-autoload --optimize --no-dev --no-interaction \
    && mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views \
               storage/logs bootstrap/cache public/storage \
    && chown -R www-data:www-data storage bootstrap/cache

COPY docker/entrypoint.sh /usr/local/bin/goenn-entrypoint
RUN chmod +x /usr/local/bin/goenn-entrypoint

EXPOSE 80

# Prüft den Weg bis zur Datenbank (/api/health fragt MySQL ab), nicht nur, ob
# Apache antwortet. `php -r` statt curl: curl ist im Abbild nicht dabei.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD php -r 'exit(str_contains((string) @file_get_contents("http://127.0.0.1/api/health"), "\"ok\":true") ? 0 : 1);'

ENTRYPOINT ["goenn-entrypoint"]
CMD ["apache2-foreground"]
