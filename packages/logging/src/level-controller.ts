import type { LogLevel } from '@atlas/platform-core';

export interface LevelResolutionInput {
  correlationId?: string | undefined;
  tenantId?: string | undefined;
  moduleId?: string | undefined;
}

export interface LevelOverridesSnapshot {
  /** The level the controller would fall back to if every override were cleared. */
  default: LogLevel;
  /** Current globally-set level (may equal default). */
  global: LogLevel;
  byModule: Readonly<Record<string, LogLevel>>;
  byTenant: Readonly<Record<string, LogLevel>>;
  byCorrelation: Readonly<Record<string, LogLevel>>;
}

/**
 * Resolves the active log level for a given execution context.
 * Precedence (highest to lowest):
 *
 *   1. correlationId override
 *   2. tenantId override
 *   3. moduleId override
 *   4. global level
 *   5. compile-time default
 *
 * Implementations may persist overrides (DB-backed) or hold them in
 * memory. This package ships InMemoryLevelController; future ports
 * can back overrides with control_plane.config or similar.
 */
export interface LevelController {
  resolve(input: LevelResolutionInput): LogLevel;
  setGlobal(level: LogLevel): void;
  /** null clears the override. */
  setModule(moduleId: string, level: LogLevel | null): void;
  /** null clears the override. */
  setTenant(tenantId: string, level: LogLevel | null): void;
  /** null clears the override. */
  setCorrelation(correlationId: string, level: LogLevel | null): void;
  snapshot(): LevelOverridesSnapshot;
}

export class InMemoryLevelController implements LevelController {
  private readonly defaultLevel: LogLevel;
  private global: LogLevel;
  private readonly byModule = new Map<string, LogLevel>();
  private readonly byTenant = new Map<string, LogLevel>();
  private readonly byCorrelation = new Map<string, LogLevel>();

  constructor(defaultLevel: LogLevel = 'info') {
    this.defaultLevel = defaultLevel;
    this.global = defaultLevel;
  }

  resolve(input: LevelResolutionInput): LogLevel {
    if (input.correlationId !== undefined) {
      const lvl = this.byCorrelation.get(input.correlationId);
      if (lvl !== undefined) return lvl;
    }
    if (input.tenantId !== undefined) {
      const lvl = this.byTenant.get(input.tenantId);
      if (lvl !== undefined) return lvl;
    }
    if (input.moduleId !== undefined) {
      const lvl = this.byModule.get(input.moduleId);
      if (lvl !== undefined) return lvl;
    }
    return this.global;
  }

  setGlobal(level: LogLevel): void {
    this.global = level;
  }

  setModule(moduleId: string, level: LogLevel | null): void {
    if (level === null) this.byModule.delete(moduleId);
    else this.byModule.set(moduleId, level);
  }

  setTenant(tenantId: string, level: LogLevel | null): void {
    if (level === null) this.byTenant.delete(tenantId);
    else this.byTenant.set(tenantId, level);
  }

  setCorrelation(correlationId: string, level: LogLevel | null): void {
    if (level === null) this.byCorrelation.delete(correlationId);
    else this.byCorrelation.set(correlationId, level);
  }

  snapshot(): LevelOverridesSnapshot {
    return {
      default: this.defaultLevel,
      global: this.global,
      byModule: Object.fromEntries(this.byModule),
      byTenant: Object.fromEntries(this.byTenant),
      byCorrelation: Object.fromEntries(this.byCorrelation),
    };
  }
}
