import type { PreparedDataset, ResultEnvelope } from '../data/types.ts'

/**
 * Carry one prepared snapshot's versions and evidence into a business result.
 * @param dataset - Snapshot used by the operation.
 * @param scope - Explicit input identifiers and selected mode.
 * @param payload - Operation-specific fields.
 * @param status - Success, limited evidence, review, or rejected request.
 * @param evidence - Record identifiers supporting the result.
 * @param limitations - Limits that affect interpretation.
 * @returns A result with deterministic, unique evidence identifiers.
 */
export function make_result<T>(
  dataset: PreparedDataset,
  scope: Record<string, string | boolean>,
  payload: T,
  status: ResultEnvelope<T>['result_status'] = 'ok',
  evidence: string[] = [],
  limitations: string[] = [],
): ResultEnvelope<T> {
  return {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    policy_version: dataset.policy_version,
    producer_version: dataset.producer_version,
    source_mode: dataset.source_mode,
    scope,
    result_status: status,
    payload,
    evidence_ids: [...new Set(evidence)].sort(),
    limitations,
  }
}
