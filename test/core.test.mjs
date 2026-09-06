import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../core/store.mjs";
import { calculate, evaluate } from "../core/calculator.mjs";
import { csv, documentHTML } from "../core/export.mjs";
const seeds = JSON.parse(
  readFileSync(new URL("../seed/templates.json", import.meta.url)),
);
const fixtures = JSON.parse(
  readFileSync(new URL("./parity.json", import.meta.url)),
);
const input = {
  client_name: "Test client",
  quotation_date: "2026-09-06",
  status: "draft",
  loan_amount: 500000,
  ccm_search_amount: 0,
  finance_legal_fee: false,
  finance_insurance: false,
};
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "chai-test-")),
    path = join(dir, "chai.sqlite"),
    store = new Store(path);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const template = store
    .rpc("templates.list")
    .find((t) => t.code === "loan-refinance-title");
  return { dir, path, store, template };
}
for (const fixture of fixtures)
  test(`Laravel parity: ${fixture.code} @ ${fixture.input.loan_amount}`, () => {
    const t = seeds.find((s) => s.code === fixture.code),
      actual = calculate(t, fixture.input);
    assert.deepEqual(actual.summary, fixture.summary);
    assert.deepEqual(
      actual.items
        .map(({ code, amount, sst_applicable }) => ({
          code,
          amount,
          sst_applicable,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      fixture.items.sort((a, b) => a.code.localeCompare(b.code)),
    );
  });
test("high loan needs negotiated rate, bounds and insurance basis", () => {
  const t = seeds[0];
  assert.throws(
    () => calculate(t, { ...input, loan_amount: 8000000 }),
    /Negotiated/,
  );
  assert.throws(
    () =>
      calculate(t, {
        ...input,
        loan_amount: 8000000,
        negotiated_legal_fee_rate: 0.011,
      }),
    /exceed/,
  );
  const r = calculate(t, {
    ...input,
    loan_amount: 8000000,
    negotiated_legal_fee_rate: 0.005,
    finance_legal_fee: true,
    legal_fee_financed_amount: 1000,
    finance_insurance: true,
    insurance_financed_amount: 9999,
  });
  assert.equal(r.items[0].amount, 78750);
  assert.equal(r.summary.stamp_duty_basis, 8001000);
  assert.equal(r.summary.total_financing, 8010999);
});
test("reject invalid input and cyclic rules; all fee methods", () => {
  for (const amount of [-1, NaN, Infinity, "", null])
    assert.throws(() => calculate(seeds[0], { ...input, loan_amount: amount }));
  assert.equal(
    evaluate(
      { method: "per_unit", basis: "n", unit_size: 1000, amount: 3 },
      { n: 1001 },
    ),
    6,
  );
  assert.equal(
    evaluate(
      {
        method: "first_additional",
        basis: "n",
        amount: 500,
        additional_amount: 100,
      },
      { n: 3 },
    ),
    700,
  );
  assert.equal(
    evaluate(
      {
        method: "banded",
        basis: "n",
        bands: [
          { up_to: 5, amount: 1 },
          { up_to: null, amount: 2 },
        ],
      },
      { n: 6 },
    ),
    2,
  );
  assert.equal(
    evaluate(
      {
        method: "conditional",
        cases: [{ when: { kind: "a" }, rule: { method: "fixed", amount: 7 } }],
      },
      { kind: "a" },
    ),
    7,
  );
  const t = structuredClone(seeds[1]);
  t.rules.sections[0].items[0].input_bindings = { x: "item:missing" };
  assert.throws(() => calculate(t, input), /circular/);
});
test("protected calculations, custom fees and hidden tax", () => {
  const t = seeds[0],
    r = calculate(t, input),
    fee = r.items[0];
  const modified = calculate(t, {
    ...input,
    line_overrides: [
      { ...fee, amount: 1, amount_overridden: true, hidden: true },
      {
        code: "custom_test",
        description: "Additional",
        amount: 100,
        category: "professional",
        sst_applicable: true,
      },
    ],
  });
  assert.equal(modified.items.find((i) => i.code === fee.code).amount, 6250);
  assert.equal(
    modified.summary.professional_fees,
    r.summary.professional_fees - 6250 + 100,
  );
  assert.equal(modified.summary.sst, r.summary.sst - 500 + 8);
});
test("personal workspace opens without authentication or user tables", (t) => {
  const { store, template } = setup(t);
  const q = store.rpc("quotations.save", { template_id: template.id, input });
  assert.equal(store.rpc("quotations.list").length, 1);
  assert.equal(store.rpc("quotations.get", { id: q.id }).number, q.number);
  assert.equal(
    store.db.prepare("SELECT name FROM sqlite_master WHERE name='users'").get(),
    undefined,
  );
  assert.throws(() => store.rpc("auth.register", {}), /Unsupported/);
});
test("snapshots, template versions, stale edits and deletion", (t) => {
  const { store, template } = setup(t);
  let q = store.rpc("quotations.save", { template_id: template.id, input });
  const original = q.calculation.summary.total_payable;
  const edited = structuredClone(template);
  edited.rules.professional_fixed[0].amount = 999;
  const v2 = store.rpc("templates.save", { template: edited });
  assert.equal(v2.version, 2);
  assert.throws(
    () => store.rpc("templates.save", { template: edited }),
    /newer/,
  );
  q = store.rpc("quotations.save", {
    id: q.id,
    revision: 1,
    input: { ...input, client_name: "Updated" },
  });
  assert.equal(q.calculation.summary.total_payable, original);
  assert.equal(q.calculation.template_snapshot.version, 1);
  assert.throws(
    () => store.rpc("quotations.save", { id: q.id, revision: 1, input }),
    /changed elsewhere/,
  );
  assert.throws(
    () => store.rpc("quotations.delete", { id: q.id, revision: 1 }),
    /changed/,
  );
  store.rpc("quotations.delete", { id: q.id, revision: 2 });
  assert.equal(store.rpc("quotations.list", {}).length, 0);
});
test("consistent online backup reopens with quotations", async (t) => {
  const { store, dir, template } = setup(t);
  const q = store.rpc("quotations.save", { template_id: template.id, input }),
    file = join(dir, "backup.sqlite");
  await store.backupTo(file);
  assert.ok(existsSync(file));
  await assert.rejects(store.backupTo(file), /overwritten/);
  const restored = new Store(file);
  try {
    assert.equal(restored.rpc("quotations.get", { id: q.id }).number, q.number);
  } finally {
    restored.close();
  }
});
test("exports escape client HTML and spreadsheet formulas", (t) => {
  const { store, template } = setup(t);
  const q = store.rpc("quotations.save", {
    template_id: template.id,
    input: {
      ...input,
      client_name: '=HYPERLINK("bad") <script>alert(1)</script>',
    },
  });
  assert.ok(documentHTML(q).includes("&lt;script&gt;"));
  assert.ok(!documentHTML(q).includes("<script>"));
  assert.ok(csv(q).includes("'=HYPERLINK"));
});
test("original template editor: update, draft, activation, deletion preserve quotation snapshots", (t) => {
  const { store, template } = setup(t),
    q = store.rpc("quotations.save", { template_id: template.id, input });
  const rules = structuredClone(template.rules);
  rules.professional_fixed[0].amount = 450;
  const updated = store.rpc("templates.update", {
    id: template.id,
    revision: 1,
    name: template.name,
    rules,
  });
  assert.equal(updated.revision, 2);
  assert.throws(
    () =>
      store.rpc("templates.update", {
        id: template.id,
        revision: 1,
        name: template.name,
        rules,
      }),
    /changed/,
  );
  assert.equal(
    store
      .rpc("quotations.get", { id: q.id })
      .calculation.items.find((i) => i.code === "discharge").amount,
    400,
  );
  let draft = store.rpc("templates.draft", {
    id: template.id,
    revision: 2,
    change_note: "New scale",
  });
  assert.equal(draft.status, "draft");
  assert.equal(draft.version, 2);
  draft = store.rpc("templates.activate", { id: draft.id, revision: 1 });
  assert.equal(draft.status, "active");
  assert.equal(store.template(template.id).status, "superseded");
  store.rpc("templates.delete", { id: draft.id, revision: draft.revision });
  assert.equal(store.template(template.id).status, "active");
});
test("template comparison calculates accurate before/after deltas", (t) => {
  const { store, template } = setup(t),
    rules = structuredClone(template.rules);
  rules.professional_fixed[0].amount += 100;
  const impact = store.rpc("templates.impact", {
    id: template.id,
    rules,
    inputs: input,
  });
  assert.equal(impact.total_delta, 108);
  assert.equal(impact.items.find((i) => i.code === "discharge").delta, 100);
});
test("actual XLSX round trip retains text, numeric totals and excludes hidden lines", async (t) => {
  const { store, template } = setup(t);
  const { xlsx } = await import("../core/export.mjs");
  const { default: ExcelJS } = await import("exceljs");
  const q = store.rpc("quotations.save", {
    template_id: template.id,
    input: { ...input, client_name: "=1+1" },
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await xlsx(q));
  const sheet = workbook.worksheets[0];
  let found = false;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === "Total payable") {
      assert.equal(row.getCell(2).value, q.calculation.summary.total_payable);
      found = true;
    }
  });
  assert.ok(found);
  assert.equal(sheet.getCell("A5").type, 3);
});
test("opening missing or unrelated database never silently creates a new workspace", (t) => {
  const { dir } = setup(t),
    missing = join(dir, "missing.sqlite");
  assert.throws(() => new Store(missing, { create: false }), /missing/);
  assert.equal(existsSync(missing), false);
});
