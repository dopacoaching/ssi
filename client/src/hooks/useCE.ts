import { useState, useCallback } from 'react';
import api from '../utils/api';

export interface CERecord {
  id: string;
  studentId: string;
  month: number;
  year: number;
  physicsMarks: number; physicsMax: number;
  chemMarks: number;    chemMax: number;
  mathMarks: number;    mathMax: number;
  bioMarks: number;     bioMax: number;
  lang1Marks: number;   lang1Max: number;
  lang2Marks: number;   lang2Max: number;
  psychologyMarks: number; psychologyMax: number;
  mcqMarks: number;
  mcqMax: number;
  mcqPct: number;
  attendancePct: number;
  hasMedCert: boolean;
  notesStatus: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';
  theoryScore: number;
  mcqScore: number;
  attendScore: number;
  notesScore: number;
  totalCE: number;
  isApproved?: boolean;
  createdAt: string;
}

export function useCE(studentId: string) {
  const [records, setRecords] = useState<CERecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/students/${studentId}/ce`);
      setRecords(data.data);
    } finally { setLoading(false); }
  }, [studentId]);

  const upsert = useCallback(async (payload: {
    month: number; year: number;
    attendancePct: number; hasMedCert: boolean;
    notesStatus: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE';
  }) => {
    const { data } = await api.post(`/students/${studentId}/ce`, payload);
    return data.data as CERecord;
  }, [studentId]);

  const remove = useCallback(async (ceId: string) => {
    const { data } = await api.delete(`/students/${studentId}/ce/${ceId}`);
    return data.data;
  }, [studentId]);

  return { records, loading, fetch, upsert, remove };
}
