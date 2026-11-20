import { afterAll, describe, expect, it } from 'vitest';
import { apiKey, App } from './app.js';
import { scenarios, type Expected } from './scenarios.js';

afterAll(() => App.removeAll());

/** What SkillUnit reported, in the form the scenarios list it. */
function observe(report: Record<string, any>): Required<Omit<Expected, 'mayFail'>> & { specErrors: string[] } {
  const problems: any[] = report.lint?.problems ?? [];
  const show = (p: any) => [p.rule, `skill/${p.file}`, p.unit ?? '-', /TS\d+/.exec(p.message)?.[0]].filter(Boolean).join(' ');
  const verdicts: any[] = (report.test?.specs ?? []).flatMap((s: any) => s.verdicts);
  return {
    lint: problems.filter((p) => p.severity === 'error').map(show).sort(),
    lintWarnings: problems.filter((p) => p.severity === 'warning').map(show).sort(),
    sync: (report.sync?.problems ?? []).map((p: any) => p.unit).sort(),
    failing: report.test?.dryRun ? [] : verdicts.filter((v) => !v.pass).map((v) => v.id).sort(),
    specErrors: (report.test?.specs ?? []).filter((s: any) => s.error).map((s: any) => `${s.spec}: ${s.error}`),
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
      const allowed = new Set([...(want.failing ?? []), ...(want.mayFail ?? [])]);

      expect(seen.specErrors).toEqual([]);
      expect({
        lint: seen.lint,
        lintWarnings: seen.lintWarnings,
        sync: seen.sync,
        // A test in `mayFail` may fail or pass; any other failure, or a pass in `failing`, is a finding.
        failing: seen.failing.filter((id) => !allowed.has(id) || (want.failing ?? []).includes(id)),
      }).toEqual({
        lint: [...(want.lint ?? [])].sort(),
        lintWarnings: [...(want.lintWarnings ?? [])].sort(),
        sync: [...(want.sync ?? [])].sort(),
        failing: real ? [...(want.failing ?? [])].sort() : [],
      });
      const clean = !want.lint?.length && !want.sync?.length && !want.failing?.length;
      expect(run.code).toBe(clean ? 0 : 1);
    });
  }
});
