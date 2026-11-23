import { useCallback } from 'react';
import api from '../utils/api';
import type { ChargeView, CampusRef, LoanView } from './useCirculation';

export interface PaymentView {
  id: string; receiptNumber: string;
  campus: { id: string; name: string; code: string; libraryName: string; receiptAddress: string; receiptPhone: string; openingHours: string };
  student: { id: string; fullName: string; regNumber: string; batch: { id: string; name: string } | null };
  amount: number; note: string; receivedAt: string; receivedBy: { id: string; name: string } | null;
  allocations: {
    chargeId: string; amount: number;
    charge: { type: 'LATE' | 'DAMAGE' | 'LOST'; amount: number; catalogNumber: string; title: string; daysLate: number | null; chargeableDays?: number | null; waivedDays?: number | null };
  }[];
  voided: { at: string; by: { id: string; name: string } | null; reason: string } | null;
}

export type WaiverStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface WaiverView {
  id: string; type: 'REQUEST' | 'DIRECT' | 'BULK'; status: WaiverStatus;
  amount: number; approvedAmount: number | null; reason: string; decisionNote: string;
  campus: CampusRef; student: { id: string; fullName: string; regNumber: string };
  charge: ChargeView;
  requestedBy: { id: string; name: string } | null; requestedAt: string;
  decidedBy: { id: string; name: string } | null; decidedAt: string | null;
  finePeriodId: string | null;
}

export interface FinePeriodView {
  id: string; campus: CampusRef; from: string; to: string; reason: string;
  createdBy: { id: string; name: string } | null; createdAt: string;
  cancelled: { at: string; by: { id: string; name: string } | null; reason: string } | null;
  waiverCount: number; totalWaived: number;
}

export interface PendingFineItem {
  student: { id: string; fullName: string; regNumber: string; batch: { id: string; name: string } | null; isActive: boolean };
  campus: CampusRef; balance: number; chargeCount: number; oldestChargeAt: string | null; accruing: number;
}
export interface PendingFinesResult {
  items: PendingFineItem[]; total: number; page: number; limit: number;
  totals: { balance: number; accruing: number };
}
export interface PendingFinesQuery { campusId?: string; q?: string; page?: number; limit?: number }

export interface StudentFines {
  student: { id: string; fullName: string; regNumber: string; batch: { id: string; name: string } | null; isActive?: boolean };
  charges: ChargeView[]; accruing: LoanView[]; balance: number;
}

export interface PaymentListQuery {
  campusId?: string; from?: string; to?: string; staffId?: string; studentId?: string;
  includeVoided?: boolean; page?: number; limit?: number;
}
export interface PaymentListResult { items: PaymentView[]; total: number; page: number; limit: number }

export interface PaymentSummary {
  date: string; campus: CampusRef | null;
  myTotal: number; myCount: number; campusTotal: number; campusCount: number;
  byStaff: { staff: { id: string; name: string }; total: number; count: number }[];
  payments: PaymentView[]; paymentsTruncated?: boolean;
}

export interface CreatePaymentPayload {
  studentId: string; campusId?: string; amount: number;
  allocations: { chargeId: string; amount: number }[]; note?: string; requestId?: string;
}

export interface WaiverListQuery { status?: WaiverStatus | ''; campusId?: string; mine?: boolean; page?: number; limit?: number }
export interface WaiverListResult { items: WaiverView[]; total: number; page: number; limit: number }

export interface FinePeriodPreview {
  returnedLoansAffected: number; totalWaivable: number; paidNotRefunded: number; openLoansAffected: number;
}
export interface FinePeriodCreateResult {
  period: FinePeriodView; appliedWaivers: number; totalWaived: number; paidNotRefunded: number;
}

function clean<T extends object>(params: T) {
  const out: Record<string, string | number | boolean> = {};
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== null) out[k] = v as string | number | boolean; });
  return out;
}

export function useFines() {
  const listPendingFines = useCallback(async (q: PendingFinesQuery) => {
    const { data } = await api.get('/library/fines/pending', { params: clean(q) });
    return data.data as PendingFinesResult;
  }, []);

  const getStudentFines = useCallback(async (studentId: string, campusId?: string) => {
    const { data } = await api.get(`/library/fines/students/${studentId}`, { params: clean({ campusId }) });
    return data.data as StudentFines;
  }, []);

  const createPayment = useCallback(async (payload: CreatePaymentPayload) => {
    const { data } = await api.post('/library/payments', payload);
    return (data.data as { payment: PaymentView }).payment;
  }, []);

  const listPayments = useCallback(async (q: PaymentListQuery) => {
    const { data } = await api.get('/library/payments', { params: clean(q) });
    return data.data as PaymentListResult;
  }, []);

  const getPayment = useCallback(async (id: string) => {
    const { data } = await api.get(`/library/payments/${id}`);
    return data.data as PaymentView;
  }, []);

  const voidPayment = useCallback(async (id: string, reason: string) => {
    const { data } = await api.post(`/library/payments/${id}/void`, { reason });
    return data.data as PaymentView;
  }, []);

  const getPaymentSummary = useCallback(async (q: { date?: string; campusId?: string }) => {
    const { data } = await api.get('/library/payments/summary', { params: clean(q) });
    return data.data as PaymentSummary;
  }, []);

  const requestWaiver = useCallback(async (payload: { chargeId: string; amount: number; reason: string }) => {
    const { data } = await api.post('/library/waivers', payload);
    return data.data as WaiverView;
  }, []);

  const listWaivers = useCallback(async (q: WaiverListQuery) => {
    const { data } = await api.get('/library/waivers', { params: clean(q) });
    return data.data as WaiverListResult;
  }, []);

  const approveWaiver = useCallback(async (id: string, payload: { amount?: number; note?: string }) => {
    const { data } = await api.post(`/library/waivers/${id}/approve`, payload);
    return data.data as WaiverView;
  }, []);

  const rejectWaiver = useCallback(async (id: string, note: string) => {
    const { data } = await api.post(`/library/waivers/${id}/reject`, { note });
    return data.data as WaiverView;
  }, []);

  const listFinePeriods = useCallback(async (campusId?: string) => {
    const { data } = await api.get('/library/fine-periods', { params: clean({ campusId }) });
    return data.data as FinePeriodView[];
  }, []);

  const previewFinePeriod = useCallback(async (q: { campusId: string; from: string; to: string }) => {
    const { data } = await api.get('/library/fine-periods/preview', { params: q });
    return data.data as FinePeriodPreview;
  }, []);

  const createFinePeriod = useCallback(async (payload: { campusId: string; from: string; to: string; reason: string }) => {
    const { data } = await api.post('/library/fine-periods', payload);
    return data.data as FinePeriodCreateResult;
  }, []);

  const cancelFinePeriod = useCallback(async (id: string, reason: string) => {
    const { data } = await api.post(`/library/fine-periods/${id}/cancel`, { reason });
    return data.data as FinePeriodView;
  }, []);

  return {
    listPendingFines, getStudentFines, createPayment, listPayments, getPayment, voidPayment, getPaymentSummary,
    requestWaiver, listWaivers, approveWaiver, rejectWaiver,
    listFinePeriods, previewFinePeriod, createFinePeriod, cancelFinePeriod,
  };
}
