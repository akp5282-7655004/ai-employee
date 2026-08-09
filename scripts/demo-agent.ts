import { Agent, newSession, type Session } from '../src/agent/index.js';
import { MockConnector } from '../src/connectors/index.js';

/**
 * Offline demo of the full agent loop — the packs, planner, and connector driven
 * by plain-English messages. No API keys: the mock interpreter parses the text
 * and the mock connector runs the actions. Pre-connecting only Google (Ads +
 * Business Profile) shows the realistic split: some channels launch, LSA needs a
 * connect link.
 */
async function main() {
  const connector = new MockConnector({ 'rapid-response-plumbing': ['google_ads', 'google_my_business'] });
  const agent = new Agent({ connector });
  let session: Session = newSession('rapid-response-plumbing');

  const conversation = [
    'hey there',
    'I run a plumbing shop in Chicago, we do 24/7 emergency service, $3k a month, I want more calls',
    'approve',
  ];

  for (const message of conversation) {
    console.log(`\n\x1b[1muser →\x1b[0m ${message}`);
    const res = await agent.handle(session, message);
    session = res.session;
    console.log(`\x1b[36memployee →\x1b[0m ${res.reply.text}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
