# Architecture: Thin Interface Pattern

> Enginehaus routes all business logic through `CoordinationService`. Interface
> layers (MCP, CLI, REST) are thin translation layers that parse input, call the
> service, and format output.

## Why Structural Enforcement?

During development, Enginehaus accumulated architectural debt:
- Three entry points independently implemented database paths
- CLI operations bypassed audit events that MCP equivalents captured
- Session state accumulated because completion paths diverged

The root cause: **instructions can be forgotten, structure cannot**.

We fixed 128 direct storage calls, added 10 service methods, and consolidated
all interfaces to thin translation layers. Now we enforce it:

- ESLint blocks storage imports (structure)
- Parity tests catch divergence (verification)
- This document explains the pattern (documentation)

Structure > Instruction > Documentation - in that order of reliability.

## The Pattern

```
MCP Tools (101)    --\
CLI Commands (~30) ---+--> CoordinationService --> SQLiteStorageService --> DB
REST Endpoints (70) -/            |
                           CoordinationEngine
                           QualityService
                           TelemetryService
                           ConfigurationManager
                           EventOrchestrator
```

Each interface file does exactly three things:

1. **Parse input** - Extract params from tool args / CLI flags / request body
2. **Call CoordinationService** - One method call for the business operation
3. **Format response** - Serialize result for the protocol (JSON, stdout, HTTP)

No filtering, sorting, mapping, or orchestration in interface files.

## Adding a New Operation

1. **Add method to `CoordinationService`** (`src/core/services/coordination-service.ts`)
   - Contains all business logic, validation, event emission
   - Returns a typed result object

2. **Add thin handler in the interface layer**
   - MCP: `src/adapters/mcp/handlers/<group>-handlers.ts`
   - CLI: `src/bin/enginehaus.ts`
   - REST: `src/adapters/rest/server.ts`

3. **Add parity test** (`tests/parity/interface-parity.test.ts`)
   - Verify handler produces same data as direct service call

## Structural Enforcement

### ESLint: `no-restricted-imports`

Interface files (`src/adapters/**`, `src/bin/`, `src/index.ts`) cannot import
from `**/storage/*`. This prevents direct database access.

```javascript
// eslint.config.js
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['**/storage/*', '**/storage/**', '**/sqlite-storage*'],
    message: 'Interface files must use CoordinationService, not direct storage access.',
  }],
}]
```

**Bootstrap exception**: Entry points import `SQLiteStorageService` to create the
storage instance that `CoordinationService` needs. Each has an explicit
`eslint-disable-next-line` comment making the exception auditable.

### Parity Tests

`tests/parity/interface-parity.test.ts` verifies that MCP handlers produce the
same results as direct service calls for core operations:

- Create task
- List tasks (with filters)
- Log decision
- Get next task
- Complete task
- Quick handoff

### Verification

```bash
npm run lint     # ESLint catches storage imports in interfaces
npm test         # Parity tests catch data divergence
```

## Acceptable Exceptions

| Location | What | Why |
|----------|------|-----|
| Entry point bootstrap | `SQLiteStorageService` import | Creates the instance CoordinationService needs |
| REST artifacts | `storage.*` CRUD | Low priority; acceptable until service wrappers added |
| REST config | `ConfigurationManager` | ConfigManager IS a service layer |
| MCP `session_heartbeat` | `CoordinationEngine` direct | Engine is the correct layer for session ops |

See the storage adapter interface in `src/storage/storage-adapter.ts` for the full operation matrix.
