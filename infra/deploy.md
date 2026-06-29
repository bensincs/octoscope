# Deploying Octoscope to Azure (Container Apps)

Infrastructure is defined as Bicep in [`main.bicep`](./main.bicep). It provisions
an Azure Container Apps environment, a Container Registry, the app itself, and a
PostgreSQL Flexible Server.

We use **Container Apps** instead of App Service because this subscription has a
0 quota for App Service dedicated VMs. Container Apps draw on a separate
consumption (vCPU/memory) quota.

The image is built **in the cloud** with `az acr build`, so you do **not** need
Docker installed locally.

The flow is:
1. **Provision infra** (Bicep) — the app starts on a placeholder image.
2. **Build + push** the real image to ACR.
3. **Roll out** the real image, then push the DB schema.

Optionally, you can map a **custom domain** (Step 5) and seed the first
**super admin** (after sign-in) — both are clearly marked optional below.

---

## Prerequisites

- Azure CLI logged in: `az account show` (sub **Ben Learning**)
- Register the required resource providers once per subscription:
  ```sh
  az provider register --namespace Microsoft.App --wait
  az provider register --namespace Microsoft.OperationalInsights --wait
  az provider register --namespace Microsoft.ContainerRegistry --wait
  az provider register --namespace Microsoft.DBforPostgreSQL --wait
  ```
- A **GitHub OAuth App** for production (<https://github.com/settings/developers>
  → *New OAuth App*). The callback URL depends on your final public URL, so
  create it with a placeholder and fix the callback in **Step 6**.
- _(Optional, for a custom domain — Step 5)_ A domain you control at a DNS
  provider where you can add `CNAME` + `TXT` records (this guide uses
  **sincs.dev** at GoDaddy, mapping `octoscope.sincs.dev`).

---

## Step 1 — Resource group

```sh
az group create -n octoscope-rg -l westus3
```

> **Region note:** this subscription is offer-restricted for PostgreSQL Flexible
> Server in several regions (`eastus`, `eastus2` fail with
> `LocationIsOfferRestricted`). Verified **allowed** regions for this sub:
> `westus3`, `centralus`, `westeurope`, `australiaeast`. All resources inherit
> the RG region via the `location` param default, so just pick the RG region
> here. To re-check allowed regions later:
> `az rest --method get --url "https://management.azure.com/subscriptions/<sub>/providers/Microsoft.DBforPostgreSQL/locations/<region>/capabilities?api-version=2023-06-01-preview" --query "value[0].restricted"`
> (`Disabled` = allowed).

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
`main.parameters.json`. On the first deploy the container app runs a public
placeholder image — that's expected.

```sh
az deployment group create \
  -g octoscope-rg \
  -f infra/main.bicep \
  -p infra/main.parameters.json \
  -p githubClientId='<your_oauth_client_id>' \
     githubClientSecret='<your_oauth_client_secret>' \
     pgAdminPassword="$PG_PW" \
     patEncryptionKey="$PAT_KEY" \
     authSecret="$AUTH_SECRET"
```

Capture the outputs:

```sh
az deployment group show -g octoscope-rg -n main \
  --query properties.outputs -o jsonc
```

You'll use `acrName`, `containerAppName`, `appUrl`, `oauthCallbackUrl`, and
`postgresFqdn` below. Grab them into shell vars:

```sh
ACR=$(az deployment group show -g octoscope-rg -n main --query properties.outputs.acrName.value -o tsv)
APP=$(az deployment group show -g octoscope-rg -n main --query properties.outputs.containerAppName.value -o tsv)
APP_URL=$(az deployment group show -g octoscope-rg -n main --query properties.outputs.appUrl.value -o tsv)
PG_FQDN=$(az deployment group show -g octoscope-rg -n main --query properties.outputs.postgresFqdn.value -o tsv)

# Public base URL used by the OAuth + sign-in steps. Defaults to the generated
# Azure URL; Step 5 overrides this if you add a custom domain.
SITE="$APP_URL"
```

## Step 4 — Build the image in ACR and roll it out

`az acr build` uploads the build context and builds the image on Azure (uses the
repo `Dockerfile`). Then point the container app at the freshly built image.

```sh
az acr build --registry "$ACR" --image octoscope:latest .

az containerapp update \
  -g octoscope-rg -n "$APP" \
  --image "${ACR}.azurecr.io/octoscope:latest"
```

## Step 5 — (Optional) Point a custom domain at the app

Skip this if the generated `*.azurecontainerapps.io` URL is fine — just leave
`SITE="$APP_URL"` and go to Step 6.

This maps **octoscope.sincs.dev** (a subdomain of `sincs.dev`, managed at
GoDaddy) to the app with a free Azure-managed TLS certificate. Adjust
`SUBDOMAIN` and the GoDaddy records for your own domain.

**5a. Get the hostname + Azure's domain-ownership token:**

```sh
SUBDOMAIN=octoscope.sincs.dev
VERIFY_ID=$(az containerapp show -g octoscope-rg -n "$APP" \
  --query properties.customDomainVerificationId -o tsv)

echo "CNAME  ${SUBDOMAIN%%.*}            -> $APP_URL"   # value below has no https://
echo "TXT    asuid.${SUBDOMAIN%%.*}      -> $VERIFY_ID"
```

**5b. Add two DNS records at your provider** (GoDaddy → *sincs.dev* → *Manage
DNS*). Enter the **host** only — GoDaddy appends `.sincs.dev` automatically:

| Type | Name (host) | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `octoscope` | the app's default FQDN, e.g. `octoscope-nxmz7n.wittycoast-759eb4e2.westus3.azurecontainerapps.io` (no `https://`, no trailing slash) | 600 |
| TXT | `asuid.octoscope` | the `$VERIFY_ID` value printed in 5a | 600 |

Wait for DNS to propagate (usually a few minutes), then verify both resolve:

```sh
dig +short CNAME "$SUBDOMAIN"
dig +short TXT   "asuid.${SUBDOMAIN}"
```

**5c. Bind the hostname and provision the managed certificate:**

```sh
az containerapp hostname add  -g octoscope-rg -n "$APP" --hostname "$SUBDOMAIN"
az containerapp hostname bind -g octoscope-rg -n "$APP" \
  --hostname "$SUBDOMAIN" --environment octoscope-env --validation-method CNAME
```

The managed cert takes a few minutes to issue. If `bind` reports the binding
isn't ready, wait and re-run it — it's idempotent.

**5d. Make the custom domain the app's canonical URL** (so NextAuth builds
correct redirect/callback URLs):

```sh
SITE="https://${SUBDOMAIN}"
az containerapp update -g octoscope-rg -n "$APP" --set-env-vars AUTH_URL="$SITE"
```

## Step 6 — Update the GitHub OAuth App callback

Set the OAuth App's **Authorization callback URL** to
`$SITE/api/auth/callback/github` and **Homepage URL** to `$SITE` — where `$SITE`
is your custom domain from Step 5, or the `appUrl` output if you skipped it
(e.g. `https://octoscope-ab12cd.<region>.azurecontainerapps.io`).

```sh
echo "Callback URL: $SITE/api/auth/callback/github"
echo "Homepage URL: $SITE"
```

> GitHub OAuth Apps allow only **one** callback URL. If you add a custom domain
> later (Step 5), come back here and update it — logins via the old URL stop
> working once you switch.

## Step 7 — Push the database schema

Add a temporary firewall rule for your current IP, run Drizzle `db:push`, then
remove the rule:

```sh
PG_SERVER=${PG_FQDN%%.*}
MY_IP=$(curl -s https://api.ipify.org)

az postgres flexible-server firewall-rule create \
  -g octoscope-rg -n "$PG_SERVER" \
  --rule-name client-tmp --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"

export DATABASE_URL="postgres://octoscope:${PG_PW}@${PG_FQDN}:5432/octoscope?sslmode=require"
export PATH="/usr/local/bin:$PATH"
npm run db:push

az postgres flexible-server firewall-rule delete \
  -g octoscope-rg -n "$PG_SERVER" --rule-name client-tmp --yes
```

Browse to `$SITE` and sign in with GitHub.

---

## Seeding the first super admin

_(Optional, but you'll want at least one.)_ **Super admins** have owner-level
access to *every* audit project (including ones they neither own nor collaborate
on) and can manage other super admins from the UI (user menu → **Super admins**,
`/admin`).

There is no env-var bootstrap: the **first** super admin is seeded manually with
SQL. Admins are keyed by GitHub `login` (lowercased); the row is matched to an
app account by login on their next sign-in, so you can seed someone before they
have ever signed in.

Reuse the temporary firewall rule + `DATABASE_URL` from Step 7, then:

```sh
psql "$DATABASE_URL" -c "insert into super_admins (login) values ('your-github-login') on conflict (login) do nothing;"
```

(If a row's `user_id` stays null it just means that login hasn't signed in yet —
it's linked automatically on their next sign-in. To force-link an existing
account immediately:
`update super_admins s set user_id = u.id from users u where lower(u.login) = s.login and s.user_id is null;`)

Remember to delete the firewall rule afterwards (see Step 7). Once one super
admin exists, add/remove the rest from the **Super admins** page.

---

## Redeploying after code changes

Only Step 4 is needed — rebuild and roll out a new revision:

```sh
az acr build --registry "$ACR" --image octoscope:latest .
az containerapp update -g octoscope-rg -n "$APP" \
  --image "${ACR}.azurecr.io/octoscope:latest"
```

Infra/config changes: edit `main.bicep` and re-run Step 3 (incremental — pass the
current `containerImage` so it isn't reset to the placeholder, e.g.
`-p containerImage="${ACR}.azurecr.io/octoscope:latest"`).

## Logs & troubleshooting

```sh
az containerapp logs show -g octoscope-rg -n "$APP" --follow
az containerapp revision list -g octoscope-rg -n "$APP" -o table

# Custom-domain binding + managed-cert status (Step 5)
az containerapp hostname list -g octoscope-rg -n "$APP" -o table
```

## Tearing it all down

```sh
az group delete -n octoscope-rg --yes --no-wait
```

## Cost note (approx, East US, pay-as-you-go)

| Resource | Tier | ~Monthly |
| --- | --- | --- |
| Container App | Consumption, 0.5 vCPU / 1 GiB, 1 replica | ~$15 warm (scale-to-zero with `minReplicas=0` ≈ near-$0 idle) |
| Container Registry | Basic | ~$5 |
| PostgreSQL Flexible | B1ms + 32 GB | ~$15–20 |
| Log Analytics | Pay-as-you-go ingest | a few $ |

Set `-p minReplicas=0` on Step 3 to scale to zero when idle (cold starts on first
request). Delete the resource group to stop all billing.

## Local testing (optional)

To verify the production build before pushing (note: this overwrites `.next` and
will disrupt a running `next dev`):

```sh
export PATH="/usr/local/bin:$PATH"
npm run build && node .next/standalone/server.js   # serves on :3000
```
