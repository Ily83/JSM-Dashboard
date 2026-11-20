import type { Alert } from './types';

export interface HistoryMonth {
  key: string;
  from: string;
  to: string;
  alerts: Alert[];
  partial: boolean;
}

export interface HistoryAnalysisStatus {
  id: string;
  from: string;
  to: string;
  state: 'running' | 'completed' | 'cancelled' | 'failed';
  pages: number;
  recordsRead: number;
  /** Calendar months scanned so far, of `monthsTotal`. */
  monthsDone: number;
  monthsTotal: number;
  partial: boolean;
  message: string | null;
}

export const HISTORY_ANALYSIS_RESULT_PAGE_SIZE = 1000;

export interface HistoryAnalysisResultPage {
  month: HistoryMonth;
  hasNextPage: boolean;
  hasNextMonth: boolean;
}
