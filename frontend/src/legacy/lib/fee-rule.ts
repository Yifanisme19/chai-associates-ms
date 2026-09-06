export type FeeRule = {
    code?: string;
    label?: string;
    method: string;
    basis?: string;
    amount?: number | null;
    rate?: number | null;
    minimum?: number | null;
    maximum?: number | null;
    unit_size?: number;
    additional_amount?: number;
    zero_when_basis_zero?: boolean;
    tiers?: Array<{ up_to: number | null; rate: number }>;
    bands?: Array<{ up_to: number | null; amount: number }>;
    cases?: Array<{
        when: Record<string, string | number | boolean>;
        rule: FeeRule;
    }>;
    expression?: string;
    source_file?: string;
    source_page?: number | null;
    effective_from?: string | null;
};

export const feeInputs = [
    ['loan_amount', 'Loan amount'],
    [
        'loan_plus_financed_legal_fee',
        'Loan + financed legal fee (insurance excluded)',
    ],
    ['consideration_or_loan_amount', 'Consideration / loan amount'],
    ['property_value', 'Property value'],
    ['purchase_price', 'Purchase price'],
    ['facility_legal_fee', 'Facility agreement legal fee'],
    ['scale_fee', 'Scale legal fee'],
    ['title_count', 'Number of titles'],
    ['charge_count', 'Number of charges'],
    ['pa_count', 'Number of powers of attorney'],
    ['property_count', 'Number of properties'],
    ['individual_count', 'Number of individuals'],
    ['vendor_count', 'Number of vendors'],
    ['application_count', 'Number of applications'],
    ['document_count', 'Number of documents'],
    ['caveat_count', 'Number of caveats'],
    ['instrument_count', 'Number of instruments'],
    ['additional_title_count', 'Additional titles (excluding first)'],
    ['additional_property_count', 'Additional properties (excluding first)'],
    ['monthly_rental', 'Monthly rental'],
    ['annual_rental', 'Annual rental'],
    ['area_acres', 'Area in acres'],
    ['citizenship', 'Citizenship'],
    ['property_type', 'Property type'],
] as const;
export const inputLabel = (key: string) =>
    feeInputs.find(([id]) => id === key)?.[1] ?? key.replaceAll('_', ' ');
const rm = (n: number | null | undefined) =>
    `RM${Number(n ?? 0).toLocaleString('en-MY', { maximumFractionDigits: 2 })}`;
export function ruleSummary(rule: FeeRule): string {
    const basis = inputLabel(rule.basis ?? 'amount');
    switch (rule.method) {
        case 'fixed':
            return `Fixed ${rm(rule.amount)}`;
        case 'percentage':
            return `${basis} × ${Number(((rule.rate ?? 0) * 100).toFixed(6))}%`;
        case 'per_unit':
            return `${rm(rule.amount)} per ${rule.unit_size ?? 1} — ${basis}`;
        case 'first_additional':
            return `First ${rm(rule.amount)}, each additional ${rm(rule.additional_amount)}`;
        case 'tiered':
            return rule.tiers?.length
                ? `${rule.tiers.length} progressive tiers · ${basis}`
                : 'Legacy scale entry — full tiers not configured';
        case 'banded':
            return `${rule.bands?.length ?? 0} fixed-fee bands · ${basis}`;
        case 'conditional':
            return `${rule.cases?.length ?? 0} cases — first matching case applies`;
        default:
            return 'Reference only — not an executable calculation';
    }
}
