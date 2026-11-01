import { getDatabaseProvider } from "./provider";
import * as sqlitePageduel from "./pageduel.schema";
import * as pgPageduel from "./pg/pageduel.schema";

// Same provider switch as ./schema.ts, kept here so upstream's barrel stays untouched.
const table =
  getDatabaseProvider() === "postgres"
    ? pgPageduel.pageduelConnections
    : sqlitePageduel.pageduelConnections;

export const pageduelConnections: typeof sqlitePageduel.pageduelConnections =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by schema-parity.test.ts
  table as unknown as typeof sqlitePageduel.pageduelConnections;
