import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { calculate } from "./calculator.mjs";
import { templateOperation } from "./templates.mjs";
const seeds = JSON.parse(
  readFileSync(new URL("../seed/templates.json", import.meta.url), "utf8"),
);
export class Store {
  constructor(path, { create = true } = {}) {
    this.path = resolve(path);
    if (!create && !existsSync(this.path))
      throw new Error("Database file is missing.");
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new DatabaseSync(this.path);
    try {
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
      const version = this.db.prepare("PRAGMA user_version").get().user_version;
      if (version > 2)
        throw new Error(
          "This database needs a newer version of Chai Associates.",
        );
      if (version === 0) {
        if (!create)
          throw new Error(
            "Choose an existing Chai Associates desktop database.",
          );
        const tables = this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all();
        if (tables.length)
          throw new Error("This is not a Chai Associates desktop database.");
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE templates(id TEXT PRIMARY KEY,code TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(code,version));
          CREATE TABLE quotations(id TEXT PRIMARY KEY,number TEXT UNIQUE NOT NULL,client_name TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
          CREATE INDEX quotations_updated ON quotations(updated_at);
          PRAGMA user_version=2;
        `);
        try {
          for (const template of seeds)
            this.insertTemplate({ ...template, version: 1 });
          this.db.exec("COMMIT");
        } catch (e) {
          this.db.exec("ROLLBACK");
          throw e;
        }
      }
      // Migrate the earlier account-based prototype without losing any quotation.
      if (version === 1)
        this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE personal_quotations(id TEXT PRIMARY KEY,number TEXT UNIQUE NOT NULL,client_name TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        INSERT INTO personal_quotations SELECT id,number,client_name,status,revision,body,created_at,updated_at FROM quotations;
        DROP TABLE quotations;
        ALTER TABLE personal_quotations RENAME TO quotations;
        DROP TABLE users;
        CREATE INDEX quotations_updated ON quotations(updated_at);
        PRAGMA user_version=2;
        COMMIT;
      `);
      // Validate the application schema before accepting a selected database path.
      this.db.prepare(
        "SELECT id,code,name,version,body,created_at FROM templates LIMIT 0",
      );
      this.db.prepare(
        "SELECT id,number,client_name,status,revision,body,created_at,updated_at FROM quotations LIMIT 0",
      );
      if (this.db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw new Error("Database integrity check failed.");
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  async backupTo(path) {
    if (existsSync(path))
      throw new Error(
        "Choose a new backup filename; existing files will not be overwritten.",
      );
    await backup(this.db, path);
    return path;
  }
  insertTemplate(t) {
    const id = randomUUID();
    const value = {
      status: "active",
      revision: 1,
      effective_from: "2026-04-01",
      ...t,
      id,
    };
    this.db
      .prepare("INSERT INTO templates VALUES(?,?,?,?,?,?)")
      .run(
        id,
        t.code,
        t.name,
        t.version,
        JSON.stringify(value),
        new Date().toISOString(),
      );
    return value;
  }
  template(id) {
    const row = this.db
      .prepare("SELECT body FROM templates WHERE id=?")
      .get(String(id));
    if (!row) throw new Error("Template not found.");
    return JSON.parse(row.body);
  }
  quote(id) {
    const row = this.db
      .prepare("SELECT * FROM quotations WHERE id=?")
      .get(String(id));
    if (!row) throw new Error("Quotation not found.");
    return {
      ...JSON.parse(row.body),
      id: row.id,
      number: row.number,
      revision: row.revision,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
  rpc(method, args = {}) {
    if (
      [
        "templates.update",
        "templates.draft",
        "templates.activate",
        "templates.delete",
        "templates.impact",
        "rules.simulate",
      ].includes(method)
    )
      return templateOperation(this, method, args);
    switch (method) {
      case "templates.list":
        return this.db
          .prepare("SELECT body FROM templates ORDER BY code,version DESC")
          .all()
          .map((r) => JSON.parse(r.body));
      case "templates.save": {
        const t = args.template;
        if (
          !t ||
          !String(t.name || "").trim() ||
          !/^[-a-z0-9]{3,100}$/.test(t.code)
        )
          throw new Error("Template name and a valid code are required.");
        if (JSON.stringify(t).length > 1000000)
          throw new Error("Template is too large.");
        calculate(t, {
          loan_amount: 500000,
          ccm_search_amount: 0,
          finance_legal_fee: false,
          finance_insurance: false,
          ...args.sample_inputs,
        });
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const current =
            this.db
              .prepare(
                "SELECT MAX(version) AS version FROM templates WHERE code=?",
              )
              .get(t.code).version || 0;
          if (current !== Number(t.version || 0))
            throw new Error(
              "A newer template version exists. Reload before saving.",
            );
          const result = this.insertTemplate({
            code: t.code,
            name: t.name.trim(),
            rules: t.rules,
            catalog_sections: t.catalog_sections || [],
            version: current + 1,
          });
          this.db.exec("COMMIT");
          return result;
        } catch (e) {
          this.db.exec("ROLLBACK");
          throw e;
        }
      }
      case "quotations.list":
        return this.db
          .prepare(
            "SELECT id,number,client_name,status,revision,created_at,updated_at,body FROM quotations ORDER BY updated_at DESC",
          )
          .all()
          .map(({ body, ...r }) => ({
            ...r,
            total: JSON.parse(body).calculation.summary.total_payable,
            template_name: JSON.parse(body).calculation.template_snapshot.name,
            input: JSON.parse(body).input,
            calculation_summary: JSON.parse(body).calculation.summary,
            template_code: JSON.parse(body).calculation.template_snapshot.code,
          }));
      case "quotations.get":
        return this.quote(args.id);
      case "quotations.calculate": {
        const template = args.id
          ? this.quote(args.id).calculation.template_snapshot
          : this.template(args.template_id);
        return calculate(template, args.input);
      }
      case "quotations.save": {
        const input = args.input;
        if (
          !input ||
          !String(input.client_name || "").trim() ||
          String(input.client_name).length > 255
        )
          throw new Error("Client name is required (maximum 255 characters).");
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(input.quotation_date || "") ||
          Number.isNaN(Date.parse(input.quotation_date)) ||
          new Date(input.quotation_date).toISOString().slice(0, 10) !==
            input.quotation_date
        )
          throw new Error("Quotation date is required.");
        if (!["draft", "issued"].includes(input.status))
          throw new Error("Invalid quotation status.");
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const old = args.id ? this.quote(args.id) : null;
          if (old && old.revision !== args.revision)
            throw new Error(
              "This quotation was changed elsewhere. Reopen it before saving.",
            );
          const template = old
              ? old.calculation.template_snapshot
              : this.template(args.template_id),
            calculation = calculate(template, input);
          const id = old?.id || randomUUID(),
            number =
              old?.number ||
              `CA-${new Date().getFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`,
            now = new Date().toISOString(),
            revision = (old?.revision || 0) + 1;
          const body = JSON.stringify({ input, calculation });
          if (old)
            this.db
              .prepare(
                "UPDATE quotations SET client_name=?,status=?,revision=?,body=?,updated_at=? WHERE id=?",
              )
              .run(
                input.client_name.trim(),
                input.status,
                revision,
                body,
                now,
                id,
              );
          else
            this.db
              .prepare("INSERT INTO quotations VALUES(?,?,?,?,?,?,?,?)")
              .run(
                id,
                number,
                input.client_name.trim(),
                input.status,
                revision,
                body,
                now,
                now,
              );
          this.db.exec("COMMIT");
          return this.quote(id);
        } catch (e) {
          this.db.exec("ROLLBACK");
          throw e;
        }
      }
      case "quotations.delete": {
        const q = this.quote(args.id);
        if (q.revision !== args.revision)
          throw new Error("Quotation changed. Reopen it first.");
        this.db.prepare("DELETE FROM quotations WHERE id=?").run(q.id);
        return true;
      }
      default:
        throw new Error("Unsupported operation.");
    }
  }
}
