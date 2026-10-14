#!/usr/bin/env bash
# Bring up the throwaway SQL Server container used by the CI validation jobs, wait
# for it, then migrate and seed the test database. Runs in the background in CI
# (launched by .azure/pipelines/pr.yml, gated by the 'Wait for test database' step)
# so the ~30s overlaps the static checks.
#
# Usage: ci-start-test-database.sh <temp-dir>
#   <temp-dir>   directory holding the mssql-pull.* status files from the prefetch
#                step; the discovered connection string is written here as
#                mssql-conn.txt for the wait step to publish.
# Env:  MSSQL_CONTAINER_NAME  container name (unique per build)
#       MSSQL_SA_PASSWORD     throwaway SA password for the ephemeral container
set -euo pipefail

tmp="${1:?usage: ci-start-test-database.sh <temp-dir>}"
container="${MSSQL_CONTAINER_NAME:?MSSQL_CONTAINER_NAME must be set}"
password="${MSSQL_SA_PASSWORD:?MSSQL_SA_PASSWORD must be set}"
image="mcr.microsoft.com/mssql/server:2022-latest"

# if the prefetch step ran, wait for it to finish so docker run below finds the
# image locally instead of starting a second concurrent pull; a failed/absent
# prefetch is fine - docker run just pulls inline
if [ -f "$tmp/mssql-pull.started" ]; then
	for _ in $(seq 1 90); do
		[ -f "$tmp/mssql-pull.status" ] && break
		sleep 2
	done
	tail -5 "$tmp/mssql-pull.log" 2>/dev/null || true
	if [ -f "$tmp/mssql-pull.status" ] && [ "$(cat "$tmp/mssql-pull.status")" != "0" ]; then
		echo "Background image pull failed - docker run will pull the image inline instead"
	fi
fi

# -p 0:1433 - let Docker pick a free host port, discovered below, rather than a fixed
# one that could collide with a concurrent run on a shared agent
docker run -d --name "$container" -p 0:1433 \
	-e 'ACCEPT_EULA=1' \
	-e "MSSQL_SA_PASSWORD=$password" \
	"$image"

# docker port can list both an IPv4 (0.0.0.0:PORT) and IPv6 ([::]:PORT) line - grab the
# trailing digits rather than splitting on ":", which breaks on the IPv6 form
hostPort=$(docker port "$container" 1433/tcp | head -n1 | grep -oE '[0-9]+$')
if [ -z "$hostPort" ]; then
	echo "Could not determine the host port Docker assigned to the SQL Server container" >&2
	exit 1
fi
echo "SQL Server container $container listening on host port $hostPort"

conn="sqlserver://localhost:$hostPort;database=identify-consultees;user=sa;password=$password;trustServerCertificate=true"
echo "$conn" > "$tmp/mssql-conn.txt"

ready=false
for i in $(seq 1 30); do
	if docker exec "$container" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$password" -C -Q 'SELECT 1' > /dev/null 2>&1; then
		ready=true
		break
	fi
	echo "Waiting for SQL Server to be ready... ($i/30)"
	sleep 2
done
if [ "$ready" != "true" ]; then
	echo "SQL Server did not become ready in time" >&2
	exit 1
fi

docker exec "$container" /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$password" -C -Q "IF DB_ID(N'identify-consultees') IS NULL CREATE DATABASE [identify-consultees]"

# applies the real migrations (including the spatial index/check constraints) to a
# throwaway database, proving the schema sets up correctly - not just that it compiles
SQL_CONNECTION_STRING_ADMIN="$conn" npm run db-migrate-prod

# matches local dev (scripts/start-local.mjs seeds automatically) - without this,
# e2e/integration tests that expect real project/consultee data to actually be there
# would see an empty database, unlike every local run. The seed needs the generated
# Prisma client, which is why the launcher runs after db-generate.
SQL_CONNECTION_STRING_ADMIN="$conn" SQL_CONNECTION_STRING="$conn" npm run db-seed

echo "Test database migrated and seeded"
