<script setup lang="ts">
import { toast } from 'vue-sonner';
import { toolRequest, exportQuotation, setDirty } from '../../../bridge';
import { Head } from '@inertiajs/vue3';
import {
    ArrowDown,
    ArrowUp,
    Download,
    Eye,
    EyeOff,
    FileSpreadsheet,
    PencilLine,
    Plus,
    RotateCcw,
    Save,
    ShieldCheck,
    Trash2,
} from '@lucide/vue';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/date';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

defineOptions({
    layout: {
        breadcrumbs: [{ title: 'Loan Refinance', href: '/quotations/create' }],
    },
});
type Item = {
    code: string;
    description: string;
    category: string;
    amount: number;
    sst_applicable: boolean;
    basis?: string;
    section_code?: string;
    section_name?: string;
    source?: 'calculated' | 'fixed' | 'manual' | 'custom';
    hidden?: boolean;
    sort_order?: number;
    default_description?: string;
    default_amount?: number;
    default_sst_applicable?: boolean;
    amount_overridden?: boolean;
};
type Result = {
    template_snapshot?: { rules: { sections?: Array<{ code: string; name: string; category: string }> } };
    calculation_formulas?: Array<{ name: string; formula: string }>;
    items: Item[];
    layout?: {
        categories?: Array<{ code: string; name: string; type: string }>;
        section_categories?: Record<string, string>;
        document_title?: string;
        professional_heading?: string;
        professional_intro?: string;
        disbursement_heading?: string;
        footer_note?: string;
    };
    inputs?: {
        ccm_search_amount?: number;
        negotiated_legal_fee_rate?: number;
    };
    summary: {
        professional_fees: number;
        disbursements: number;
        sst: number;
        total_payable: number;
        stamp_duty_basis: number;
        total_financing: number;
    };
    rule_set: { name: string; version: number };
};
const props = defineProps<{
    ruleSets: Array<{
        id: number;
        name: string;
        code: string;
        version: number;
        effective_from: string;
        input_schema?: {
            primary_amount_label?: string;
            supports_financing?: boolean;
            supports_ccm_search?: boolean;
        };
    }>;
    defaultRuleSetId: number;
    quotation?: {
        ref_code?: string | null;
        id: number;
        number: string;
        status: string;
        rule_set_id: number;
        pic: string;
        client_name: string;
        reference: string;
        quotation_date: string;
        loan_amount: number | string;
        finance_legal_fee: boolean;
        legal_fee_financed_amount: number | string;
        finance_insurance: boolean;
        insurance_financed_amount: number | string;
        calculation_snapshot: Result;
    };
}>();
const selectedRuleSet = computed(() =>
    props.ruleSets.find((rule) => String(rule.id) === String(form.rule_set_id)),
);
const inputSchema = computed(() => ({
    primary_amount_label:
        selectedRuleSet.value?.input_schema?.primary_amount_label ??
        'Loan Amount',
    supports_financing:
        selectedRuleSet.value?.input_schema?.supports_financing ?? true,
    supports_ccm_search:
        selectedRuleSet.value?.input_schema?.supports_ccm_search ?? true,
}));
const sectionDetails = (item: Item) => {
    if (item.category === 'professional')
        return ['professional_fees', 'PROFESSIONAL FEES:-'] as const;
    if (['title_search', 'bankruptcy_search', 'ccm_search'].includes(item.code))
        return ['searches', 'Searches'] as const;
    if (
        [
            'facility_stamp_duty',
            'facility_duplicate',
            'charge_stamp',
            'drr_stamp',
            'form_16n_stamp',
            'letter_offer',
            'statutory_declaration_stamp',
        ].includes(item.code)
    )
        return ['stamp_duties', 'Stamp Duties (Subject to valuation)'] as const;
    if (
        [
            'form_16a_registration',
            'form_16n_registration',
            'form_19b',
            'form_19g',
        ].includes(item.code)
    )
        return [
            'registration_fees',
            'Registration Fees (Subject to valuation)',
        ] as const;
    return ['others', 'Others'] as const;
};
const normalizeItem = (
    item: Item,
    index: number,
): Required<
    Pick<
        Item,
        | 'code'
        | 'description'
        | 'category'
        | 'amount'
        | 'sst_applicable'
        | 'section_code'
        | 'section_name'
        | 'source'
        | 'hidden'
        | 'sort_order'
    >
> &
    Item => {
    const [sectionCode, sectionName] = sectionDetails(item);
    return {
        ...item,
        section_code: item.section_code ?? sectionCode,
        section_name: item.section_name ?? sectionName,
        source: item.source ?? 'fixed',
        hidden: item.hidden ?? false,
        sort_order: item.sort_order ?? (index + 1) * 10,
        default_description: item.default_description ?? item.description,
        default_amount: item.default_amount ?? item.amount,
        default_sst_applicable:
            item.default_sst_applicable ?? item.sst_applicable,
        amount_overridden: [
            'facilities_agreement',
            'charge',
            'facility_stamp_duty',
        ].includes(item.code)
            ? false
            : (item.amount_overridden ?? false),
    };
};
const form = reactive({
    ref_code: props.quotation?.ref_code ?? '',
    rule_set_id: String(props.quotation?.rule_set_id ?? props.defaultRuleSetId),
    pic: props.quotation?.pic ?? '',
    client_name: props.quotation?.client_name ?? '',
    reference: props.quotation?.reference ?? '',
    quotation_date:
        props.quotation?.quotation_date?.slice(0, 10) ??
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kuala_Lumpur',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date()),
    loan_amount: Number(props.quotation?.loan_amount ?? 0),
    ccm_search_amount: Number(
        props.quotation?.calculation_snapshot?.inputs?.ccm_search_amount ?? 0,
    ),
    finance_legal_fee: props.quotation?.finance_legal_fee ?? false,
    legal_fee_financed_amount: Number(
        props.quotation?.legal_fee_financed_amount ?? 0,
    ),
    finance_insurance: props.quotation?.finance_insurance ?? false,
    insurance_financed_amount: Number(
        props.quotation?.insurance_financed_amount ?? 0,
    ),
    negotiated_legal_fee_rate: props.quotation?.calculation_snapshot?.inputs
        ?.negotiated_legal_fee_rate as number | undefined,
    line_overrides: (props.quotation?.calculation_snapshot?.items ?? []).map(
        normalizeItem,
    ),
});
const result = ref<Result | null>(
    props.quotation?.calculation_snapshot ?? null,
);
const errors = ref<Record<string, string[]>>({});
const financingIncomplete = computed(
    () =>
        (form.finance_legal_fee &&
            Number(form.legal_fee_financed_amount) <= 0) ||
        (form.finance_insurance && Number(form.insurance_financed_amount) <= 0),
);
const busy = ref(false);
const recordId = ref<number | null>(props.quotation?.id ?? null);
const isSaved = ref(Boolean(props.quotation));
const savedNumber = ref<string | null>(props.quotation?.number ?? null);
let timer: number;
let calculationAbort: AbortController | null = null;
const editingLines = ref(false);
const addLineOpen = ref(false);
const newLine = reactive({
    description: '',
    amount: 0,
    section_code: '',
    sst_applicable: false,
});
const fallbackSectionOptions = [
    {
        code: 'professional_fees',
        name: 'PROFESSIONAL FEES:-',
        category: 'professional',
    },
    { code: 'searches', name: 'Searches', category: 'disbursement' },
    {
        code: 'stamp_duties',
        name: 'Stamp Duties (Subject to valuation)',
        category: 'disbursement',
    },
    {
        code: 'registration_fees',
        name: 'Registration Fees (Subject to valuation)',
        category: 'disbursement',
    },
    { code: 'others', name: 'Others', category: 'disbursement' },
] as const;
const sectionOptions = computed(() => result.value?.template_snapshot?.rules.sections ?? fallbackSectionOptions);
const displayedItems = computed(() =>
    (form.line_overrides.length
        ? form.line_overrides
        : (result.value?.items ?? []).map(normalizeItem)
    ).filter((item) => editingLines.value || !item.hidden),
);
const isAutomatic = (item: Item) =>
    ['facilities_agreement', 'charge', 'facility_stamp_duty'].includes(
        item.code,
    );
const groupedSections = computed(() => {
    const groups = new Map<
        string,
        { code: string; name: string; category: string; items: Item[] }
    >();
    for (const item of [...displayedItems.value].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    )) {
        const code = item.section_code ?? 'others';
        if (!groups.has(code))
            groups.set(code, {
                code,
                name: item.section_name ?? 'Others',
                category: item.category,
                items: [],
            });
        groups.get(code)?.items.push(item);
    }
    const categories = documentLayout.value.categories;
    const mapping = documentLayout.value.section_categories ?? {};
    return [...groups.values()].sort((a, b) => categories ? categories.findIndex(c => c.code === (mapping[a.code] ?? a.category)) - categories.findIndex(c => c.code === (mapping[b.code] ?? b.category)) : 0);
});
const documentLayout = computed(() => ({
    document_title: 'PROFORMA',
    professional_heading: 'PROFESSIONAL FEES:-',
    professional_intro:
        'Services rendered including taking instructions to prepare the following:-',
    disbursement_heading: 'DISBURSEMENTS:-',
    footer_note:
        '*Kindly be informed that this Proforma is subject to adjustments should there be any variation in the nature, complexity, or scope of the matter.',
    ...(result.value?.layout ?? props.quotation?.calculation_snapshot.layout),
}));
const firstDisbursementCode = computed(
    () =>
        groupedSections.value.find(
            (section) => section.category === 'disbursement',
        )?.code,
);
const categoryKey = (section: { code: string; category: string }) => documentLayout.value.section_categories?.[section.code] ?? section.category;
const categoryEnds = (index: number) => index === groupedSections.value.length - 1 || categoryKey(groupedSections.value[index]) !== categoryKey(groupedSections.value[index + 1]);
const categoryTotal = (section: { code: string; category: string }) => groupedSections.value.filter(s => categoryKey(s) === categoryKey(section)).flatMap(s => s.items).filter(i => !i.hidden).reduce((n, i) => n + i.amount, 0);
const lastDisbursementCode = computed(
    () =>
        [...groupedSections.value]
            .reverse()
            .find((section) => section.category === 'disbursement')?.code,
);
const hiddenCount = computed(
    () => form.line_overrides.filter((item) => item.hidden).length,
);
const taxableTotal = computed(() =>
    displayedItems.value
        .filter((item) => item.sst_applicable && !item.hidden)
        .reduce((total, item) => total + item.amount, 0),
);
const effectiveSstRate = computed(() =>
    taxableTotal.value && result.value
        ? result.value.summary.sst / taxableTotal.value
        : 0,
);
const itemSst = (item: Item) =>
    item.sst_applicable ? item.amount * effectiveSstRate.value : null;
const money = (value: number) =>
    new Intl.NumberFormat('en-MY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value || 0);
const xsrf = () =>
    decodeURIComponent(
        document.cookie
            .split('; ')
            .find((value) => value.startsWith('XSRF-TOKEN='))
            ?.split('=')[1] ?? '',
    );
async function request(
    url: string,
    signal?: AbortSignal,
    method: 'POST' | 'PUT' = 'POST',
) {
    busy.value = true;
    errors.value = {};
    try {
        const response = await toolRequest(url, {
            method,
            signal,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-XSRF-TOKEN': xsrf(),
            },
            body: JSON.stringify(form),
        });
        const data = await response.json();
        if (signal?.aborted) return null;
        if (!response.ok) {
            errors.value = data.errors ?? { form: [data.message] };
            return null;
        }
        return data;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
            return null;
        errors.value = { form: [error instanceof Error ? error.message : String(error)] };
        return null;
    } finally {
        busy.value = false;
    }
}
async function calculate() {
    if (form.loan_amount < 0) return;
    calculationAbort?.abort();
    calculationAbort = new AbortController();
    const calculated = await request(
        recordId.value
            ? `/quotations/${recordId.value}/calculate`
            : '/quotations/calculate',
        calculationAbort.signal,
    );
    if (calculated) {
        result.value = calculated;
        for (const item of form.line_overrides) {
            const updated = calculated.items.find(
                (row: Item) => row.code === item.code,
            );
            if (updated && !item.amount_overridden) {
                item.amount = updated.amount;
                item.default_amount = updated.default_amount;
            }
        }
    }
}
async function save() {
    if (financingIncomplete.value) return;
    const data = await request(
        recordId.value ? `/quotations/${recordId.value}` : '/quotations',
        undefined,
        recordId.value ? 'PUT' : 'POST',
    );
    if (data) {
        recordId.value = data.id;
        isSaved.value = true;
        setDirty(false);
        savedNumber.value = data.number;
        result.value = data.calculation_snapshot;
        toast.success('Quotation draft saved.');
    }
}
function download(type: 'pdf' | 'excel') {
    if (recordId.value && isSaved.value)
        exportQuotation(String(recordId.value), type);
}
function beginCustomize() {
    if (!form.line_overrides.length)
        form.line_overrides = (result.value?.items ?? []).map(normalizeItem);
    editingLines.value = !editingLines.value;
}
function addCustomLine() {
    const section = sectionOptions.value.find(
        (option) => option.code === newLine.section_code,
    );
    if (!section || !newLine.description.trim()) return;
    const maxOrder = Math.max(
        0,
        ...form.line_overrides
            .filter((item) => item.section_code === section.code)
            .map((item) => item.sort_order ?? 0),
    );
    form.line_overrides.push({
        code: `custom_${Date.now()}`,
        description: newLine.description.trim(),
        category: section.category,
        amount: Number(newLine.amount) || 0,
        sst_applicable: newLine.sst_applicable,
        section_code: section.code,
        section_name: section.name,
        source: 'custom',
        hidden: false,
        sort_order: maxOrder + 5,
        amount_overridden: true,
    });
    newLine.description = '';
    newLine.amount = 0;
    newLine.sst_applicable = false;
    addLineOpen.value = false;
}
function resetLine(item: Item) {
    item.description = item.default_description ?? item.description;
    item.amount = item.default_amount ?? item.amount;
    item.sst_applicable = item.default_sst_applicable ?? item.sst_applicable;
    item.hidden = false;
    item.amount_overridden = false;
}
function removeLine(item: Item) {
    const index = form.line_overrides.findIndex(
        (candidate) => candidate.code === item.code,
    );
    if (index < 0) return;
    if (item.source === 'custom') form.line_overrides.splice(index, 1);
    else form.line_overrides[index].hidden = true;
}
function moveLine(item: Item, direction: -1 | 1) {
    const siblings = form.line_overrides
        .filter((candidate) => candidate.section_code === item.section_code)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const position = siblings.findIndex(
        (candidate) => candidate.code === item.code,
    );
    const target = siblings[position + direction];
    if (!target) return;
    const order = item.sort_order ?? 0;
    item.sort_order = target.sort_order ?? 0;
    target.sort_order = order;
}
watch(
    () => form.rule_set_id,
    () => {
        form.line_overrides = [];
        editingLines.value = false;
        if (!inputSchema.value.supports_financing) {
            form.finance_legal_fee = false;
            form.legal_fee_financed_amount = 0;
            form.finance_insurance = false;
            form.insurance_financed_amount = 0;
        }
    },
);
watch(
    () => JSON.stringify({...form, line_overrides: form.line_overrides.map(({amount,default_amount,...item}) => item.amount_overridden ? {...item,amount} : item)}),
    () => {
        isSaved.value = false;
        setDirty(true);
        clearTimeout(timer);
        timer = window.setTimeout(calculate, 350);
    },
    { deep: true },
);
onMounted(calculate);
onUnmounted(() => {clearTimeout(timer); calculationAbort?.abort();});
</script>

<template>
    <Head :title="props.quotation ? 'Edit quotation' : 'Loan Refinance'" />
    <div class="bg-background min-h-full min-w-0 overflow-x-hidden p-4 lg:p-6">
        <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 class="text-2xl font-semibold tracking-tight">
                    {{ props.quotation ? 'Edit quotation' : 'Loan Refinance' }}
                </h1>
                <p class="text-muted-foreground mt-1 text-sm">
                    {{ selectedRuleSet?.name }} · Version
                    {{ selectedRuleSet?.version }}
                </p>
            </div>
            <div class="flex flex-wrap gap-2">
                <Button
                    variant="outline"
                    :disabled="busy || isSaved || financingIncomplete"
                    @click="save"
                    ><Save />{{
                        busy
                            ? 'Saving…'
                            : isSaved
                              ? 'Saved'
                              : recordId
                                ? 'Update Draft'
                                : 'Save Draft'
                    }}</Button
                >
                <Button
                    variant="outline"
                    :disabled="!recordId || !isSaved"
                    @click="download('pdf')"
                    ><Download />Export PDF</Button
                >
                <Button
                    :disabled="!recordId || !isSaved"
                    @click="download('excel')"
                    ><FileSpreadsheet />Export Excel</Button
                >
            </div>
        </header>

        <div
            v-if="Object.keys(errors).length"
            class="border-destructive/40 bg-destructive/10 text-destructive mb-4 rounded-md border px-4 py-3 text-sm"
        >
            <div v-for="(messages, key) in errors" :key="key">
                {{ messages[0] }}
            </div>
        </div>

        <main
            class="grid min-w-0 items-start gap-5 xl:grid-cols-[410px_minmax(0,1fr)]"
        >
            <div class="min-w-0 space-y-4">
                <Card class="min-w-0">
                    <CardHeader
                        ><CardTitle>Quotation details</CardTitle></CardHeader
                    >
                    <CardContent class="space-y-4">
                        <label class="field"
                            ><span>PIC</span
                            ><Input
                                v-model="form.pic"
                                placeholder="Person in charge"
                        /></label>
                        <label class="field"
                            ><span>Client Name</span
                            ><Input
                                v-model="form.client_name"
                                placeholder="Client or company name"
                        /></label>
                        <label class="field"
                            ><span>Re</span
                            ><textarea
                                v-model="form.reference"
                                class="form-textarea"
                                rows="2"
                                placeholder="Matter reference"
                            />
                        </label>
                        <label class="field"
                            ><span>{{ inputSchema.primary_amount_label }}</span>
                            <div class="money-input">
                                <b>RM</b
                                ><Input
                                    v-model.number="form.loan_amount"
                                    type="number"
                                    min="0"
                                    step="1000"
                                /></div
                        ></label>

                        <div
                            v-if="inputSchema.supports_financing"
                            class="field"
                        >
                            <span>Finance in Legal Fee</span>
                            <div class="segments">
                                <Button
                                    type="button"
                                    :variant="
                                        form.finance_legal_fee
                                            ? 'default'
                                            : 'ghost'
                                    "
                                    @click="form.finance_legal_fee = true"
                                    >Yes</Button
                                >
                                <Button
                                    type="button"
                                    :variant="
                                        !form.finance_legal_fee
                                            ? 'default'
                                            : 'ghost'
                                    "
                                    @click="
                                        form.finance_legal_fee = false;
                                        form.legal_fee_financed_amount = 0;
                                    "
                                    >No</Button
                                >
                            </div>
                        </div>
                        <label
                            v-if="
                                inputSchema.supports_financing &&
                                form.finance_legal_fee
                            "
                            class="field"
                            ><span>Legal Fee Amount</span>
                            <div class="money-input">
                                <b>RM</b
                                ><Input
                                    v-model.number="
                                        form.legal_fee_financed_amount
                                    "
                                    type="number"
                                    min="0.01"
                                />
                            </div>
                            <span
                                v-if="
                                    Number(form.legal_fee_financed_amount) <= 0
                                "
                                class="text-muted-foreground text-xs font-normal"
                                >Enter the legal fee amount to be financed
                                before saving.</span
                            >
                        </label>

                        <div
                            v-if="inputSchema.supports_financing"
                            class="field"
                        >
                            <span>Finance in Insurance</span>
                            <div class="segments">
                                <Button
                                    type="button"
                                    :variant="
                                        form.finance_insurance
                                            ? 'default'
                                            : 'ghost'
                                    "
                                    @click="form.finance_insurance = true"
                                    >Yes</Button
                                >
                                <Button
                                    type="button"
                                    :variant="
                                        !form.finance_insurance
                                            ? 'default'
                                            : 'ghost'
                                    "
                                    @click="
                                        form.finance_insurance = false;
                                        form.insurance_financed_amount = 0;
                                    "
                                    >No</Button
                                >
                            </div>
                        </div>
                        <label
                            v-if="
                                inputSchema.supports_financing &&
                                form.finance_insurance
                            "
                            class="field"
                            ><span>Insurance Amount</span>
                            <div class="money-input">
                                <b>RM</b
                                ><Input
                                    v-model.number="
                                        form.insurance_financed_amount
                                    "
                                    type="number"
                                    min="0.01"
                                />
                            </div>
                            <span
                                v-if="
                                    Number(form.insurance_financed_amount) <= 0
                                "
                                class="text-muted-foreground text-xs font-normal"
                                >Enter the insurance amount to be financed
                                before saving.</span
                            >
                        </label>

                        <label
                            v-if="
                                inputSchema.supports_financing &&
                                form.loan_amount > 7500000
                            "
                            class="field"
                            ><span>Negotiated rate above RM7.5m</span
                            ><Input
                                v-model.number="form.negotiated_legal_fee_rate"
                                type="number"
                                min="0"
                                max="0.01"
                                step="0.0001"
                                placeholder="e.g. 0.008"
                        /></label>
                        <div
                            v-if="inputSchema.supports_financing"
                            class="bg-muted/50 text-muted-foreground flex gap-2 rounded-md border p-3 text-xs leading-5"
                        >
                            <ShieldCheck
                                class="mt-0.5 size-4 shrink-0"
                            />Calculations use the active fee rule. Financed
                            insurance is excluded from stamp duty.
                        </div>
                    </CardContent>
                </Card>

                <Card class="min-w-0">
                    <CardHeader>
                        <CardTitle>Calculation formulas</CardTitle>
                        <p class="text-muted-foreground text-xs">
                            Reference only. Formulas reflect the rules used for
                            this quotation.
                        </p>
                    </CardHeader>
                    <CardContent>
                        <table
                            class="w-full table-fixed border-collapse text-left text-xs leading-5"
                        >
                            <thead class="bg-muted/50">
                                <tr>
                                    <th class="w-[36%] border p-2 align-top">
                                        Item
                                    </th>
                                    <th class="border p-2">Formula</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in result?.calculation_formulas ??
                                    []"
                                    :key="row.name"
                                >
                                    <th
                                        scope="row"
                                        class="border p-2 align-top font-medium break-words"
                                    >
                                        {{ row.name }}
                                    </th>
                                    <td
                                        class="border p-2 align-top break-words"
                                    >
                                        {{ row.formula }}
                                    </td>
                                </tr>
                                <tr
                                    v-if="!result?.calculation_formulas?.length"
                                >
                                    <td
                                        colspan="2"
                                        class="text-muted-foreground border p-2"
                                    >
                                        Formula details will appear after
                                        calculation.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            </div>

            <div class="min-w-0 space-y-3">
                <div
                    class="bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                    <div>
                        <p class="text-sm font-medium">Quotation items</p>
                        <p class="text-muted-foreground text-xs">
                            Changes here apply only to this draft.
                            <span v-if="hiddenCount"
                                >{{ hiddenCount }} hidden item(s).</span
                            >
                        </p>
                    </div>
                    <div class="flex gap-2">
                        <Button
                            v-if="editingLines"
                            variant="outline"
                            size="sm"
                            @click="
                                newLine.section_code = '';
                                addLineOpen = true;
                            "
                            ><Plus />Add item</Button
                        >
                        <Button
                            :variant="editingLines ? 'default' : 'outline'"
                            size="sm"
                            @click="beginCustomize"
                            ><PencilLine />{{
                                editingLines
                                    ? 'Finish editing'
                                    : 'Customize items'
                            }}</Button
                        >
                    </div>
                </div>

                <section class="excel-preview">
                    <h2 class="excel-title">
                        {{ documentLayout.document_title }}
                    </h2>
                    <div class="excel-meta">
                        <div class="excel-pic">
                            <b>PIC</b><span>:</span
                            ><span>{{ form.pic || '-' }}</span>
                        </div>
                        <div class="excel-date">
                            <b>Date</b><span>:</span
                            ><Input
                                v-if="editingLines"
                                v-model="form.quotation_date"
                                type="date"
                                aria-label="Quotation date"
                                class="w-full min-w-0"
                            />
                            <span v-else>{{
                                formatDate(form.quotation_date)
                            }}</span>
                        </div>
                        <div class="excel-ref">
                            <b>Ref</b><span>:</span
                            ><Input
                                v-if="editingLines"
                                v-model="form.ref_code"
                                maxlength="120"
                                aria-label="Reference code"
                                :placeholder="
                                    savedNumber || 'Auto-generated when saved'
                                "
                                class="w-full min-w-0"
                            />
                            <span v-else>{{
                                form.ref_code ||
                                savedNumber ||
                                'Auto-generated when saved'
                            }}</span>
                        </div>
                        <div class="excel-client">
                            <b>Client</b><span>:</span
                            ><span>{{ form.client_name || '-' }}</span>
                        </div>
                        <div class="excel-re">
                            <b>Re</b><span>:</span
                            ><span>{{ form.reference || '-' }}</span>
                        </div>
                    </div>
                    <div
                        v-if="!result"
                        class="text-muted-foreground py-20 text-center text-sm"
                    >
                        Enter a valid loan amount to calculate.
                    </div>
                    <template v-else>
                        <table class="excel-table">
                            <colgroup>
                                <col />
                                <col class="amount-col" />
                                <col class="total-col" />
                                <col class="sst-col" />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>Amount</th>
                                    <th>Total</th>
                                    <th>
                                        SST Rate
                                        {{
                                            money(
                                                effectiveSstRate * 100,
                                            ).replace('.00', '')
                                        }}%
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <template
                                    v-for="(section, sectionIndex) in groupedSections"
                                    :key="section.code"
                                >
                                    <tr v-if="documentLayout.categories && (sectionIndex === 0 || documentLayout.section_categories?.[groupedSections[sectionIndex - 1].code] !== documentLayout.section_categories?.[section.code])" class="section-row"><td colspan="4">{{ documentLayout.categories.find(c => c.code === (documentLayout.section_categories?.[section.code] ?? section.category))?.name }}</td></tr>
                                    <tr
                                        v-if="
                                            !documentLayout.categories && section.category === 'professional'
                                        "
                                        class="section-row"
                                    >
                                        <td colspan="4">
                                            {{
                                                documentLayout.professional_heading
                                            }}
                                        </td>
                                    </tr>
                                    <tr
                                        v-if="
                                            section.category === 'professional' && (sectionIndex === 0 || categoryKey(groupedSections[sectionIndex - 1]) !== categoryKey(section))
                                        "
                                        class="intro-row"
                                    >
                                        <td colspan="4">
                                            {{
                                                documentLayout.professional_intro
                                            }}
                                        </td>
                                    </tr>
                                    <tr
                                        v-if="
                                            !documentLayout.categories && section.code ===
                                            firstDisbursementCode
                                        "
                                        class="section-row"
                                    >
                                        <td colspan="4">
                                            {{
                                                documentLayout.disbursement_heading
                                            }}
                                        </td>
                                    </tr>
                                    <tr
                                        v-if="
                                            section.category === 'disbursement'
                                        "
                                        class="group-row"
                                    >
                                        <td colspan="4">{{ section.name }}</td>
                                    </tr>
                                    <tr
                                        v-for="item in section.items"
                                        :key="item.code"
                                        :class="{
                                            'line-hidden': item.hidden,
                                            'line-editing': editingLines,
                                        }"
                                    >
                                        <td>
                                            <div
                                                v-if="editingLines"
                                                class="line-description-editor"
                                            >
                                                <Input
                                                    v-model="item.description"
                                                    aria-label="Item description"
                                                />
                                                <span
                                                    class="text-muted-foreground text-[10px]"
                                                    >{{ item.source }}</span
                                                >
                                            </div>
                                            <template v-else>{{
                                                item.description
                                            }}</template>
                                        </td>
                                        <td>
                                            <div
                                                v-if="editingLines"
                                                class="line-amount-editor"
                                            >
                                                <span>RM</span>
                                                <Input
                                                    v-model.number="item.amount"
                                                    :disabled="
                                                        isAutomatic(item)
                                                    "
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    aria-label="Item amount"
                                                    @update:model-value="
                                                        item.amount_overridden = true
                                                    "
                                                />
                                            </div>
                                            <template v-else
                                                >RM&nbsp;&nbsp;{{
                                                    money(item.amount)
                                                }}</template
                                            >
                                        </td>
                                        <td>
                                            <div
                                                v-if="editingLines"
                                                class="line-actions"
                                            >
                                                <button
                                                    type="button"
                                                    title="Move up"
                                                    @click="moveLine(item, -1)"
                                                >
                                                    <ArrowUp />
                                                </button>
                                                <button
                                                    type="button"
                                                    title="Move down"
                                                    @click="moveLine(item, 1)"
                                                >
                                                    <ArrowDown />
                                                </button>
                                                <button
                                                    type="button"
                                                    :title="
                                                        item.hidden
                                                            ? 'Show item'
                                                            : 'Hide item'
                                                    "
                                                    @click="
                                                        item.hidden =
                                                            !item.hidden
                                                    "
                                                >
                                                    <Eye v-if="item.hidden" />
                                                    <EyeOff v-else />
                                                </button>
                                                <button
                                                    v-if="
                                                        item.source !== 'custom'
                                                    "
                                                    type="button"
                                                    title="Restore template default"
                                                    @click="resetLine(item)"
                                                >
                                                    <RotateCcw />
                                                </button>
                                                <button
                                                    v-else
                                                    type="button"
                                                    title="Delete custom item"
                                                    class="text-destructive"
                                                    @click="removeLine(item)"
                                                >
                                                    <Trash2 />
                                                </button>
                                            </div>
                                        </td>
                                        <td>
                                            <label
                                                v-if="editingLines"
                                                class="inline-flex items-center gap-1"
                                            >
                                                <input
                                                    v-model="
                                                        item.sst_applicable
                                                    "
                                                    type="checkbox"
                                                />
                                                <span class="text-[10px]"
                                                    >SST</span
                                                >
                                            </label>
                                            <template v-else>
                                                {{
                                                    itemSst(item) === null
                                                        ? '-'
                                                        : `RM ${money(itemSst(item) ?? 0)}`
                                                }}
                                            </template>
                                        </td>
                                    </tr>
                                    <tr
                                        v-if="
                                            !documentLayout.categories && section.category === 'professional'
                                        "
                                        class="subtotal-row"
                                    >
                                        <td></td>
                                        <td></td>
                                        <td>
                                            RM&nbsp;&nbsp;{{
                                                money(
                                                    result.summary
                                                        .professional_fees,
                                                )
                                            }}
                                        </td>
                                        <td>-</td>
                                    </tr>
                                    <tr
                                        v-if="
                                            !documentLayout.categories && section.code ===
                                            lastDisbursementCode
                                        "
                                        class="subtotal-row"
                                    >
                                        <td></td>
                                        <td></td>
                                        <td>
                                            RM&nbsp;&nbsp;{{
                                                money(
                                                    result.summary
                                                        .disbursements,
                                                )
                                            }}
                                        </td>
                                        <td></td>
                                    </tr>
                                    <tr v-if="documentLayout.categories && categoryEnds(sectionIndex)" class="subtotal-row"><td></td><td></td><td>RM {{ money(categoryTotal(section)) }}</td><td></td></tr>
                                </template>
                                <tr class="total-row">
                                    <td colspan="3">Total SST Payable</td>
                                    <td>
                                        RM&nbsp;&nbsp;{{
                                            money(result.summary.sst)
                                        }}
                                    </td>
                                </tr>
                                <tr class="grand-total-row">
                                    <td colspan="3">
                                        TOTAL PAYABLE INCLUSIVE OF SST
                                    </td>
                                    <td>
                                        RM&nbsp;&nbsp;{{
                                            money(result.summary.total_payable)
                                        }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <p v-if="documentLayout.footer_note" class="excel-note">
                            {{ documentLayout.footer_note }}
                        </p>
                    </template>
                </section>
            </div>
        </main>

        <Dialog v-model:open="addLineOpen">
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add quotation item</DialogTitle>
                    <DialogDescription>
                        This item is saved only in the current quotation draft.
                    </DialogDescription>
                </DialogHeader>
                <div class="space-y-4">
                    <label class="field">
                        <span>Section</span>
                        <Select v-model="newLine.section_code">
                            <SelectTrigger class="w-full"
                                ><SelectValue placeholder="-- Please Select --"
                            /></SelectTrigger>
                            <SelectContent>
                                <SelectItem
                                    v-for="section in sectionOptions"
                                    :key="section.code"
                                    :value="section.code"
                                    >{{ section.name }}</SelectItem
                                >
                            </SelectContent>
                        </Select>
                    </label>
                    <label class="field">
                        <span>Description</span>
                        <Input
                            v-model="newLine.description"
                            placeholder="e.g. Additional land search"
                        />
                    </label>
                    <label class="field">
                        <span>Amount</span>
                        <div class="money-input">
                            <b>RM</b>
                            <Input
                                v-model.number="newLine.amount"
                                type="number"
                                min="0"
                                step="0.01"
                            />
                        </div>
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                        <input
                            v-model="newLine.sst_applicable"
                            type="checkbox"
                        />
                        Apply SST to this item
                    </label>
                </div>
                <DialogFooter>
                    <Button variant="outline" @click="addLineOpen = false"
                        >Cancel</Button
                    >
                    <Button
                        :disabled="
                            !newLine.section_code || !newLine.description.trim()
                        "
                        @click="addCustomLine"
                    >
                        <Plus />Add item
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
</template>

<style>
.field {
    display: grid;
    gap: 0.4rem;
    font-size: 0.875rem;
    font-weight: 500;
}
.form-textarea {
    width: 100%;
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: transparent;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 400;
    outline: none;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
}
.form-textarea:focus {
    border-color: var(--ring);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 50%, transparent);
}
.segments {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.25rem;
}
.money-input {
    display: flex;
    overflow: hidden;
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: var(--background);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
}
.money-input b {
    display: flex;
    align-items: center;
    border-right: 1px solid var(--border);
    background: var(--muted);
    padding: 0 0.75rem;
    color: var(--muted-foreground);
    font-weight: 500;
}
.money-input input {
    border: 0;
    border-radius: 0;
    box-shadow: none;
    text-align: right;
}
.excel-preview {
    min-height: 780px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    background: white;
    padding: 1.75rem 2rem;
    color: #111;
    font-family: Arial, Helvetica, sans-serif;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
}
.excel-title {
    margin: 0 0 1.25rem;
    text-align: center;
    font-size: 1.1rem;
    font-weight: 700;
}
.excel-meta {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(190px, 0.4fr);
    margin-bottom: 1rem;
    font-size: 0.72rem;
}
.excel-meta > div {
    display: grid;
    grid-template-columns: 46px 12px minmax(0, 1fr);
    min-height: 1.35rem;
    align-items: start;
}
.excel-meta .excel-pic {
    grid-column: 1;
    grid-row: 1;
}
.excel-meta .excel-ref {
    grid-column: 1;
    grid-row: 2;
}
.excel-meta .excel-client {
    grid-column: 1;
    grid-row: 3;
}
.excel-meta .excel-re {
    grid-column: 1;
    grid-row: 4;
}
.excel-meta .excel-date {
    grid-column: 2;
    grid-row: 1;
    grid-template-columns: 36px 12px minmax(0, 1fr);
}
.excel-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 0.68rem;
}
.excel-table .amount-col {
    width: 19%;
}
.excel-table .total-col {
    width: 16%;
}
.excel-table .sst-col {
    width: 18%;
}
.excel-table th {
    border-top: 1px solid #222;
    border-bottom: 1px solid #222;
    padding: 0.35rem 0.3rem;
    text-align: center;
    font-weight: 400;
}
.excel-table td {
    padding: 0.2rem 0.3rem;
    vertical-align: top;
}
.excel-table td:not(:first-child) {
    text-align: right;
    white-space: nowrap;
}
.excel-table .section-row td {
    padding-top: 0.65rem;
    font-size: 0.72rem;
    font-weight: 700;
    text-align: left;
}
.excel-table .intro-row td {
    padding-top: 0.3rem;
    padding-bottom: 0.55rem;
    text-align: left;
    line-height: 1.4;
}
.excel-table .group-row td {
    padding-top: 0.55rem;
    padding-bottom: 0.25rem;
    text-align: left;
    font-weight: 700;
}
.excel-table .subtotal-row td {
    border-top: 1px solid #222;
}
.excel-table .total-row td {
    border-top: 1px solid #222;
    border-bottom: 1px solid #222;
}
.excel-table .grand-total-row td {
    border-bottom: 1px solid #222;
    font-weight: 700;
}
.excel-table .total-row td:first-child,
.excel-table .grand-total-row td:first-child {
    text-align: left;
}
.excel-table .line-editing td {
    padding-top: 0.28rem;
    padding-bottom: 0.28rem;
    vertical-align: middle;
}
.excel-table .line-hidden {
    background: var(--muted);
    opacity: 0.55;
}
.line-description-editor {
    display: grid;
    gap: 0.1rem;
    text-align: left;
}
.line-description-editor input,
.line-amount-editor input {
    height: 1.9rem;
    font-size: 0.7rem;
}
.line-amount-editor {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}
.line-amount-editor input {
    min-width: 70px;
    text-align: right;
}
.line-actions {
    display: flex;
    justify-content: center;
    gap: 0.1rem;
}
.line-actions button {
    display: inline-flex;
    width: 1.7rem;
    height: 1.7rem;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
}
.line-actions button:hover {
    background: var(--muted);
}
.line-actions svg {
    width: 0.8rem;
    height: 0.8rem;
}
.excel-note {
    margin: 1.1rem auto 0;
    max-width: 90%;
    font-size: 0.58rem;
}
@media (max-width: 767px) {
    .excel-preview {
        overflow-x: auto;
        padding: 1.25rem;
    }
    .excel-meta,
    .excel-table {
        min-width: 680px;
    }
}
</style>
