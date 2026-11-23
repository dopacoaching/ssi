import { useCallback } from 'react';
import api from '../utils/api';
import type { LoanView } from './useCirculation';

export type CopyStatus = 'AVAILABLE' | 'ISSUED' | 'LOST' | 'DAMAGED' | 'WITHDRAWN';

export interface BookCopy {
  id: string; campusId: string; bookId: string;
  catalogNumber: string; seq: number;
  status: CopyStatus;
  shelfLocation: string; remarks: string;
  withdrawnAt: string | null;
  withdrawnBy: { id: string; name: string } | null;
  withdrawReason: string;
  statusBeforeWithdraw?: 'AVAILABLE' | 'DAMAGED' | null;
  lostAt?: string | null; lostReason?: string; lostSource?: null | 'LOAN' | 'STOCK_CHECK';
  foundAt?: string | null; repairedAt?: string | null;
  loan?: {
    id: string; dueDate: string; isOverdue: boolean; daysLate: number; waivedDays?: number; lateFine?: number;
    student: { id: string; fullName: string; regNumber: string };
  } | null;
  createdAt: string; updatedAt: string;
}

export interface CopyCounts {
  total: number; AVAILABLE: number; ISSUED: number; LOST: number; DAMAGED: number; WITHDRAWN: number;
}

export interface Book {
  id: string; campusId: string;
  campus?: { id: string; name: string; code: string };
  title: string; author: string; category: string; publisher: string; edition: string; isbn: string; remarks: string;
  year: number | null; price: number | null;
  matchKey: string;
  copyCounts: CopyCounts;
  copies?: BookCopy[];
  createdAt: string; updatedAt: string;
}

export interface HistoryEntry {
  id: string; action: string; entity: 'Book' | 'BookCopy'; entityId: string;
  description: string; userName: string; userRole: string; createdAt: string;
}

export interface BookListQuery {
  q?: string; status?: string; category?: string; shelf?: string; campusId?: string;
  page?: number; limit?: number;
}

export interface BookListResult { items: Book[]; total: number; page: number; limit: number }

export interface BookPayload {
  campusId?: string;
  title: string; author?: string; category?: string; publisher?: string; edition?: string;
  year?: number | null; isbn?: string; price?: number | null; remarks?: string;
  copies?: number; shelfLocation?: string; copyRemarks?: string;
}

export type BookUpdatePayload = Partial<Pick<Book, 'title' | 'author' | 'category' | 'publisher' | 'edition' | 'isbn' | 'remarks'>> & {
  year?: number | null; price?: number | null;
};

export interface AddResult { book: Book; copies: BookCopy[] }

export type BulkResolution = { mode: 'new' } | { mode: 'existing'; bookId: string };

export interface BulkRow {
  rowNumber: number;
  title: string; author?: string; category?: string; publisher?: string; edition?: string;
  year?: number | string | null; isbn?: string; price?: number | string | null; remarks?: string;
  copies?: number | string;
  shelfLocation?: string;
  resolution?: BulkResolution;
}

export interface BulkRowResult {
  rowNumber: number;
  errors: string[];
  duplicates: { id: string; title: string; author: string; copyCount: number }[];
  duplicateInFile: number[];
}

export interface BulkValidation {
  valid: boolean;
  totalRows: number; totalCopies: number;
  rows: BulkRowResult[];
  newCategories: string[]; newShelves: string[];
  message?: string; // top-level server message (client-attached)
}

export interface BulkImportResult {
  createdBooks: number; addedToExisting: number;
  copies: (BookCopy & { title: string })[];
  addedCategories: string[]; addedShelves: string[];
}

export function useCatalog() {
  const listBooks = useCallback(async (params: BookListQuery) => {
    const clean: Record<string, string | number> = {};
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') clean[k] = v as string | number; });
    const { data } = await api.get('/library/books', { params: clean });
    return data.data as BookListResult;
  }, []);

  const findSimilar = useCallback(async (title: string, author?: string, campusId?: string) => {
    const params: Record<string, string> = { title };
    if (author) params.author = author;
    if (campusId) params.campusId = campusId;
    const { data } = await api.get('/library/books/similar', { params });
    return data.data as Book[];
  }, []);

  const getBook = useCallback(async (id: string) => {
    const { data } = await api.get(`/library/books/${id}`);
    return data.data as { book: Book; history: HistoryEntry[]; loans?: LoanView[] };
  }, []);

  const createBook = useCallback(async (payload: BookPayload) => {
    const { data } = await api.post('/library/books', payload);
    return data.data as AddResult;
  }, []);

  const addCopies = useCallback(async (bookId: string, payload: { count: number; shelfLocation?: string; remarks?: string }) => {
    const { data } = await api.post(`/library/books/${bookId}/copies`, payload);
    return data.data as AddResult;
  }, []);

  const updateBook = useCallback(async (id: string, payload: BookUpdatePayload) => {
    const { data } = await api.patch(`/library/books/${id}`, payload);
    return data.data as Book;
  }, []);

  const updateCopy = useCallback(async (id: string, payload: { shelfLocation?: string; remarks?: string }) => {
    const { data } = await api.patch(`/library/copies/${id}`, payload);
    return data.data as BookCopy;
  }, []);

  const withdrawCopy = useCallback(async (id: string, reason: string) => {
    const { data } = await api.post(`/library/copies/${id}/withdraw`, { reason });
    return data.data as BookCopy;
  }, []);

  const reinstateCopy = useCallback(async (id: string) => {
    const { data } = await api.post(`/library/copies/${id}/reinstate`);
    return data.data as BookCopy;
  }, []);

  const markFound = useCallback(async (id: string, note?: string) => {
    const { data } = await api.post(`/library/copies/${id}/found`, note ? { note } : {});
    return data.data as BookCopy & { loan?: LoanView | null };
  }, []);

  const markRepaired = useCallback(async (id: string, note?: string) => {
    const { data } = await api.post(`/library/copies/${id}/repair`, note ? { note } : {});
    return data.data as BookCopy;
  }, []);

  const validateBulk =useCallback(async (campusId: string | undefined, rows: BulkRow[]) => {
    const { data } = await api.post('/library/books/bulk/validate', { campusId, rows });
    return { ...(data.data as BulkValidation), message: data.message as string | undefined };
  }, []);

  const importBulk = useCallback(async (campusId: string | undefined, rows: BulkRow[]) => {
    const { data } = await api.post('/library/books/bulk/import', { campusId, rows });
    return data.data as BulkImportResult;
  }, []);

  return {
    listBooks, findSimilar, getBook, createBook, addCopies, updateBook, updateCopy,
    withdrawCopy, reinstateCopy, markFound, markRepaired, validateBulk, importBulk,
  };
}
