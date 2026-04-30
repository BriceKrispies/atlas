export interface CatalogStateRecord {
  tenantId: string;
  seedPackageKey: string;
  seedPackageVersion: string;
  payload: unknown;
  publishedRevisions: Record<string, number>;
}

export interface CatalogStateStore {
  get(tenantId: string): Promise<CatalogStateRecord | null>;
  put(record: CatalogStateRecord): Promise<void>;
}
