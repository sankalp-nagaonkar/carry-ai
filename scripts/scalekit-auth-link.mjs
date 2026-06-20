import 'dotenv/config';
import { ScalekitClient } from '@scalekit-sdk/node';

const envUrl = process.env.SCALEKIT_ENV_URL || process.env.SCALEKIT_ENVIRONMENT_URL;
const clientId = process.env.SCALEKIT_CLIENT_ID;
const clientSecret = process.env.SCALEKIT_CLIENT_SECRET;
const identifier = process.env.DEMO_USER_ID || process.env.SCALEKIT_TEST_IDENTIFIER || 'demo_user';

const arg = process.argv[2] || 'notion';
const envMap = {
  gmail: 'GMAIL_CONNECTION_NAME',
  notion: 'NOTION_CONNECTION_NAME',
  slack: 'SLACK_CONNECTION_NAME',
  github: 'GITHUB_CONNECTION_NAME',
  googlecalendar: 'GOOGLE_CALENDAR_CONNECTION_NAME',
  googlesheets: 'GOOGLE_SHEETS_CONNECTION_NAME',
};
const connectionName = process.env[envMap[arg] || ''] || arg;

if (!envUrl || !clientId || !clientSecret) {
  console.error('Missing SCALEKIT credentials');
  process.exit(1);
}

const scalekit = new ScalekitClient(envUrl, clientId, clientSecret);

const response = await scalekit.actions.getOrCreateConnectedAccount({ connectionName, identifier });
console.log('Connected account:', {
  id: response.connectedAccount?.id,
  provider: response.connectedAccount?.provider,
  status: response.connectedAccount?.status,
});

const linkResponse = await scalekit.actions.getAuthorizationLink({ connectionName, identifier });
console.log('\nOpen this link to authorize/re-authorize:');
console.log(linkResponse.link);
