import { describe, expect, it } from 'vitest';
import { Agent, MockInterpreter, newSession, type Session } from '../src/agent/index.js';
import { MockConnector } from '../src/connectors/index.js';

describe('MockInterpreter', () => {
  const interp = new MockInterpreter();
  const s = newSession('u');

  it('extracts vertical, category, budget, goal, emergency from one message', () => {
    const r = interp.interpret('I run a plumbing shop in Chicago, 24/7 emergency, $3k a month, want more calls', s);
    expect(r.intent).toBe('plan');
    expect(r.fields).toMatchObject({
      vertical: 'home_services',
      category: 'plumbing',
      monthlyBudget: 3000,
      goal: 'more_calls',
      emergency: true,
    });
    expect(r.fields.cities).toContain('Chicago');
  });

  it('routes dental keywords to the dental pack', () => {
    expect(interp.interpret('cosmetic dentist, veneers and whitening', s).fields).toMatchObject({
      vertical: 'dental',
      category: 'cosmetic',
    });
  });

  it('detects approve and connect intents', () => {
    expect(interp.interpret('approve', s).intent).toBe('approve');
    expect(interp.interpret('yes go ahead', s).intent).toBe('approve');
    expect(interp.interpret('connect my google ads', s)).toMatchObject({ intent: 'connect', connectApp: 'google_ads' });
  });
});

describe('Agent loop', () => {
  function fresh() {
    const connector = new MockConnector({ shop: ['google_ads', 'google_my_business'] });
    return { agent: new Agent({ connector }), session: newSession('shop') as Session };
  }

  it('asks for the missing budget, then plans once it has enough', async () => {
    const { agent } = fresh();
    let s = newSession('shop') as Session;

    let res = await agent.handle(s, 'I run a plumbing business');
    s = res.session;
    expect(res.reply.text.toLowerCase()).toMatch(/budget/);
    expect(res.reply.plan).toBeUndefined();

    res = await agent.handle(s, '$3000 a month, more calls');
    s = res.session;
    expect(res.reply.plan).toBeDefined();
    expect(res.reply.actions!.length).toBeGreaterThan(0);
    expect(res.reply.text).toMatch(/approve/i);
    expect(s.pending).toBeDefined();
  });

  it('greets and coaches when it has nothing to go on', async () => {
    const { agent, session } = fresh();
    const res = await agent.handle(session, 'hey there');
    expect(res.reply.plan).toBeUndefined();
    expect(res.reply.text.toLowerCase()).toMatch(/marketing employee|tell me/);
  });

  it('on approve, runs connected channels and returns a connect link for the rest', async () => {
    const { agent } = fresh();
    let s = newSession('shop') as Session;
    s = (await agent.handle(s, 'plumbing, Chicago, 24/7 emergency, $3k/month, more calls')).session;
    expect(s.pending).toBeDefined();

    const res = await agent.handle(s, 'approve');
    // Google Ads + Business Profile are connected → launched; LSA is not → needs connect.
    expect(res.reply.text).toMatch(/Launched:/);
    expect(res.reply.text).toMatch(/google_lsa/);
    expect(res.reply.connectUrl).toBeDefined();
    expect(res.session.pending).toBeUndefined(); // cleared after approval
  });

  it('has nothing to approve before a plan exists', async () => {
    const { agent, session } = fresh();
    const res = await agent.handle(session, 'approve');
    expect(res.reply.text.toLowerCase()).toMatch(/nothing waiting/);
  });
});
