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
  return pipedreamReady(cfg) ? new PipedreamConnector(cfg) : new MockConnector();
}
