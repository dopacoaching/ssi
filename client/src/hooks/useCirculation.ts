import { useCallback } from 'react';
import api from '../utils/api';
import type { BookCopy } from './useCatalog';
import type { PaymentView, WaiverView } from './useFines';

export type Reason = { code: string; message: string };
export type LoanCondition = null | 'GOOD' | 'DAMAGED_MINOR' | 'DAMAGED_MAJOR';
export type CampusRef = { id: string; name: string; code: string };

export interface LoanView {
  id: string; campusId: string; campus: CampusRef;
  copy: { id: string; catalogNumber: string; status: string };
  book: { id: string; title: string; author: string; price?: number | null };
  student: { id: string; fullName: string; regNumber: string; batch: { id: string; name: string } | null };
  issuedAt: string; issuedBy: { id: string; name: string } | null;
  dueDate: string; renewCount: number; renewals: unknown[];
  status: 'OPEN' | 'RETURNED' | 'LOST';
  returnedAt: string | null; returnedBy: { id: string; name: string } | null;
  condition: LoanCondition;
  daysLate: number; lateFine: number; waivedDays?: number;
  isOverdue: boolean; canRenew: boolean; renewBlockedReason: string | null;
  backdated: unknown;
  lostAt?: string | null; lostBy?: { id: string; name: string } | null; foundAt?: string | null;
}

export interface ChargeView {
  id: string; campusId: string; type: 'LATE' | 'DAMAGE' | 'LOST';
  amount: number; paidAmount: number; waivedAmount: number; balance: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED';
  note: string; loanId: string;
  copy: { id: string; catalogNumber: string }; book: { id: string; title: string };
  createdAt: string; createdBy: { id: string; name: string } | null;
}

export interface OtherCampusSummary { openLoans: number; overdueLoans: number; outstanding: number; campuses: string[] }

export interface StudentCard {
  student: {
    id: string; fullName: string; regNumber: string; photo?: string | null; isActive: boolean;
    batch: { id: string; name: string } | null; campus: CampusRef | null;
  };
  loans: LoanView[];
  charges: ChargeView[];
  otherCampuses: OtherCampusSummary | null;
  outstanding: { thisCampus: number; total: number };
  eligibility: { canIssue: boolean; reasons: Reason[] };
  settings: { maxBooks: number; fineBlockThreshold: number; loanDays: number };
}

export interface CopyCard {
  copy: BookCopy;
  book: { id: string; title: string; author: string; price: number | null };
  campus: CampusRef;
  openLoan: LoanView | null;
}

export interface IssuePayload { regNumber: string; catalogNumber: string; campusId?: string; issuedAt?: string; reason?: string }
export interface IssueResult { loan: LoanView; student: StudentCard | null }

export interface ReturnPayload {
  catalogNumber: string; condition: 'GOOD' | 'DAMAGED';
  severity?: 'MINOR' | 'MAJOR'; charge?: number; returnedAt?: string; reason?: string;
}
export interface ReturnResult {
  loan: LoanView; charges?: ChargeView[];
  student?: { id: string; fullName: string; regNumber: string; outstanding: number } | null;
}

export interface ReportLostPayload { loanId: string; amount?: number; note?: string; lostAt?: string; reason?: string }
export interface ReportLostResult {
  loan: LoanView; charges: ChargeView[];
  student: { id: string; fullName: string; regNumber: string; outstanding: number } | null;
  copyDriftStatus?: string | null;
}

export type LoanListView = 'open' | 'overdue' | 'dueToday' | 'dueSoon';
export interface LoanListQuery { view: LoanListView; campusId?: string; q?: string; page?: number; limit?: number }
export interface LoanListResult { items: LoanView[]; total: number; page: number; limit: number }

export interface StudentHistory {
  student: StudentCard['student'];
  loans: LoanView[]; charges: ChargeView[]; otherCampuses: OtherCampusSummary | null;
  payments?: PaymentView[]; waivers?: WaiverView[];
}

/** Eligibility reasons attached to a 400 response (data.reasons), if any. */
export function reasonsFrom(e: any): Reason[] {
  const r = e?.response?.data?.data?.reasons;
  return Array.isArray(r) ? r : [];
}

export function useCirculation() {
  const getStudentCard = useCallback(async (regNumber: string, campusId?: string) => {
    const { data } = await api.get(`/library/circulation/student/${encodeURIComponent(regNumber)}`, { params: campusId ? { campusId } : {} });
    return data.data as StudentCard;
  }, []);

  const getCopyCard = useCallback(async (catalogNumber: string, campusId?: string) => {
    const { data } = await api.get(`/library/circulation/copy/${encodeURIComponent(catalogNumber)}`, { params: campusId ? { campusId } : {} });
    return data.data as CopyCard;
  }, []);

  const issueBook = useCallback(async (payload: IssuePayload) => {
    const { data } = await api.post('/library/circulation/issue', payload);
    return data.data as IssueResult;
  }, []);

  const returnBook = useCallback(async (payload: ReturnPayload) => {
    const { data } = await api.post('/library/circulation/return', payload);
    return data.data as ReturnResult;
  }, []);

  const reportLost = useCallback(async (payload: ReportLostPayload) => {
    const { data } = await api.post('/library/circulation/report-lost', payload);
    return data.data as ReportLostResult;
  }, []);

  const renewLoan =useCallback(async (loanId: string) => {
    const { data } = await api.post('/library/circulation/renew', { loanId });
    return data.data as { loan?: LoanView | null };
  }, []);

  const listLoans = useCallback(async (params: LoanListQuery) => {
    const clean: Record<string, string | number> = {};
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') clean[k] = v as string | number; });
    const { data } = await api.get('/library/circulation/loans', { params: clean });
    return data.data as LoanListResult;
  }, []);

  const getStudentHistory = useCallback(async (studentId: string) => {
    const { data } = await api.get(`/library/circulation/students/${studentId}/history`);
    return data.data as StudentHistory;
  }, []);

  return { getStudentCard, getCopyCard, issueBook, returnBook, reportLost, renewLoan, listLoans, getStudentHistory };
}
