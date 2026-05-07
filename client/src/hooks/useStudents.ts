import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface Student {
  id: string;
  fullName: string;
  regNumber: string;
  password?: string;
  batchId: string;
  batch?: { id: string; name: string };
  isActive: boolean;
  createdAt: string;
  ceRecords?: { totalCE: number; month: number; year: number }[];
}

export function useStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchByBatch = useCallback(async (batchId: string) => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get(`/batches/${batchId}/students`);
      setStudents(data.data);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load students');
    } finally { setLoading(false); }
  }, []);

  const fetchOne = useCallback(async (id: string): Promise<Student | null> => {
    try {
      const { data } = await api.get(`/students/${id}`);
      return data.data;
    } catch { return null; }
  }, []);

  const create = useCallback(async (payload: { 
    fullName: string; 
    regNumber: string; 
    batchId: string;
    password?: string;
  }) => {
    const { data } = await api.post('/students', payload);
    return data.data as Student;
  }, []);

  const update = useCallback(async (id: string, payload: { 
    fullName?: string; 
    regNumber?: string;
    password?: string;
  }) => {
    const { data } = await api.patch(`/students/${id}`, payload);
    return data.data as Student;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.delete(`/students/${id}`);
  }, []);

  const fetchBatchReport = useCallback(async (batchId: string) => {
    const { data } = await api.get(`/batches/${batchId}/report`);
    return data.data;
  }, []);

  const search = useCallback(async (q: string): Promise<Student[]> => {
    if (q.trim().length < 2) return [];
    const { data } = await api.get(`/students/search?q=${encodeURIComponent(q.trim())}`);
    return data.data as Student[];
  }, []);

  return { students, loading, error, fetchByBatch, fetchOne, create, update, remove, fetchBatchReport, search };
}
