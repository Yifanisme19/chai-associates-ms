#!/bin/sh
set -eu
# Refuse to overwrite an existing test database. The application database is untouched.
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root -e "CREATE DATABASE chai_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; GRANT ALL ON chai_test.* TO chai;"'
trap 'docker compose exec -T db sh -c '\''MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root -e "DROP DATABASE chai_test;"'\''' EXIT
# Files are copied to the running container only; not included in the production image.
docker compose exec -T web mkdir -p /var/www/tests
docker compose cp server/tests/run.php web:/var/www/tests/run.php
docker compose cp server/tests/parity.json web:/var/www/tests/parity.json
docker compose exec -T -e DB_NAME=chai_test web php -d display_errors=1 -d log_errors=0 /var/www/tests/run.php
