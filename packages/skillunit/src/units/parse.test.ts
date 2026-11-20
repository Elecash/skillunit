import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';
import { codeSpans, parseCheck, parseFile, parseSkill } from './parse.js';
import type { Fence, InlineCode } from './types.js';

const F = '```';

/** The example file of the style guide, one label per paragraph, with frontmatter. */
const RETRIES = `---
name: tinyfetch-retries
description: Retries in \`tinyfetch\`.
---

# tinyfetch — retries

tinyfetch can repeat a request that failed with a network error or a 5xx status.

Setup:

${F}ts
import { tf } from 'tinyfetch';
${F}

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| \`retry\` | number | 0 | extra attempts after the first one |

## Rules

### rule: retry-idempotent-only

When: a request may be retried, which happens when the caller passes \`retry\` or sets it on a client created with \`tf.create\`.

Do: enable \`retry\` only for GET, HEAD, PUT and DELETE.

Right:

${F}ts
tf.get('/users', { retry: 3 });
${F}

Wrong:

- Doing: \`tf.post('/users', { name: 'Ada' }, { retry: 3 });\`

  Because: a retried POST can create the same resource twice.

- Doing: retrying a POST by hand in an interceptor that catches the error and calls \`tf.post\` again with the same body.

  Because: same duplicate, and the retry is invisible in the call.

Applies: retries, post

Check: forbid \`/post\\([^)]*retry/\` in ts

Check: forbid \`/retry:\\s*_?\\d+/\` in js

Source: src/retry.ts
`;

/** A decision and a fact, one label per paragraph. */
const CLIENTS = `# tinyfetch — clients

## Rules

### decision: pick-a-client

When: the code makes more than one request to the same API.

Decide: which way to call.

- **shared** — the requests share a base URL or headers: create one client with \`tf.create\`.

  ${F}ts
  const api = tf.create({ baseUrl: 'https://api.example.com' });
  ${F}

- **direct** — one request, or requests to unrelated hosts: call \`tf.get\` directly.

Even when: the second request is added later.

Wrong:

- Doing: a new client per request.

  Because: settings drift apart between calls.

Applies: clients

Source: src/create.ts#create

### fact: default-timeout

When: the user asks how long a request waits by default.

Value: 10 seconds (\`timeout: 10_000\`).

Unknown: say that tinyfetch has no per-host timeout; do not invent one.

Applies: timeouts

Source: src/timeout.ts
`;

/** The same kind of content with labels on consecutive lines, the older way to write a unit. */
const COMPACT = `## Rules

### rule: retry-idempotent-only
When: a request may be retried.
Do: enable \`retry\` only for GET, HEAD, PUT and DELETE.
Right:
${F}ts
tf.get('/users', { retry: 3 });
${F}
Wrong:
- Doing: \`tf.post('/users', { name: 'Ada' }, { retry: 3 });\`
  Because: a retried POST can create the same resource twice.

Even when: the request looks safe to repeat.
Applies: retries, post
Check: forbid \`/post\\([^)]*retry/\` in ts
Source: src/retry.ts

### decision: pick-a-client
When: the code makes more than one request.
Decide:
- **shared** — the requests share a base URL: create one client with \`tf.create\`.
- **direct** — one request: call \`tf.get\` directly.

Even when: the second request is added later.
Applies: clients
`;

const parse = (text: string, file = 'features/retries.md') => parseFile(text, file);
const messages = (text: string) => parse(text).errors.map((e) => `${e.line}: ${e.message}`);
/** 1-based line of the first line of `text` that contains `needle`. */
const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

describe('rule', () => {
  const file = parse(RETRIES);
  const unit = file.units[0]!;

  it('parses the style guide example with no errors', () => {
    expect(file.errors).toEqual([]);
    expect(file.units).toHaveLength(1);
  });

  it('reads id, kind, place and body fields, with wrapped text joined', () => {
    expect(unit).toMatchObject({
      id: 'retry-idempotent-only',
      kind: 'rule',
      file: 'features/retries.md',
      line: lineOf(RETRIES, '### rule'),
      endLine: lineOf(RETRIES, 'Source:'),
      section: 'Rules',
      when: 'a request may be retried, which happens when the caller passes `retry` or sets it on a client created with `tf.create`.',
      do: 'enable `retry` only for GET, HEAD, PUT and DELETE.',
    });
    expect(unit.text.split('\n')[0]).toBe('### rule: retry-idempotent-only');
    expect(unit.text.split('\n').at(-1)).toBe('Source: src/retry.ts');
  });

  it('reads Right as a fence and each Wrong item as doing and because', () => {
    expect(unit.right).toHaveLength(1);
    expect(unit.right[0]).toMatchObject({ type: 'fence', lang: 'ts', code: "tf.get('/users', { retry: 3 });" });
    expect(unit.wrong).toEqual([
      expect.objectContaining({
        line: lineOf(RETRIES, '- Doing: `tf.post'),
        doing: "`tf.post('/users', { name: 'Ada' }, { retry: 3 });`",
        because: 'a retried POST can create the same resource twice.',
        becauseLine: lineOf(RETRIES, 'Because: a retried'),
        becauseJoined: false,
      }),
      expect.objectContaining({
        doing: 'retrying a POST by hand in an interceptor that catches the error and calls `tf.post` again with the same body.',
        because: 'same duplicate, and the retry is invisible in the call.',
        code: null,
      }),
    ]);
  });

  it('marks a Doing that is one code span as Wrong code', () => {
    expect(unit.wrong[0]!.code).toMatchObject({
      line: lineOf(RETRIES, '- Doing: `tf.post'),
      column: 10,
      code: "tf.post('/users', { name: 'Ada' }, { retry: 3 });",
    });
    expect(file.wrongCode).toEqual([{ unit: 'retry-idempotent-only', item: 0, code: unit.wrong[0]!.code }]);
  });

  it('reads the footer, with the Check regex from its code span', () => {
    expect(unit.applies).toEqual(['retries', 'post']);
    expect(unit.source).toEqual([{ path: 'src/retry.ts' }]);
    expect(unit.check.map((c) => [c.regex.source, c.langs, c.line, c.column])).toEqual([
      ['post\\([^)]*retry', ['ts'], lineOf(RETRIES, 'Check: forbid `/post'), 15],
      ['retry:\\s*_?\\d+', ['js'], lineOf(RETRIES, 'Check: forbid `/retry'), 15],
    ]);
    expect(unit.check[0]!.regex.test(unit.wrong[0]!.code!.code)).toBe(true);
    expect(unit.check[0]!.regex.test("tf.get('/users', { retry: 3 });")).toBe(false);
  });

  it('does not collect the regex span of a Check as inline code', () => {
    expect(file.inlineCode.map((c) => c.code)).not.toContain('/post\\([^)]*retry/');
  });
});

describe('decision and fact', () => {
  const file = parse(CLIENTS);
  const [decision, fact] = file.units;

  it('reads the paths of Decide, their fences, Even when and the footer', () => {
    expect(file.errors).toEqual([]);
    expect(decision).toMatchObject({ kind: 'decision', decideText: 'which way to call.', evenWhen: 'the second request is added later.' });
    expect(decision!.decide).toEqual([
      expect.objectContaining({
        id: 'shared',
        line: lineOf(CLIENTS, '- **shared**'),
        condition: 'the requests share a base URL or headers: create one client with `tf.create`.',
        fences: [expect.objectContaining({ lang: 'ts', code: "const api = tf.create({ baseUrl: 'https://api.example.com' });" })],
      }),
      expect.objectContaining({ id: 'direct', fences: [] }),
    ]);
    expect(decision!.wrong[0]).toMatchObject({ doing: 'a new client per request.', because: 'settings drift apart between calls.' });
    expect(decision!.source).toEqual([{ path: 'src/create.ts', symbol: 'create' }]);
  });

  it('reads Value and Unknown', () => {
    expect(fact).toMatchObject({
      kind: 'fact',
      value: '10 seconds (`timeout: 10_000`).',
      unknown: 'say that tinyfetch has no per-host timeout; do not invent one.',
      applies: ['timeouts'],
    });
  });

  it('accepts an en dash or a hyphen between path and condition', () => {
    const f = parse('### decision: d\nWhen: x\nDecide:\n- **a** – first\n- **b** - second\n');
    expect(f.errors).toEqual([]);
    expect(f.units[0]!.decide.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('body and footer', () => {
  it('decides the part by the label name, whatever the blank lines', () => {
    const unit = parse(RETRIES).units[0]!;
    expect(unit.labels.map((l) => `${l.name}:${l.part}`)).toEqual([
      'When:body',
      'Do:body',
      'Right:body',
      'Wrong:body',
      'Applies:footer',
      'Check:footer',
      'Check:footer',
      'Source:footer',
    ]);
    const compact = parse('### rule: r\nWhen: x\nApplies: a\nDo: y\n').units[0]!;
    expect(compact.labels.map((l) => l.part)).toEqual(['body', 'footer', 'body']);
  });

  it('records whether a label shares a paragraph with the one before it', () => {
    expect(parse(RETRIES).units[0]!.labels.every((l) => !l.joined)).toBe(true);
    const unit = parse(COMPACT).units[0]!;
    expect(unit.labels.map((l) => `${l.name}:${l.joined}`)).toEqual([
      'When:false',
      'Do:true',
      'Right:true',
      'Wrong:false',
      'Even when:false',
      'Applies:true',
      'Check:true',
      'Source:true',
    ]);
    expect(unit.wrong[0]!.becauseJoined).toBe(true);
  });

  it('joins the wrapped lines of a label, indented or not', () => {
    const unit = parse('### rule: r\n\nWhen: a long\nsituation that\n  wraps.\n\nApplies: a,\nb\n').units[0]!;
    expect(unit.when).toBe('a long situation that wraps.');
    expect(unit.applies).toEqual(['a', 'b']);
  });

  it('ends a unit at the next heading of any level', () => {
    const file = parse('### rule: a\n\nWhen: x\n\nDo: y\n\nApplies: z\n\n#### Notes\n\nprose\n');
    expect(file.units[0]!.endLine).toBe(7);
    expect(file.errors).toEqual([]);
  });

  it('reads lists with backticks in Applies and several Source paths', () => {
    const unit = parse('### rule: r\nApplies: `get`, post\nSource: src/a.ts, src/b.ts#B\n').units[0]!;
    expect(unit.applies).toEqual(['get', 'post']);
    expect(unit.source).toEqual([{ path: 'src/a.ts' }, { path: 'src/b.ts', symbol: 'B' }]);
  });
});

describe('Prettier', () => {
  /** What lint and sync read from a file: everything but line numbers and the code in fences. */
  const shape = (text: string) => {
    const f = parse(text);
    return {
      errors: f.errors.map((e) => e.message),
      setup: Object.keys(f.setup),
      fences: f.fences.map((x) => [x.owner, x.lang, x.flags]),
      units: f.units.map((u) => ({
        id: u.id,
        kind: u.kind,
        section: u.section,
        labels: u.labels.map((l) => [l.name, l.value, l.part, l.joined]),
        wrong: u.wrong.map((w) => [w.doing, w.because, w.becauseJoined, w.code?.code ?? null, w.fences.length]),
        decide: u.decide.map((d) => [d.id, d.condition, d.fences.length]),
        right: u.right.map((r) => (r.type === 'fence' ? ['fence', r.lang] : ['inline', r.code])),
        applies: u.applies,
        check: u.check.map((c) => [c.regex.source, c.regex.flags, c.langs]),
        source: u.source,
      })),
    };
  };

  for (const proseWrap of ['preserve', 'always', 'never'] as const) {
    it(`parses the same before and after Prettier with proseWrap: ${proseWrap}`, async () => {
      for (const text of [RETRIES, CLIENTS]) {
        const formatted = await format(text, { parser: 'markdown', proseWrap });
        expect(shape(text).errors).toEqual([]);
        expect(shape(formatted)).toEqual(shape(text));
      }
    });
  }

  it('changes the long lines when proseWrap is always, so the test above means something', async () => {
    const formatted = await format(RETRIES, { parser: 'markdown', proseWrap: 'always' });
    expect(formatted).not.toBe(RETRIES);
    expect(formatted.split('\n').every((l) => l.length <= 80 || l.includes('`'))).toBe(true);
  });

  it('parses labels on consecutive lines the same before and after Prettier defaults', async () => {
    const formatted = await format(COMPACT, { parser: 'markdown' });
    expect(formatted).not.toBe(COMPACT);
    expect(shape(COMPACT).errors).toEqual([]);
    expect(shape(formatted)).toEqual(shape(COMPACT));
  });
});

describe('fenced code inside a unit', () => {
  it('reads nothing inside a fence as a heading or a label', () => {
    const file = parse(`### rule: r\n\nWhen: x\n\nRight:\n\n${F}md\n### rule: not-a-unit\nDo: not a label\n## Not a heading\n${F}\n\nApplies: a\n`);
    expect(file.errors).toEqual([]);
    expect(file.units.map((u) => u.id)).toEqual(['r']);
    expect(file.headings.map((h) => h.text)).toEqual(['rule: r']);
    expect(file.units[0]!.labels.map((l) => l.name)).toEqual(['When', 'Right', 'Applies']);
    expect((file.units[0]!.right[0] as Fence).code).toContain('Do: not a label');
  });

  it('accepts tildes and longer fences, closed by a run at least as long', () => {
    const file = parse(`### rule: r\nRight:\n~~~~ts\nconst a = '~~~';\n~~~\n~~~~\n\nApplies: a\n`);
    expect(file.errors).toEqual([]);
    expect((file.units[0]!.right[0] as Fence).code).toBe("const a = '~~~';\n~~~");
  });

  it('removes the indentation of a fence inside a list item', () => {
    const file = parse(`### rule: r\nWrong:\n\n- Doing: a loop that retries.\n\n  Because: duplicates.\n\n  ${F}ts\n  for (;;) {\n    tf.post('/a');\n  }\n  ${F}\n\nApplies: a\n`);
    expect(file.errors).toEqual([]);
    const fence = file.units[0]!.wrong[0]!.fences[0]!;
    expect(fence.code).toBe("for (;;) {\n  tf.post('/a');\n}");
    expect(fence.owner).toEqual({ kind: 'wrong', unit: 'r', item: 0 });
  });
});

describe('Setup', () => {
  const text = `# tinyfetch — React\n\nSetup:\n${F}ts\nimport { tf } from 'tinyfetch';\n${F}\n\nSetup:\n\n${F}tsx\nimport { useFetch } from 'tinyfetch/react';\n${F}\n\nSome prose.\n\n${F}tsx\nconst a = useFetch('/a');\n${F}\n`;

  it('records one Setup block per language, owned by setup', () => {
    const file = parse(text);
    expect(file.errors).toEqual([]);
    expect(Object.keys(file.setup)).toEqual(['ts', 'tsx']);
    expect(file.setup.ts).toMatchObject({ line: 4, code: "import { tf } from 'tinyfetch';", owner: { kind: 'setup' } });
    expect(file.setup.tsx!.line).toBe(10);
    expect(file.fences.map((f) => f.owner.kind)).toEqual(['setup', 'setup', 'reference']);
  });

  it('keeps only the first Setup of a language in `setup`, and every one in `fences`', () => {
    const file = parse(`Setup:\n${F}ts\nimport { a } from 'a';\n${F}\n\nSetup:\n${F}ts\nimport { b } from 'b';\n${F}\n`);
    expect(file.setup.ts!.line).toBe(2);
    expect(file.fences.filter((f) => f.owner.kind === 'setup')).toHaveLength(2);
  });

  it('reports a Setup with no fence, with text on its line, or with no language', () => {
    expect(messages('Setup:\nimport { tf } from "tinyfetch";\n')).toEqual(['1: `Setup:` must be followed by a fenced block']);
    expect(messages('Setup:\n\n## Next\n')).toEqual(['1: `Setup:` must be followed by a fenced block']);
    expect(messages('Setup:')).toEqual(['1: `Setup:` must be followed by a fenced block']);
    expect(messages(`Setup: ts\n${F}ts\nx\n${F}\n`)).toEqual([
      '1: `Setup:` stands alone on its line, with the fenced block on the next lines',
    ]);
    expect(messages(`Setup:\n${F}\nx\n${F}\n`)).toEqual(['2: a `Setup` block needs a language after the opening fence']);
  });

  it('reports a Setup inside a unit', () => {
    expect(parse('### rule: r\n\nWhen: x\n\nSetup:\n').errors).toEqual([
      expect.objectContaining({ line: 5, unit: 'r', message: expect.stringContaining('prose part of the file') }),
    ]);
  });
});

describe('frontmatter', () => {
  it('skips a leading frontmatter block: no headings, labels or inline code from it', () => {
    const file = parse('---\nname: x\ndescription: Use `tinyfetch`.\n# not a heading\n---\n\n# Title\n\nUse `tf.get`.\n');
    expect(file.errors).toEqual([]);
    expect(file.headings).toEqual([{ line: 7, level: 1, text: 'Title' }]);
    expect(file.inlineCode.map((c) => c.code)).toEqual(['tf.get']);
  });

  it('reads a file whose first line is a rule, not frontmatter, as Markdown', () => {
    expect(parse('---\n\n# Title\n').headings).toEqual([{ line: 3, level: 1, text: 'Title' }]);
  });
});

describe('fence flags', () => {
  it('splits the info string into a lowercased language and flags', () => {
    const file = parse(`${F}TS no-check\nconst a: number = 'x';\n${F}\n\n${F}\nplain\n${F}\n\n${F}ts title="a.ts"\nx\n${F}\n`);
    expect(file.fences.map((f) => [f.lang, f.flags])).toEqual([
      ['ts', ['no-check']],
      ['', []],
      ['ts', ['title="a.ts"']],
    ]);
  });
});

describe('example owners', () => {
  const file = parse(`# tinyfetch — clients

${F}ts
const ref = 1;
${F}

## Rules

### rule: r

When: x

Do: y

Right:

* One request:

  ${F}ts
  tf.get('/a');
  ${F}

+ Several: \`tf.create({ baseUrl })\`

Wrong:

- Doing: \`tf.post('/a', {}, { retry: 1 })\`

  Because: duplicates.

  ${F}ts
  tf.post('/b', {}, { retry: 1 });
  ${F}

Applies: a

### decision: d

When: x

Decide:

- **shared** — several requests:

  ${F}ts
  const api = tf.create({});
  ${F}

- **direct** — one request.

Applies: a
`);

  it('assigns each fence to reference, right, wrong or decide', () => {
    expect(file.errors).toEqual([]);
    expect(file.fences.map((f) => f.owner)).toEqual([
      { kind: 'reference' },
      { kind: 'right', unit: 'r' },
      { kind: 'wrong', unit: 'r', item: 0 },
      { kind: 'decide', unit: 'd', path: 'shared' },
    ]);
  });

  it('collects Right list items, with any list marker, fences and inline code alike', () => {
    const right = file.units[0]!.right;
    expect(right.map((r) => r.type)).toEqual(['fence', 'inline']);
    expect((right[1] as InlineCode).code).toBe('tf.create({ baseUrl })');
  });

  it('marks inline code in Wrong items, so Check can skip it', () => {
    const wrong = file.inlineCode.filter((c) => c.owner.kind === 'unit' && c.owner.label === 'Wrong');
    expect(wrong.map((c) => c.code)).toEqual(["tf.post('/a', {}, { retry: 1 })"]);
    expect(wrong[0]!.owner).toEqual({ kind: 'unit', unit: 'r', label: 'Wrong', item: 0 });
  });

  it('reports a fence under a label that takes no code', () => {
    const f = parse(`### rule: r\n\nDo: y\n\n${F}ts\nx\n${F}\n`);
    expect(f.fences[0]!.owner).toEqual({ kind: 'misplaced', unit: 'r', label: 'Do' });
    expect(f.errors.map((e) => e.message)).toEqual(['fenced blocks go under `Right`, `Wrong` or `Decide`, not under `Do`']);
  });

  it('reports a fence under Wrong or Decide that is not inside an item', () => {
    expect(messages(`### rule: r\nWrong:\n${F}ts\nx\n${F}\n`)).toEqual([
      '3: a fenced block under `Wrong` goes inside a `- Doing:` item, indented',
    ]);
    expect(messages(`### decision: d\nDecide:\n- **a** — x\n\n${F}ts\nx\n${F}\n`)).toEqual([
      '5: a fenced block under `Decide` goes inside a `- **path** — condition` item, indented',
    ]);
  });
});

describe('Check', () => {
  it('accepts only a regex in a code span, and says to add the backticks', () => {
    expect(messages('### rule: r\nCheck: forbid /post.*retry/ in ts\n')).toEqual([
      '2: put the regex of a `Check` in backticks, as in ``forbid `/regex/` in ts``: outside a code span, Markdown reads `*` and `_` as emphasis and a formatter rewrites them',
    ]);
    expect(parseCheck('forbid `/a/i` in ts, TSX', 3)).toMatchObject({ mode: 'forbid', langs: ['ts', 'tsx'], line: 3 });
    expect(parseCheck('forbid ``/a`b/`` in ts', 1)).toMatchObject({ regex: /a`b/ });
  });

  it('reports require, the flags g and y, a bad regex and a bad layout', () => {
    expect(parseCheck('require `/a/` in ts', 1)).toBe('`require` is not supported; v1 of `Check` has only `forbid`');
    expect(parseCheck('forbid `/a/g` in ts', 1)).toMatch(/cannot use the flags `g` or `y`/);
    expect(parseCheck('forbid `/a/y` in ts', 1)).toMatch(/cannot use the flags `g` or `y`/);
    expect(parseCheck('forbid `/a(/` in ts', 1)).toMatch(/^`Check` has an invalid regex: /);
    expect(parseCheck('forbid `/a/` in ,', 1)).toBe('`Check` needs at least one language after `in`');
    for (const bad of ['forbid', 'forbid `/a/`', 'forbid `a` in ts', 'ban `/a/` in ts', 'forbid x `/a/` in ts']) {
      expect(parseCheck(bad, 1)).toBe('`Check` reads ``forbid `/regex/` in <languages>``');
    }
  });

  it('reports an error on the Check line, with the unit', () => {
    expect(parse('### rule: r\n\nCheck: forbid `/a/g` in ts\n').errors).toEqual([
      expect.objectContaining({ line: 3, unit: 'r', message: expect.stringContaining('`g` or `y`') }),
    ]);
  });
});

describe('labels and lists', () => {
  it('reports a label right under a list item, and still reads it as a label', () => {
    const file = parse('### decision: d\nDecide:\n- **a** — x\nEven when: y\n');
    expect(file.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([
      '4: leave a blank line between the list and `Even when:`; without it, Markdown reads the label as part of the last list item',
    ]);
    expect(file.units[0]!.evenWhen).toBe('y');
    expect(file.units[0]!.decide[0]!.condition).toBe('x');
  });

  it('reports a label indented into a list item, as a formatter leaves it, without joining it', () => {
    const file = parse('### decision: d\nDecide:\n- **a** — x\n  Even when: y\n  Wrong:\n- Doing: z\n');
    expect(file.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([
      '4: `Even when:` is indented into the list item above it; start it at the beginning of the line, after a blank line',
      '5: `Wrong:` is indented into the list item above it; start it at the beginning of the line, after a blank line',
    ]);
    expect(file.units[0]!.decide[0]!.condition).toBe('x');
    expect(file.units[0]!.wrong[0]!.doing).toBe('z');
  });

  it('reads an unindented Because right after Doing as the item’s Because', () => {
    const unit = parse('### rule: r\nWrong:\n- Doing: a\nBecause: b\n').units[0]!;
    expect(unit.wrong[0]).toMatchObject({ doing: 'a', because: 'b', becauseJoined: true });
  });

  it('joins a list item wrapped onto the next line', () => {
    const unit = parse('### rule: r\nWrong:\n- Doing: a long\n  mistake.\n\n  Because: it\nbreaks.\n').units[0]!;
    expect(unit.wrong[0]).toMatchObject({ doing: 'a long mistake.', because: 'it breaks.', code: null });
  });
});

describe('malformed input', () => {
  it('reports a fence that is never closed, and reads nothing after it as structure', () => {
    const file = parse(`### rule: r\nRight:\n${F}ts\nx\n\n### rule: hidden\n`);
    expect(file.errors.map((e) => `${e.line}: ${e.message}`)).toEqual(['3: this fenced block is never closed']);
    expect(file.units.map((u) => u.id)).toEqual(['r']);
  });

  it('reports a unit heading at the wrong level, or with an id that is not one word', () => {
    expect(messages('#### rule: r\nWhen: x\n')).toEqual(['1: a unit heading must be level 3 (`### rule: r`), not level 4']);
    expect(messages('### rule: retry only idempotent\n')).toEqual([
      '1: "retry only idempotent" is not a valid unit id: use letters, digits and hyphens, with no spaces',
    ]);
    expect(messages('### fact:\n')).toHaveLength(1);
  });

  it('does not treat a heading that only starts like a kind as a unit', () => {
    const file = parse('### rules of thumb\n### Rule: r\n');
    expect(file.units).toEqual([]);
    expect(file.errors).toEqual([]);
  });

  it('reports Wrong items that do not follow the format', () => {
    expect(messages('### rule: r\nWrong: a POST with retry\n')).toEqual([
      '2: `Wrong:` takes a list of `- Doing:` items on the next lines, not text on the same line',
    ]);
    expect(messages('### rule: r\nWrong:\n- a POST with retry\n\n  Because: it duplicates.\n')).toEqual([
      '3: an item under `Wrong` starts with `Doing:`',
    ]);
    expect(messages('### rule: r\nWrong:\n- Doing: a\n\n  Because: b\n\n  Because: c\n')).toEqual([
      '7: this `Wrong` item already has a `Because:` line',
    ]);
    expect(messages('### rule: r\nWrong:\n- Doing: a\n\n  Some more text.\n')).toEqual([
      '5: a `Wrong` item holds a `Doing:` paragraph, a `Because:` paragraph and fenced blocks, nothing else',
    ]);
  });

  it('reports lists nested beyond one level, and lists under labels that take none', () => {
    expect(messages('### rule: r\nWrong:\n- Doing: a\n  - Doing: b\n')).toEqual(['4: lists go one level deep']);
    expect(messages('### rule: r\nRight:\n  * `a`\n')).toEqual(['3: lists go one level deep']);
    expect(messages('### rule: r\nDo: y\n\n- and also z\n')).toEqual(['4: only `Right`, `Wrong` and `Decide` take a list, not `Do`']);
    expect(messages('### decision: d\nDecide:\n- shared: when x\n')).toEqual(['3: a path under `Decide` reads `- **path** — condition`']);
  });

  it('reports a paragraph that is not a label, and labels that repeat', () => {
    expect(messages('### rule: r\n\nDo: y\n\nThis also matters.\n')).toEqual([
      '5: this paragraph is not a label; a unit holds only labels (When, Do, Decide, Value, Unknown, Even when, Right, Wrong, Applies, Check, Source)',
    ]);
    expect(messages('### rule: r\nWhy: old label\n')[0]).toMatch(/^2: this paragraph is not a label/);
    expect(messages('### rule: r\n\n  indented\n')).toEqual(['3: indented text outside a list item']);
    expect(messages('### rule: r\nDo: a\n\nDo: b\n')).toEqual(['4: `Do` appears twice in this unit']);
  });

  it('carries file, line and unit on every error', () => {
    const file = parseFile('# t\n\n### rule: r\n\nWhen: x\n\nnot a label\n', 'a/b.md');
    expect(file.errors).toEqual([{ file: 'a/b.md', line: 7, unit: 'r', message: expect.any(String) }]);
  });

  it('reads Windows line endings', () => {
    const file = parse(RETRIES.replace(/\n/g, '\r\n'));
    expect(file.errors).toEqual([]);
    expect(file.units[0]!.wrong[0]!.code!.code).toBe("tf.post('/users', { name: 'Ada' }, { retry: 3 });");
  });
});

describe('codeSpans', () => {
  it('matches backtick runs of the same length', () => {
    expect(codeSpans('a `b` and ``c ` d`` and `unclosed').map((s) => s.code)).toEqual(['b', 'c ` d']);
    expect(codeSpans('`` `x` ``')[0]!.code).toBe('`x`');
    expect(codeSpans('x `a` y')[0]!.column).toBe(3);
  });
});

describe('parseSkill', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('parses every Markdown file and collects units and errors with their file', () => {
    dir = mkdtempSync(join(tmpdir(), 'skillunit-units-'));
    mkdirSync(join(dir, 'features'));
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'SKILL.md'), '# tinyfetch\n\n## Rules\n\n### fact: name\n\nWhen: x\n\nValue: tinyfetch\n\nApplies: all\n');
    const broken = `${RETRIES}\n### rule: broken\n\nnot a label\n`;
    writeFileSync(join(dir, 'features', 'retries.md'), broken);
    writeFileSync(join(dir, 'node_modules', 'x.md'), '### rule: ignored\n');

    const skill = parseSkill(dir);
    expect(skill.files.map((f) => f.file)).toEqual(['SKILL.md', 'features/retries.md']);
    expect(skill.units.map((u) => `${u.file}#${u.id}`)).toEqual([
      'SKILL.md#name',
      'features/retries.md#retry-idempotent-only',
      'features/retries.md#broken',
    ]);
    expect(skill.errors).toEqual([
      expect.objectContaining({ file: 'features/retries.md', unit: 'broken', line: lineOf(broken, 'not a label') }),
    ]);
  });
});

describe('skipped items', () => {
  it('skips a fence inside a malformed Wrong item, with one error for the item', () => {
    const file = parse(`### rule: r\n\nWrong:\n\n- a POST with retry\n\n  ${F}ts\n  tf.post('/a', {}, { retry: 1 });\n  ${F}\n\nApplies: a\n`);
    expect(file.errors.map((e) => `${e.line}: ${e.message}`)).toEqual(['5: an item under `Wrong` starts with `Doing:`']);
    expect(file.fences.map((f) => f.owner)).toEqual([{ kind: 'skipped', unit: 'r' }]);
    expect(file.units[0]).toMatchObject({ wrong: [], skipped: 1 });
    expect(file.inlineCode).toEqual([]);
  });

  it('skips a fence inside a malformed Decide path', () => {
    const file = parse(`### decision: d\n\nDecide:\n\n- shared: when x\n\n  ${F}ts\n  const a = 1;\n  ${F}\n\nApplies: a\n`);
    expect(file.errors.map((e) => e.line)).toEqual([5]);
    expect(file.fences.map((f) => f.owner.kind)).toEqual(['skipped']);
    expect(file.units[0]).toMatchObject({ decide: [], skipped: 1 });
  });
});

describe('language names', () => {
  it('reads typescript as ts and javascript as js', () => {
    const file = parse(`Setup:\n\n${F}TypeScript\nimport { tf } from 'tinyfetch';\n${F}\n\n${F}javascript no-check\nx\n${F}\n`);
    expect(file.fences.map((f) => [f.lang, f.flags])).toEqual([
      ['ts', []],
      ['js', ['no-check']],
    ]);
    expect(Object.keys(file.setup)).toEqual(['ts']);
  });
});
