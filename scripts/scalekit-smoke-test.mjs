import 'dotenv/config';
import { ScalekitClient } from '@scalekit-sdk/node';
import { ConnectorStatus } from '@scalekit-sdk/node/lib/pkg/grpc/scalekit/v1/connected_accounts/connected_accounts_pb.js';

const envUrl = process.env.SCALEKIT_ENV_URL || process.env.SCALEKIT_ENVIRONMENT_URL;
const clientId = process.env.SCALEKIT_CLIENT_ID;
const clientSecret = process.env.SCALEKIT_CLIENT_SECRET;
const identifier = process.env.DEMO_USER_ID || process.env.SCALEKIT_TEST_IDENTIFIER || 'demo_user';

const connectorSpecs = [
  ['GMAIL_CONNECTION_NAME', 'gmail'],
  ['NOTION_CONNECTION_NAME', 'notion'],
  ['SLACK_CONNECTION_NAME', 'slack'],
  ['GITHUB_CONNECTION_NAME', 'github'],
  ['GOOGLE_CALENDAR_CONNECTION_NAME', 'googlecalendar'],
  ['GOOGLE_SHEETS_CONNECTION_NAME', 'googlesheets'],
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function statusLabel(status) {
  if (typeof status === 'number') return ConnectorStatus[status] || String(status);
  return String(status || 'UNKNOWN');
}

function summarizeAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    identifier: account.identifier,
    provider: account.provider,
    status: account.status,
    statusLabel: statusLabel(account.status),
    authorizationType: account.authorizationType,
    tokenExpiresAt: account.tokenExpiresAt,
  };
}

if (!envUrl || !clientId || !clientSecret) {
  fail('Missing Scalekit credentials. Need SCALEKIT_CLIENT_ID, SCALEKIT_CLIENT_SECRET, and SCALEKIT_ENV_URL or SCALEKIT_ENVIRONMENT_URL.');
  process.exit();
}

console.log('Scalekit smoke test');
console.log('Env URL:', envUrl);
console.log('Client ID:', `${clientId.slice(0, 6)}…${clientId.slice(-4)}`);
console.log('Identifier:', identifier);
console.log('');

const scalekit = new ScalekitClient(envUrl, clientId, clientSecret);

console.log('1) Testing API credentials by listing tools...');
try {
  const res = await scalekit.tools.listTools({ pageSize: 20 });
  const tools = res.tools || [];
  console.log(`✅ Credentials OK. Workspace returned ${tools.length} tool(s) in first page.`);
  for (const t of tools.slice(0, 8)) {
    const def = t.definition || t.tool?.definition || t;
    console.log(`   - ${def.name || t.name || '(unnamed tool)'}`);
  }
} catch (err) {
  fail(`Could not list tools: ${err?.constructor?.name || 'Error'}: ${err?.message || err}`);
}

console.log('\n2) Checking requested connections and generating OAuth links if needed...');
const results = [];

for (const [envName, fallbackName] of connectorSpecs) {
  const connectionName = process.env[envName] || fallbackName;
  console.log(`\n— ${fallbackName} connectionName=${connectionName}${process.env[envName] ? ` (from ${envName})` : ' (default guess)'}`);
  const item = { connector: fallbackName, connectionName };

  try {
    const response = await scalekit.actions.getOrCreateConnectedAccount({
      connectionName,
      identifier,
    });
    const account = response.connectedAccount;
    item.account = summarizeAccount(account);
    console.log('✅ Connected account exists/created:', item.account);

    const status = statusLabel(account?.status).toUpperCase();
    if (status !== 'ACTIVE') {
      const linkResponse = await scalekit.actions.getAuthorizationLink({
        connectionName,
        identifier,
      });
      item.authorizationLink = linkResponse.link;
      console.log('🔗 Needs authorization. Open this link:');
      console.log(linkResponse.link);
    } else {
      console.log('✅ Already ACTIVE.');
    }

    try {
      const scoped = await scalekit.tools.listScopedTools(identifier, {
        filter: { connectionNames: [connectionName] },
        pageSize: 100,
      });
      const scopedTools = scoped.tools || [];
      item.scopedToolCount = scopedTools.length;
      item.scopedTools = scopedTools.slice(0, 20).map((t) => {
        const def = t.tool?.definition || t.definition || t;
        return def.name || t.name;
      }).filter(Boolean);
      console.log(`🧰 Scoped tools visible: ${item.scopedToolCount}`);
      for (const name of item.scopedTools.slice(0, 10)) console.log(`   - ${name}`);
    } catch (err) {
      item.scopedToolsError = `${err?.constructor?.name || 'Error'}: ${err?.message || err}`;
      console.log(`⚠️ Could not list scoped tools: ${item.scopedToolsError}`);
    }
  } catch (err) {
    item.error = `${err?.constructor?.name || 'Error'}: ${err?.message || err}`;
    console.log(`❌ Connection test failed: ${item.error}`);
    console.log('   Likely cause: this connection has not been created in Scalekit Dashboard, or the connection name differs.');
  }

  results.push(item);
}

console.log('\n3) Existing connected accounts for this identifier...');
try {
  const listed = await scalekit.actions.listConnectedAccounts({ identifier });
  const accounts = listed.connectedAccounts || [];
  console.log(`Found ${accounts.length} account(s):`);
  for (const a of accounts) console.log(' -', summarizeAccount(a));
} catch (err) {
  console.log(`⚠️ Could not list connected accounts: ${err?.constructor?.name || 'Error'}: ${err?.message || err}`);
}

console.log('\nSummary JSON:');
console.log(JSON.stringify(results, null, 2));

const failures = results.filter((r) => r.error).length;
if (failures) {
  console.log(`\n⚠️ ${failures} connection(s) failed. Create them in Scalekit Dashboard → AgentKit → Connections, or set exact *_CONNECTION_NAME env vars.`);
  process.exitCode = 2;
} else {
  console.log('\n✅ Scalekit SDK + requested connection names are reachable. Authorize links above if accounts are not ACTIVE.');
}
