// A small stand-in for Cloudflare D1, backed by Node's built-in SQLite, so the API can be tested offline.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.sql'), 'utf8');

export function createDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);

  const clean = (args) => args.map((v) => (v === undefined ? null : v));

  function statement(sql, args = []) {
    return {
      sql,
      args,
      bind: (...a) => statement(sql, a),
      first: async () => sqlite.prepare(sql).get(...clean(args)) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...clean(args)), success: true }),
      run: async () => {
        const r = sqlite.prepare(sql).run(...clean(args));
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
  }

  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    raw: sqlite,
  };
}
