import { homeServicesPack } from './homeServices.js';
import { dentalPack } from './dental.js';
import { roofingPack } from './roofing.js';
import { solarPack } from './solar.js';
import type { CommandPack } from './types.js';

export * from './types.js';
export * from './apply.js';

/**
 * The pack registry — the roster of verticals. Adding a vertical is adding a data
 * file here; nothing in the engine changes (docs/VISION.md §3). Home services is
 * the default.
 */
export const PACKS: Record<string, CommandPack> = {
  [homeServicesPack.id]: homeServicesPack,
  [dentalPack.id]: dentalPack,
  [roofingPack.id]: roofingPack,
  [solarPack.id]: solarPack,
};

export const DEFAULT_PACK_ID = homeServicesPack.id;

/** Resolve a pack by id, falling back to the default for unknown/missing ids. */
export function getPack(id?: string): CommandPack {
  return (id ? PACKS[id] : undefined) ?? PACKS[DEFAULT_PACK_ID]!;
}

export function listPacks(): CommandPack[] {
  return Object.values(PACKS);
}
