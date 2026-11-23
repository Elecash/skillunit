import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decode, parseJUnit, ReportError, skillTags, type TestCase } from './junit.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/proof');
const fixture = (name: string) => parseJUnit(readFileSync(join(FIXTURES, name), 'utf8'), name);
/** `status tags message`, the parts every runner must agree on. */
const brief = (c: TestCase) => `${c.status} [${c.tags.join(', ')}]${c.message ? ` ${c.message}` : ''}`;

describe('reports written by the runners', () => {
  it('reads the Vitest report', () => {
    const cases = fixture('vitest.xml');
    expect(cases.map(brief)).toEqual([
      'passed [retry-defaults]',
      'passed [retry-network, retry-5xx]',
      'failed [retry-fails] expected 1 to be 2 // Object.is equality',
      'skipped [retry-skipped]',
      'failed [retry-throws] boom & <done>',
      'passed [errors-in-describe]',
      'passed []',
    ]);
    expect(cases[5]).toMatchObject({ classname: 'sample.test.ts', name: 'errors [skill:errors-in-describe] > passes a title with "quotes" & <angle> brackets', report: 'vitest.xml', line: 30 });
  });

  it('reads the Jest report, where classname repeats the title and a failure has no message attribute', () => {
    const cases = fixture('jest.xml');
    expect(cases.map(brief)).toEqual([
      'passed [retry-defaults]',
      'passed [retry-network, retry-5xx]',
      'failed [retry-fails] Error: expect(received).toBe(expected) // Object.is equality',
      'skipped [retry-skipped]',
      'failed [retry-throws] Error: boom & <done>',
      'passed [errors-in-describe]',
      'passed []',
    ]);
    expect(cases[5]!.name).toBe('errors [skill:errors-in-describe] passes a title with "quotes" & <angle> brackets');
  });

  it('reads the pytest report, with tags from parametrize ids and an error at setup', () => {
    const cases = fixture('pytest.xml');
    expect(cases.map(brief)).toEqual([
      'passed [retry-defaults]',
      'passed [retry-network, retry-5xx]',
      'failed [retry-fails] assert 1 == 2',
      'skipped [retry-skipped] not now',
      'failed [retry-throws] RuntimeError: boom & <done>',
      'failed [retry-setup-error] failed on setup with "RuntimeError: fixture failed"',
      'passed []',
      'passed []',
    ]);
    expect(cases[0]).toMatchObject({ classname: 'test_sample.TestRetries', name: 'test_reads_the_defaults[skill:retry-defaults]' });
    expect(cases[6]!.name).toBe('test_title_with_entities["quotes" & <angle>]');
  });
});

describe('the format', () => {
  it('reads nested suites, single quotes, CDATA, comments, a DOCTYPE and a > inside a value', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE testsuites [ <!ENTITY x "y"> ]>
<!-- written by hand -->
<testsuites>
  <testsuite name="outer">
    <testsuite name='inner'>
      <testcase classname='a.b' name='x &gt; y [skill:one]'/>
      <testcase name="cdata [skill:two]"><failure><![CDATA[
  first <line> & more
second]]></failure></testcase>
      <testcase name="a > b [skill:three]"><!-- <failure/> --></testcase>
    </testsuite>
  </testsuite>
</testsuites>
`;
    const cases = parseJUnit(xml, 'r.xml');
    expect(cases.map((c) => `${c.line} ${c.name} ${brief(c)}`)).toEqual([
      '7 x > y [skill:one] passed [one]',
      '8 cdata [skill:two] failed [two] first <line> & more',
      '11 a > b [skill:three] passed [three]',
    ]);
  });

  it('counts error as failed, and a failure over a skip whatever the order', () => {
    const xml = `<testsuite>
<testcase name="e"><error message="boom"/></testcase>
<testcase name="s-then-f"><skipped message="later"/><failure message="broke">trace</failure></testcase>
<testcase name="f-then-s"><failure>first line

second line</failure><skipped/></testcase>
<testcase name="out"><system-out>failure</system-out></testcase>
</testsuite>`;
    expect(parseJUnit(xml, 'r.xml').map((c) => `${c.name} ${brief(c)}`)).toEqual([
      'e failed [] boom',
      's-then-f failed [] broke',
      'f-then-s failed [] first line',
      'out passed []',
    ]);
  });

  it('decodes the five entities and character references, and leaves others', () => {
    expect(decode('&lt;&gt;&amp;&quot;&apos; &#65;&#x42; &nbsp; &amp;lt;')).toBe(`<>&"' AB &nbsp; &lt;`);
  });

  it('says where a report is broken', () => {
    const broken = (xml: string) => {
      try {
        parseJUnit(xml, 'r.xml');
      } catch (e) {
        expect(e).toBeInstanceOf(ReportError);
        return (e as Error).message;
      }
      return 'no error';
    };
    expect(broken('<testsuite>\n<testcase name="a">\n')).toBe('r.xml:3: the report ends inside `<testcase>`; was it cut short?');
    expect(broken('<testsuite>\n</testcase>')).toBe('r.xml:2: `</testcase>` closes `<testsuite>`');
    expect(broken('<testsuite name="a>\n')).toBe('r.xml:1: the value of `name` is never closed');
    expect(broken('<testsuite>\n<testcase name="a"><testcase name="b"/></testcase></testsuite>')).toBe('r.xml:2: a `testcase` inside another `testcase`');
    expect(broken('<testsuite>a < b</testsuite>')).toBe('r.xml:1: a `<` that starts no tag; write it as `&lt;`');
  });
});

describe('tags', () => {
  it('finds every [skill:<id>] of a title, in order and once each', () => {
    expect(skillTags('a [skill:x] b [skill:y.z][skill:x]')).toEqual(['x', 'y.z']);
    expect(skillTags('[skill:]')).toEqual(['']);
    expect(skillTags('[skill: x] [Skill:x] skill:x')).toEqual([]);
  });
});
