/** CLI-owned control-flow signal for a completed analysis that misses its quality threshold. */
export class QualityThresholdFailure extends Error {
  constructor() {
    super();
    this.name = 'QualityThresholdFailure';
  }
}
