#!/usr/bin/env node
/** Pin spec coverage and prove rejection using virtual faults; never mutate a developer's files. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const key = (file) => {
  const absolute = resolve(file);
  return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase();
};
function specsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.name.startsWith('.') ||
      ['node_modules', 'dist', 'test-results', 'playwright-report'].includes(entry.name)
    )
      return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? specsIn(path) : entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

function scriptsIn(manifest) {
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).scripts;
  } catch (cause) {
    throw new Error(`Cannot read package scripts: ${manifest}`, { cause });
  }
}

let projectCount = 0;
let specCount = 0;
let probeCount = 0;
for (const parent of ['packages', 'apps']) {
  for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, parent, entry.name);
    const manifest = join(directory, 'package.json');
    if (!existsSync(manifest)) continue;
    const specs = specsIn(directory).sort();
    if (specs.length === 0) continue;
    const scripts = scriptsIn(manifest);
    assert.equal(typeof scripts?.typecheck, 'string', `${entry.name}: missing typecheck script`);
    const covered = new Set();
    for (const command of scripts.typecheck.split('&&')) {
      // Reject swallowed errors or opaque wrappers; every listed compiler must be a real gate.
      const match = command.trim().match(/^tsc -p (\S+)( --noEmit)?$/);
      assert.ok(match, `${entry.name}: unsupported typecheck command: ${command}`);
      const configPath = join(directory, match[1]);
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      assert.equal(config.error, undefined, `Cannot read ${configPath}`);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        directory,
        undefined,
        configPath,
      );
      assert.equal(
        parsed.errors.length,
        0,
        `${configPath}: ${parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n')}`,
      );
      assert.ok(match[2] || parsed.options.noEmit, `${configPath}: test checking must never emit`);
      const names = new Set(parsed.fileNames.map(key));
      const included = specs.filter((file) => names.has(key(file)));
      for (const file of included) covered.add(key(file));
      if (included.length === 0) continue;

      // One representative per consumed config: desktop main and renderer are separate environments.
      const target = parsed.fileNames.find((file) => key(file) === key(included[0]));
      assert.ok(target);
      const original = readFileSync(target, 'utf8');
      const options = { ...parsed.options, noEmit: true };
      const host = ts.createCompilerHost(options);
      const read = host.readFile.bind(host);
      host.readFile = (file) =>
        key(file) === key(target)
          ? `${original}\nconst __focusloopSpecTypecheckProbe: number = 'not a number';\n`
          : read(file);
      const program = ts.createProgram(parsed.fileNames, options, host);
      const source = program.getSourceFile(target);
      assert.ok(source, `${basename(configPath)} did not load ${target}`);
      const diagnostics = program.getSemanticDiagnostics(source);
      assert.ok(
        diagnostics.some(
          (diagnostic) => diagnostic.code === 2322 && diagnostic.start >= original.length,
        ),
        `${entry.name}/${basename(configPath)} swallowed the injected spec type error`,
      );
      probeCount += 1;
    }
    const missing = specs.filter((file) => !covered.has(key(file)));
    assert.equal(
      missing.length,
      0,
      `${entry.name}: specs omitted from typecheck:\n${missing.join('\n')}`,
    );
    projectCount += 1;
    specCount += specs.length;
  }
}
assert.ok(projectCount > 0 && probeCount > 0, 'No spec typechecking was exercised');
process.stdout.write(
  `Spec typecheck invariants: ${specCount} specs across ${projectCount} projects; ${probeCount} injected faults rejected (no files modified or emitted).\n`,
);
