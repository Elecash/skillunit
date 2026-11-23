import { describe, expect, it } from 'vitest';
import { checks } from './check.js';
import { setups } from './setup.js';
import { structure } from './structure.js';
import { F, lineOf, skillOf } from './testing.js';
import type { Problem } from './types.js';

/** `line unit severity: message`, the parts a test asserts on. */
const show = (p: Problem) => `${p.line} ${p.unit ?? '-'} ${p.severity}: ${p.message}`;
const structureOf = (text: string) => structure(skillOf({ 'a.md': text })).map(show);
const checksOf = (files: Record<string, string>) => {
  const skill = skillOf(files);
  return checks(skill)
    .map((p) => `${p.file}:${show(p)}`)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
};
const setupsOf = (text: string) => setups(skillOf({ 'a.md': text })).map(show);

const GOOD = `# tinyfetch — retries

Setup:

${F}ts
import { tf } from 'tinyfetch';
${F}

## Rules

### rule: retry-idempotent-only

When: a request may be retried.

Do: enable \`retry\` only for GET, HEAD, PUT and DELETE.

Even when: the request looks safe to repeat.

Right:

${F}ts
tf.get('/users', { retry: 3 });
${F}

Applies: retries

Check: forbid \`/post\\([^)]*retry/\` in ts

### decision: pick-a-client

When: the code makes more than one request.

Decide:

- **shared** — the requests share a base URL.

Even when: the second request comes later.

Applies: clients

### fact: default-timeout

When: the user asks for the default timeout.

Value: 10 seconds.

Unknown: there is no per-host timeout.

Applies: timeouts
`;

describe('structure', () => {
  it('passes a well-formed file of every kind', () => {
    expect(structureOf(GOOD)).toEqual([]);
  });

  it('reports what the parser could not read, as a parse problem', () => {
    const problems = structure(skillOf({ 'a.md': '## Rules\n\n### rule: r\n\nWhen: x\n\nnot a label\n' }));
    expect(problems.map((p) => [p.rule, p.line, p.unit])).toContainEqual(['parse', 7, 'r']);
  });

  it('reports missing required labels, per kind', () => {
    expect(structureOf('## Rules\n\n### rule: r\n\nWhen: x\n')).toEqual([
      '3 r error: a rule needs `Do`',
      '3 r error: a rule needs `Applies`',
    ]);
    expect(structureOf('## Rules\n\n### decision: d\n\nWhen: x\n\nApplies: a\n')).toEqual(['3 d error: a decision needs `Decide`']);
    expect(structureOf('## Rules\n\n### fact: f\n\nWhen: x\n\nApplies: a\n')).toEqual(['3 f error: a fact needs `Value`']);
  });

  it('reports a label the kind does not take, and allows Check on every kind', () => {
    expect(structureOf('## Rules\n\n### rule: r\n\nWhen: x\n\nDo: y\n\nValue: 3\n\nApplies: a\n')).toEqual([
      '9 r error: a rule does not take `Value`; its labels are `When`, `Do`, `Even when`, `Right` and the footer',
    ]);
    expect(structureOf('## Rules\n\n### fact: f\n\nWhen: x\n\nValue: 3\n\nApplies: a\n\nCheck: forbid `/x/` in ts\n')).toEqual([]);
  });

  it('reports labels out of order, footer before body included [skill:labels-in-order]', () => {
    expect(structureOf(`## Rules\n\n### rule: r\n\nWhen: x\n\nRight:\n\n${F}ts\na\n${F}\n\nDo: y\n\nApplies: a\n`)).toEqual([
      '13 r error: `Do` goes before `Right`; the order is When, Do, Decide, Value, Unknown, Even when, Right, Applies, Check, Proof',
    ]);
    expect(structureOf('## Rules\n\n### rule: r\n\nApplies: a\n\nWhen: x\n\nDo: y\n')[0]).toMatch(/^7 r error: `When` goes before `Applies`/);
  });

  it('warns about labels that share a paragraph, footer included [skill:one-label-per-paragraph]', () => {
    expect(structureOf('## Rules\n\n### rule: r\nWhen: x\nDo: y\n\nApplies: a\nCheck: forbid `/x/` in ts\n')).toEqual([
      '5 r warning: put `Do:` in a paragraph of its own, with a blank line before it',
      '8 r warning: put `Check:` in a paragraph of its own, with a blank line before it',
    ]);
  });

  it('reports two labels on one line, outside code spans', () => {
    expect(structureOf('## Rules\n\n### rule: r\n\nWhen: x Do: y\n\nApplies: a\n')).toEqual([
      '5 r error: `When:` and `Do:` share a line; put each label in a paragraph of its own',
      '3 r error: a rule needs `Do`',
    ]);
    expect(structureOf('## Rules\n\n### rule: r\n\nWhen: x\n\nDo: set `Value: 3`\n\nApplies: a\n')).toEqual([]);
  });

  it('reports empty labels, a Decide with no path and a Right with no example', () => {
    expect(structureOf('## Rules\n\n### rule: r\n\nWhen:\n\nDo: y\n\nRight:\n\nApplies: a\n')).toEqual([
      '5 r error: `When` is empty',
      '9 r error: `Right` has no example: add a fenced block or inline code',
    ]);
    expect(structureOf('## Rules\n\n### decision: d\n\nWhen: x\n\nDecide: which\n\nApplies: a\n')).toEqual([
      '7 d error: `Decide` needs at least one `- **path** — condition` item',
    ]);
  });

  it('reports ids that are not kebab-case, and ids used twice across files [skill:id-names-the-instruction]', () => {
    expect(structureOf('## Rules\n\n### rule: Retry_Once\n\nWhen: x\n\nDo: y\n\nApplies: a\n')).toEqual([
      '3 Retry_Once error: `Retry_Once` is not kebab-case: use lowercase words joined by hyphens',
    ]);
    const unit = '## Rules\n\n### fact: same\n\nWhen: x\n\nValue: y\n\nApplies: a\n';
    const problems = structure(skillOf({ 'a.md': unit, 'b.md': unit }));
    expect(problems.map((p) => `${p.file}:${show(p)}`)).toEqual([
      'b.md:3 same error: the id `same` is already used at a.md:3; ids are unique across the skill',
    ]);
  });

  it('reports units outside ## Rules', () => {
    expect(structureOf('## Usage\n\n### fact: f\n\nWhen: x\n\nValue: y\n\nApplies: a\n')).toEqual([
      '3 f error: units go under `## Rules`; this one is under `## Usage`',
    ]);
    expect(structureOf('### fact: f\n\nWhen: x\n\nValue: y\n\nApplies: a\n')).toEqual([
      '1 f error: units go under `## Rules`; this one is under no `##` heading',
    ]);
  });

  it('reports a ## Rules that is not last, a second one, and anything in it that is not a unit [skill:rules-section-last]', () => {
    const text = `# T\n\n## Rules\n\nSome text.\n\n### fact: f\n\nWhen: x\n\nValue: y\n\nApplies: a\n\n#### Notes\n\n## More\n\n## Rules\n`;
    expect(structureOf(text).sort()).toEqual([
      '15 - error: `## Rules` holds only units; `#### Notes` is not one',
      '17 - error: `## Rules` is the last section of the file; move `## More` above it',
      '19 - error: a second `## Rules`; a file has one, holding all its units',
      '5 - error: `## Rules` holds only units; move this text above `## Rules` or into a unit',
    ]);
  });
});

describe('Check', () => {
  const rule = (check = 'Check: forbid `/post\\([^)]*retry/` in ts') => `## Rules

### rule: retry-idempotent-only

When: a request may be retried.

Do: enable \`retry\` only for GET.

Right:

${F}ts
tf.get('/users', { retry: 3 });
${F}

Applies: retries

${check}
`;

  it('passes when no example breaks the rule, and skips the Check line', () => {
    expect(checksOf({ 'a.md': rule() })).toEqual([]);
  });

  it('reports a reference fence of a listed language at the line of the match', () => {
    const ref = `# Retries\n\nSetup:\n\n${F}ts\nimport { tf } from 'tinyfetch';\n${F}\n\n${F}ts\nconst a = 1;\ntf.post('/x', {}, { retry: 2 });\n${F}\n\n${F}js\ntf.post('/x', {}, { retry: 2 });\n${F}\n`;
    expect(checksOf({ 'a.md': rule(), 'b.md': ref })).toEqual([
      "b.md:11 - error: breaks `retry-idempotent-only`: `post('/x', {}, { retry` matches its `Check` (a.md:17)",
    ]);
  });

  it('reports a Right fence, a Setup and an inline span anywhere, with the unit they belong to', () => {
    const text = rule()
      .replace("tf.get('/users', { retry: 3 });", "tf.post('/users', { retry: 3 });")
      .replace('Do: enable `retry` only for GET.', 'Do: call `tf.post(url, { retry: 0 })` at most.');
    const setup = `# B\n\nSetup:\n\n${F}ts\nconst x = tf.post('/a', { retry: 1 });\n${F}\n\nProse with \`tf.post(u, { retry: 1 })\`.\n`;
    expect(checksOf({ 'a.md': text, 'b.md': setup })).toEqual([
      "a.md:7 retry-idempotent-only error: breaks `retry-idempotent-only`: `post(url, { retry` matches its `Check` (a.md:17)",
      "a.md:12 retry-idempotent-only error: breaks `retry-idempotent-only`: `post('/users', { retry` matches its `Check` (a.md:17)",
      "b.md:6 - error: breaks `retry-idempotent-only`: `post('/a', { retry` matches its `Check` (a.md:17)",
      "b.md:9 - error: breaks `retry-idempotent-only`: `post(u, { retry` matches its `Check` (a.md:17)",
    ]);
  });

  it('runs the regex on inline spans whatever languages it lists', () => {
    const text = rule('Check: forbid `/post\\([^)]*retry/` in py').replace('Do: enable `retry` only for GET.', 'Do: avoid `tf.post(u, { retry: 1 })`.');
    expect(checksOf({ 'a.md': text }).filter((p) => p.includes('breaks'))).toEqual([
      "a.md:7 retry-idempotent-only error: breaks `retry-idempotent-only`: `post(u, { retry` matches its `Check` (a.md:17)",
    ]);
  });
});

describe('Setup', () => {
  const unit = `## Rules\n\n### fact: f\n\nWhen: x\n\nValue: y\n\nApplies: a\n`;

  it('passes one Setup per language, above the examples that use it', () => {
    expect(setupsOf(`# T\n\nSetup:\n\n${F}ts\nimport { tf } from 'tinyfetch';\n${F}\n\n${F}tsx\nconst a = 1;\n${F}\n\n${unit}`)).toEqual([]);
  });

  it('reports a second Setup of the same language', () => {
    expect(setupsOf(`Setup:\n${F}ts\na\n${F}\n\nSetup:\n${F}ts\nb\n${F}\n`)).toEqual([
      '7 - error: a second `ts` Setup; a file has at most one per language',
    ]);
  });

  it('reports a Setup inside ## Rules', () => {
    expect(setupsOf(`## Rules\n\nSetup:\n\n${F}ts\na\n${F}\n`)).toEqual(['5 - error: `Setup` goes in the prose part of the file, above `## Rules`']);
  });

  it('reports a Setup after the first example that uses it, tsx falling back to ts', () => {
    expect(setupsOf(`# T\n\n${F}tsx\nconst a = 1;\n${F}\n\nSetup:\n\n${F}ts\nimport { tf } from 'tinyfetch';\n${F}\n`)).toEqual([
      '9 - error: this `ts` Setup comes after a `tsx` example at line 3; move it above the first example',
    ]);
    expect(setupsOf(`# T\n\n${F}py\nx = 1\n${F}\n\nSetup:\n\n${F}ts\nimport { tf } from 'tinyfetch';\n${F}\n`)).toEqual([]);
  });
});

describe('fixture lines', () => {
  it('match the fixtures', () => {
    expect(lineOf(GOOD, '### rule')).toBe(11);
  });
});

describe('broken items', () => {
  /** Every finding the rules that need no files on disk report. */
  const all = (text: string) => {
    const skill = skillOf({ 'a.md': text });
    return [...structure(skill), ...setups(skill), ...checks(skill)].map(show);
  };

  it('gives one finding for a malformed Decide path that holds a fence', () => {
    expect(all(`## Rules\n\n### decision: d\n\nWhen: x\n\nDecide:\n\n- shared: when x\n\n  ${F}ts\n  const a = 1;\n  ${F}\n\nApplies: a\n`)).toEqual([
      '9 d error: a path under `Decide` reads `- **path** — condition`',
    ]);
  });
});

describe('examples with no language', () => {
  it('reports a fence with no language under Right or Decide, and allows one in reference text [skill:language-on-every-example]', () => {
    const text = `# T\n\n${F}\noutput\n${F}\n\n## Rules\n\n### rule: r\n\nWhen: x\n\nDo: y\n\nRight:\n\n${F}\ntf.get('/a');\n${F}\n\nApplies: a\n\n### decision: d\n\nWhen: x\n\nDecide:\n\n- **a** — y\n\n  ${F}\n  tf.post('/a');\n  ${F}\n\nApplies: a\n`;
    expect(structureOf(text)).toEqual([
      '17 r error: this example has no language after its opening fence (`ts`, `sh`…), so nothing checks it',
      '31 d error: this example has no language after its opening fence (`ts`, `sh`…), so nothing checks it',
    ]);
  });
});
