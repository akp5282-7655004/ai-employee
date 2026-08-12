import { loadConfig, pipedreamReady, type Config } from '../config.js';
import { MockConnector } from './mock.js';
import { PipedreamConnector } from './pipedream.js';
import type { Connector } from './types.js';

export * from './types.js';
export { MockConnector } from './mock.js';
export { PipedreamConnector } from './pipedream.js';

/**
 * Resolve the connector from config: the live Pipedream client when it's selected
 * and fully credentialed, otherwise the offline mock. The engine calls this and
 * never cares which came back (docs/VISION.md §3).
 */
export function getConnector(cfg: Config = loadConfig()): Connector {
  if (pipedreamReady(cfg)) return new PipedreamConnector(cfg);
  // Dev/demo only: MOCK_SEED_APPS='{"userId":["gohighlevel"]}' pre-connects apps on
  // the mock so connected-only flows (leads, publishing) can be exercised offline.
  let seed: Record<string, string[]> | undefined;
  if (process.env.MOCK_SEED_APPS) {
    try {
      seed = JSON.parse(process.env.MOCK_SEED_APPS) as Record<string, string[]>;
    } catch {
      /* ignore malformed seed */
    }
  }
  return new MockConnector(seed);
}
