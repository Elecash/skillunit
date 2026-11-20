import { describe, expect, it } from 'vitest';
import { buildRequest, NONE_DESCRIPTION } from './reader.js';
import type { TestCase } from './spec.js';

const choice: TestCase = {
  id: 'pick',
  scenarios: ['First phrasing.', 'Second phrasing.'],
  question: 'Which one?',
  options: { a: 'A', b: 'B' },
  expect: 'a',
};
const yesNo: TestCase = { id: 'allowed', scenarios: ['A situation.'], question: 'Is it allowed?', expect: 'no' };

describe('buildRequest', () => {
  it('adds the none option to every choice question and asks each phrasing on its own', () => {
    const request = buildRequest('skill text', [choice, yesNo]);
    expect(Object.keys(request.questions)).toEqual(['pick#1', 'pick#2', 'allowed']);
    expect(request.questions['pick#1']).toMatchObject({ type: 'choice', criteria: { a: 'A', b: 'B', none: NONE_DESCRIPTION } });
    expect(request.questions.allowed).toMatchObject({ type: 'noul' });
    expect(request.state).toEqual({ skill: 'skill text' });
  });

  it('puts `with` files in the state under references', () => {
    const request = buildRequest('skill text', [yesNo], undefined, undefined, { 'ref.md': 'ref' });
    expect(request.state).toEqual({ skill: 'skill text', references: { 'ref.md': 'ref' } });
  });
});
