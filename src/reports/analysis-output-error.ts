export type AnalysisOutputErrorCode =
  | 'OUTPUT_PLAN_INVALID'
  | 'OUTPUT_DIRECTORY_PREPARE_FAILED'
  | 'OUTPUT_FORMAT_FAILED'
  | 'OUTPUT_WRITE_FAILED';

export class AnalysisOutputError extends Error {
  readonly code: AnalysisOutputErrorCode;

  constructor(code: AnalysisOutputErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnalysisOutputError';
    this.code = code;
  }
}
