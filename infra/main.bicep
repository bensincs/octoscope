// ---------------------------------------------------------------------------
// Octoscope — Azure infrastructure (Azure Container Apps edition)
//
// Deploys:
//   * Log Analytics workspace            (Container Apps log sink)
//   * Container Apps managed environment (consumption)
//   * Azure Container Registry           (Basic, admin enabled)
//   * Container App                      (the Next.js app, external ingress)
//   * PostgreSQL Flexible Server         (Burstable B1ms) + database + firewall
//
// Container Apps use consumption vCPU/memory quota — independent of the
// App Service "VMs" quota that is capped at 0 on this subscription.
//
// Two-phase flow (see deploy.md):
//   1. Deploy this Bicep. The container app starts on a public placeholder
//      image because the real image doesn't exist in ACR yet.
//   2. `az acr build` the real image, then `az containerapp update --image ...`
//      to roll it out. Re-deploys only need step 2.
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

// Short, deterministic suffix → globally-unique names.
var suffix = take(uniqueString(resourceGroup().id), 6)
var containerAppName = '${namePrefix}-${suffix}'
var pgServerName = '${namePrefix}-pg-${suffix}'
var acrName = '${namePrefix}acr${suffix}' // ACR names: alphanumeric only
var envName = '${namePrefix}-env'
var lawName = '${namePrefix}-logs'

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
// Azure Container Registry
// ---------------------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
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

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
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
var databaseUrl = 'postgres://${pgAdminUser}:${pgAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
var appUrl = 'https://${containerAppName}.${env.properties.defaultDomain}'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
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
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
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
              value: appUrl
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
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: 3
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output containerAppName string = containerAppName
output appUrl string = appUrl
output oauthCallbackUrl string = '${appUrl}/api/auth/callback/github'
output acrName string = acrName
output acrLoginServer string = acr.properties.loginServer
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output resourceGroup string = resourceGroup().name
