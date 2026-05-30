import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface WeeklyTest {
  id: string; studentId: string;
  weekDate: string; testType: 'Theory' | 'MCQ' | string; subject: string; chapter?: string;
  marks: number; maxMarks: number;
  createdAt: string;
}

export interface MonthlyTest {
  id: string; studentId: string;
  month: number; year: number;
  testType: 'Theory' | 'MCQ' | string; subject: string; marks: number; maxMarks: number;
  createdAt: string;
}

export interface BulkEntry { studentId: string; marks: number | '' }

export interface BulkTestPayload {
  isWeekly: boolean;
  testType: string;
  subject: string;
  maxMarks: number;
  chapter?: string;
  weekDate?: string;
  month?: number;
  year?: number;
  entries: { studentId: string; marks: number }[];
}

export function useTests(studentId: string) {
  const [weekly, setWeekly]   = useState<WeeklyTest[]>([]);
  const [monthly, setMonthly] = useState<MonthlyTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [w, m] = await Promise.all([
        api.get(`/students/${studentId}/weekly-tests`),
        api.get(`/students/${studentId}/monthly-tests`),
      ]);
      setWeekly(w.data.data);
      setMonthly(m.data.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load tests');
    } finally { setLoading(false); }
  }, [studentId]);

  const addWeekly = useCallback(async (payload: { weekDate: string; testType: string; subject: string; chapter?: string; marks: number; maxMarks: number }) => {
    const { data } = await api.post(`/students/${studentId}/weekly-tests`, payload);
    return data.data as WeeklyTest;
  }, [studentId]);

  const updateWeekly = useCallback(async (testId: string, payload: { marks?: number; maxMarks?: number; chapter?: string }) => {
    const { data } = await api.patch(`/weekly-tests/${testId}`, payload);
    return data.data as WeeklyTest;
  }, []);

  const deleteWeekly = useCallback(async (testId: string) => {
    await api.delete(`/weekly-tests/${testId}`);
  }, []);

  const addMonthly = useCallback(async (payload: { month: number; year: number; testType: string; subject: string; marks: number; maxMarks: number }) => {
    const { data } = await api.post(`/students/${studentId}/monthly-tests`, payload);
    return data.data as MonthlyTest;
  }, [studentId]);

  const updateMonthly = useCallback(async (testId: string, payload: { marks?: number; maxMarks?: number }) => {
    const { data } = await api.patch(`/monthly-tests/${testId}`, payload);
    return data.data as MonthlyTest;
  }, []);

  const deleteMonthly = useCallback(async (testId: string) => {
    await api.delete(`/monthly-tests/${testId}`);
  }, []);

  return { weekly, monthly, loading, error, fetchAll, addWeekly, updateWeekly, deleteWeekly, addMonthly, updateMonthly, deleteMonthly };
}

export function useBatchTests() {
  const [submitting, setSubmitting] = useState(false);

  const bulkAdd = useCallback(async (batchId: string, payload: BulkTestPayload): Promise<{ created: number; skipped: number }> => {
    setSubmitting(true);
    try {
      const { data } = await api.post(`/batches/${batchId}/tests/bulk`, payload);
      return data.data as { created: number; skipped: number };
    } finally { setSubmitting(false); }
  }, []);

  return { submitting, bulkAdd };
}
