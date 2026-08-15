import { describe, expect, it } from 'vitest';
import { canonicalVerb, pickComponent } from '../src/connectors/pipedream.js';

describe('canonicalVerb', () => {
  it('maps every automation SMS verb to "send sms"', () => {
    for (const v of [
      'Send SMS to new lead',
      'Send missed-call text-back SMS',
      'Send review request SMS',
      'Send Google review link SMS',
      'Send service-recovery SMS',
      'Send no-show rebook SMS',
      'Send onboarding welcome SMS',
    ]) {
      expect(canonicalVerb(v)).toBe('send sms');
    }
  });
  it('maps task and email verbs, passes others through', () => {
    expect(canonicalVerb('Create task')).toBe('create task');
    expect(canonicalVerb('Send onboarding welcome email')).toBe('send email');
    expect(canonicalVerb('Create or update campaign')).toBe('Create or update campaign');
  });
});

describe('pickComponent picks the right GHL action', () => {
  const ghlActions = [
    { name: 'Create Contact', key: 'gohighlevel-create-contact' },
    { name: 'Send SMS', key: 'gohighlevel-send-sms' },
    { name: 'Send Email', key: 'gohighlevel-send-email' },
    { name: 'Create Contact Task', key: 'gohighlevel-create-task' },
    { name: 'Add Tag', key: 'gohighlevel-add-tag' },
  ];
  it('routes a text-back to Send SMS', () => {
    expect(pickComponent(ghlActions, canonicalVerb('Send missed-call text-back SMS')).key).toBe('gohighlevel-send-sms');
  });
  it('routes a recovery task to the task action', () => {
    expect(pickComponent(ghlActions, canonicalVerb('Create task')).key).toBe('gohighlevel-create-task');
  });
});
