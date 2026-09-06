FROM node:24-bookworm-slim AS frontend
WORKDIR /src
COPY frontend/package*.json ./
RUN npm ci --ignore-scripts
COPY frontend/index.html frontend/vite.config.mjs ./
COPY frontend/src ./src
COPY frontend/public ./public
RUN npm run build
FROM php:8.4-apache
RUN apt-get update && apt-get install -y --no-install-recommends libzip-dev libpng-dev libonig-dev libxml2-dev unzip && docker-php-ext-install pdo_mysql zip gd mbstring && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www
COPY backend/composer.* ./
RUN composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader
COPY backend/src ./src
COPY backend/seed ./seed
COPY backend/public/ ./html/
COPY --from=frontend /src/dist/ ./html/
COPY backend/backup-worker.php ./backup-worker.php
RUN mkdir -p /var/www/data && chown www-data:www-data /var/www/data && a2enmod rewrite && printf 'upload_max_filesize=100M\npost_max_size=110M\nmemory_limit=512M\nmax_execution_time=120\ndisplay_errors=Off\n' > /usr/local/etc/php/conf.d/chai.ini

RUN printf '<Directory /var/www/html>\n    AllowOverride All\n    Require all granted\n</Directory>\n' > /etc/apache2/conf-available/chai.conf && a2enconf chai
