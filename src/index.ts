import { buildServer } from './server.js';
import { makeStore } from './db/index.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

async function main() {
  const authStore = makeStore();
  await authStore.init();
  const app = buildServer({ authStore });
  await app.listen({ port, host });
  // eslint-disable-next-line no-console
  console.log(`Miles listening on http://${host}:${port} (store: ${authStore.name})`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
