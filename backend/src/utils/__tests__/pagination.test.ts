import type { Request } from 'express';
import { MAX_OFFSET, parseQueryParams, parseCursorQueryParams } from '../pagination.js';

const mockRequest = (query: Record<string, unknown>): Request => ({ query }) as unknown as Request;

describe('parseQueryParams', () => {
  it('parses and caps limit and offset', () => {
    const result = parseQueryParams(mockRequest({ limit: '25', offset: '10' }));

    expect(result.limit).toBe(25);
    expect(result.offset).toBe(10);
  });

  it('caps limit at 100', () => {
    const result = parseQueryParams(mockRequest({ limit: '5000' }));

    expect(result.limit).toBe(100);
  });

  it('caps offset at MAX_OFFSET so deep pagination cannot force a full scan', () => {
    const result = parseQueryParams(mockRequest({ offset: '999999999' }));

    expect(result.offset).toBe(MAX_OFFSET);
  });

  it('falls back to defaults for negative, non-numeric, and missing values', () => {
    expect(parseQueryParams(mockRequest({ offset: '-5' })).offset).toBe(0);
    expect(parseQueryParams(mockRequest({ offset: 'abc' })).offset).toBe(0);
    expect(parseQueryParams(mockRequest({})).offset).toBe(0);
    expect(parseQueryParams(mockRequest({})).limit).toBe(50);
  });

  it('keeps cursor parsing free of offset semantics', () => {
    const result = parseCursorQueryParams(mockRequest({ cursor: 'abc', limit: '10' }));

    expect(result.cursor).toBe('abc');
    expect(result.limit).toBe(10);
  });
});
