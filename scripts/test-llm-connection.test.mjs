import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./test-llm-connection.mjs', import.meta.url));
const frame = (choice) => `data: ${JSON.stringify({ choices: [choice] })}\n\n`;

async function probe(t, stream) {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    const input = JSON.parse(body);
    if (input.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(stream);
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  let stdout;
  let code = 0;
  try {
    ({ stdout } = await exec(process.execPath, [script, '--model', 'synthetic'], {
      env: {
        ...process.env,
        OPENAI_COMPATA_API_KEY: 'synthetic-secret-do-not-echo',
        OPENAI_COMPATA_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
    }));
  } catch (error) {
    stdout = error.stdout;
    code = error.code;
  }
  assert.equal(typeof stdout, 'string');
  assert.ok(!stdout.includes('synthetic-secret-do-not-echo'));
  assert.ok(!stdout.includes('127.0.0.1'));
  return {
    code,
    results: stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  };
}

test('token-limited streaming is rejected with a safe phase and specific diagnostic', async (t) => {
  const { code, results } = await probe(
    t,
    frame({ delta: { content: 'partial' } }) +
      frame({ delta: {}, finish_reason: 'length' }) +
      'data: [DONE]\n\n',
  );
  assert.equal(code, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].phase, 'streaming');
  assert.equal(results[1].reason, 'bad-response');
  assert.equal(results[1].diagnostic, 'stream-token-limit');
});

test('missing DONE remains a failed stream and is distinguished from the token limit', async (t) => {
  const { code, results } = await probe(t, frame({ delta: { content: 'partial' } }));
  assert.equal(code, 1);
  assert.equal(results[1].diagnostic, 'stream-missing-done');
});

test('malformed SSE is diagnosed without printing its payload', async (t) => {
  const { code, results } = await probe(t, 'data: private-body-do-not-echo\n\n');
  assert.equal(code, 1);
  assert.equal(results[1].diagnostic, 'stream-invalid-json');
  assert.ok(!JSON.stringify(results).includes('private-body-do-not-echo'));
});

test('a normal stream still completes successfully', async (t) => {
  const { code, results } = await probe(
    t,
    frame({ delta: { content: 'OK' } }) +
      frame({ delta: {}, finish_reason: 'stop' }) +
      'data: [DONE]\n\n',
  );
  assert.equal(code, 0);
  assert.equal(results[1].streaming, true);
  assert.equal(results[1].characters, 2);
});
