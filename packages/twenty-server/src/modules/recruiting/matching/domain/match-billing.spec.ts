/** Keeps estimates distinct from missing prices, cached work and unavailable provider usage. */
import { getMatchBilling } from './match-billing';
import { type RecruitingPairResult } from '../pair-evaluator.service';
it('excludes cached evaluations from the estimate', () => {
  expect(
    getMatchBilling(
      [
        { status: 'SCORED', cached: false, usage: { inputTokens: 1000 } },
        { status: 'SCORED', cached: true, usage: { inputTokens: 9000 } },
      ] as RecruitingPairResult[],
      2,
    ),
  ).toEqual({ estimatedUsd: 0.002, unknownUsage: 0 });
});
it('does not claim an unconfigured price is free', () => {
  expect(getMatchBilling([], null)).toBeNull();
});
it('reports missing provider usage', () => {
  expect(
    getMatchBilling(
      [{ status: 'FAILED', cached: false }] as RecruitingPairResult[],
      2,
    )?.unknownUsage,
  ).toBe(1);
});
