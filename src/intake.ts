import { z } from 'zod';
import { getPack } from './packs/index.js';

/**
 * The intake — everything the planner needs to turn a business into a campaign
 * plan: which vertical door, which category, what to advertise, where, with what
 * money, and which claims are legitimate. Validated strictly; the category must
 * belong to the chosen vertical pack (docs/VISION.md §3, §5).
 */
export const IntakeSchema = z
  .object({
    businessName: z.string().min(1),
    /** Which command pack to run — the "door" the customer entered through. */
    vertical: z.string().default('home_services'),
    /** Category within the vertical (a pack category id, e.g. 'plumbing', 'cosmetic'). */
    category: z.string().min(1),
    /** Services offered, as customer-facing names (also the ad targets). */
    services: z.array(z.string()).min(1),
    serviceArea: z
      .object({
        cities: z.array(z.string()).default([]),
        radiusMiles: z.number().min(1).max(150).optional(),
      })
      .default({ cities: [] }),
    /** Total monthly ad budget in whole dollars. */
    monthlyBudget: z.number().min(0),
    goal: z.enum(['more_calls', 'higher_ticket', 'fill_schedule', 'awareness']).default('more_calls'),
    /** Whether the business runs true emergencies (24/7) — boosts high-intent channels. */
    emergency: z.boolean().default(false),
    /** Facts that legitimize claims — "licensed"/"insured" may only be said if true. */
    licensing: z
      .object({
        licenseNumber: z.string().optional(),
        licensedStates: z.array(z.string()).default([]),
        yearsInBusiness: z.number().optional(),
        insured: z.boolean().default(false),
      })
      .default({ licensedStates: [], insured: false }),
    /** Services the owner wants MORE of — the planner over-indexes on these. */
    wantMoreOf: z.array(z.string()).default([]),
    /** Services to de-emphasize (low margin, at capacity, disliked). */
    wantLessOf: z.array(z.string()).default([]),
  })
  .superRefine((val, ctx) => {
    const pack = getPack(val.vertical);
    if (!pack.categories.some((c) => c.id === val.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category'],
        message: `Unknown category "${val.category}" for vertical "${pack.id}". Options: ${pack.categories
          .map((c) => c.id)
          .join(', ')}`,
      });
    }
  });

export type Intake = z.infer<typeof IntakeSchema>;

export function parseIntake(input: unknown): Intake {
  return IntakeSchema.parse(input);
}
