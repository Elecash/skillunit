/**
 * JUnit XML, for CI systems that show test results from it. One suite per layer: lint has one
 * case per file, proof one per unit (and one per finding about no unit), and test one suite per
 * spec with one case per test. Borderline verdicts carry a `borderline` property.
 */
import { join } from 'node:path';
import type { Problem } from '../lint/types.js';
import { decidingNumber, distribution, shown } from './text.js';
import type { CheckReport, ReportOptions } from './types.js';

interface Case {
  name: string;
  classname: string;
  failure?: string;
  error?: string;
  out?: string;
  properties?: Record<string, string>;
}

interface Suite {
  name: string;
  cases: Case[];
}

export function junit(report: CheckReport, options: ReportOptions): string {
  const suites: Suite[] = [];
  const line = (skill: string, p: Problem) => `${shown(join(skill, p.file), options)}:${p.line}  ${p.unit ?? '-'}  ${p.message}`;

  if (report.lint) {
    const { lint } = report;
    const files = [...new Set([...lint.files, ...lint.problems.map((p) => p.file)])];
    suites.push({
      name: 'lint',
      cases: files.map((file) => {
        const mine = lint.problems.filter((p) => p.file === file);
        const errors = mine.filter((p) => p.severity === 'error');
        const warnings = mine.filter((p) => p.severity === 'warning');
        const c: Case = { name: shown(join(lint.skill, file), options), classname: 'lint' };
        if (errors.length) c.failure = errors.map((p) => line(lint.skill, p)).join('\n');
        if (warnings.length) c.out = warnings.map((p) => `warning: ${line(lint.skill, p)}`).join('\n');
        return c;
      }),
    });
  }

  if (report.proof?.configured) {
    const { proof } = report;
    const cases: Case[] = proof.units.map((u) => {
      const c: Case = { name: u.id, classname: `proof.${shown(join(proof.skill, u.file), options)}`, properties: { state: u.state } };
      const mine = proof.problems.filter((p) => p.unit === u.id);
      const errors = mine.filter((p) => p.severity === 'error');
      const warnings = mine.filter((p) => p.severity === 'warning');
      if (errors.length) c.failure = errors.map((p) => line(proof.skill, p)).join('\n');
      if (warnings.length) c.out = warnings.map((p) => `warning: ${line(proof.skill, p)}`).join('\n');
      return c;
    });
    // Findings about no unit: a report, a test file, an example file, the settings.
    for (const p of proof.problems.filter((p) => !p.unit)) {
      const c: Case = { name: `${shown(join(proof.skill, p.file), options)}:${p.line}`, classname: 'proof' };
      if (p.severity === 'error') c.failure = line(proof.skill, p);
      else c.out = `warning: ${line(proof.skill, p)}`;
      cases.push(c);
    }
    suites.push({ name: 'proof', cases });
  }

  if (report.test) {
    for (const spec of report.test.specs) {
      const name = shown(spec.spec, options);
      const cases: Case[] = spec.verdicts.map((v) => {
        const c: Case = { name: v.id, classname: name };
        const got = `expected ${v.expect}, got ${v.answer} (${decidingNumber(v, report)}): ${distribution(v, ', ')}`;
        if (!v.pass) c.failure = `${got}\nscenario: ${v.scenario}\nquestion: ${v.question}`;
        if (v.borderline) {
          c.properties = { borderline: 'true' };
          if (v.pass) c.out = `borderline: ${got}`;
        }
        return c;
      });
      if (spec.error) cases.push({ name: '(spec)', classname: name, error: spec.error });
      suites.push({ name: `test ${name}`, cases });
    }
  }

  const count = (cases: Case[], key: 'failure' | 'error') => cases.filter((c) => c[key] !== undefined).length;
  const all = suites.flatMap((s) => s.cases);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="SkillUnit" tests="${all.length}" failures="${count(all, 'failure')}" errors="${count(all, 'error')}">`,
  ];
  for (const suite of suites) {
    xml.push(
      `  <testsuite name="${esc(suite.name)}" tests="${suite.cases.length}" failures="${count(suite.cases, 'failure')}" errors="${count(suite.cases, 'error')}">`,
    );
    for (const c of suite.cases) {
      const body: string[] = [];
      if (c.properties) {
        body.push('      <properties>');
        for (const [k, v] of Object.entries(c.properties)) body.push(`        <property name="${esc(k)}" value="${esc(v)}"/>`);
        body.push('      </properties>');
      }
      if (c.failure !== undefined) body.push(`      <failure message="${esc(c.failure.split('\n')[0]!)}">${esc(c.failure)}</failure>`);
      if (c.error !== undefined) body.push(`      <error message="${esc(c.error.split('\n')[0]!)}">${esc(c.error)}</error>`);
      if (c.out !== undefined) body.push(`      <system-out>${esc(c.out)}</system-out>`);
      const open = `    <testcase name="${esc(c.name)}" classname="${esc(c.classname)}"`;
      xml.push(...(body.length ? [`${open}>`, ...body, '    </testcase>'] : [`${open}/>`]));
    }
    xml.push('  </testsuite>');
  }
  xml.push('</testsuites>', '');
  return xml.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
