import { describe, expect, it } from 'vitest';
import { lintSkill } from './lint.js';
import { proofMarks } from './proof.js';
import { structure } from './structure.js';
import { F, lineOf, skillOf } from './testing.js';
import type { Problem } from './types.js';

const show = (p: Problem) => `${p.file}:${p.line} ${p.unit ?? '-'} ${p.rule} ${p.severity}: ${p.message}`;
const marksOf = (files: Record<string, string>) => proofMarks(skillOf(files)).map(show);

const rule = (id: string, info: string, footer = '') => `### rule: ${id}

When: a request failed.

Do: test the error first.

Right:

${F}${info}
check(error);
${F}

Applies: errors
${footer}`;

const file = (...units: string[]) => `# T\n\n## Rules\n\n${units.join('\n')}`;

describe('proof marks', () => {
  it('accepts the unit id, the unit id and a name, and Proof: none on a unit with no flag', () => {
    const decision = `### decision: pick

When: a choice.

Decide:

- **one** — first.

  ${F}ts proof=pick.one
  a();
  ${F}

- **two** — second.

  ${F}ts proof=pick.second-way
  b();
  ${F}

Applies: picks
`;
    expect(marksOf({ 'a.md': file(rule('r', 'ts proof=r'), decision, rule('advice', 'ts', '\nProof: none, a recommendation\n')) })).toEqual([]);
  });

  it('reports a flag that names another unit, or a name that is not kebab-case', () => {
    const text = file(rule('r', 'ts proof=other'), rule('s', 'ts proof=s.Bad_Name'), rule('t', 'ts proof=tt'));
    expect(marksOf({ 'a.md': text })).toEqual([
      `a.md:${lineOf(text, 'proof=other')} r proof error: \`proof=other\` does not name this block's unit; a fence of \`r\` takes \`proof=r\`, or \`proof=r.<name>\` with a kebab-case name`,
      `a.md:${lineOf(text, 'proof=s.')} s proof error: \`proof=s.Bad_Name\` does not name this block's unit; a fence of \`s\` takes \`proof=s\`, or \`proof=s.<name>\` with a kebab-case name`,
      `a.md:${lineOf(text, 'proof=tt')} t proof error: \`proof=tt\` does not name this block's unit; a fence of \`t\` takes \`proof=t\`, or \`proof=t.<name>\` with a kebab-case name`,
    ]);
  });

  it('reports an empty flag, and two flags on one block', () => {
    const text = file(rule('r', 'ts proof='), rule('s', 'ts proof=s proof=s.b'));
    expect(marksOf({ 'a.md': text })).toEqual([
      `a.md:${lineOf(text, 'proof=')} r proof error: \`proof=\` needs an id: \`proof=r\`, or \`proof=r.<name>\` when the unit has several proved examples`,
      `a.md:${lineOf(text, 'proof=s')} s proof error: this block has two \`proof=\` flags; one block is one example, produced by one test`,
    ]);
  });

  it('reports the same id on two blocks, in one file or two', () => {
    const two = `### rule: r

When: a.

Do: b.

Right:

- first:

  ${F}ts proof=r.x
  a();
  ${F}

- second:

  ${F}ts proof=r.x
  b();
  ${F}

Applies: a
`;
    const text = file(two);
    const second = lineOf(text, 'proof=r.x', lineOf(text, 'proof=r.x'));
    expect(marksOf({ 'a.md': text })).toEqual([
      `a.md:${second} r proof error: \`proof=r.x\` is also on the block at a.md:${lineOf(text, 'proof=r.x')}; each proved example has an id of its own`,
    ]);
    // Two units with one id are a structure error; the flag of the second is reported too.
    const other = marksOf({ 'a.md': file(rule('r', 'ts proof=r')), 'b.md': file(rule('r', 'ts proof=r')) });
    expect(other).toEqual([`b.md:13 r proof error: \`proof=r\` is also on the block at a.md:13; each proved example has an id of its own`]);
  });

  it('reports a flag on a block that belongs to no unit', () => {
    expect(marksOf({ 'SKILL.md': `# T\n\n${F}ts proof=r\na();\n${F}\n` })).toEqual([
      'SKILL.md:3 - proof error: `proof=r` is on a block that belongs to no unit; a test proves the example of a unit, so the flag goes on a fence inside one',
    ]);
  });

  it('reports Proof: none on a unit with a flagged block, and any Proof but none', () => {
    const text = file(rule('r', 'ts proof=r', '\nProof: none\n'), rule('s', 'ts', '\nProof: tested\n'));
    expect(marksOf({ 'a.md': text })).toEqual([
      `a.md:${lineOf(text, 'Proof: none')} r proof error: this unit says \`Proof: none\` but has a block with \`proof=\` (line ${lineOf(text, 'proof=r')}); keep one: the test that produces the block, or \`Proof: none\``,
      `a.md:${lineOf(text, 'Proof: tested')} s proof error: \`Proof\` takes only \`none\`, with an optional reason: \`Proof: none, a recommendation\`. A unit a test proves needs no \`Proof\` label: the test's \`[skill:<id>]\` tag says it`,
    ]);
  });

  it('places Proof in the footer for the structure rules, on every kind', () => {
    const fact = `### fact: f\n\nWhen: a.\n\nValue: 1.\n\nApplies: a\n\nSource: src/a.ts\n\nProof: none\n`;
    expect(structure(skillOf({ 'a.md': file(fact, rule('r', 'ts', '\nProof: none\n')) }))).toEqual([]);
    const early = `### fact: f\n\nWhen: a.\n\nProof: none\n\nValue: 1.\n\nApplies: a\n`;
    expect(structure(skillOf({ 'a.md': file(early) })).map((p) => p.message)).toEqual([
      '`Value` goes before `Proof`; the order is When, Do, Decide, Value, Unknown, Even when, Right, Wrong, Applies, Check, Source, Proof',
      '`Applies` goes before `Proof`; the order is When, Do, Decide, Value, Unknown, Even when, Right, Wrong, Applies, Check, Source, Proof',
    ]);
    expect(structure(skillOf({ 'a.md': file(rule('r', 'ts', '\nProof:\n')) })).map((p) => p.message)).toEqual(['`Proof` is empty']);
  });

  it('runs in lint, under the rule proof, which lint.off turns off', () => {
    const skill = skillOf({ 'a.md': file(rule('r', 'ts proof=x')) });
    const rules = (off: Problem['rule'][]) => lintSkill(skill, { off: ['index', ...off] as never }).problems.map((p) => p.rule);
    expect(rules([])).toEqual(['proof']);
    expect(rules(['proof'])).toEqual([]);
  });
});
