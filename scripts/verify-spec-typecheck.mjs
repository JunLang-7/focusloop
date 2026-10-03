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
const IGNORED_DIRECTORIES = [
  'node_modules',
  'dist',
  'test-results',
  'playwright-report',
  'release',
  'coverage',
  'build',
  'out',
];

function specsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.includes(entry.name)) return [];
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
      // Deliberately fail-closed: rewriting a command (`tsc --noEmit -p x`, `--pretty false`, a
      // shared wrapper) has to update this parser instead of quietly leaving the project behind.
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

      // Fault EVERY spec this config compiles, not one representative: a file-level suppression
      // (`// @ts-nocheck`, `@ts-ignore` over the file) in a sibling would otherwise stay invisible.
      const options = { ...parsed.options, noEmit: true };
      const host = ts.createCompilerHost(options);
      const read = host.readFile.bind(host);
      const faults = new Map();
      for (const file of included) {
        const target = parsed.fileNames.find((name) => key(name) === key(file));
        assert.ok(target, `${basename(configPath)} did not load ${file}`);
        const original = readFileSync(target, 'utf8');
        faults.set(key(target), {
          target,
          originalLength: original.length,
          // A unique name per file keeps the probes from colliding in a non-module file.
          text: `${original}\nconst __focusloopSpecTypecheckProbe${faults.size}: number = 'not a number';\n`,
        });
      }
      host.readFile = (file) => faults.get(key(file))?.text ?? read(file);
      const program = ts.createProgram(parsed.fileNames, options, host);
      for (const fault of faults.values()) {
        const source = program.getSourceFile(fault.target);
        assert.ok(source, `${basename(configPath)} did not load ${fault.target}`);
        const diagnostics = program.getSemanticDiagnostics(source);
        assert.ok(
          diagnostics.some(
            (diagnostic) => diagnostic.code === 2322 && diagnostic.start >= fault.originalLength,
          ),
          `${entry.name}/${basename(configPath)} swallowed the injected spec type error in ${fault.target}`,
        );
        probeCount += 1;
      }
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
