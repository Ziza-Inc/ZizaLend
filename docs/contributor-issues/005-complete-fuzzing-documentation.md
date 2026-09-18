---
title: "Complete fuzzing documentation (fuzz_invariants.md and FUZZING_README.md)"
area: infrastructure
difficulty: beginner
labels: ["contracts", "documentation", "good first issue", "help wanted", "infrastructure"]
---


## Description

The fuzzing documentation files at `docs/fuzz_invariants.md` and `docs/FUZZING_README.md` are currently empty. These files should contain comprehensive documentation about:

1. The invariants that the fuzz testing suite checks
2. How to run the fuzz tests
3. How to interpret fuzz test results
4. How to add new fuzz targets

## Background

- Fuzz testing infrastructure exists at `contracts/fuzz/`
- Existing fuzz targets are in `contracts/fuzz/fuzz_targets/`
- Previous fuzz reports are in `contracts/fuzz/reports/`
- The contract state machine is documented at `docs/wiki/contract-state-machine.md`
- Architecture Decision Records at `docs/adr/` provide context on contract design

## Requirements

### docs/fuzz_invariants.md
Document the invariants that should hold true for each contract:
- **Lending Pool**: Share price never decreases, total deposits = sum of individual deposits
- **Loan Manager**: Loan states follow the state machine, interest accrues correctly
- **Remittance NFT**: NFT ownership is unique, score history is append-only
- **Multisig Governance**: Proposals follow lifecycle, votes are counted correctly

### docs/FUZZING_README.md
Document how to:
- Set up the fuzzing environment
- Run specific fuzz targets
- Interpret crash reports
- Add new fuzz targets
- Configure fuzzing parameters

## Definition of Done

- Both files contain meaningful, accurate documentation
- Documentation references existing code and configuration
- A contributor can follow the docs to run and extend the fuzz suite
