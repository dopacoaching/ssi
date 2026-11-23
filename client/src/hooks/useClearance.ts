import { useCallback } from 'react';
import api from '../utils/api';
import type { CampusRef, OtherCampusSummary, StudentCard } from './useCirculation';

export interface DueLoan {
  loanId: string; campus: CampusRef; catalogNumber: string; title: string;
  dueDate: string; daysLate: number; lateFine: number; isOverdue: boolean;
}
export interface DueCharge {
  chargeId: string; campus: CampusRef; type: 'LATE' | 'DAMAGE' | 'LOST';
  catalogNumber: string; title: string; balance: number;
}
export interface LibraryDues {
  openLoans: DueLoan[]; charges: DueCharge[]; outstanding: number; isClear: boolean;
}

export interface ClearanceResult {
  student: StudentCard['student'];
  isClear: boolean; outstanding: number;
  thisCampus: { openLoans: DueLoan[]; charges: DueCharge[] };
  otherCampuses: OtherCampusSummary | null;
  checkedAt: string; checkedBy: { id: string; name: string };
  campus: CampusRef | null;
}

export interface ClearanceSlip {
  reference: string; issuedAt: string; issuedBy: { id: string; name: string };
  student: StudentCard['student'];
  campus: (CampusRef & { libraryName?: string; receiptAddress?: string; receiptPhone?: string }) | null;
}

export function useClearance() {
  const getClearance = useCallback(async (regNumber: string) => {
    const { data } = await api.get(`/library/clearance/${encodeURIComponent(regNumber)}`);
    return data.data as ClearanceResult;
  }, []);

  const issueSlip = useCallback(async (regNumber: string) => {
    const { data } = await api.post(`/library/clearance/${encodeURIComponent(regNumber)}/slip`);
    return data.data as ClearanceSlip;
  }, []);

  const getLibraryDues = useCallback(async (studentId: string) => {
    const { data } = await api.get(`/students/${studentId}/library-dues`);
    return data.data as LibraryDues;
  }, []);

  return { getClearance, issueSlip, getLibraryDues };
}
