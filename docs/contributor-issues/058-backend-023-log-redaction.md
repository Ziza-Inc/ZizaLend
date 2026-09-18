---
title: "Redact secrets and personal data from logs"
area: backend
difficulty: intermediate
labels: ["backend", "security"]
---

## Context

The logger and the request logger are used across the codebase. Request bodies, headers, and error objects routinely contain signed transaction XDR, bearer tokens, and wallet addresses. An error log that prints the whole request prints all of that, and logs are the least carefully stored data in most systems.

## Task

- Add a redaction pass with a declared list of sensitive field names and patterns
- Redact at the logger boundary so a call site cannot forget
- Cover headers, bodies, query strings, and error objects
- Add a test asserting a known-sensitive value does not appear in serialised output

## Definition of Done

- A test asserting a token is absent from the log output passes
- The redaction list is documented and includes the fields the audit found

## Relevant files

- `backend/src/utils/logger.ts`
- `backend/src/middleware/requestLogger.ts`
