export type Severity = 'info' | 'warning' | 'high' | 'critical';

export type Category = 'risk' | 'contract' | 'testing';

export type FindingSource = 'pr-risk-analyzer' | 'contract-checker' | 'test-generator';

export interface SourceLocation {
  repositoryId: string;
  file: string;
  startLine?: number;
  endLine?: number;
}

export interface FindingEvidence {
  expected?: string;
  actual?: string;
  codeSnippet?: string;
  details?: Record<string, unknown>;
}

export interface AnalysisFinding {
  id: string;
  ruleId: string;
  rootCauseId?: string;
  source: FindingSource;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  location?: SourceLocation;
  evidence?: FindingEvidence;
  recommendation?: string;
  relatedFindingIds?: string[];
  metadata?: Record<string, unknown>;
}
