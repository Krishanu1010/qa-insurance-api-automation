import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';

export type PolicyRow = {
  id: string;
  policyholder_id: string;
  type: string;
  status: string;
  effective_date: string;
  coverage_amount: number;
};

export type ClaimRow = {
  id: string;
  policy_id: string;
  status: string;
  incident_date: string;
  claimed_amount: number;
};

async function openSnapshot() {
  const databasePath = resolve(process.cwd(), '.runtime', 'northstar.sqlite');
  const bytes = new Uint8Array(readFileSync(databasePath));
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  return new SQL.Database(bytes);
}

// This helper only reads the API's local SQLite snapshot; it is not a general application database client.
export async function readPolicyRow(id: string): Promise<PolicyRow | undefined> {
  const database = await openSnapshot();
  try {
    const statement = database.prepare('SELECT id, policyholder_id, type, status, effective_date, coverage_amount FROM policies WHERE id = ?');
    statement.bind([id]);
    const row = statement.step() ? statement.getAsObject() as unknown as PolicyRow : undefined;
    statement.free();
    return row;
  } finally {
    database.close();
  }
}

export async function readClaimRow(id: string): Promise<ClaimRow | undefined> {
  const database = await openSnapshot();
  try {
    const statement = database.prepare('SELECT id, policy_id, status, incident_date, claimed_amount FROM claims WHERE id = ?');
    statement.bind([id]);
    const row = statement.step() ? statement.getAsObject() as unknown as ClaimRow : undefined;
    statement.free();
    return row;
  } finally {
    database.close();
  }
}
