/**
 * The contract every decision model that ships must keep, checked against the real API: one
 * fixed request about a short text, for each provider whose key is set. Run it when adding a
 * provider, changing an adapter or updating a provider's SDK: `npx nx contract skillunit`, which
 * reads the keys from `.env`. `vitest run` and CI leave it out.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../config.js';
import { buildRequest, judge } from '../test/reader.js';
import type { TestCase } from '../test/spec.js';
import { PROVIDER_NAMES, PROVIDERS } from './providers.js';
import type { ProbabilityAnswer } from './types.js';

const TEXT = `# pagekit — images

pagekit builds static pages. These are its rules for images.

- Every image has an \`alt\` text. An image without one fails the build.
- Photos are served as WebP.
- Screenshots are the one exception: they stay PNG, so text in them stays sharp.
- No image is wider than 1600 pixels; pagekit scales down a wider one.
- Images live in \`assets/img\`, next to the page that shows them.
- pagekit does not upload images anywhere; the host serves them as they are.`;

const tests: TestCase[] = [
  {
    id: 'screenshot-png',
    scenarios: ['The agent adds a screenshot of a settings page to a guide.', 'A tutorial needs a screenshot of the terminal output.'],
    question: 'May the agent keep the screenshot as PNG?',
    expect: 'yes',
  },
  { id: 'no-alt', scenarios: ['The agent adds a decorative photo to a landing page.'], question: 'May the agent leave out the `alt` text of that image?', expect: 'no' },
  {
    id: 'photo-format',
    scenarios: ['The agent adds a product photo to a page.'],
    question: 'Which format should the photo be served in?',
    options: { webp: 'WebP', png: 'PNG', jpeg: null },
    expect: 'webp',
  },
  {
    id: 'cdn',
    scenarios: ['The agent sets up where the images of a site are served from.'],
    question: 'Which CDN should serve the images?',
    options: { cloudfront: 'Amazon CloudFront', fastly: 'Fastly' },
    expect: 'cloudfront',
  },
];

const request = buildRequest(TEXT, tests, 'pagekit is a static page builder.');
const byId = Object.fromEntries(tests.map((t) => [t.id, t]));

for (const name of PROVIDER_NAMES) {
  const missing = PROVIDERS[name].env.filter((v) => !process.env[v]);

  describe.skipIf(missing.length > 0)(`the ${name} provider`, () => {
    it('answers every question under its own id, with probabilities that add up, and gets the plain ones right', async () => {
      const model = await PROVIDERS[name].create({});
      const result = await model.decide(request);

      expect(result.model).toBeTruthy();
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(Object.keys(result.answers).sort()).toEqual(request.questions.map((q) => q.id).sort());
      expect(request.questions.map((q) => q.id)).toContain('screenshot-png#2');

      for (const q of request.questions) {
        const answer = result.answers[q.id]!;
        expect(answer, `${q.id} was refused`).not.toHaveProperty('refused');
        const { probabilities } = answer as ProbabilityAnswer;
        for (const p of Object.values(probabilities)) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
        if (q.options) {
          expect(Object.keys(probabilities).sort()).toEqual(q.options.map((o) => o.id).sort());
          expect(Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(0.02);
        } else {
          expect(Object.keys(probabilities).sort()).toEqual(['no', 'yes']);
        }
      }

      const verdict = (id: string, phrasing = 0) => {
        const test = byId[id.replace(/#\d+$/, '')]!;
        return judge(test, result.answers[id], DEFAULT_THRESHOLDS, phrasing);
      };
      expect(verdict('screenshot-png#1').pass, 'a screenshot may stay PNG').toBe(true);
      expect(verdict('screenshot-png#2', 1).pass, 'a screenshot may stay PNG').toBe(true);
      expect(verdict('no-alt').pass, 'an image needs alt text').toBe(true);
      expect(verdict('photo-format').pass, 'photos are WebP').toBe(true);
      expect(verdict('cdn').pass, 'nothing in the text picks a CDN').toBe(false);
    }, 90_000);
  });
}
