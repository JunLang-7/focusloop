/**
 * Opt-in live adapter smoke test; excluded from the offline test suite and CI.
 * Credentials can come from the environment (CI/cloud) or an explicitly named env file.
 * Example: node scripts/test-llm-connection.mjs --env-file .env --provider compatible --model <model-id>
 *
 * A failing run prints the numeric HTTP status when there was one: `quota-exceeded` with a 402
 * says the account needs topping up, and a `bad-response` without a status says the provider's reply
 * broke the published contract. The two used to be the same line of output.
 */
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';

/** Emit only the sanitized, machine-readable CLI result, one JSON object per line. */
function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'compatible' },
    model: { type: 'string' },
    'env-file': { type: 'string' },
    'list-only': { type: 'boolean', default: false },
  },
});
if (!['deepseek', 'compatible'].includes(values.provider))
  throw new Error('Choose --provider deepseek or compatible');
if (values['env-file']) loadEnvFile(resolve(values['env-file']));
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'focusloop-live-llm-'));
try {
  const bundle = join(directory, 'adapter.mjs');
  await build({
    entryPoints: [join(root, 'packages/llm-provider/src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    tsconfig: join(root, 'apps/desktop/tsconfig.main.json'),
    logLevel: 'silent',
  });
  const { OpenAICompatibleProvider, fetchModelList } = await import(pathToFileURL(bundle).href);
  const deepseek = values.provider === 'deepseek';
  const apiKey = deepseek
    ? (process.env.FOCUSLOOP_DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY)
    : process.env.OPENAI_COMPATA_API_KEY;
  const baseUrl = deepseek
    ? (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1')
    : process.env.OPENAI_COMPATA_BASE_URL;
  const model =
    values.model ??
    (deepseek ? (process.env.DEEPSEEK_MODEL ?? 'deepseek-chat') : process.env.OPENAI_COMPATA_MODEL);
  if (!apiKey || !baseUrl || (!model && !values['list-only'])) {
    writeResult({
      provider: values.provider,
      ok: false,
      reason:
        'Configure credentials and base URL in the environment, and supply --model or a model environment variable',
    });
    process.exitCode = 1;
  } else {
    try {
      if (values['list-only']) {
        const models = await fetchModelList({ providerId: values.provider, apiKey, baseUrl });
        writeResult({
          provider: values.provider,
          discovery: true,
          modelCount: models.length,
          ...(model ? { requestedModelAvailable: models.some((item) => item.id === model) } : {}),
        });
      } else {
        const provider = new OpenAICompatibleProvider({
          providerId: values.provider,
          apiKey,
          baseUrl,
          model,
          timeoutMs: 30_000,
        });
        const result = await provider.complete({ prompt: 'Reply with OK.', maxTokens: 64 });
        writeResult({
          provider: values.provider,
          model,
          ok: true,
          latencyMs: result.latencyMs,
          usage: result.usage,
        });
        let characters = 0;
        let completed = false;
        for await (const event of provider.stream({ prompt: 'Reply with OK.', maxTokens: 64 })) {
          if (event.type === 'text') characters += event.text.length;
          else completed = true;
        }
        writeResult({
          provider: values.provider,
          model,
          streaming: completed && characters > 0,
          characters,
        });
        if (!completed || characters === 0) process.exitCode = 1;
      }
    } catch (error) {
      // No raw HTTP bodies, exception text, URLs or credentials leave this script. The status is a
      // number, not a payload, and it is what tells an empty account (402) apart from a provider
      // whose reply broke the contract — a distinction the reason alone does not always carry.
      const status = error?.status;
      const failure = {
        provider: values.provider,
        model,
        ok: false,
        reason: error?.reason ?? 'bad-response',
        ...(typeof status === 'number' ? { status } : {}),
      };
      writeResult(failure);
      process.exitCode = 1;
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
