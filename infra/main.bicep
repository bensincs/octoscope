// ---------------------------------------------------------------------------
// Octoscope — Azure infrastructure (Azure Container Apps edition)
//
// Deploys:
//   * Log Analytics workspace            (Container Apps log sink)
//   * Container Apps managed environment (consumption)
//   * Azure Container Registry           (Basic, admin enabled)
//   * Container App                      (the Next.js app, external ingress)
//   * PostgreSQL Flexible Server         (Burstable B1ms) + database + firewall
//   * Managed certificate                (only when customDomain is set)
//
// Container Apps use consumption vCPU/memory quota, so this works on
// subscriptions with a 0 quota for App Service dedicated VMs.
//
// Three-phase flow (see deploy.md):
//   1. Deploy this Bicep with customDomain=''. The container app starts on a
//      public placeholder image because the real image isn't in ACR yet.
//   2. `az acr build` the real image, then `az containerapp update --image ...`.
//   3. Create the DNS records in the Azure DNS zone, then re-deploy this Bicep
//      with customDomain set to bind the hostname + managed TLS certificate.
//
// After that, code-only redeploys need step 2 alone. Infra redeploys must keep
// passing customDomain (and containerImage), or ARM will reapply the ingress
// block without them and drop the custom hostname.
// ---------------------------------------------------------------------------

@description('Azure region for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Base name used to derive resource names. A short hash of the resource group id is appended for global uniqueness.')
param namePrefix string = 'octoscope'

@description('Container image to run. Leave as the placeholder for the first deploy; az containerapp update swaps in the real ACR image afterwards.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Number of always-on replicas. 0 enables scale-to-zero (cheaper, cold starts); 1 keeps the app warm.')
@minValue(0)
@maxValue(5)
param minReplicas int = 1

@description('PostgreSQL administrator login name.')
param pgAdminUser string = 'octoscope'

@description('PostgreSQL administrator password. URL-safe (no @ : / ? # characters) so it embeds cleanly in DATABASE_URL.')
@secure()
param pgAdminPassword string

@description('Name of the application database created on the Postgres server.')
param databaseName string = 'octoscope'

@description('GitHub OAuth App client id.')
param githubClientId string

@description('GitHub OAuth App client secret.')
@secure()
param githubClientSecret string

@description('AES-256-GCM key for PAT encryption at rest. 32 bytes, base64 encoded.')
@secure()
param patEncryptionKey string

@description('NextAuth (Auth.js) AUTH_SECRET. Generate with: openssl rand -base64 32')
@secure()
param authSecret string

@description('Custom hostname to serve the app on, e.g. octoscope.msft.ae. Leave empty on the first deploy; set it on the second pass once the CNAME + asuid TXT records exist (see deploy.md Step 5). When set it also becomes AUTH_URL.')
param customDomain string = ''

@description('Image for the schema-migration job (Dockerfile.migrate). Leave empty until it has been built; the job is only created once this is set.')
param migrateImage string = ''

@description('Password for the least-privilege application database role. Create the role first with: db-ops.cjs ensure-app-role. Leave empty to fall back to the admin account (not recommended).')
@secure()
param appDbPassword string = ''

@description('Auto-approve destructive schema statements on the next migration run. Leave false; set true for ONE deployment when a change intentionally drops or narrows a column.')
param allowSchemaDataLoss bool = false

@description('Cron schedule (UTC) for the database auto-start job. Default: hourly on the hour, 05:00-17:00 UTC, Mon-Fri. Set to empty to disable the job.')
param dbAutoStartCron string = '0 5-17 * * 1-5'

// Short, deterministic suffix → globally-unique names.
var suffix = take(uniqueString(resourceGroup().id), 6)
var containerAppName = '${namePrefix}-${suffix}'
var pgServerName = '${namePrefix}-pg-${suffix}'
var acrName = '${namePrefix}acr${suffix}' // ACR names: alphanumeric only
var envName = '${namePrefix}-env'
var lawName = '${namePrefix}-logs'

// Custom domain is opt-in via the customDomain param (empty = not configured yet).
var useCustomDomain = !empty(customDomain)
// Guarded so the name expression stays valid when no custom domain is set and
// the certificate resource is skipped.
var certName = useCustomDomain ? replace(customDomain, '.', '-') : 'placeholder-cert'

// Built-in AcrPull role. Granted to the managed identity so neither the app nor
// the migration job needs the registry admin password.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// ---------------------------------------------------------------------------
// PostgreSQL Flexible Server
// ---------------------------------------------------------------------------
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminUser
    administratorLoginPassword: pgAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
  }
}

// Allow other Azure services (the Container App) to reach the server.
// Start+End 0.0.0.0 is the documented "Allow Azure services" rule.
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ---------------------------------------------------------------------------
// Managed identity + Azure Container Registry
//
// A user-assigned identity (rather than system-assigned) so the AcrPull role
// assignment can be created *before* the app and the job that depend on it. A
// system-assigned identity only gets a principalId once its resource exists,
// which races RBAC propagation against the first image pull.
// ---------------------------------------------------------------------------
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id-${suffix}'
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    // Pulls are authenticated with the managed identity below, so the shared
    // admin password is not needed and is deliberately disabled.
    adminUserEnabled: false
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, uami.id, acrPullRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Log Analytics + Container Apps managed environment
// ---------------------------------------------------------------------------
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Container App
// ---------------------------------------------------------------------------
// Migrations need DDL, so they keep the admin account.
var adminDatabaseUrl = 'postgres://${pgAdminUser}:${pgAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

// The app gets a role that can only read and write rows. The Postgres firewall
// must allow all Azure services (Container Apps consumption has no stable
// egress IP), so the credential is the main control — it should not be one that
// can drop the database.
var appDbUser = '${namePrefix}_app'
var databaseUrl = empty(appDbPassword)
  ? adminDatabaseUrl
  : 'postgres://${appDbUser}:${appDbPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
var appUrl = 'https://${containerAppName}.${env.properties.defaultDomain}'

// Canonical public URL. NextAuth builds its OAuth redirect/callback URLs from
// AUTH_URL, so this must be whatever hostname users actually browse to.
var siteUrl = useCustomDomain ? 'https://${customDomain}' : appUrl

resource containerApp 'Microsoft.App/containerApps@2025-07-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        // Custom domains MUST be declared here. ARM incremental deploys reapply
        // the whole ingress block, so a hostname bound out-of-band with
        // `az containerapp hostname bind` is silently stripped on the next
        // `az deployment group create`. bindingType 'Auto' binds the managed
        // certificate below without needing its certificateId.
        customDomains: useCustomDomain
          ? [
              {
                name: customDomain
                bindingType: 'Auto'
              }
            ]
          : []
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uami.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          value: databaseUrl
        }
        {
          name: 'github-client-secret'
          value: githubClientSecret
        }
        {
          name: 'pat-encryption-key'
          value: patEncryptionKey
        }
        {
          name: 'auth-secret'
          value: authSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'octoscope'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'GITHUB_CLIENT_ID'
              value: githubClientId
            }
            {
              name: 'GITHUB_CLIENT_SECRET'
              secretRef: 'github-client-secret'
            }
            {
              name: 'PAT_ENCRYPTION_KEY'
              secretRef: 'pat-encryption-key'
            }
            {
              name: 'AUTH_SECRET'
              secretRef: 'auth-secret'
            }
            {
              name: 'AUTH_URL'
              value: siteUrl
            }
            // NextAuth v5 sits behind the Container Apps ingress proxy.
            {
              name: 'AUTH_TRUST_HOST'
              value: 'true'
            }
            {
              name: 'PORT'
              value: '3000'
            }
          ]
          // Without probes, Container Apps marks a replica ready as soon as the
          // process starts. Both probes point at a SHALLOW check that does not
          // touch Postgres.
          //
          // Readiness deliberately does not verify the database. Governance on
          // this subscription stops idle databases, and gating readiness on one
          // took the only replica out of rotation whenever that happened — the
          // ingress then had no backend and requests hung with no response,
          // rather than the app loading and reporting the problem. A dependency
          // outage must not become a total outage.
          //
          // The deep check remains at /api/health for humans and monitoring.
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health/live'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              // Liveness only asserts the Node process still serves HTTP.
              // Restarting cannot fix an unreachable database, and probing one
              // here would turn a blip into a crash loop.
              type: 'Liveness'
              httpGet: {
                path: '/api/health/live'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 20
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: 3
      }
    }
  }
  // The AcrPull grant must exist before the first image pull, or the initial
  // revision fails to start while RBAC propagates.
  dependsOn: [
    acrPull
  ]
}

// ---------------------------------------------------------------------------
// Free Azure-managed TLS certificate for the custom domain
//
// Ordering matters: the RP rejects a managed certificate whose subjectName is
// not already a custom hostname on some app in the environment
// (RequireCustomHostnameInEnvironment), hence dependsOn the container app.
// Issuance also needs the CNAME + asuid TXT records to already resolve, which
// is why customDomain is only set on the second deploy pass.
// ---------------------------------------------------------------------------
resource managedCert 'Microsoft.App/managedEnvironments/managedCertificates@2025-07-01' = if (useCustomDomain) {
  parent: env
  name: certName
  location: location
  properties: {
    subjectName: customDomain
    domainControlValidation: 'CNAME'
  }
  dependsOn: [
    containerApp
  ]
}

// ---------------------------------------------------------------------------
// Schema migration job
//
// Postgres Flexible Server is only reachable from inside Azure (corporate
// networks commonly block outbound :5432), so `drizzle-kit push` runs here
// rather than from a developer machine. That also means the server never needs
// a firewall rule for a laptop.
//
// Manual trigger only — start it with:
//   az containerapp job start -g <rg> -n <namePrefix>-migrate
//
// Only created once migrateImage is supplied, because the image does not exist
// on the very first deploy.
// ---------------------------------------------------------------------------
resource migrateJob 'Microsoft.App/jobs@2025-07-01' = if (!empty(migrateImage)) {
  name: '${namePrefix}-migrate'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uami.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          value: adminDatabaseUrl
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: migrateImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              // Empty string leaves --force off; see Dockerfile.migrate.
              name: 'ALLOW_DATA_LOSS'
              value: allowSchemaDataLoss ? 'true' : ''
            }
          ]
        }
      ]
    }
  }
  dependsOn: [
    acrPull
  ]
}

// ---------------------------------------------------------------------------
// Database auto-start
//
// This subscription's governance stops idle PostgreSQL servers (observed ~9h
// after creation, by a platform service principal). That is a cost control we
// don't own and can't disable, so instead of fighting it the app restarts the
// database on a schedule during working hours and leaves it stopped overnight
// and at weekends — which is the point of the policy.
//
// Least privilege: rather than granting Contributor, a custom role carries
// exactly the two actions needed, scoped to this one server.
// ---------------------------------------------------------------------------
resource pgOperatorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = if (!empty(dbAutoStartCron)) {
  name: guid(resourceGroup().id, 'pg-start-operator')
  properties: {
    roleName: '${namePrefix}-pg-start-operator-${suffix}'
    description: 'Start a stopped PostgreSQL flexible server. No data plane access.'
    type: 'CustomRole'
    assignableScopes: [
      resourceGroup().id
    ]
    permissions: [
      {
        actions: [
          'Microsoft.DBforPostgreSQL/flexibleServers/read'
          'Microsoft.DBforPostgreSQL/flexibleServers/start/action'
        ]
        notActions: []
      }
    ]
  }
}

resource pgOperatorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(dbAutoStartCron)) {
  scope: postgres
  name: guid(postgres.id, uami.id, 'pg-start-operator')
  properties: {
    roleDefinitionId: pgOperatorRole.id
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource dbStartJob 'Microsoft.App/jobs@2025-07-01' = if (!empty(dbAutoStartCron)) {
  name: '${namePrefix}-db-start'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 900
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: dbAutoStartCron
        parallelism: 1
        replicaCompletionCount: 1
      }
    }
    template: {
      containers: [
        {
          name: 'db-start'
          // Public MCR image, so no registry credentials are involved.
          image: 'mcr.microsoft.com/azure-cli:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'AZ_CLIENT_ID', value: uami.properties.clientId }
            { name: 'AZ_SUBSCRIPTION', value: subscription().subscriptionId }
            { name: 'PG_RG', value: resourceGroup().name }
            { name: 'PG_NAME', value: pgServerName }
          ]
          command: [
            '/bin/sh'
            '-c'
          ]
          args: [
            // `--client-id` is the current flag; `--username` is the older
            // spelling. Try both so an image refresh can't break the job.
            // Starting an already-running server errors, so check state first,
            // which also makes the hourly schedule a cheap no-op most runs.
            'set -e; az login --identity --client-id "$AZ_CLIENT_ID" >/dev/null 2>&1 || az login --identity --username "$AZ_CLIENT_ID" >/dev/null; az account set --subscription "$AZ_SUBSCRIPTION"; state=$(az postgres flexible-server show -g "$PG_RG" -n "$PG_NAME" --query state -o tsv); echo "state=$state"; if [ "$state" = "Stopped" ]; then echo "starting..."; az postgres flexible-server start -g "$PG_RG" -n "$PG_NAME" -o none; echo "started"; else echo "nothing to do"; fi'
          ]
        }
      ]
    }
  }
  dependsOn: [
    pgOperatorAssignment
  ]
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output containerAppName string = containerAppName
output appUrl string = appUrl
output siteUrl string = siteUrl
// CNAME target for the custom domain (no scheme, no trailing slash).
output defaultFqdn string = containerApp.properties.configuration.ingress.fqdn
// Value for the asuid.<subdomain> TXT record that proves domain ownership.
output customDomainVerificationId string = containerApp.properties.customDomainVerificationId
output oauthCallbackUrl string = '${siteUrl}/api/auth/callback/github'
output acrName string = acrName
output acrLoginServer string = acr.properties.loginServer
output managedIdentityName string = uami.name
output migrateJobName string = empty(migrateImage) ? '' : '${namePrefix}-migrate'
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output resourceGroup string = resourceGroup().name
