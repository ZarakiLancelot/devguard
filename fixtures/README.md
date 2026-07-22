# DevGuard Test Fixtures

Deterministic test fixtures for DevGuard analysis modules.

## Purpose

These fixtures are **test data**, not independently runnable applications.
They provide controlled inputs for unit and integration tests of the
contract checker, risk analyzer, and test generator modules.

Git-backed temporary repositories will be created in later integration
tests (Milestone 12) for end-to-end CLI validation.

## Fixture Scenarios

### valid-contract

OpenAPI and TypeScript declarations match perfectly.

- **Expected findings:** none
- **Expected warnings:** none

### missing-property

OpenAPI requires `authorId` (integer) but the TypeScript declaration
does not include it.

- **Expected findings:** `contract.missing-property` (high)
- **Expected warnings:** none

### incompatible-type

OpenAPI defines `pageCount` as `integer` but TypeScript defines it
as `string`.

- **Expected findings:** `contract.incompatible-type` (critical)
- **Expected warnings:** none

### required-mismatch

OpenAPI marks `category` as required but TypeScript marks it optional
with `?`.

- **Expected findings:** `contract.required-mismatch` (high)
- **Expected warnings:** none

### missing-tests

A production TypeScript file (`book.ts`) is represented as
changed with no matching `.test.ts` or `.spec.ts` counterpart.

- **Expected findings:** `risk.missing-related-tests` (warning)
- **Expected warnings:** none
- **Note:** Since Git diff integration is not yet available, the intended
  changed-file context is documented in `expected.json`.

### unsupported-typescript

The TypeScript declaration uses `Pick` with generic wrappers, which are
explicitly outside the supported MVP subset.

- **Expected findings:** `contract.unsupported-type` (warning)
- **Expected warnings:** unsupported construct message

### malformed-openapi

The OpenAPI YAML file contains invalid syntax that prevents parsing.

- **Expected findings:** none
- **Expected warnings:** recoverable OpenAPI parse failure

## Structure

Each fixture directory contains:

```
fixture-name/
├── .devguard.yml          # Configuration for this scenario
├── backend/
│   └── docs/
│       └── openapi.yaml   # OpenAPI document
├── frontend/
│   └── src/
│       └── types/         # or services/
│           └── book.ts
└── expected.json          # Expected findings and warnings
```

## Domain

All fixtures use the **Book** domain to maintain consistency
and readability across scenarios.
