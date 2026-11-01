/** Estimates this run's token cost without billing cached evaluations twice. */
import { type RecruitingPairResult } from '../pair-evaluator.service';

/** Missing usage remains explicit; the estimate is not an upstream invoice. */
export const getMatchBilling = (
  results: RecruitingPairResult[],
  inputPricePerMillion: number | null,
) => {
  if (inputPricePerMillion === null) return null;
  const calls = results.filter(
    (row) => !row.cached && row.status !== 'EXCLUDED',
  );
  return {
    estimatedUsd:
      (calls.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0), 0) *
        inputPricePerMillion) /
      1_000_000,
    unknownUsage: calls.filter((row) => row.usage?.inputTokens === undefined)
      .length,
  };
};
