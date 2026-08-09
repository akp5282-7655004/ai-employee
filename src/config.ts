/**
 * Runtime config from the environment. Everything defaults to offline/mock, so
 * the product runs with zero setup; add Pipedream credentials to switch the
 * connector live (docs/VISION.md §3). See `.env.example`.
 */
export interface Config {
  connector: 'mock' | 'pipedream';
  pipedream: {
    environment: 'development' | 'production';
    projectId?: string;
    clientId?: string;
    clientSecret?: string;
  };
}

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

export function loadConfig(): Config {
  const driver = env('CONNECTOR') === 'pipedream' ? 'pipedream' : 'mock';
  return {
    connector: driver,
    pipedream: {
      environment: env('PIPEDREAM_ENVIRONMENT') === 'production' ? 'production' : 'development',
      projectId: env('PIPEDREAM_PROJECT_ID'),
      clientId: env('PIPEDREAM_CLIENT_ID'),
      clientSecret: env('PIPEDREAM_CLIENT_SECRET'),
    },
  };
}

/** True only when the Pipedream connector is selected AND fully credentialed. */
export function pipedreamReady(cfg: Config): boolean {
  const p = cfg.pipedream;
  return cfg.connector === 'pipedream' && !!p.projectId && !!p.clientId && !!p.clientSecret;
}
