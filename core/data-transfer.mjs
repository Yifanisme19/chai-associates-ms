import { DatabaseSync } from "node:sqlite";
import { readFileSync, statSync, writeFileSync } from "node:fs";

export const FORMAT = "chai-associates-desktop";
const fail = (message) => {
  throw new Error(`Invalid import: ${message}`);
};
const object = (x) => x && typeof x === "object" && !Array.isArray(x);
const text = (v, max = 1000) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const number = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
function validateTemplate(t) {
  if (
    !object(t) ||
    !text(t.id) ||
    !text(t.code) ||
    !text(t.name) ||
    !Number.isInteger(t.version) ||
    t.version < 1 ||
    !object(t.rules)
  )
    fail("malformed template.");
  if (!number(t.rules.sst_rate) || t.rules.sst_rate > 1)
    fail("invalid template tax rate.");
  if (t.rules.sections) {
    if (!Array.isArray(t.rules.sections)) fail("invalid template sections.");
    const codes = new Set();
    for (const s of t.rules.sections) {
      if (
        !text(s.code) ||
        !text(s.name) ||
        !["professional", "disbursement"].includes(s.category) ||
        !Array.isArray(s.items)
      )
        fail("invalid template section.");
      for (const i of s.items) {
        if (
          !text(i.code) ||
          !text(i.description) ||
          codes.has(i.code) ||
          !["fixed", "manual", "rule"].includes(i.source)
        )
          fail("invalid or duplicate fee line.");
        codes.add(i.code);
      }
    }
  } else if (
    !object(t.rules.legal_fee) ||
    !object(t.rules.charge_fee) ||
    !Array.isArray(t.rules.professional_fixed) ||
    !Array.isArray(t.rules.disbursements)
  )
    fail("missing fee rules.");
  if (t.catalog_sections != null && !Array.isArray(t.catalog_sections))
    fail("invalid rule catalogue.");
}
export function validateData(data) {
  if (
    !object(data) ||
    data.format !== FORMAT ||
    data.version !== 1 ||
    !Array.isArray(data.templates) ||
    !Array.isArray(data.quotations)
  )
    fail("choose a Chai desktop SQLite backup or JSON export.");
  if (data.templates.length > 10000 || data.quotations.length > 100000)
    fail("too many records.");
  const tids = new Set(),
    versions = new Set(),
    qids = new Set(),
    numbers = new Set();
  for (const row of data.templates) {
    if (!object(row) || !text(row.body, 2e6) || !text(row.created_at))
      fail("invalid template record.");
    let t;
    try {
      t = JSON.parse(row.body);
    } catch {
      fail("template JSON is unreadable.");
    }
    validateTemplate(t);
    if (
      row.id !== t.id ||
      row.code !== t.code ||
      row.name !== t.name ||
      row.version !== t.version ||
      tids.has(row.id) ||
      versions.has(`${row.code}/${row.version}`)
    )
      fail("duplicate or inconsistent template.");
    tids.add(row.id);
    versions.add(`${row.code}/${row.version}`);
  }
  for (const row of data.quotations) {
    if (
      !object(row) ||
      !text(row.id) ||
      !text(row.number) ||
      !text(row.client_name) ||
      !text(row.created_at) ||
      !text(row.updated_at) ||
      !Number.isInteger(row.revision) ||
      row.revision < 1 ||
      !["draft", "issued"].includes(row.status) ||
      !text(row.body, 4e6) ||
      qids.has(row.id) ||
      numbers.has(row.number)
    )
      fail("duplicate or invalid quotation.");
    let q;
    try {
      q = JSON.parse(row.body);
    } catch {
      fail("quotation JSON is unreadable.");
    }
    if (
      !object(q.input) ||
      !object(q.calculation) ||
      !object(q.calculation.summary) ||
      !Array.isArray(q.calculation.items) ||
      !text(q.input.client_name) ||
      q.input.client_name.trim() !== row.client_name ||
      q.input.status !== row.status
    )
      fail("inconsistent quotation data.");
    validateTemplate(q.calculation.template_snapshot);
    for (const key of [
      "professional_fees",
      "disbursements",
      "sst",
      "total_payable",
      "stamp_duty_basis",
      "total_financing",
    ])
      if (!number(q.calculation.summary[key]))
        fail("invalid quotation totals.");
    const codes = new Set();
    for (const item of q.calculation.items) {
      if (
        !text(item.code) ||
        !text(item.description) ||
        !number(item.amount) ||
        codes.has(item.code)
      )
        fail("invalid quotation fee.");
      codes.add(item.code);
    }
    qids.add(row.id);
    numbers.add(row.number);
  }
  return data;
}
export function snapshot(store) {
  const db = store.db;
  db.exec("BEGIN");
  try {
    const data = {
      format: FORMAT,
      version: 1,
      exported_at: new Date().toISOString(),
      templates: db
        .prepare("SELECT * FROM templates ORDER BY code,version")
        .all(),
      quotations: db
        .prepare("SELECT * FROM quotations ORDER BY created_at,id")
        .all(),
    };
    validateData(data);
    db.exec("COMMIT");
    return data;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function readImport(path) {
  if (statSync(path).size > 100 * 1024 * 1024)
    fail("file exceeds the 100 MB import limit.");
  if (path.toLowerCase().endsWith(".json")) {
    let data;
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      fail("file is not valid JSON.");
    }
    return validateData(data);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA user_version").get().user_version !== 2)
      fail("unsupported SQLite schema version.");
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      fail("SQLite integrity check failed.");
    return snapshot({ db });
  } finally {
    db.close();
  }
}
export function exportJSON(store, path) {
  writeFileSync(path, JSON.stringify(snapshot(store), null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  return path;
}
function same(a, b) {
  return a.body === b.body && a.id === b.id;
}
export function mergePlan(store, data) {
  const plan = { templates: [], quotations: [], skipped: 0, conflicts: [] };
  for (const row of data.templates) {
    const old = store.db
      .prepare("SELECT * FROM templates WHERE id=? OR (code=? AND version=?)")
      .all(row.id, row.code, row.version);
    if (!old.length) plan.templates.push(row);
    else if (old.length === 1 && same(old[0], row)) plan.skipped++;
    else
      plan.conflicts.push({
        type: "Template",
        name: `${row.name} · v${row.version}`,
      });
  }
  for (const row of data.quotations) {
    const old = store.db
      .prepare("SELECT * FROM quotations WHERE id=? OR number=?")
      .all(row.id, row.number);
    if (!old.length) plan.quotations.push(row);
    else if (old.length === 1 && same(old[0], row)) plan.skipped++;
    else plan.conflicts.push({ type: "Quotation", name: row.number });
  }
  return plan;
}
function insertRows(store, data, normalizeActive) {
  const template = store.db.prepare(
      "INSERT INTO templates VALUES(?,?,?,?,?,?)",
    ),
    quote = store.db.prepare("INSERT INTO quotations VALUES(?,?,?,?,?,?,?,?)");
  // Multiple active versions would be ambiguous. Existing active versions keep priority on merge.
  for (const t of data.templates) {
    let body = t.body;
    const parsed = JSON.parse(body);
    if (normalizeActive && parsed.status === "active") {
      const active = store.db
        .prepare("SELECT body FROM templates WHERE code=?")
        .all(t.code)
        .some((x) => JSON.parse(x.body).status === "active");
      if (active) {
        parsed.status = "superseded";
        body = JSON.stringify(parsed);
      }
    }
    template.run(t.id, t.code, t.name, t.version, body, t.created_at);
  }
  for (const q of data.quotations)
    quote.run(
      q.id,
      q.number,
      q.client_name,
      q.status,
      q.revision,
      q.body,
      q.created_at,
      q.updated_at,
    );
}
export function applyImport(store, data, mode = "merge") {
  validateData(data);
  if (!["merge", "restore"].includes(mode))
    throw new Error("Invalid import mode.");
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const plan =
      mode === "merge"
        ? mergePlan(store, data)
        : {
            templates: data.templates,
            quotations: data.quotations,
            skipped: 0,
            conflicts: [],
          };
    if (mode === "restore")
      store.db.exec("DELETE FROM quotations; DELETE FROM templates;");
    insertRows(store, plan, mode === "merge");
    store.db.exec("COMMIT");
    return {
      templates: plan.templates.length,
      quotations: plan.quotations.length,
      skipped: plan.skipped,
      conflicts: plan.conflicts,
    };
  } catch (e) {
    store.db.exec("ROLLBACK");
    throw e;
  }
}
