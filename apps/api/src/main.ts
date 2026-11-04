import { config as loadEnv } from 'dotenv';
import { createServerRuntime } from './app';
import { loadConfig } from './config';
import { resolveWorkspacePath } from './utils/workspace-path';

async function bootstrap() {
  loadEnv({ path: [resolveWorkspacePath('.env'), '.env'] });
  const runtime = createServerRuntime(loadConfig());
  await runtime.start();
  const shutdown = () => {
    void runtime.stop().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
