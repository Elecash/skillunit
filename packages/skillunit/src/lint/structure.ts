/**
 * Lint item 1, structure: what the parser could not read, required and allowed labels, label
 * order, one label per paragraph, ids, and where units and `## Rules` sit in a file.
 */
import { BODY_LABELS, codeSpans, FOOTER_LABELS, type LabelName, type ParsedFile, type ParsedSkill, type Unit, type UnitKind } from '../units/index.js';
import type { Problem } from './types.js';

/** One order for every kind: the body labels, then the footer. */
const ORDER: readonly LabelName[] = [...BODY_LABELS, ...FOOTER_LABELS];

/** Body labels each kind takes. Every kind takes the whole footer. */
const ALLOWED: Record<UnitKind, readonly LabelName[]> = {
  rule: ['When', 'Do', 'Even when', 'Right'],
  decision: ['When', 'Decide', 'Even when'],
  fact: ['When', 'Value', 'Unknown'],
};

const REQUIRED: Record<UnitKind, readonly LabelName[]> = {
  rule: ['When', 'Do', 'Applies'],
  decision: ['When', 'Decide', 'Applies'],
  fact: ['When', 'Value', 'Applies'],
};

/** Labels whose text may be empty: their content is a list or code on the next lines. */
const MAY_BE_EMPTY: readonly LabelName[] = ['Decide', 'Right'];

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNIT_HEADING = /^(rule|decision|fact):/;
/** A label name inside another label's text: what a formatter that joins lines leaves behind. */
const INNER_LABEL = new RegExp(`(?:^|\\s)(${ORDER.join('|')}):(?=\\s|$)`);

export function structure(skill: ParsedSkill): Problem[] {
  const out: Problem[] = skill.errors.map((e) => ({ ...e, severity: 'error' as const, rule: 'parse' as const }));
  const seen = new Map<string, Unit>();
  for (const file of skill.files) {
    out.push(...rulesSection(file));
    for (const fence of file.fences) {
      const kind = fence.owner.kind;
      if (fence.lang || !(kind === 'right' || kind === 'decide')) continue;
      out.push({
        file: file.file,
        line: fence.line,
        unit: fence.owner.unit,
        severity: 'error',
        rule: 'structure',
        message: 'this example has no language after its opening fence (`ts`, `sh`…), so nothing checks it',
      });
    }
    for (const unit of file.units) {
      out.push(...checkUnit(unit));
      const first = seen.get(unit.id);
      if (first) {
        out.push(problem(unit, unit.line, `the id \`${unit.id}\` is already used at ${first.file}:${first.line}; ids are unique across the skill`));
      } else {
        seen.set(unit.id, unit);
      }
    }
  }
  return out;
}

function problem(unit: Unit, line: number, message: string, severity: Problem['severity'] = 'error'): Problem {
  return { file: unit.file, line, unit: unit.id, severity, rule: 'structure', message };
}

function checkUnit(u: Unit): Problem[] {
  const out: Problem[] = [];
  if (!KEBAB.test(u.id)) out.push(problem(u, u.line, `\`${u.id}\` is not kebab-case: use lowercase words joined by hyphens`));
  if (u.section !== 'Rules') {
    out.push(problem(u, u.line, `units go under \`## Rules\`; this one is under ${u.section ? `\`## ${u.section}\`` : 'no `##` heading'}`));
  }

  let last: LabelName | null = null;
  for (const label of u.labels) {
    const footer = (FOOTER_LABELS as readonly string[]).includes(label.name);
    if (!footer && !ALLOWED[u.kind].includes(label.name)) {
      out.push(problem(u, label.line, `a ${u.kind} does not take \`${label.name}\`; its labels are ${ALLOWED[u.kind].map((l) => `\`${l}\``).join(', ')} and the footer`));
    }
    if (last && ORDER.indexOf(label.name) < ORDER.indexOf(last)) {
      out.push(problem(u, label.line, `\`${label.name}\` goes before \`${last}\`; the order is ${ORDER.join(', ')}`));
    } else {
      last = label.name;
    }
    if (label.joined) {
      out.push(problem(u, label.line, `put \`${label.name}:\` in a paragraph of its own, with a blank line before it`, 'warning'));
    }
    if (!label.value && !MAY_BE_EMPTY.includes(label.name)) out.push(problem(u, label.line, `\`${label.name}\` is empty`));
    out.push(...sharedLine(u, label.line, label.name, label.value));
  }

  const names = new Set(u.labels.map((l) => l.name));
  for (const required of REQUIRED[u.kind]) {
    if (!names.has(required)) out.push(problem(u, u.line, `a ${u.kind} needs \`${required}\``));
  }
  const decide = u.labels.find((l) => l.name === 'Decide');
  if (decide && u.decide.length === 0 && u.skipped === 0) out.push(problem(u, decide.line, '`Decide` needs at least one `- **path** — condition` item'));
  const right = u.labels.find((l) => l.name === 'Right');
  if (right && u.right.length === 0) out.push(problem(u, right.line, '`Right` has no example: add a fenced block or inline code'));
  return out;
}

/** Reports a label name inside another label's text, outside code spans. */
function sharedLine(u: Unit, line: number, name: string, value: string): Problem[] {
  let text = value;
  for (const span of codeSpans(value)) text = text.replace(span.raw, ' ');
  const inner = INNER_LABEL.exec(text);
  if (!inner) return [];
  return [problem(u, line, `\`${name}:\` and \`${inner[1]}:\` share a line; put each label in a paragraph of its own`)];
}

/** `## Rules` is the last `##` section of the file, appears once, and holds only units. */
function rulesSection(file: ParsedFile): Problem[] {
  const out: Problem[] = [];
  const at = (line: number, message: string): Problem => ({ file: file.file, line, severity: 'error', rule: 'structure', message });
  const rules = file.headings.filter((h) => h.level === 2 && h.text === 'Rules');
  if (rules.length === 0) return out;
  for (const extra of rules.slice(1)) out.push(at(extra.line, 'a second `## Rules`; a file has one, holding all its units'));
  const start = rules[0]!;

  for (const h of file.headings) {
    if (h.line <= start.line) continue;
    if (h.level <= 2 && !(h.level === 2 && h.text === 'Rules')) {
      out.push(at(h.line, `\`## Rules\` is the last section of the file; move \`${'#'.repeat(h.level)} ${h.text}\` above it`));
    } else if (h.level > 2 && !(h.level === 3 && UNIT_HEADING.test(h.text))) {
      out.push(at(h.line, `\`## Rules\` holds only units; \`${'#'.repeat(h.level)} ${h.text}\` is not one`));
    }
  }

  // Text between `## Rules` and its first unit belongs to no unit. Setup blocks there are
  // reported by the Setup rule.
  const lines = file.text.split(/\r?\n/);
  const firstUnit = file.units.find((u) => u.line > start.line)?.line ?? lines.length + 1;
  const setupLines = new Set<number>();
  for (const f of file.fences) {
    if (f.owner.kind !== 'setup') continue;
    for (let l = f.line; l <= f.endLine; l++) setupLines.add(l);
  }
  const fenceAt = new Map(file.fences.map((f) => [f.line, f]));
  for (let line = start.line + 1; line < firstUnit; line++) {
    const fence = fenceAt.get(line);
    if (setupLines.has(line) || /^Setup:\s*$/.test(lines[line - 1]!)) continue;
    if (fence || lines[line - 1]!.trim()) {
      out.push(at(line, '`## Rules` holds only units; move this text above `## Rules` or into a unit'));
      break;
    }
  }
  return out;
}
