/**
 * JUnit XML, for CI systems that show test results from it. One suite per layer: proof has one
 * case per unit (and one per finding about no unit), and test one suite per request with one
 * case per test. Borderline verdicts carry a `borderline` property.
 */
import { join } from 'node:path';
import type { Problem } from '../problems.js';
import { buildChange, gotLine, shown, unitOrigin, withOrigin } from './text.js';
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
  const line = (skill: string, p: Problem) => `${shown(join(skill, p.file), options)}:${p.line}  ${p.unit ?? '-'}  ${withOrigin(skill, p, options)}`;

  if (report.proof?.configured) {
    const { proof } = report;
    const cases: Case[] = proof.units.map((u) => {
      const from = `${shown(join(proof.skill, u.test.file), options)}:${u.test.line}`;
      const c: Case = { name: u.id, classname: `proof.${shown(join(proof.skill, u.file), options)}`, properties: { from: u.from, state: u.state, origin: from } };
      const mine = proof.problems.filter((p) => p.unit === u.id);
      const errors = mine.filter((p) => p.severity === 'error');
      const warnings = mine.filter((p) => p.severity === 'warning');
      if (errors.length) c.failure = errors.map((p) => line(proof.skill, p)).join('\n');
      if (warnings.length) c.out = warnings.map((p) => `warning: ${line(proof.skill, p)}`).join('\n');
      return c;
    });
    // Findings about no unit: a file of the skill, a record, the settings.
    for (const p of proof.problems.filter((p) => !p.unit)) {
      const c: Case = { name: `${shown(join(proof.skill, p.file), options)}:${p.line}`, classname: 'proof' };
      if (p.severity === 'error') c.failure = line(proof.skill, p);
      else c.out = `warning: ${line(proof.skill, p)}`;
      cases.push(c);
    }
    const change = buildChange(proof, options);
    if (change) cases.push({ name: shown(proof.skill, options), classname: 'proof', out: change });
    suites.push({ name: 'proof', cases });
  }

  if (report.test) {
    const { test } = report;
    const declared = (d: { file: string; line: number } | undefined) => (d ? `${shown(d.file, options)}:${d.line}` : 'test');
    if (test.problems.length) {
      const cases: Case[] = test.problems.map((p) => ({ name: p.id ?? '(questions)', classname: declared(p.declared), error: p.message }));
      suites.push({ name: 'test questions', cases });
    }
    for (const r of test.requests) {
      const name = shown(join(test.skill, r.file), options);
      const cases: Case[] = r.verdicts.map((v) => {
        const c: Case = { name: v.id, classname: declared(v.declared) };
        const got = gotLine(v, report);
        const origin = unitOrigin(report, v.unit, options);
        if (!v.pass) c.failure = `${got}\nscenario: ${v.scenario}\nquestion: ${v.question}${origin ? `\n${origin}` : ''}`;
        if (v.borderline) {
          c.properties = { borderline: 'true' };
          if (v.pass) c.out = `borderline: ${got}`;
        }
        return c;
      });
      if (r.error) for (const q of r.questions ?? []) cases.push({ name: q.id, classname: declared(q.declared), error: r.error });
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
