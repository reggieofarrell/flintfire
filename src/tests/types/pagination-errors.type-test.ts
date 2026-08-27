/**
 * Compile-only contract for the public pagination cursor error exports.
 * Checked by `npm run test:types`; this file is never executed.
 */
import { InvalidPaginationCursorError, type InvalidPaginationCursorReason } from '../../index.js';

const reasons = [
  'malformed',
  'source_mismatch',
  'stale',
] as const satisfies readonly InvalidPaginationCursorReason[];
void reasons;

export function handleCursorError(error: InvalidPaginationCursorError): string {
  const reason: InvalidPaginationCursorReason = error.reason;

  switch (reason) {
    case 'malformed':
      return 'restart';
    case 'source_mismatch':
      return 'reject';
    case 'stale':
      return 'refresh';
  }
}

// @ts-expect-error the public reason union rejects unknown categories
new InvalidPaginationCursorError('expired');
