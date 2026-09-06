export function describe(rule) {
  if (!rule) return "Fixed quotation amount.";
  const rate = (n) => `${Number(n || 0) * 100}%`;
  switch (rule.method) {
    case "fixed":
      return `Fixed amount: RM${rule.amount || 0}.`;
    case "percentage":
      return `${rule.basis} × ${rate(rule.rate)}${rule.minimum != null ? `; minimum RM${rule.minimum}` : ""}${rule.maximum != null ? `; maximum RM${rule.maximum}` : ""}.`;
    case "tiered":
      return `${rule.basis}: ${(rule.tiers || []).map((t) => `${t.up_to == null ? "remaining amount" : `up to RM${t.up_to}`} at ${rate(t.rate)}`).join("; ")}${rule.minimum != null ? `; minimum RM${rule.minimum}` : ""}.`;
    case "per_unit":
      return `${rule.basis} ÷ ${rule.unit_size || 1}, rounded up × RM${rule.amount || 0}.`;
    case "first_additional":
      return `First unit RM${rule.amount || 0}; each additional unit RM${rule.additional_amount || 0}.`;
    case "banded":
      return `Fee band selected using ${rule.basis}.`;
    case "conditional":
      return "Fee selected from the matching input conditions.";
    default:
      return "Structured fee rule.";
  }
}
export function formulas(template, rules, items) {
  const configured = rules.sections
    ? items
        .filter((i) => i.rule_snapshot)
        .map((i) => ({
          name: i.description,
          formula: describe(i.rule_snapshot),
        }))
    : [
        {
          name: "Facilities Agreement",
          formula: `First RM500,000 × ${rules.legal_fee.first_500k_rate * 100}%; next RM7,000,000 × ${rules.legal_fee.next_7m_rate * 100}%. Excess above RM7.5m uses negotiated rate. Minimum RM${rules.legal_fee.minimum}; RM0 when loan is zero.`,
        },
        {
          name: "Form 16A and Charge Annexure",
          formula: `Facilities Agreement fee × ${rules.charge_fee.rate * 100}%; minimum RM${rules.charge_fee.minimum}, maximum RM${rules.charge_fee.maximum}. RM0 when loan is zero.`,
        },
        {
          name: "Facilities Agreement stamp duty",
          formula: `(Loan amount + financed legal fee) × ${rules.facility_stamp_duty_rate * 100}%. Financed insurance is excluded.`,
        },
      ];
  return [
    ...configured,
    {
      name: "SST",
      formula: `Sum of visible taxable items × ${rules.sst_rate * 100}%.`,
    },
    {
      name: "Total payable",
      formula:
        "Professional fees + disbursements + SST. Hidden items are excluded.",
    },
    {
      name: "Total financing",
      formula:
        "Loan amount + financed legal fee + financed insurance. Only amounts selected for financing are included.",
    },
  ];
}
