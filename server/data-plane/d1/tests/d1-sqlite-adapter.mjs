import { DatabaseSync } from "node:sqlite";

class BoundStatement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new BoundStatement(this.database, this.sql, bindings);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }

  async first(columnName) {
    const row = this.database.prepare(this.sql).get(...this.bindings) || null;
    if (columnName === undefined) return row;
    return row ? row[columnName] : null;
  }

  async all() {
    const results = this.database.prepare(this.sql).all(...this.bindings);
    return {
      success: true,
      results,
      meta: { changes: 0 },
    };
  }
}

export class D1SqliteAdapter {
  constructor(path = ":memory:") {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON");
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  prepare(sql) {
    return new BoundStatement(this.raw, sql);
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.raw.close();
  }
}

