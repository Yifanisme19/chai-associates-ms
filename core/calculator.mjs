import { formulas } from "./descriptions.mjs";
export const money = (n) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export function nonnegative(n, label = "Amount") {
  if (
    n === "" ||
    n === null ||
    typeof n === "boolean" ||
    !Number.isFinite(Number(n)) ||
    Number(n) < 0 ||
    Number(n) > 1e12
  )
    throw new Error(`${label} must be a non-negative number below 1 trillion.`);
  return Number(n);
}
export function evaluate(rule, inputs, depth = 0) {
  if (depth > 15) throw new Error("Rule nesting is too deep.");
  const method = rule.method || "fixed";
  const value = ["fixed", "conditional"].includes(method)
    ? 0
    : nonnegative(inputs[rule.basis], rule.basis);
  let amount = 0;
  const num = (key, fallback = 0) => nonnegative(rule[key] ?? fallback, key);
  switch (method) {
    case "fixed":
      amount = num("amount");
      break;
    case "percentage":
      amount = value * num("rate");
      break;
    case "per_unit": {
      const unit = num("unit_size", 1);
      if (!unit) throw new Error("Unit size must be positive.");
      amount = Math.ceil(value / unit) * num("amount");
      break;
    }
    case "first_additional":
      amount =
        value > 0
          ? num("amount") +
            Math.max(0, Math.ceil(value) - 1) * num("additional_amount")
          : 0;
      break;
    case "tiered": {
      let lower = 0,
        covered = false;
      for (const tier of rule.tiers || []) {
        const upper = tier.up_to ?? Infinity;
        if (upper <= lower) throw new Error("Tier limits must increase.");
        amount +=
          Math.max(0, Math.min(value, upper) - lower) *
          nonnegative(tier.rate ?? 0, "Tier rate");
        if (value <= upper) {
          covered = true;
          break;
        }
        lower = upper;
      }
      if (!covered)
        throw new Error(
          "The fee scale does not cover this amount. Add a negotiated tier to the template.",
        );
      break;
    }
    case "banded": {
      const band = (rule.bands || []).find(
        (b) => b.up_to == null || value <= b.up_to,
      );
      if (!band) throw new Error("No fee band covers this amount.");
      amount = nonnegative(band.amount);
      break;
    }
    case "conditional": {
      const c = (rule.cases || []).find((c) =>
        Object.entries(c.when || {}).every(([k, v]) => inputs[k] === v),
      );
      if (!c) throw new Error("No rule matches these details.");
      amount = evaluate(c.rule, inputs, depth + 1);
      break;
    }
    default:
      throw new Error(`Unsupported calculation method: ${method}`);
  }
  if (rule.zero_when_basis_zero && value === 0) amount = 0;
  else {
    if (rule.minimum != null) amount = Math.max(amount, num("minimum"));
    if (rule.maximum != null) amount = Math.min(amount, num("maximum"));
  }
  return money(nonnegative(amount));
}
function structured(rules, catalog, inputs) {
  const definitions = Object.fromEntries(
    (catalog || []).flatMap((s) =>
      s.conditions.map((c) => [`${s.code}/${c.code}`, c]),
    ),
  );
  const pending = new Map();
  for (const section of rules.sections)
    for (const item of section.items) {
      if (pending.has(item.code))
        throw new Error("Template item identifiers must be unique.");
      pending.set(item.code, {
        section_code: section.code,
        section_name: section.name,
        category: section.category,
        sort_order: pending.size * 10,
        ...item,
      });
    }
  const resolved = new Map();
  while (pending.size) {
    let progress = false;
    for (const [code, item] of pending) {
      const context = { ...inputs, ...item.input_defaults };
      let ready = true;
      for (const [target, binding] of Object.entries(
        item.input_bindings || {},
      )) {
        if (binding.startsWith("item:")) {
          if (!resolved.has(binding.slice(5))) {
            ready = false;
            break;
          }
          context[target] = resolved.get(binding.slice(5)).amount;
        } else context[target] = inputs[binding];
      }
      if (!ready) continue;
      const source = item.source || "fixed",
        rule = item.formula || definitions[item.rule_ref];
      let amount;
      if (source === "rule") {
        if (!rule) throw new Error(`Missing rule for ${item.description}`);
        amount = evaluate(rule, context);
      } else if (source === "manual")
        amount = inputs[item.input_key || code] ?? item.amount ?? 0;
      else if (source === "fixed") amount = item.amount ?? 0;
      else throw new Error("Unsupported item source.");
      resolved.set(code, {
        ...item,
        amount: money(nonnegative(amount)),
        source: source === "rule" ? "calculated" : source,
        rule_snapshot: rule || null,
      });
      pending.delete(code);
      progress = true;
    }
    if (!progress)
      throw new Error("Template contains missing or circular item references.");
  }
  return [...resolved.values()].sort((a, b) => a.sort_order - b.sort_order);
}
export function calculate(template, input) {
  const rules = structuredClone(template.rules),
    loan = money(nonnegative(input.loan_amount, "Loan amount"));
  const ccm = money(nonnegative(input.ccm_search_amount ?? 0, "CCM search"));
  const legal = input.finance_legal_fee
    ? money(nonnegative(input.legal_fee_financed_amount, "Financed legal fee"))
    : 0;
  const insurance = input.finance_insurance
    ? money(nonnegative(input.insurance_financed_amount, "Financed insurance"))
    : 0;
  const basis = money(loan + legal);
  let items = [];
  if (rules.sections)
    items = structured(rules, template.catalog_sections, {
      ...input,
      loan_amount: loan,
      ccm_search_amount: ccm,
      loan_plus_financed_legal_fee: basis,
    });
  else {
    const conditions = Object.fromEntries(
      (template.catalog_sections || []).flatMap((s) =>
        s.conditions.map((c) => [`${s.code}/${c.code}`, c]),
      ),
    );
    const first = conditions["legal_transfer_non_hda/first_500k"],
      next = conditions["legal_transfer_non_hda/next_7m"],
      charge = conditions["charge_documents/charge_fee"],
      stamp = conditions["facility_stamp_duty/facility"];
    if (first) {
      rules.legal_fee.first_500k_rate = first.rate;
      rules.legal_fee.minimum = first.minimum;
    }
    if (next) rules.legal_fee.next_7m_rate = next.rate;
    if (charge) rules.charge_fee = charge;
    if (stamp) rules.facility_stamp_duty_rate = stamp.rate;
    let rate = 0;
    if (loan > 7500000) {
      rate = nonnegative(input.negotiated_legal_fee_rate, "Negotiated rate");
      if (rate > 0.01) throw new Error("Negotiated rate cannot exceed 1%.");
    }
    const fee = loan
      ? money(
          Math.max(
            rules.legal_fee.minimum,
            Math.min(loan, 500000) * rules.legal_fee.first_500k_rate +
              Math.min(Math.max(loan - 500000, 0), 7000000) *
                rules.legal_fee.next_7m_rate +
              Math.max(loan - 7500000, 0) * rate,
          ),
        )
      : 0;
    const sectionFor = (code) =>
      ["title_search", "bankruptcy_search", "ccm_search"].includes(code)
        ? ["searches", "Searches"]
        : /stamp|duplicate|letter_offer/.test(code)
          ? ["stamp_duties", "Stamp Duties (Subject to valuation)"]
          : /registration|form_19/.test(code)
            ? ["registration_fees", "Registration Fees (Subject to valuation)"]
            : ["others", "Others"];
    const add = (
      code,
      description,
      amount,
      category,
      sst = false,
      source = "fixed",
    ) => {
      const [section_code, section_name] =
        category === "professional"
          ? ["professional_fees", "PROFESSIONAL FEES:-"]
          : sectionFor(code);
      items.push({
        code,
        description,
        amount: money(nonnegative(amount)),
        category,
        sst_applicable: sst,
        source,
        section_code,
        section_name,
        sort_order: items.length * 10,
      });
    };
    add(
      "facilities_agreement",
      "Facilities Agreement",
      fee,
      "professional",
      true,
      "calculated",
    );
    add(
      "charge",
      "Form 16A and Charge Annexure",
      loan
        ? Math.min(
            Math.max(fee * rules.charge_fee.rate, rules.charge_fee.minimum),
            rules.charge_fee.maximum,
          )
        : 0,
      "professional",
      true,
      "calculated",
    );
    for (const i of rules.professional_fixed)
      add(i.code, i.description, i.amount, "professional", !!i.sst);
    for (const i of rules.disbursements)
      add(i.code, i.description, i.amount, "disbursement", !!i.sst);
    add("ccm_search", "CCM Search", ccm, "disbursement", false, "manual");
    add(
      "facility_stamp_duty",
      "Facilities Agreement (Original)",
      basis * rules.facility_stamp_duty_rate,
      "disbursement",
      false,
      "calculated",
    );
    const order = [
      "facilities_agreement",
      "charge",
      "discharge",
      "caveat_legal",
      "statutory_declaration_legal",
      "title_search",
      "bankruptcy_search",
      "ccm_search",
      "facility_stamp_duty",
      "facility_duplicate",
      "charge_stamp",
      "drr_stamp",
      "form_16n_stamp",
      "letter_offer",
      "statutory_declaration_stamp",
      "form_16a_registration",
      "form_16n_registration",
      "form_19b",
      "form_19g",
      "drr_filing",
      "admin_bank",
      "swearing",
      "courier",
      "printing",
      "transportation",
      "miscellaneous",
    ];
    const descriptions = {
      charge_stamp: "Form 16A and Charge Annexure",
      form_16a_registration: "Form 16A and Charge Annexure",
      drr_stamp: "Deed of Receipt and Reassignment",
      form_16n_stamp: "Form 16N",
      form_16n_registration: "Form 16N",
      statutory_declaration_stamp: "Statutory Declaration",
      form_19g: "Form 19G / Caveator's Consent",
    };
    for (const item of items) {
      item.sort_order = (order.indexOf(item.code) + 1) * 10;
      if (descriptions[item.code]) item.description = descriptions[item.code];
    }
  }
  items = items.map((i) => ({
    ...i,
    hidden: !!i.hidden,
    sst_applicable: !!i.sst_applicable,
    default_amount: i.amount,
    default_description: i.description,
    default_sst_applicable: !!i.sst_applicable,
    amount_overridden: false,
  }));
  const seen = new Set();
  for (const override of input.line_overrides || []) {
    if (seen.has(override.code)) throw new Error("Duplicate quotation line.");
    seen.add(override.code);
    const existing = items.find((i) => i.code === override.code);
    if (!existing && !override.code.startsWith("custom_"))
      throw new Error("Unknown quotation line.");
    const clean = {
      description: String(override.description || "").slice(0, 255),
      hidden: !!override.hidden,
      sst_applicable: !!override.sst_applicable,
      sort_order: nonnegative(override.sort_order ?? 0),
    };
    if (!clean.description) throw new Error("Line description is required.");
    if (existing) {
      const protectedAmount = [
        "facilities_agreement",
        "charge",
        "facility_stamp_duty",
      ].includes(existing.code);
      Object.assign(existing, clean);
      if (override.amount_overridden && !protectedAmount)
        Object.assign(existing, {
          amount: money(nonnegative(override.amount)),
          amount_overridden: true,
        });
    } else {
      if (!["professional", "disbursement"].includes(override.category))
        throw new Error("Invalid line category.");
      items.push({
        ...clean,
        code: override.code,
        category: override.category,
        section_code: override.section_code || "custom",
        section_name: override.section_name || "Additional items",
        source: "custom",
        amount: money(nonnegative(override.amount)),
        amount_overridden: true,
      });
    }
  }
  const categoryOrder = new Map(
    (rules.layout?.categories || []).map((c, i) => [c.code, i]),
  );
  const categoryKey = (i) =>
    rules.layout?.section_categories?.[i.section_code] || i.category;
  items.sort(
    (a, b) =>
      (categoryOrder.get(categoryKey(a)) ??
        (a.category === "professional" ? 0 : 1)) -
        (categoryOrder.get(categoryKey(b)) ??
          (b.category === "professional" ? 0 : 1)) ||
      a.sort_order - b.sort_order,
  );
  const visible = items.filter((i) => !i.hidden),
    sum = (a) => money(a.reduce((n, i) => n + i.amount, 0));
  const professional = sum(
      visible.filter((i) => i.category === "professional"),
    ),
    disbursements = sum(visible.filter((i) => i.category === "disbursement"));
  const sstRate = nonnegative(rules.sst_rate);
  if (sstRate > 1) throw new Error("SST rate must be between 0 and 1.");
  const sst = money(sum(visible.filter((i) => i.sst_applicable)) * sstRate);
  return {
    calculation_formulas: formulas(template, rules, items),
    rule_set: {
      id: template.id,
      name: template.name,
      version: template.version,
      code: template.code,
    },
    items,
    layout: rules.layout || {},
    template_snapshot: structuredClone(template),
    inputs: { ...input, loan_amount: loan },
    summary: {
      professional_fees: professional,
      disbursements,
      sst,
      total_payable: money(professional + disbursements + sst),
      stamp_duty_basis: basis,
      total_financing: money(loan + legal + insurance),
    },
  };
}
