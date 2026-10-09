import { describe, expect, it } from 'vitest';
import { redactToolArgs, TOOL_ARGS_KEEP_CHARS } from './tool';

describe('tool-call argument redaction (AG8.8)', () => {
  it('keeps what answers "what was attempted": short ids, numbers, booleans', () => {
    const args = { taskId: 'rbt-t1', conceptId: 'c-bst', minutes: 3, confirmed: true };
    expect(redactToolArgs(args)).toEqual(args);
  });

  it('does not keep prose — the audit answers what was attempted, not what was said', () => {
    const note = 'Dear diary, today the learner wrote something only they should read. '.repeat(3);
    const redacted = redactToolArgs({ note, taskId: 'rbt-t1' });

    expect(JSON.stringify(redacted)).not.toContain('Dear diary');
    expect(JSON.stringify(redacted)).toContain('rbt-t1');
    expect(String(redacted['note'])).toMatch(/^\[redacted \d+ chars\]$/);
  });

  it('walks nested objects and arrays, keeping every key', () => {
    const long = 'y'.repeat(TOOL_ARGS_KEEP_CHARS + 1);
    const redacted = redactToolArgs({
      rewrite: { taskId: 't1', steps: ['short', long] },
      list: [{ keep: 'ok', prose: long }],
    });

    expect(redacted).toEqual({
      rewrite: { taskId: 't1', steps: ['short', `[redacted ${long.length} chars]`] },
      list: [{ keep: 'ok', prose: `[redacted ${long.length} chars]` }],
    });
  });

  it('stops at a bound depth instead of walking forever', () => {
    let nested: Record<string, unknown> = { leaf: 'z'.repeat(100) };
    for (let index = 0; index < 12; index += 1) nested = { child: nested };

    const redacted = redactToolArgs(nested);
    expect(JSON.stringify(redacted).length).toBeLessThan(500);
    expect(JSON.stringify(redacted)).toContain('redacted');
  });

  it('is total: a circular payload becomes no args rather than an exception', () => {
    const circular: Record<string, unknown> = { taskId: 't1' };
    circular['self'] = circular;
    expect(redactToolArgs(circular)).toEqual({ taskId: 't1', self: '[redacted]' });
  });
});
