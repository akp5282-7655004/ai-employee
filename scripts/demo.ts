import { parseIntake } from '../src/intake.js';
import { planCampaign } from '../src/plan/planner.js';
import { checkClaims, getPack } from '../src/packs/index.js';
import type { CampaignPlan } from '../src/plan/types.js';

/**
 * Offline demo — no API keys. Two businesses in two different verticals go
 * through the same engine and come out with vertical-appropriate plans, proving
 * the chassis + packs idea end-to-end (docs/VISION.md §3).
 */

const CHANNEL_NAME: Record<string, string> = { lsa: 'LSA', search: 'Search', social: 'Social', managed_profile: 'Profile' };
const money = (n: number): string => '$' + n.toLocaleString('en-US');

function printPlan(plan: CampaignPlan): void {
  console.log(
    `\n═══ CAMPAIGN PLAN — ${plan.businessName}  (${plan.vertical} · ${plan.category} · ${money(plan.monthlyBudget)}/mo · ${plan.band}) ═══\n`,
  );
  console.log(plan.summary + '\n');

  for (const a of plan.allocations) {
    const spend = a.monthlyBudget > 0 ? `${money(a.monthlyBudget)}/mo (${Math.round(a.share * 100)}%)` : 'managed · $0';
    console.log(`  ${a.label.padEnd(26)} ${spend}`);
    console.log(`      → ${a.rationale}`);
  }

  console.log(`\n  Suggested offers (pick one — you can't type a weak offer):`);
  for (const o of plan.suggestedOffers) console.log(`      • ${o.headline}`);

  console.log(`\n  ─── Ad drafts (claims-checked) ───`);
  for (const d of plan.drafts) {
    const flag = d.claims.ok ? 'OK ' : 'HOLD';
    console.log(`  [${flag}] ${CHANNEL_NAME[d.channel]} · ${d.service}: "${d.headline} — ${d.body} ${d.cta}"`);
  }
}

// ── 1. Home services: emergency plumbing, wants more calls ──
const plumbing = parseIntake({
  businessName: 'Rapid Response Plumbing',
  vertical: 'home_services',
  category: 'plumbing',
  services: ['drain cleaning', 'water heater', 'sewer line', 'faucet repair'],
  serviceArea: { cities: ['Chicago', 'Naperville'], radiusMiles: 30 },
  monthlyBudget: 3000,
  goal: 'more_calls',
  emergency: true,
  licensing: { licenseNumber: 'IL-PL-055-123456', licensedStates: ['IL'], yearsInBusiness: 14, insured: true },
  wantMoreOf: ['sewer line', 'water heater'],
  wantLessOf: ['faucet repair'],
});

// ── 2. Dental: cosmetic practice, higher-ticket goal ──
const dental = parseIntake({
  businessName: 'Bright Smiles Dental',
  vertical: 'dental',
  category: 'cosmetic',
  services: ['veneers', 'whitening', 'implants', 'invisalign'],
  serviceArea: { cities: ['Austin'] },
  monthlyBudget: 6000,
  goal: 'higher_ticket',
  emergency: false,
  licensing: { yearsInBusiness: 9, insured: true },
  wantMoreOf: ['veneers', 'implants'],
});

printPlan(planCampaign(plumbing));
printPlan(planCampaign(dental));

// ── The honesty guardrail, shown directly ──
console.log(`\n═══ THE HONESTY GUARDRAIL ═══\n`);
const bad = 'Pain-free dentistry, guaranteed results — the #1 dentist in Austin';
const verdict = checkClaims(getPack('dental'), bad);
console.log(`  Draft: "${bad}"`);
console.log(`  Allowed to publish? ${verdict.ok ? 'yes' : 'NO'}`);
for (const v of verdict.violations) console.log(`    ✗ ${v}`);
console.log();
