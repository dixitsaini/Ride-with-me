# ADR-001: Phase 0 foundation baseline

## Context

The repository begins as an empty project root with architecture guidance but no implementation. To begin feature work safely, the project must establish a minimal cross-platform React Native / Expo foundation before product modules are added.

## Decision

We will initialize the foundation with shared React Native / Expo capabilities, strict TypeScript, linting, testing, navigation, app shell, environment configuration, and core abstractions for network, storage, secure storage, logging, analytics, permissions, and notifications.

We will not implement product feature modules in this phase.

## Alternatives considered

1. Start with a feature-first implementation inside the product domain.
   - Rejected because the required foundation does not exist and cross-cutting infrastructure is missing.

2. Add a large number of abstractions immediately.
   - Rejected because this would violate the requirement to avoid unnecessary abstractions.

## Consequences

- Product work will remain blocked until the foundation is validated.
- Architecture boundaries are clearer and reusable for future feature modules.
- The project is ready to add domain features in the correct order without inventing missing infrastructure.
