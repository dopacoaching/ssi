import { useCallback } from 'react';
import api from '../utils/api';
import type { CampusRef } from './useCirculation';

type UserRef = { id: string; name: string } | null;
export interface MissingCopy { copyId: string; catalogNumber: string; title: string; shelfLocation: string; markedLostAt: string | null }

export interface StockCheckView {
  id: string; campus: CampusRef; status: 'OPEN' | 'CLOSED' | 'CANCELLED'; note: string;
  startedBy: UserRef; startedAt: string; closedBy: UserRef; closedAt: string | null;
  cancelledBy: UserRef; cancelledAt: string | null; cancelReason: string;
  scanCount: number; expectedCount: number | null; missing: MissingCopy[]; missingCount?: number;
}
export interface ScanView { copyId: string; catalogNumber: string; title: string; statusAtScan: string; scannedBy: UserRef; scannedAt: string }
export interface ShelfProgress { shelf: string; expected: number; scanned: number }
export type StockCheckDetail = StockCheckView & { progress: ShelfProgress[]; recentScans: ScanView[] };

export type ScanOutcome = 'OK' | 'ALREADY_SCANNED' | 'WRONG_CAMPUS' | 'NOT_FOUND' | 'ISSUED' | 'LOST' | 'DAMAGED' | 'WITHDRAWN';
export interface ScanResult {
  result: ScanOutcome; message: string;
  copy: { id: string; catalogNumber: string; status: string; shelfLocation: string; title: string } | null;
  scanCount: number;
}

export function useStockCheck() {
  const list = useCallback(async (params: { campusId?: string; page?: number; limit?: number }) => {
    const clean: Record<string, string | number> = {};
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') clean[k] = v as string | number; });
    const { data } = await api.get('/library/stock-checks', { params: clean });
    return data.data as { items: StockCheckView[]; total: number; page: number; limit: number };
  }, []);

  const start = useCallback(async (payload: { campusId?: string; note?: string }) => {
    const { data } = await api.post('/library/stock-checks', payload);
    return data.data as StockCheckView;
  }, []);

  const get = useCallback(async (id: string) => {
    const { data } = await api.get(`/library/stock-checks/${id}`);
    return data.data as StockCheckDetail;
  }, []);

  const scan = useCallback(async (id: string, catalogNumber: string) => {
    const { data } = await api.post(`/library/stock-checks/${id}/scan`, { catalogNumber });
    return data.data as ScanResult;
  }, []);

  const undoScan = useCallback(async (id: string, copyId: string) => {
    const { data } = await api.delete(`/library/stock-checks/${id}/scans/${copyId}`);
    return data.data as { scanCount: number };
  }, []);

  const close = useCallback(async (id: string) => {
    const { data } = await api.post(`/library/stock-checks/${id}/close`);
    return data.data as StockCheckView;
  }, []);

  const cancel = useCallback(async (id: string, reason: string) => {
    const { data } = await api.post(`/library/stock-checks/${id}/cancel`, { reason });
    return data.data as StockCheckView;
  }, []);

  const markLost = useCallback(async (id: string, copyIds: string[], reason: string) => {
    const { data } = await api.post(`/library/stock-checks/${id}/mark-lost`, { copyIds, reason });
    return data.data as { marked: number; skipped: { copyId: string; catalogNumber: string; status: string }[] };
  }, []);

  return { list, start, get, scan, undoScan, close, cancel, markLost };
}
