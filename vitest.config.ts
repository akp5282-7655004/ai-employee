import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Two groups, run one after the other by `npm test`.
 *
 * A test file that imports playwright starts its own Chromium. Run alongside
 * everything else, a dozen browsers shared two CI cores, and steps that take a
 * second took a minute and timed out. So the browser files run one at a time,
 * after the rest. `vitest run` with no group still runs every file together.
 */
const browserFiles = readdirSync('test')
  .filter((name) => name.endsWith('.test.ts') && /from 'playwright'/.test(readFileSync(`test/${name}`, 'utf8')))
  .map((name) => `test/${name}`);

const group = process.env.TEST_GROUP;

export default defineConfig({
  test: group === 'browser'
    ? { include: browserFiles, fileParallelism: false }
    : group === 'unit'
      ? { include: ['test/**/*.test.ts'], exclude: browserFiles }
      : { include: ['test/**/*.test.ts'] },
});
