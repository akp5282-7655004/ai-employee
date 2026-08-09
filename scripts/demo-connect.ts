import { getConnector, MockConnector } from '../src/connectors/index.js';
import { loadConfig } from '../src/config.js';

/**
 * Offline demo of the connector seam — the "hands". Shows the connect flow, the
 * user's connected accounts, and running an action on their behalf. Runs on the
 * mock connector by default; set CONNECTOR=pipedream (+ credentials) to point the
 * same calls at live Pipedream Connect.
 */
async function main() {
  const cfg = loadConfig();
  console.log(`\nConnector in use: ${getConnector(cfg).name}\n`);

  // For the demo, use a mock we can pre-seed with connected accounts.
  const c = new MockConnector({ 'rapid-response-plumbing': ['google_ads', 'google_my_business'] });
  const user = 'rapid-response-plumbing';

  // 1. The connect flow — the link we'd send the owner to connect a new app.
  const token = await c.createConnectToken(user);
  console.log('1. Connect a new app — send the owner this link:');
  console.log(`   ${token.connectUrl}`);
  console.log(`   (token expires ${token.expiresAt})\n`);

  // 2. What they've already connected.
  const accounts = await c.listAccounts(user);
  console.log('2. Connected accounts:');
  for (const a of accounts) console.log(`   • ${a.app}${a.healthy ? '' : '  ⚠ needs reconnect'} (${a.id})`);
  console.log();

  // 3. The employee acting — launch a campaign on the connected Google Ads account.
  console.log('3. Run an action on their behalf:');
  const run = await c.runAction({
    externalUserId: user,
    actionId: 'google_ads-create-campaign',
    configuredProps: { name: 'Spring Drain Special', dailyBudget: 65 },
  });
  console.log(`   google_ads-create-campaign → ${run.ok ? 'OK' : 'BLOCKED'}`);
  console.log(`   ${run.note}`);
  console.log(`   output: ${JSON.stringify(run.output)}\n`);

  // 4. An action for an app they HAVEN'T connected — blocked with a clear reason.
  const blocked = await c.runAction({ externalUserId: user, actionId: 'facebook_pages-create-post' });
  console.log('4. Action for an unconnected app:');
  console.log(`   facebook_pages-create-post → ${blocked.ok ? 'OK' : 'BLOCKED'} — ${blocked.note}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
