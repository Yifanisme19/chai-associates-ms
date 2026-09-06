import { calculate, evaluate, money } from "./calculator.mjs";
const sample = {
  loan_amount: 500000,
  ccm_search_amount: 0,
  finance_legal_fee: false,
  finance_insurance: false,
};
export function templateOperation(store, method, args) {
  if (method === "rules.simulate")
    return {
      amount: evaluate(args.rule, args.inputs),
      steps: [
        {
          description: "Structured rule result",
          amount: evaluate(args.rule, args.inputs),
        },
      ],
    };
  const current = store.template(args.id);
  if (method === "templates.impact") {
    const before = calculate(current, args.inputs),
      after = calculate({ ...current, rules: args.rules }, args.inputs);
    const codes = [
      ...new Set([...before.items, ...after.items].map((i) => i.code)),
    ];
    return {
      baseline: { version: current.version },
      candidate: { version: current.version },
      before: before.summary,
      after: after.summary,
      total_delta: money(
        after.summary.total_payable - before.summary.total_payable,
      ),
      items: codes.map((code) => {
        const a = before.items.find((i) => i.code === code),
          b = after.items.find((i) => i.code === code),
          av = a && !a.hidden ? a.amount : 0,
          bv = b && !b.hidden ? b.amount : 0;
        return {
          code,
          description: (b || a).description,
          status: !a
            ? "added"
            : !b
              ? "removed"
              : av === bv
                ? "unchanged"
                : "changed",
          before: av,
          after: bv,
          delta: money(bv - av),
        };
      }),
    };
  }
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const value = store.template(args.id);
    if ((value.revision || 1) !== args.revision)
      throw new Error("Template changed. Reload before saving.");
    const put = (t) =>
      store.db
        .prepare("UPDATE templates SET name=?,body=? WHERE id=?")
        .run(t.name, JSON.stringify(t), t.id);
    let result;
    if (method === "templates.update") {
      if (!String(args.name || "").trim() || args.name.length > 255)
        throw new Error("Template name is required (maximum 255 characters).");
      const updated = {
        ...value,
        name: args.name.trim(),
        rules: args.rules,
        change_note: args.change_note || "",
        effective_from: args.effective_from || value.effective_from,
        revision: (value.revision || 1) + 1,
      };
      calculate(updated, sample);
      put(updated);
      result = updated;
    } else if (method === "templates.draft") {
      const version =
        store.db
          .prepare("SELECT MAX(version) AS v FROM templates WHERE code=?")
          .get(value.code).v + 1;
      result = store.insertTemplate({
        ...value,
        version,
        status: "draft",
        revision: 1,
        change_note: args.change_note || "",
      });
    } else if (method === "templates.activate") {
      const siblings = store.db
        .prepare("SELECT body FROM templates WHERE code=?")
        .all(value.code)
        .map((r) => JSON.parse(r.body));
      for (const t of siblings) {
        t.status = t.id === value.id ? "active" : "superseded";
        t.revision = (t.revision || 1) + 1;
        put(t);
        if (t.id === value.id) result = t;
      }
    } else if (method === "templates.delete") {
      store.db.prepare("DELETE FROM templates WHERE id=?").run(value.id);
      const siblings = store.db
        .prepare(
          "SELECT body FROM templates WHERE code=? ORDER BY version DESC",
        )
        .all(value.code)
        .map((r) => JSON.parse(r.body));
      if (!siblings.some((t) => t.status === "active") && siblings.length) {
        siblings[0].status = "active";
        siblings[0].revision = (siblings[0].revision || 1) + 1;
        put(siblings[0]);
      }
      result = true;
    } else throw new Error("Unsupported template action.");
    store.db.exec("COMMIT");
    return result;
  } catch (e) {
    store.db.exec("ROLLBACK");
    throw e;
  }
}
