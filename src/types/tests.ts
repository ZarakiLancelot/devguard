export type SupportedTestFramework = 'vitest' | 'jest' | 'scenario-only';

export interface GeneratedTest {
  id: string;
  framework: SupportedTestFramework;
  title: string;
  rationale: string;
  filePath?: string;
  code?: string;
  relatedFindingIds: string[];
}
