import { afterAll, describe, expect, it } from 'vitest';
import { apiKey, App } from './app.js';
import { scenarios, type Expected } from './scenarios.js';

afterAll(() => App.removeAll());

/** What SkillUnit reported, in the form the scenarios list it. */
function observe(report: Record<string, any>): Required<Omit<Expected, 'mayFail' | 'oneFails'>> & { testErrors: string[] } {
  const problems: any[] = report.lint?.problems ?? [];
  const show = (p: any) => [p.rule, `skill/${p.file}`, p.unit ?? '-', /TS\d+/.exec(p.message)?.[0]].filter(Boolean).join(' ');
  const verdicts: any[] = (report.test?.requests ?? []).flatMap((r: any) => r.verdicts);
  return {
    lint: problems.filter((p) => p.severity === 'error').map(show).sort(),
    lintWarnings: problems.filter((p) => p.severity === 'warning').map(show).sort(),
    proof: (report.proof?.problems ?? []).filter((p: any) => p.severity === 'error').map((p: any) => p.unit ?? p.file).sort(),
    proofWarnings: (report.proof?.problems ?? []).filter((p: any) => p.severity === 'warning').map((p: any) => p.unit ?? p.file).sort(),
    failing: report.test?.dryRun ? [] : verdicts.filter((v) => !v.pass).map((v) => v.id).sort(),
    // A request that could not run, and a question that could not be asked.
    testErrors: [...(report.test?.requests ?? []).filter((r: any) => r.error).map((r: any) => `${r.file}: ${r.error}`), ...(report.test?.problems ?? []).map((p: any) => p.message)],
  };
}

const key = apiKey();

describe('tinyfetch scenarios', () => {
  for (const scenario of scenarios) {
    const skip = scenario.model === 'required' && !key;
    it.skipIf(skip)(`${scenario.name}: ${scenario.change}`, async () => {
      const app = App.copy(scenario.name.replace(/\W+/g, '-'));
      await scenario.apply(app);
      const real = scenario.model !== undefined && key !== undefined;
      const run = app.run('check', ...(real ? [] : ['--dry-run']));
      const seen = observe(run.report);
      const want = scenario.expect;
      const allowed = new Set([...(want.failing ?? []), ...(want.mayFail ?? []), ...(want.oneFails ?? [])]);

      expect(seen.testErrors).toEqual([]);
      if (real && want.oneFails) expect(seen.failing.some((id) => want.oneFails!.includes(id)), `one of ${want.oneFails.join(', ')} fails`).toBe(true);
      expect({
        lint: seen.lint,
        lintWarnings: seen.lintWarnings,
        proof: seen.proof,
        proofWarnings: seen.proofWarnings,
        // A test in `mayFail` may fail or pass; any other failure, or a pass in `failing`, is a finding.
        failing: seen.failing.filter((id) => !allowed.has(id) || (want.failing ?? []).includes(id)),
      }).toEqual({
        lint: [...(want.lint ?? [])].sort(),
        lintWarnings: [...(want.lintWarnings ?? [])].sort(),
        proof: [...(want.proof ?? [])].sort(),
        proofWarnings: [...(want.proofWarnings ?? [])].sort(),
        failing: real ? [...(want.failing ?? [])].sort() : [],
      });
      const clean = !want.lint?.length && !want.proof?.length && !want.failing?.length && !(real && want.oneFails?.length);
      expect(run.code).toBe(clean ? 0 : 1);
    });
  }
});
