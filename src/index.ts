import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const app = buildServer();
app
  .listen({ port, host })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`Miles listening on http://${host}:${port}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
