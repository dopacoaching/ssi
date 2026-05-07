import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface Teacher {
  id: string; email: string; name: string;
  role: 'ADMIN' | 'TEACHER'; batchIds: string[]; isActive?: boolean;
}

export interface BatchAnalytics {
  batch: { id: string; name: string };
  studentCount: number;
  ceMonthly: { month: number; year: number; avgCE: number; avgAttendance: number; studentCount: number }[];
  subjectAverages: { physics: number; chem: number; math: number; bio: number; lang1: number; lang2: number };
  topStudents: { id: string; fullName: string; regNumber: string; avgCE: number }[];
  atRisk: { id: string; fullName: string; regNumber: string; avgCE: number; avgAttendance: number }[];
}

export interface AlertStudent {
  id: string; fullName: string; regNumber: string;
  batch: { id: string; name: string };
  latestCE: { totalCE: number; attendancePct: number; month: number; year: number };
  prevCE: { totalCE: number } | null;
}

export function useAdmin() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading]   = useState(false);

  const fetchTeachers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/teachers');
      setTeachers(data.data);
    } finally { setLoading(false); }
  }, []);

  const createTeacher = useCallback(async (payload: { email: string; password: string; name: string; batchIds?: string[] }) => {
    const { data } = await api.post('/admin/teachers', payload);
    return data.data as Teacher;
  }, []);

  const updateTeacher = useCallback(async (id: string, payload: { name?: string; batchIds?: string[]; isActive?: boolean; password?: string }) => {
    const { data } = await api.patch(`/admin/teachers/${id}`, payload);
    return data.data as Teacher;
  }, []);

  const fetchAnalytics = useCallback(async (batchId: string): Promise<BatchAnalytics> => {
    const { data } = await api.get(`/admin/batches/${batchId}/analytics`);
    return data.data as BatchAnalytics;
  }, []);

  const fetchAlerts = useCallback(async (): Promise<AlertStudent[]> => {
    const { data } = await api.get('/admin/alerts');
    return data.data as AlertStudent[];
  }, []);

  return { teachers, loading, fetchTeachers, createTeacher, updateTeacher, fetchAnalytics, fetchAlerts };
}
