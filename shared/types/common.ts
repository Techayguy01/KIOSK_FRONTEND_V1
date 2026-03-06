/**
 * File: shared/types/common.ts
 * Purpose: Pure shared TypeScript types used by both frontend and backend.
 *
 * These are NOT Zod schemas. For validated contracts (with Zod), see shared/contracts/.
 * For API request/response shapes, see shared/contracts/api.contract.ts.
 *
 * Both frontend and backend can import from this file safely.
 */

// ─── Branded ID Types ───────────────────────────────────────────────────────
// Using branded types prevents accidental cross-type ID assignments.

export type TenantId = string & { readonly __brand: 'TenantId' };
export type RoomId = string & { readonly __brand: 'RoomId' };
export type BookingId = string & { readonly __brand: 'BookingId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

// ─── Guest Info ──────────────────────────────────────────────────────────────

export interface GuestInfo {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    idNumber?: string;
}

// ─── Generic API Response Wrapper ────────────────────────────────────────────
// All backend HTTP responses should conform to this shape.

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    requestId?: string;
}

// ─── Currency ────────────────────────────────────────────────────────────────

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR' | (string & {});

export interface MonetaryAmount {
    value: number;
    currency: CurrencyCode;
}

// ─── Date Helpers ────────────────────────────────────────────────────────────
// ISO 8601 date strings (YYYY-MM-DD) used for check-in/check-out.

export type IsoDateString = string; // e.g. "2025-03-15"
