import { describe, expect, it } from 'vitest';
import { Agent, MockInterpreter, newSession, type Session } from '../src/agent/index.js';
import { MockConnector } from '../src/connectors/index.js';

describe('action interpretation (mock)', () => {
  const interp = new MockInterpreter();
  const s = newSession('u');

  it('reads "add a contact to GoHighLevel" with the email and name', () => {
    const r = interp.interpret('in my go high level account can you add a new contact miles@gmail.com name - Miles Employee', s);
    expect(r.intent).toBe('action');
    expect(r.action).toMatchObject({ app: 'gohighlevel', op: 'create_contact' });
    expect(r.action!.params.email).toBe('miles@gmail.com');
    expect(r.action!.params.name).toBe('Miles Employee');
    expect(r.action!.params.firstName).toBe('Miles');
    expect(r.action!.params.lastName).toBe('Employee');
  });

  it('detects a send-text task with a phone number', () => {
    const r = interp.interpret('text this lead at +1 415-555-0199 saying "we can come today"', s);
    expect(r.intent).toBe('action');
    expect(r.action!.op).toBe('send_sms');
    expect(r.action!.params.phone).toContain('415');
    expect(r.action!.params.message).toBe('we can come today');
  });

  it('detects an add-tag task', () => {
    const r = interp.interpret('tag them VIP in hubspot', s);
    expect(r.intent).toBe('action');
    expect(r.action).toMatchObject({ app: 'hubspot', op: 'add_tag' });
  });

  it('does NOT mistake a marketing-plan message for an action', () => {
    const r = interp.interpret('I run an HVAC company in Phoenix, $3k/month, I want more calls', s);
    expect(r.intent).toBe('plan');
    expect(r.action).toBeUndefined();
  });
});

describe('agent runs the task through the connector', () => {
  it('runs the task when the app is connected', async () => {
    const connector = new MockConnector({ shop: ['gohighlevel'] });
    const agent = new Agent({ connector });
    const { reply } = await agent.handle(newSession('shop') as Session, 'add a contact jane@acme.com name Jane Doe in gohighlevel');
    expect(reply.task).toBeDefined();
    expect(reply.task!.ok).toBe(true);
    expect(reply.text).toContain('✅');
    expect(reply.text.toLowerCase()).toContain('jane');
  });

  it('asks the owner to connect the app when it is not connected, with a link', async () => {
    const connector = new MockConnector(); // nothing connected
    const agent = new Agent({ connector });
    const { reply } = await agent.handle(newSession('shop') as Session, 'add a contact jane@acme.com in gohighlevel');
    expect(reply.task!.ok).toBe(false);
    expect(reply.text.toLowerCase()).toContain('connect');
    expect(reply.connectUrl).toBeTruthy();
  });

  it('builds an email campaign instead of dead-ending when the app has no such action', async () => {
    const connector = new MockConnector({ shop: ['gohighlevel'] });
    // Stub textGen so the test is deterministic (no network).
    const textGen = async () => 'Email 1 — Subject: We miss you\nBody: Come back for 15% off.';
    const agent = new Agent({ connector, textGen });
    const { reply } = await agent.handle(newSession('shop') as Session, 'build an email marketing campaign and put it into my go high level account');
    expect(reply.task!.ok).toBe(true);
    expect(reply.text).toContain('Email 1 — Subject');
    expect(reply.text).toContain('GoHighLevel'); // honest delivery note
  });

  it('still dead-ends gracefully (no textGen) rather than crashing', async () => {
    const connector = new MockConnector({ shop: ['gohighlevel'] });
    const agent = new Agent({ connector }); // no textGen
    const { reply } = await agent.handle(newSession('shop') as Session, 'build an email marketing campaign in gohighlevel');
    expect(reply.task).toBeDefined();
  });
});
