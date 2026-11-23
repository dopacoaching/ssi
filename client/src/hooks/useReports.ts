import { useCallback } from 'react';
import api from '../utils/api';
import type { CampusRef } from './useCirculation';

export type ReportColumnType = 'text' | 'number' | 'money' | 'date';
export interface ReportColumn { key: string; label: string; type: ReportColumnType }
export type ReportRow = Record<string, string | number | null>;

export interface ReportResult {
  type: string; title: string; campus: CampusRef | null;
  from: string | null; to: string | null; generatedAt: string;
  columns: ReportColumn[]; rows: ReportRow[];
  totals: Record<string, number> | null;
  truncated?: boolean;
}

export type ReportParams = Record<string, string | number | undefined>;

export function useReports() {
  const fetchReport = useCallback(async (type: string, params: ReportParams) => {
    const clean: Record<string, string | number> = {};
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') clean[k] = v; });
    const { data } = await api.get(`/library/reports/${type}`, { params: clean });
    return data.data as ReportResult;
  }, []);
  return { fetchReport };
}
