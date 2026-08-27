# Deploying Octoscope to Azure (Container Apps)

Infrastructure is defined as Bicep in [`main.bicep`](./main.bicep). It provisions
an Azure Container Apps environment, a Container Registry, the app itself, a
PostgreSQL Flexible Server, and — once you set `customDomain` — a free managed
TLS certificate bound to `octoscope.msft.ae`.

We use **Container Apps** instead of App Service because App Service dedicated
VM quota is 0 on these subscriptions. Container Apps draw on a separate
consumption (vCPU/memory) quota.

The image is built **in the cloud** with `az acr build`, so you do **not** need
Docker installed locally.

The flow is:
1. **Provision infra** (Bicep, no custom domain) — the app starts on a placeholder image.
2. **Build + push** the real image to ACR and roll it out.
3. **Create DNS records** in the `msft.ae` Azure DNS zone.
4. **Re-run Bicep with `customDomain`** to bind the hostname + managed certificate.
5. Point the GitHub OAuth App at the final URL.
6. **Build the migrator image** and re-run Bicep with `migrateImage` to create
   the schema job, then run it.

---

## Target environment

Everything lives in the **msft.ae** tenant (`592f2526-87c5-4b56-a69c-911ca616e213`),
but split across two subscriptions:

| What | Subscription | Id |
| --- | --- | --- |
| App, ACR, Postgres, Container Apps env | `ME-MngEnvMCAP569532-bensinclair-2` | `4bb69453-53d7-4a30-87ca-3d6f29499276` |
| `msft.ae` Azure DNS zone (RG `dns`) | `Core` | `3a5edb60-2256-469b-a6f7-356b86ceb9bc` |

Because the DNS zone is in a *different* subscription from the app, every DNS
command below carries an explicit `--subscription "$DNS_SUB"`. Everything else
uses the app subscription.

Set these once at the top of your shell session — the rest of the guide assumes
them:

```sh
TENANT=592f2526-87c5-4b56-a69c-911ca616e213
APP_SUB=4bb69453-53d7-4a30-87ca-3d6f29499276   # ME-MngEnvMCAP569532-bensinclair-2
DNS_SUB=3a5edb60-2256-469b-a6f7-356b86ceb9bc   # Core
DNS_RG=dns
DNS_ZONE=msft.ae
HOST_LABEL=octoscope                            # -> octoscope.msft.ae
FQDN="${HOST_LABEL}.${DNS_ZONE}"

RG=octoscope-rg
LOCATION=eastus2

az login --tenant "$TENANT"      # if not already signed in as bensinclair@msft.ae
az account set --subscription "$APP_SUB"
az account show --query "{sub:name, tenant:tenantId, user:user.name}" -o jsonc
```

---

## Prerequisites

- Azure CLI signed in as `bensinclair@msft.ae` (see above).
- Resource providers registered in the **app** subscription (already done, but
  idempotent — re-run if you switch subscriptions):
  ```sh
  for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL; do
    az provider register --namespace "$ns" --subscription "$APP_SUB" --wait
  done
  ```
- Write access to the `msft.ae` DNS zone in the `Core` subscription. Verify:
  ```sh
  az network dns zone show -g "$DNS_RG" -n "$DNS_ZONE" --subscription "$DNS_SUB" -o none && echo OK
  ```
- A **GitHub OAuth App** for production (<https://github.com/settings/developers>
  → *New OAuth App*). The callback URL is fixed in **Step 6**; create it with a
  placeholder for now.

---

## Step 1 — Resource group

```sh
az group create -n "$RG" -l "$LOCATION" --subscription "$APP_SUB"
```

> **Region note:** `eastus2` is used because it matches the existing
> `casper.msft.ae` Container Apps environment and is unrestricted for
> PostgreSQL Flexible Server on this subscription. `westeurope`, `westus3` and
> `uaenorth` are also verified-unrestricted if you need to move. All resources
> inherit the RG region via the `location` param default, so the RG region is
> the only place you pick one. To re-check a region:
> ```sh
> az rest --method get --subscription "$APP_SUB" \
>   --url "https://management.azure.com/subscriptions/$APP_SUB/providers/Microsoft.DBforPostgreSQL/locations/$LOCATION/capabilities?api-version=2023-06-01-preview" \
>   --query "value[0].restricted"
> ```
> (`Disabled` = allowed. Yes, that reads backwards — the field means "is
> restricted", so `Disabled` means "not restricted".)

## Step 2 — Generate secrets

```sh
AUTH_SECRET=$(openssl rand -base64 32)        # NextAuth session secret
PAT_KEY=$(openssl rand -base64 32)            # PAT AES-256-GCM key
PG_PW=$(openssl rand -hex 24)                 # URL-safe Postgres password

echo "AUTH_SECRET=$AUTH_SECRET"; echo "PAT_KEY=$PAT_KEY"; echo "PG_PW=$PG_PW"
```

> Keep these safe. `PAT_KEY` must never change once data exists, or stored PATs
> become undecryptable. (Re-run this step only if you're starting fresh.)

## Step 3 — Deploy the infrastructure

Secrets are passed inline (never committed); non-secret values come from
`main.parameters.json`. On this first pass the container app runs a public
placeholder image and has **no custom domain** — both are expected, and both
are fixed in Steps 4 and 5.

```sh
az deployment group create \
  -g "$RG" --subscription "$APP_SUB" \
  -f infra/main.bicep \
  -p infra/main.parameters.json \
  -p githubClientId='<your_oauth_client_id>' \
     githubClientSecret='<your_oauth_client_secret>' \
     pgAdminPassword="$PG_PW" \
     patEncryptionKey="$PAT_KEY" \
     authSecret="$AUTH_SECRET"
```

Grab the outputs into shell vars:

```sh
out() { az deployment group show -g "$RG" --subscription "$APP_SUB" -n main \
  --query "properties.outputs.$1.value" -o tsv; }

ACR=$(out acrName)
APP=$(out containerAppName)
APP_FQDN=$(out defaultFqdn)                  # CNAME target, no scheme
VERIFY_ID=$(out customDomainVerificationId)  # asuid TXT value
PG_FQDN=$(out postgresFqdn)

printf 'app=%s\nfqdn=%s\nacr=%s\npg=%s\n' "$APP" "$APP_FQDN" "$ACR" "$PG_FQDN"
```

## Step 4 — Build the image in ACR and roll it out

`az acr build` uploads the build context and builds the image on Azure (uses the
repo `Dockerfile`). Then point the container app at the freshly built image.

```sh
IMAGE="${ACR}.azurecr.io/octoscope:latest"

az acr build --registry "$ACR" --subscription "$APP_SUB" --image octoscope:latest .

az containerapp update \
  -g "$RG" --subscription "$APP_SUB" -n "$APP" \
  --image "$IMAGE"
```

Sanity-check it's serving on the generated URL before adding the custom domain:

```sh
curl -sSI "https://${APP_FQDN}" | head -1
```

## Step 5 — Bind `octoscope.msft.ae`

The `msft.ae` zone is Azure DNS in the `Core` subscription, so the records are
scripted rather than clicked. This mirrors the existing `casper.msft.ae` setup
in the same zone.

**5a. Create the CNAME + ownership TXT records.**

`asuid.<label>` proves to Azure that you control the hostname. TTL is 300 to
match the rest of the zone and to keep a bad value from being cached for long.

```sh
dns() { az network dns "$@" -g "$DNS_RG" -z "$DNS_ZONE" --subscription "$DNS_SUB" -o none; }

# CNAME octoscope -> <app>.<env>.eastus2.azurecontainerapps.io
dns record-set cname create     -n "$HOST_LABEL" --ttl 300
dns record-set cname set-record -n "$HOST_LABEL" --cname "$APP_FQDN"

# TXT asuid.octoscope -> customDomainVerificationId
# Delete first so re-runs replace the value instead of appending a second one.
dns record-set txt delete -n "asuid.${HOST_LABEL}" --yes 2>/dev/null || true
dns record-set txt create -n "asuid.${HOST_LABEL}" --ttl 300
dns record-set txt add-record -n "asuid.${HOST_LABEL}" -v "$VERIFY_ID"
```

**5b. Wait for both to resolve.** The next step fails hard if they haven't
propagated — Azure validates domain ownership synchronously.

```sh
until [ "$(dig +short CNAME "$FQDN")" = "${APP_FQDN}." ]; do echo "waiting for CNAME..."; sleep 10; done
until dig +short TXT "asuid.${FQDN}" | grep -q "$VERIFY_ID";  do echo "waiting for TXT...";   sleep 10; done
echo "DNS ready"
```

**5c. Re-run Bicep with the custom domain set.** This adds the hostname to the
app's ingress, provisions the free managed certificate, and sets `AUTH_URL` to
`https://octoscope.msft.ae` so NextAuth builds correct callback URLs.

Note the extra `containerImage` — without it, ARM resets the app to the
placeholder image from Step 3.

```sh
az deployment group create \
  -g "$RG" --subscription "$APP_SUB" \
  -f infra/main.bicep \
  -p infra/main.parameters.json \
  -p githubClientId='<your_oauth_client_id>' \
     githubClientSecret='<your_oauth_client_secret>' \
     pgAdminPassword="$PG_PW" \
     patEncryptionKey="$PAT_KEY" \
     authSecret="$AUTH_SECRET" \
     customDomain="$FQDN" \
     containerImage="$IMAGE"

SITE="https://${FQDN}"
```

Certificate issuance takes a few minutes and is part of the deployment, so the
command blocks until it completes. Verify:

```sh
az containerapp hostname list -g "$RG" --subscription "$APP_SUB" -n "$APP" -o table
curl -sSI "$SITE" | head -1
```

> **Why this is in Bicep and not `az containerapp hostname bind`.** ARM
> incremental deployments reapply the *entire* ingress block. A hostname bound
> out-of-band with the CLI is silently stripped the next time anyone runs
> `az deployment group create` — and `AUTH_URL` reverts to the
> `azurecontainerapps.io` URL, breaking OAuth. Declaring `customDomain` keeps
> the two in sync. Always pass `customDomain` on subsequent infra deploys.

## Step 6 — Update the GitHub OAuth App callback

Set the OAuth App's **Authorization callback URL** to
`$SITE/api/auth/callback/github` and **Homepage URL** to `$SITE`:

```sh
echo "Callback URL: $SITE/api/auth/callback/github"
echo "Homepage URL: $SITE"
```

> GitHub OAuth Apps allow only **one** callback URL, so logins via the
> `azurecontainerapps.io` URL stop working once you switch. That's intended —
> `AUTH_URL` now points at the custom domain either way.

## Step 7 — Apply the database schema

**Do not push from your laptop.** Microsoft corpnet drops outbound `:5432`, so
`npm run db:push` hangs on *"Pulling schema from database"* and eventually
fails. Adding a Postgres firewall rule for your IP does **not** help — the
packets never reach Azure. (Diagnostic: `nc -z <pg-fqdn> 5432` times out rather
than being refused. A refusal would mean Azure got the packet and rejected it;
a timeout means egress filtering.)

Instead run Drizzle from a **Container Apps job** in the same environment, which
already reaches Postgres through the `AllowAllAzureServices` rule. This also
means the Postgres server never needs a firewall hole for a developer machine.

[`Dockerfile.migrate`](../Dockerfile.migrate) builds the app's dependency tree
plus `drizzle-kit` and [`scripts/db-ops.cjs`](../scripts/db-ops.cjs). Its default
command pushes the schema and then lists the resulting tables.

The job itself is declared in `main.bicep`, but only once `migrateImage` is
supplied — the image does not exist on the first deploy. So this is a build
followed by a third Bicep pass.

**7a. Build the migrator image, then create the job via Bicep.**

```sh
MIGRATE_IMAGE="${ACR}.azurecr.io/octoscope-migrate:latest"

az acr build --registry "$ACR" --subscription "$APP_SUB" \
  -f Dockerfile.migrate --image octoscope-migrate:latest .

# Same command as Step 5c, plus migrateImage. Keep passing customDomain and
# containerImage every time — see the warning in Step 5c.
az deployment group create \
  -g "$RG" --subscription "$APP_SUB" -f infra/main.bicep \
  -p infra/main.parameters.json \
  -p githubClientId='<id>' githubClientSecret='<secret>' \
     pgAdminPassword="$PG_PW" patEncryptionKey="$PAT_KEY" authSecret="$AUTH_SECRET" \
     customDomain="$FQDN" containerImage="$IMAGE" migrateImage="$MIGRATE_IMAGE"
```

The job authenticates to ACR with the deployment's user-assigned managed
identity, so no registry password exists anywhere — the registry's admin user is
disabled.


**7b. Run it and wait.**

```sh
EXEC=$(az containerapp job start -g "$RG" --subscription "$APP_SUB" \
  -n octoscope-migrate --query name -o tsv)

until [ "$(az containerapp job execution show -g "$RG" --subscription "$APP_SUB" \
  -n octoscope-migrate --job-execution-name "$EXEC" \
  --query properties.status -o tsv)" != "Running" ]; do sleep 10; done

az containerapp job execution show -g "$RG" --subscription "$APP_SUB" \
  -n octoscope-migrate --job-execution-name "$EXEC" --query properties.status -o tsv
```

**7c. Read the output.** Job logs go to Log Analytics; `az containerapp job logs
show` only works while a replica is alive, so query the workspace instead:

```sh
WS=$(az monitor log-analytics workspace show -g "$RG" --subscription "$APP_SUB" \
  -n octoscope-logs --query customerId -o tsv)

az monitor log-analytics query --workspace "$WS" --subscription "$APP_SUB" \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerGroupName_s startswith 'octoscope-migrate' | project TimeGenerated, Log_s | order by TimeGenerated asc" \
  --query "[].Log_s" -o tsv
```

Expected tail:

```
[✓] Changes applied
TABLES: audit_boards, audit_projects, audit_repos, project_collaborators, super_admins, users
```

> Re-running the job is safe and idempotent — a second run reports
> `[i] No changes detected`. See "Redeploying after code changes" for why
> `push` is the only schema mechanism here.

Browse to `$SITE` and sign in with GitHub.


---

## Seeding the first super admin

_(Optional, but you'll want at least one.)_ **Super admins** have owner-level
access to *every* audit project (including ones they neither own nor collaborate
on) and can manage other super admins from the UI (user menu → **Super admins**,
`/admin`).

There is no env-var bootstrap: the **first** super admin is seeded manually.
Admins are keyed by GitHub `login` (lowercased); the row is matched to an app
account by login on their next sign-in, so you can seed someone before they have
ever signed in.

Reuse the migrator image from Step 7, overriding the command to run the
`seed-admin` subcommand of [`scripts/db-ops.cjs`](../scripts/db-ops.cjs). This
one is a genuine one-off, so it stays a CLI job rather than living in Bicep —
note `--registry-identity`, since the registry has no admin user:

```sh
LOGIN=your-github-login
UAMI=$(az deployment group show -g "$RG" --subscription "$APP_SUB" -n main \
  --query properties.outputs.managedIdentityName.value -o tsv)
UAMI_ID=$(az identity show -g "$RG" --subscription "$APP_SUB" -n "$UAMI" --query id -o tsv)
DB_URL="postgres://octoscope:${PG_PW}@${PG_FQDN}:5432/octoscope?sslmode=require"

az containerapp job create \
  -g "$RG" --subscription "$APP_SUB" -n octoscope-seed \
  --environment octoscope-env \
  --trigger-type Manual \
  --replica-timeout 300 --replica-retry-limit 0 \
  --parallelism 1 --replica-completion-count 1 \
  --image "${ACR}.azurecr.io/octoscope-migrate:latest" \
  --registry-server "${ACR}.azurecr.io" \
  --registry-identity "$UAMI_ID" \
  --secrets "database-url=$DB_URL" \
  --env-vars "DATABASE_URL=secretref:database-url" \
  --cpu 0.5 --memory 1Gi \
  --command "node" --args "scripts/db-ops.cjs" "seed-admin" "$LOGIN"

az containerapp job start -g "$RG" --subscription "$APP_SUB" -n octoscope-seed
```

Delete it once you're done — `az containerapp job delete -g "$RG" -n octoscope-seed --yes`.

Read the result with the Step 7c query, substituting `octoscope-seed`. Expect:

```
SUPER_ADMINS: [{"login":"your-github-login","user_id":null}]
```

> `--args` values are **space-separated and individually quoted**, not
> comma-separated. Passing `--args "-e,<script>"` sends one literal argument
> containing a comma, which is why the ops logic lives in a script file rather
> than an inline `node -e` string.

A null `user_id` just means that login hasn't signed in yet — `db-ops.cjs`
relinks it automatically on the next run, and the app links it on sign-in. Once
one super admin exists, add and remove the rest from the **Super admins** page.


---

## Redeploying after code changes

Only Step 4 is needed — rebuild and roll out a new revision. This does not touch
ingress, so the custom domain and certificate are unaffected:

```sh
az acr build --registry "$ACR" --subscription "$APP_SUB" --image octoscope:latest .
az containerapp update -g "$RG" --subscription "$APP_SUB" -n "$APP" \
  --image "${ACR}.azurecr.io/octoscope:latest"
```

**Infra/config changes:** edit `main.bicep` and re-run the Step 7a command —
i.e. always include **`customDomain`, `containerImage` and `migrateImage`**.
Omitting `customDomain` drops the hostname binding; omitting `containerImage`
reverts the app to the placeholder image; omitting `migrateImage` deletes the
migration job.

**Schema changes:** rebuild the migrator image so it picks up the new
`lib/db/schema.js`, then re-run the job. The job definition does not change, so
this is two commands:

```sh
az acr build --registry "$ACR" --subscription "$APP_SUB" \
  -f Dockerfile.migrate --image octoscope-migrate:latest .
az containerapp job start -g "$RG" --subscription "$APP_SUB" -n octoscope-migrate
```

The job uses `drizzle-kit push --force`, which auto-approves data-loss
statements. On a schema change that drops or narrows a column this **will**
discard data without prompting — review the diff locally with
`npm run db:generate` first if that matters.

> **Renaming a table needs a manual step first.** `push` has no concept of a
> rename: a renamed table looks like "drop the old one, create a new empty one",
> and `--force` approves exactly that. For a parent table the drop cascades into
> its children. Rename in place *before* pushing, using the same one-off job
> pattern as the super-admin seed:
>
> ```sh
> --command "node" --args "scripts/db-ops.cjs" "rename-table" "<old>" "<new>"
> ```
>
> It is idempotent, refuses to run when both names exist, brings matching index
> names across, and prints row counts either side so you can confirm nothing was
> lost. `push` then sees no difference. Note the app is broken between the
> rename and the new revision going live, so build images first and run the
> rename, push and rollout back to back.

> **`push` is the only schema mechanism.** There is no migration history:
> `lib/db/migrations/` was deleted because it had drifted out of sync with
> `lib/db/schema.js` (it was missing `super_admins` entirely), and a stale
> migration set that silently produces the wrong schema is worse than none.
> `drizzle-kit push` diffs against the live database, so it cannot drift.
> If you later want reviewable migrations, generate a baseline from the current
> schema and mark it as already-applied against the deployed database.



## Logs & troubleshooting

```sh
az containerapp logs show -g "$RG" --subscription "$APP_SUB" -n "$APP" --follow
az containerapp revision list -g "$RG" --subscription "$APP_SUB" -n "$APP" -o table
az containerapp hostname list -g "$RG" --subscription "$APP_SUB" -n "$APP" -o table

# Managed certificate state
az containerapp env certificate list -g "$RG" --subscription "$APP_SUB" -n octoscope-env -o table
```

### Health probes

The app exposes [`/api/health`](../app/api/health/route.js), which runs
`select 1` against Postgres and returns `503 {"status":"degraded"}` if that
fails. It is the **readiness** probe target, so a revision that boots but cannot
reach the database never receives traffic — instead of silently serving errors
while the deployment reports success.

**Liveness** deliberately points at `/api/auth/csrf` instead. Restarting the
container cannot fix an unreachable database, and pointing liveness at a
dependency check turns a brief Postgres blip into a crash loop.

```sh
curl -s "$SITE/api/health"        # {"status":"ok"}
az containerapp revision list -g "$RG" --subscription "$APP_SUB" -n "$APP" \
  --query "[].{rev:name, active:properties.active, healthy:properties.healthState}" -o table
```

If a new revision never becomes healthy, it is almost always the readiness probe
failing on the database — check the app logs rather than the deployment output.


Common custom-domain failures on the Step 5c deployment:

| Error | Cause |
| --- | --- |
| `InvalidCustomHostNameValidation` | `asuid.octoscope` TXT missing, stale, or not yet propagated. Re-check Step 5b. |
| `RequireCustomHostnameInEnvironment` | Certificate reached the RP before the hostname did. Just re-run 5c — it's idempotent. |
| Cert issues but browser shows a TLS error | Issuance can lag the deployment by a few minutes. Wait, then re-check `hostname list`. |

Do not put Cloudflare, Front Door or Traffic Manager in front of the CNAME — an
intermediate hop blocks managed-certificate issuance *and* renewal. Likewise, if
a CAA record is ever added to `msft.ae`, it must include `0 issue digicert.com`
or renewal will fail.

## Tearing it all down

```sh
az group delete -n "$RG" --subscription "$APP_SUB" --yes --no-wait

# DNS records live in the Core subscription and are not in the RG:
az network dns record-set cname delete -g "$DNS_RG" -z "$DNS_ZONE" \
  -n "$HOST_LABEL" --subscription "$DNS_SUB" --yes
az network dns record-set txt delete -g "$DNS_RG" -z "$DNS_ZONE" \
  -n "asuid.${HOST_LABEL}" --subscription "$DNS_SUB" --yes
```

## Cost note (approx, East US 2, pay-as-you-go)

| Resource | Tier | ~Monthly |
| --- | --- | --- |
| Container App | Consumption, 0.5 vCPU / 1 GiB, 1 replica | ~$15 warm (scale-to-zero with `minReplicas=0` ≈ near-$0 idle) |
| Container Registry | Basic | ~$5 |
| PostgreSQL Flexible | B1ms + 32 GB | ~$15–20 |
| Log Analytics | Pay-as-you-go ingest | a few $ |
| Managed TLS certificate | Free | $0 |

Set `-p minReplicas=0` on Step 3/5c to scale to zero when idle (cold starts on
first request). Delete the resource group to stop all billing.

## Local testing (optional)

To verify the production build before pushing (note: this overwrites `.next` and
will disrupt a running `next dev`):

```sh
export PATH="/usr/local/bin:$PATH"
npm run build && node .next/standalone/server.js   # serves on :3000
```

## Database auto-start

This subscription's governance **stops idle PostgreSQL servers** — observed
roughly 9 hours after the server was created, performed by a platform service
principal (not by anyone on the team, and not by anything in this repo). It is a
cost control we don't own, so the deployment works with it rather than against
it.

`main.bicep` defines a scheduled Container Apps job, `octoscope-db-start`, which
runs on `dbAutoStartCron` (default `0 5-17 * * 1-5` — hourly on the hour,
05:00–17:00 UTC, Mon–Fri). It checks the server state and starts it only when
`Stopped`, so most runs are a no-op. Overnight and at weekends the database
stays stopped, which is the point of the policy.

The job authenticates with the deployment's managed identity and holds a
**custom role** carrying only `flexibleServers/read` and
`flexibleServers/start/action`, scoped to that one server — no Contributor, no
data-plane access.

```sh
# Force a start right now
az containerapp job start -g "$RG" --subscription "$APP_SUB" -n octoscope-db-start

# Or directly
az postgres flexible-server start -g "$RG" --subscription "$APP_SUB" -n "${PG_FQDN%%.*}"

# Check state
az postgres flexible-server show -g "$RG" --subscription "$APP_SUB" \
  -n "${PG_FQDN%%.*}" --query state -o tsv
```

Set `-p dbAutoStartCron=''` to remove the job entirely.

### Why the site hangs rather than erroring when the database is down

It no longer does, but it did. `node-postgres` defaults `connectionTimeoutMillis`
to `0` — wait forever. With the database stopped, every request that touched it
hung indefinitely, including `/api/health`, so the readiness probe timed out
instead of reporting unhealthy and the ingress had no ready replica to route to.
The site stopped responding entirely instead of returning a fast 503.

`lib/db/index.js` now sets `connectionTimeoutMillis`, `statement_timeout` and
`query_timeout`. An unreachable database is an *expected* state here, so it has
to degrade cleanly.

## Hardening notes

### Least-privilege database role

The app connects as **`octoscope_app`**, not the server admin. Create or rotate
it with the migrator image before deploying:

```sh
APP_DB_PW=$(openssl rand -hex 24)   # alphanumeric on purpose, see below
# run as a one-off job with the ADMIN DATABASE_URL:
--command "node" --args "scripts/db-ops.cjs" "ensure-app-role" "octoscope_app" "$APP_DB_PW"
```

Then pass `-p appDbPassword="$APP_DB_PW"` on the Bicep deploy. Leave it empty
and the app falls back to the admin account, which works but gives up the
protection.

The role has `SELECT/INSERT/UPDATE/DELETE` on `public` and nothing else — no
DDL, no role management. Default privileges are granted too, so tables created
by future migrations are reachable without re-running anything. Migrations keep
using the admin account, since they need DDL.

> Role names and passwords cannot be bound as query parameters, so
> `ensure-app-role` requires an alphanumeric password (hex from `openssl`). That
> removes the escaping question entirely rather than relying on getting quoting
> right.

Verify at any time — this **fails** if the role can run DDL, so it can be
asserted from a script without reading logs:

```sh
--command "node" --args "scripts/db-ops.cjs" "verify-app-role"
```

### What is NOT fixed: the Postgres firewall

The server still carries the `0.0.0.0` "allow all Azure services" rule, which
permits connections from **any Azure subscription, including other customers'**.
Credentials are the only control, which is why the app no longer uses an admin
one.

This cannot be narrowed as things stand. Container Apps **Consumption-only**
environments have no stable outbound IP (Microsoft documents that outbound IPs
"might change over time"), so there is no address to allow-list. A stable egress
IP requires a **workload-profiles** environment with a custom VNet and a NAT
Gateway — and **a VNet cannot be added to an existing environment**. Reaching
Postgres over a private endpoint has the same prerequisite.

Closing this properly therefore means recreating the Container Apps environment:
new default domain, re-pointed CNAME, reissued managed certificate, and
downtime. The custom domain makes the FQDN churn invisible to users, so it is
doable — but it is a migration, not a setting.

### TLS verification

`lib/db/index.js` and `scripts/db-ops.cjs` set `rejectUnauthorized: true`. The
previous `false` gave encryption without authentication: unreadable in transit,
but nothing proved the far end was really our database. Azure's chain roots in
DigiCert Global Root G2, which Node already trusts, so no CA bundle is needed.

The migration job runs before the app rolls out and verifies certificates
itself, so it doubles as the deployment canary.

### Schema data loss

`drizzle-kit push --force` is now opt-in via `allowSchemaDataLoss`. Without it,
a destructive change prompts, and stdin is `/dev/null` so the job fails loudly
instead of hanging. Set `-p allowSchemaDataLoss=true` for the single deployment
that intentionally drops or narrows a column, then set it back.

### Scale to zero

`minReplicas` is `0`. The app costs nothing while idle at the price of a cold
start on the first request after a quiet period.

## Agent

The Agent tab is backed by any **OpenAI-compatible** `/chat/completions`
endpoint — OpenAI, Azure OpenAI, or anything else speaking the same API. There
is no deployment-level configuration: a project admin sets the endpoint, model
and API key under **project settings → Agent**.

The key is stored encrypted with the same AES-256-GCM key as repository PATs
(`PAT_ENCRYPTION_KEY`), is decrypted only server-side when relaying a request,
and is never sent to the browser. Members can use the agent without ever
holding it.

Credentials are per **project**, not per user: an API key is billed by usage
rather than licensed to a person, so an admin providing one for their team is a
normal arrangement. Its usage is billed to whoever owns the key.

> An earlier revision targeted GitHub Copilot. That was abandoned: Copilot has
> no public API for third-party applications, `copilot_internal` is an
> undocumented editor endpoint that GitHub allowlists to editor OAuth clients,
> and a Copilot seat is licensed per person so sharing one across a team would
> not have been legitimate. GitHub Models, the supported token-based route,
> now returns `410 github_models_retirement_brownout`.
