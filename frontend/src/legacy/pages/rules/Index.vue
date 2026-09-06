<script setup lang="ts">
import { Head, Link, router, useForm } from '@inertiajs/vue3';
import { toolRequest, setDirty } from '../../../bridge';
import { confirmAction } from '@/lib/confirmAction';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
    Archive,
    ArrowDown,
    ArrowUp,
    Copy,
    FileText,
    GripVertical,
    Plus,
    Save,
    Settings2,
    Trash2,
    Undo2,
} from '@lucide/vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import FeeRuleEditor from '@/components/FeeRuleEditor.vue';
import type { FeeRule } from '@/lib/fee-rule';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

defineOptions({
    layout: {
        breadcrumbs: [{ title: 'Templates', href: '/templates' }, { title: 'Loan Refinance', href: '/templates/loan-refinance' }],
    },
});
type LegacyItem = {
    code: string;
    description: string;
    amount: number;
    sst?: boolean;
    section_code?: string;
    section_name?: string;
};
type Item = LegacyItem & {
    formula?: FeeRule;
    input_bindings?: Record<string, string>;
    source: 'fixed' | 'manual' | 'rule';
    rule_ref?: string;
    locked?: boolean;
    hidden?: boolean;
    editable?: boolean;
};
type Section = {
    category_id?: string;
    code: string;
    name: string;
    category: 'professional' | 'disbursement';
    items: Item[];
};
type Category = { code: string; name: string; type: 'professional' | 'disbursement' };
type Template = {
    id: number;
    rule_catalog_id?: number | null;
    name: string;
    code: string;
    version: number;
    effective_from: string;
    effective_to?: string | null;
    status: string;
    rules: Record<string, any>;
    change_note?: string | null;
};
type Catalog = {
    id: number;
    name: string;
    version: number;
    status: string;
    sections?: Array<{
        code: string;
        name: string;
        conditions: Array<{ code: string; label: string }>;
    }>;
};
const props = defineProps<{
    ruleSets: Template[];
    activeTemplates: Template[];
    ruleCatalogs: Catalog[];
}>();
const defaults = {
    document_title: 'PROFORMA',
    professional_heading: 'PROFESSIONAL FEES:-',
    professional_intro:
        'Services rendered including taking instructions to prepare the following:-',
    disbursement_heading: 'DISBURSEMENTS:-',
    footer_note:
        '*Kindly be informed that this Proforma is subject to adjustments should there be any variation in the nature, complexity, or scope of the matter.',
};
const inputDefaults = {
    primary_amount_label: 'Loan Amount',
    supports_financing: true,
    supports_ccm_search: true,
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const infer = (code: string): [string, string] => {
    if (['title_search', 'bankruptcy_search', 'ccm_search'].includes(code))
        return ['searches', 'Searches'];
    if (
        code.includes('stamp') ||
        ['facility_duplicate', 'letter_offer'].includes(code)
    )
        return ['stamp_duties', 'Stamp Duties (Subject to valuation)'];
    if (
        [
            'form_16a_registration',
            'form_16n_registration',
            'form_19b',
            'form_19g',
        ].includes(code)
    )
        return [
            'registration_fees',
            'Registration Fees (Subject to valuation)',
        ];
    return ['others', 'Others'];
};
function makeWorkspace(rules: Record<string, any>) {
    const workspace = baseWorkspace(rules);
    const catalog = props.ruleCatalogs.find(
        (c) => c.id === props.activeTemplates[0]?.rule_catalog_id,
    );
    for (const section of workspace.sections) {
        for (const item of section.items) {
            item.sst = item.sst ?? (item as any).sst_applicable ?? false;
            item.locked = false;
            if (item.source === 'rule' && !item.formula) {
                const [sc, rc] = (item.rule_ref ?? '').split('/');
                const definition = catalog?.sections
                    ?.find((s) => s.code === sc)
                    ?.conditions.find((r) => r.code === rc);
                if (definition)
                    item.formula = clone(definition) as unknown as FeeRule;
                if (item.code === 'charge' && item.formula)
                    item.formula.zero_when_basis_zero = true;
            }
        }
    }
    return workspace;
}
function baseWorkspace(rules: Record<string, any>) {
    const layout = { ...defaults, ...rules.layout };
    const inputSchema = { ...inputDefaults, ...rules.input_schema };
    if (rules.sections)
        return {
            layout,
            inputSchema,
            sections: clone(rules.sections) as Section[],
        };
    const sections = new Map<string, Section>();
    sections.set('professional_fees', {
        code: 'professional_fees',
        name: layout.professional_heading,
        category: 'professional',
        items: [
            {
                code: 'facilities_agreement',
                description: 'Facilities Agreement',
                amount: 0,
                sst: true,
                source: 'rule',
                rule_ref: 'legal_transfer_non_hda/facility_scale',
                locked: true,
                editable: true,
            },
            {
                code: 'charge',
                description: 'Form 16A and Charge Annexure',
                amount: 0,
                sst: true,
                source: 'rule',
                rule_ref: 'charge_documents/charge_fee',
                locked: true,
                editable: true,
            },
            ...(rules.professional_fixed ?? []).map((i: LegacyItem) => ({
                ...i,
                source: 'fixed' as const,
                editable: true,
            })),
        ],
    });
    const disbursements: Item[] = [
        ...(rules.disbursements ?? []).map((i: LegacyItem) => ({
            ...i,
            source: 'fixed' as const,
            editable: true,
        })),
        {
            code: 'ccm_search',
            description: 'CCM Search',
            amount: 0,
            sst: false,
            source: 'manual',
            locked: true,
            editable: true,
        },
        {
            code: 'facility_stamp_duty',
            description: 'Facilities Agreement (Original)',
            amount: 0,
            sst: false,
            source: 'rule',
            rule_ref: 'facility_stamp_duty/facility',
            locked: true,
            editable: true,
        },
    ];
    for (const item of disbursements) {
        const [code, name] =
            item.section_code && item.section_name
                ? [item.section_code, item.section_name]
                : infer(item.code);
        if (!sections.has(code))
            sections.set(code, {
                code,
                name,
                category: 'disbursement',
                items: [],
            });
        sections
            .get(code)!
            .items.push({ ...item, section_code: code, section_name: name });
    }
    return { layout, inputSchema, sections: [...sections.values()] };
}
const active = ref(props.activeTemplates[0]);
const showNewVersion = ref(false);
const editorOpen = ref(false);
const itemTab = ref<'section' | 'item'>('item');
const editorMode = ref<'document' | 'item' | 'category' | 'version' | 'test'>('document');
const editingCategory = ref<Category | null>(null);
function openEditor(mode: 'document' | 'item' | 'category' | 'version' | 'test', category?: Category) {
    editorMode.value = mode;
    itemTab.value = 'item';
    layoutMode.value = mode === 'document';
    editingCategory.value = category ?? null;
    editorOpen.value = true;
}
const versionForm = useForm({ change_note: '' });
function createVersion() {
    versionForm.post(`/templates/${active.value.id}/draft`, {
        preserveScroll: true,
        onSuccess: () => {
            showNewVersion.value = false;
            editorOpen.value = false;
            versionForm.reset();
            selectTemplate([...props.ruleSets].sort((a, b) => b.version - a.version)[0].id);
        },
    });
}
async function deleteVersion(version: Template) {
    if (await confirmAction(`Delete ${versionName(version)}? Existing quotations will be preserved. If this is active, the newest remaining version becomes active. Deleting the last version prevents new quotations.`)) {
        router.delete(`/templates/${version.id}`, { preserveScroll: true });
    }
}
const dragging = ref('');
const dropCode = ref('');
const dropAfter = ref(false);
const dragOffset = ref(0);
const dragAnnouncement = ref('');
let cancelDrag: (() => void) | undefined;
onUnmounted(() => cancelDrag?.());
function dragSection(event: PointerEvent, code: string, isCategory = false) {
    if (event.button !== 0) return;
    cancelDrag?.();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const timer = window.setTimeout(() => {
        dragging.value = code;
        dragAnnouncement.value = 'Section picked up. Move to a new position, release to drop. Escape cancels.';
    }, 300);
    const move = (e: PointerEvent) => {
        if (!dragging.value) {
            if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) > 8) end();
            return;
        }
        dragOffset.value = e.clientY - event.clientY;
        const row = [...document.querySelectorAll<HTMLElement>(isCategory ? '[data-category-code]' : '[data-section-code]')].find(el => {
            const box = el.getBoundingClientRect();
            return (isCategory ? el.dataset.categoryCode : el.dataset.sectionCode) !== code && e.clientY >= box.top && e.clientY <= box.bottom && e.clientX >= box.left && e.clientX <= box.right;
        });
        dropCode.value = (isCategory ? row?.dataset.categoryCode : row?.dataset.sectionCode) ?? '';
        if (row) dropAfter.value = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    };
    const end = () => {
        window.clearTimeout(timer);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', drop);
        handle.removeEventListener('pointercancel', end);
        handle.removeEventListener('lostpointercapture', end);
        window.removeEventListener('keydown', escape);
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        dragging.value = '';
        dropCode.value = '';
        dragOffset.value = 0;
        cancelDrag = undefined;
    };
    const drop = () => {
        if (dragging.value && dropCode.value) {
            const sections = (isCategory ? categories.value : workspace.value.sections) as Array<Category | Section>;
            const from = sections.findIndex(s => s.code === code);
            const [moved] = sections.splice(from, 1);
            const to = sections.findIndex(s => s.code === dropCode.value) + (dropAfter.value ? 1 : 0);
            sections.splice(to, 0, moved);
            if (!isCategory) {
                const target = workspace.value.sections.find(s => s.code === dropCode.value);
                if (target) (moved as Section).category_id = target.category_id ?? target.category;
            }
            arrangeSections();
            dragAnnouncement.value = `${moved.name} moved to position ${to + 1}. Save this version to keep the order.`;
        }
        end();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') end(); };
    cancelDrag = end;
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', drop);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end);
    window.addEventListener('keydown', escape);
}
const workspace = ref(makeWorkspace(active.value.rules));
const categories = ref<Category[]>(loadCategories(active.value.rules));
function loadCategories(rules: Record<string, any>): Category[] {
    return clone(rules.layout?.categories ?? [
        { code: 'professional', name: rules.layout?.professional_heading ?? defaults.professional_heading, type: 'professional' },
        { code: 'disbursement', name: rules.layout?.disbursement_heading ?? defaults.disbursement_heading, type: 'disbursement' },
    ]);
}
function arrangeSections() {
    workspace.value.sections.sort((a, b) => categories.value.findIndex(c => c.code === (a.category_id ?? a.category)) - categories.value.findIndex(c => c.code === (b.category_id ?? b.category)));
    for (const s of workspace.value.sections) {
        s.category_id ??= s.category;
        s.category = categories.value.find(c => c.code === s.category_id)?.type ?? s.category;
    }
}
function addCategory() {
    const category: Category = { code: `category_${Date.now()}`, name: 'New category', type: 'disbursement' };
    categories.value.push(category);
    openEditor('category', category);
}
function moveCategory(code: string, direction: number) {
    const from = categories.value.findIndex(c => c.code === code), to = from + direction;
    if (to < 0 || to >= categories.value.length) return;
    categories.value.splice(to, 0, categories.value.splice(from, 1)[0]);
    arrangeSections();
}
const deletingCategory = ref<Category | null>(null);
const destinationCategory = ref('');
function removeCategory(move: boolean) {
    if (!deletingCategory.value) return;
    const code = deletingCategory.value.code;
    if (move && !destinationCategory.value) return;
    const oldSections = clone(workspace.value.sections), oldCategories = clone(categories.value);
    if (move) workspace.value.sections.forEach(s => { if ((s.category_id ?? s.category) === code) s.category_id = destinationCategory.value; });
    else workspace.value.sections = workspace.value.sections.filter(s => (s.category_id ?? s.category) !== code);
    categories.value = categories.value.filter(c => c.code !== code);
    arrangeSections();
    undo.value = () => { workspace.value.sections = oldSections; categories.value = oldCategories; undo.value = null; };
    deletingCategory.value = null;
}
const form = useForm({
    name: active.value.name,
    rule_catalog_id: active.value.rule_catalog_id
        ? String(active.value.rule_catalog_id)
        : '',
    rules: clone(active.value.rules),
    change_note: '',
    effective_from: new Date().toISOString().slice(0, 10),
});
const createForm = useForm({
    name: '',
    code: '',
    source_rule_set_id: String(active.value.id),
    change_note: '',
});
const sectionCode = ref(workspace.value.sections[0]?.code ?? '');
const itemCode = ref(workspace.value.sections[0]?.items[0]?.code ?? '');
const layoutMode = ref(false),
    showCreate = ref(false),
    undo = ref<null | (() => void)>(null);
type Impact = {
    baseline: { version: number };
    candidate: { version: number };
    before: { total_payable: number };
    after: { total_payable: number };
    total_delta: number;
    items: Array<{
        code: string;
        description: string;
        status: string;
        before: number;
        after: number;
        delta: number;
    }>;
};
const impactLoan = ref(500000);
const impact = ref<Impact | null>(null);
const impactErrors = ref<string[]>([]);
const impactBusy = ref(false);
const editable = computed(() => true);
const section = computed(
    () =>
        workspace.value.sections.find((s) => s.code === sectionCode.value) ??
        workspace.value.sections[0],
);
const item = computed(() =>
    workspace.value.sections
        .flatMap((s) => s.items)
        .find((i) => i.code === itemCode.value),
);
const history = computed(() =>
    props.ruleSets.filter((v) => v.code === active.value.code),
);
const catalog = computed(() =>
    props.ruleCatalogs.find((c) => String(c.id) === String(form.rule_catalog_id)),
);
const availableRules = computed(
    () =>
        catalog.value?.sections?.flatMap((s) =>
            s.conditions.map((r) => ({
                value: `${s.code}/${r.code}`,
                label: `${s.name} — ${r.label}`,
            })),
        ) ?? [],
);
const subtotal = (s: Section) =>
    s.items
        .filter((i) => !i.hidden)
        .reduce((n, i) => n + Number(i.amount || 0), 0);
const total = computed(() =>
    workspace.value.sections.reduce((n, s) => n + subtotal(s), 0),
);
const sst = computed(() =>
    workspace.value.sections
        .flatMap((s) => s.items)
        .filter((i) => !i.hidden && i.sst)
        .reduce(
            (n, i) =>
                n + Number(i.amount || 0) * Number(form.rules.sst_rate ?? 0.08),
            0,
        ),
);
const money = (v: number) =>
    Number(v ?? 0).toLocaleString('en-MY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
const sourceLabel = (i: Item) =>
    i.source === 'rule'
        ? 'Calculated by rule'
        : i.source === 'manual'
          ? 'Enter amount when quoting'
          : 'Fixed amount';
const slug = (v: string) =>
    v
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
function selectTemplate(id: number) {
    const previousSection = sectionCode.value, previousItem = itemCode.value;
    const previousCategory = editingCategory.value?.code;
    const sameVersion = active.value.id === id;
    const next = props.ruleSets.find((t) => t.id === id);
    if (!next) return;
    active.value = next;
    workspace.value = makeWorkspace(next.rules);
    categories.value = loadCategories(next.rules);
    if (previousCategory) editingCategory.value = categories.value.find(c => c.code === previousCategory) ?? null;
    form.name = next.name;
    form.rule_catalog_id = next.rule_catalog_id
        ? String(next.rule_catalog_id)
        : '';
    form.rules = clone(next.rules);
    form.change_note = '';
    createForm.source_rule_set_id = String(id);
    sectionCode.value = workspace.value.sections[0]?.code ?? '';
    itemCode.value = workspace.value.sections[0]?.items[0]?.code ?? '';
    if (sameVersion && workspace.value.sections.some(s => s.code === previousSection)) {
        sectionCode.value = previousSection;
        const selected = workspace.value.sections.find(s => s.code === previousSection)!;
        itemCode.value = selected.items.some(i => i.code === previousItem) ? previousItem : selected.items[0]?.code ?? '';
    }
    undo.value = null;
}
function selectSection(s: Section) {
    openEditor('item');
    itemTab.value = 'section';
    layoutMode.value = false;
    sectionCode.value = s.code;
    itemCode.value = s.items[0]?.code ?? '';
}
watch(
    () => props.activeTemplates,
    (templates) => {
        const selected = props.ruleSets.find(t => t.id === active.value.id);
        if (selected || templates[0]) selectTemplate((selected ?? templates[0]).id);
    },
);
function addSection(categoryCode?: string) {
    const s: Section = {
        code: `custom_section_${Date.now()}`,
        name: 'New section',
        category: 'disbursement',
        category_id: categoryCode ?? categories.value[0]?.code,
        items: [],
    };
    workspace.value.sections.push(s);
    arrangeSections();
    selectSection(s);
}
function moveSection(direction: -1 | 1) {
    if (!section.value) return;
    const rows = workspace.value.sections;
    const index = rows.indexOf(section.value);
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const [moving] = rows.splice(index, 1);
    rows.splice(target, 0, moving);
}
function removeSection() {
    if (!section.value || workspace.value.sections.length <= 1) return;
    const rows = workspace.value.sections;
    const index = rows.indexOf(section.value);
    const [removed] = rows.splice(index, 1);
    selectSection(rows[Math.min(index, rows.length - 1)]);
    undo.value = () => {
        rows.splice(index, 0, removed);
        selectSection(removed);
        undo.value = null;
    };
}
function addItem(s: Section) {
    openEditor('item');
    const i: Item = {
        code: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        description: 'New item',
        amount: 0,
        sst: false,
        source: 'fixed',
        editable: true,
    };
    s.items.push(i);
    sectionCode.value = s.code;
    itemCode.value = i.code;
}
function duplicateItem() {
    if (!item.value || !section.value) return;
    const at = section.value.items.findIndex(
        (i) => i.code === item.value!.code,
    );
    const copy = {
        ...clone(item.value),
        code: `custom_${Date.now()}`,
        description: `${item.value.description} (Copy)`,
        locked: false,
    };
    section.value.items.splice(at + 1, 0, copy);
    itemCode.value = copy.code;
}
function removeItem() {
    if (!item.value || !section.value || item.value.locked) return;
    const s = section.value,
        at = s.items.findIndex((i) => i.code === item.value!.code),
        [removed] = s.items.splice(at, 1);
    itemCode.value = s.items[Math.min(at, s.items.length - 1)]?.code ?? '';
    undo.value = () => {
        s.items.splice(at, 0, removed);
        itemCode.value = removed.code;
        undo.value = null;
    };
}
function move(direction: -1 | 1) {
    if (!item.value || !section.value) return;
    const items = section.value.items,
        at = items.findIndex((i) => i.code === item.value!.code),
        to = at + direction;
    if (to < 0 || to >= items.length) return;
    const [moving] = items.splice(at, 1);
    items.splice(to, 0, moving);
}
function layoutLines(key: 'company_lines' | 'payment_lines'): string {
    const value = workspace.value.layout[key];
    return Array.isArray(value) ? value.join('\n') : '';
}
function setLayoutLines(key: 'company_lines' | 'payment_lines', value: string) {
    workspace.value.layout[key] = value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}
watch(() => JSON.stringify([workspace.value, form.name, form.rules, form.change_note]), () => setDirty(true));
function sync() {
    arrangeSections();
    const rules = clone(form.rules);
    rules.layout = clone(workspace.value.layout);
    rules.layout.categories = clone(categories.value);
    rules.layout.section_categories = Object.fromEntries(workspace.value.sections.map(s => [s.code, s.category_id ?? s.category]));
    rules.input_schema = clone(workspace.value.inputSchema);
    const all = workspace.value.sections.flatMap((s) =>
        s.items.map((i) => ({
            ...i,
            section_code: s.code,
            section_name: s.name,
            category: s.category,
        })),
    );
    rules.professional_fixed = all
        .filter((i) => i.category === 'professional' && i.source === 'fixed')
        .map(
            ({
                source,
                locked,
                hidden,
                editable,
                rule_ref,
                section_code,
                section_name,
                category,
                ...rest
            }) => ({ ...rest, sst: Boolean(rest.sst) }),
        );
    rules.disbursements = all
        .filter((i) => i.category === 'disbursement' && i.source === 'fixed')
        .map(
            ({
                source,
                locked,
                hidden,
                editable,
                rule_ref,
                category,
                ...rest
            }) => ({ ...rest, sst: Boolean(rest.sst) }),
        );
    rules.sections = workspace.value.sections.map((section) => ({
        code: section.code,
        name: section.name,
        category: section.category,
        category_id: section.category_id ?? section.category,
        items: section.items.map((item) => ({
            code: item.code,
            description: item.description,
            source: item.source,
            amount: Number(item.amount || 0),
            sst_applicable: Boolean(item.sst),
            hidden: Boolean(item.hidden),
            editable: item.editable !== false,
            ...(item.rule_ref ? { rule_ref: item.rule_ref } : {}),
            ...(item.formula ? { formula: clone(item.formula) } : {}),
            ...(item.input_bindings
                ? { input_bindings: clone(item.input_bindings) }
                : {}),
            ...(item.code === 'ccm_search'
                ? { input_key: 'ccm_search_amount' }
                : {}),
            ...(item.code === 'charge'
                ? {
                      input_bindings: {
                          facility_legal_fee: 'item:facilities_agreement',
                      },
                  }
                : {}),
        })),
    }));
    form.rules = rules;
}
function versionName(template: Template): string {
    return (
        template.rules.version_label ||
        (template.version === 1 ? 'v2026.3.25' : `v${template.version}`)
    );
}
function save() {
    sync();
    form.put(`/templates/${active.value.id}`, { preserveScroll: true });
}
function saveAndActivate() {
    sync();
    const id = active.value.id;
    form.put(`/templates/${id}`, {
        preserveScroll: true,
        onSuccess: () => router.post(`/templates/${id}/activate`),
    });
}
function publish() {
    sync();
    form.post(`/templates/${active.value.id}/publish`, {
        preserveScroll: true,
    });
}
async function compareImpact() {
    sync();
    impactBusy.value = true;
    impact.value = null;
    impactErrors.value = [];
    try {
        const token = decodeURIComponent(
            document.cookie
                .split('; ')
                .find((value) => value.startsWith('XSRF-TOKEN='))
                ?.split('=')[1] ?? '',
        );
        const response = await toolRequest(`/templates/${active.value.id}/impact`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-XSRF-TOKEN': token,
            },
            body: JSON.stringify({
                rules: form.rules,
                rule_catalog_id: form.rule_catalog_id || null,
                inputs: {
                    loan_amount: impactLoan.value,
                    ccm_search_amount: 0,
                    finance_legal_fee: false,
                    legal_fee_financed_amount: 0,
                    finance_insurance: false,
                    insurance_financed_amount: 0,
                },
            }),
        });
        const data = await response.json();
        if (!response.ok)
            impactErrors.value = data.errors
                ? (Object.values(data.errors).flat() as string[])
                : [data.message ?? 'Unable to compare versions.'];
        else impact.value = data;
    } catch {
        impactErrors.value = ['Unable to reach the comparison service.'];
    } finally {
        impactBusy.value = false;
    }
}
function createBusiness() {
    if (!createForm.code) createForm.code = slug(createForm.name);
    createForm.post('/templates');
}
</script>

<template>
    <Head title="Templates" />
    <Dialog :open="!!deletingCategory" @update:open="open => { if (!open) deletingCategory = null; }"><DialogContent><DialogHeader><DialogTitle>Delete category</DialogTitle><DialogDescription>Choose where to move its sections, or delete the category together with its sections and items. Existing quotations are unchanged.</DialogDescription></DialogHeader><label class="field"><span>Move sections to</span><select v-model="destinationCategory" class="rounded border bg-background p-2"><option value="">Please select</option><option v-for="c in categories.filter(c => c.code !== deletingCategory?.code)" :key="c.code" :value="c.code">{{ c.name }}</option></select></label><div class="flex flex-wrap gap-2"><Button variant="outline" @click="deletingCategory = null">Cancel</Button><Button :disabled="!destinationCategory" @click="removeCategory(true)">Move sections and delete</Button><Button variant="destructive" :disabled="!workspace.sections.some(s => (s.category_id ?? s.category) !== deletingCategory?.code)" @click="removeCategory(false)">Delete with contents</Button></div></DialogContent></Dialog>
    <div
        v-if="Object.keys(form.errors).length"
        role="alert"
        class="border-destructive text-destructive m-4 rounded-md border p-4 text-sm"
    >
        <p v-for="(error, key) in form.errors" :key="key">{{ error }}</p>
    </div>
    <div
        class="mx-auto w-full max-w-[1600px] min-w-0 space-y-5 overflow-x-clip p-4 lg:p-6"
    >
        <header class="flex flex-wrap items-start justify-between gap-4">
            <div>
                <Link href="/templates" class="mb-3 inline-block text-sm underline underline-offset-4">Back to templates</Link>
                <h1 class="break-words text-2xl font-semibold">{{ form.name || 'Loan Refinance template' }}</h1>
                <p class="text-muted-foreground mt-1 text-sm">
                    Save changes to this version, or create a separate version.
                    Existing quotations keep their saved settings.
                </p>
            </div>
            <div class="flex flex-wrap gap-2">
                <Button v-if="active.status === 'draft'" variant="outline" @click="openEditor('test')">Test calculations</Button><Button v-if="undo" variant="outline" @click="undo()"
                    ><Undo2 />Undo removal</Button
                ><Button @click="openEditor('version')"
                    ><Archive />New version</Button
                ><Button variant="outline" :disabled="form.processing" @click="save"
                        ><Save />Save this version</Button
                    ><Button
                        v-if="active.status !== 'active'"
                        @click="saveAndActivate"
                        >Set as Active</Button
                    >
            </div>
        </header>
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4"><div><p class="font-semibold">{{ workspace.layout.document_title }}</p><p class="text-sm text-muted-foreground">Select a category, section or item to edit in the side panel. Changes appear in the preview; save this version when ready.</p></div><Button variant="outline" @click="openEditor('document')"><Settings2 />Edit template details</Button></div>
        <Card v-if="false">
            <CardHeader><CardTitle>Template title</CardTitle></CardHeader>
            <CardContent class="grid gap-5 md:grid-cols-2">
                <label class="field"><span>Template title</span><Input v-model="form.name" maxlength="255" /><span class="text-xs text-muted-foreground">Name shown in Templates. Save this version to keep the change.</span></label>
                <label class="field"><span>Quotation document title</span><Input v-model="workspace.layout.document_title" maxlength="120" /><span class="text-xs text-muted-foreground">Heading shown in the preview, PDF and Excel, such as PROFORMA.</span></label>
            </CardContent>
        </Card>
        <Card v-if="false">
            <CardHeader><CardTitle>Category headings</CardTitle><p class="text-sm text-muted-foreground">Edit the two main category titles. Save this version to apply your changes.</p></CardHeader>
            <CardContent class="grid gap-5 md:grid-cols-2">
                <label class="field"><span>Professional fees category</span><Input v-model="workspace.layout.professional_heading" maxlength="255" /></label>
                <label class="field"><span>Disbursements category</span><Input v-model="workspace.layout.disbursement_heading" maxlength="255" /></label>
            </CardContent>
        </Card>
        <Card v-if="false">
            <CardHeader><CardTitle>Create a new version from {{ versionName(active) }}</CardTitle></CardHeader>
            <CardContent class="space-y-4">
                <p class="text-sm text-muted-foreground">Copies the saved version. Save current edits first if you want to include them.</p>
                <label class="field"><span>Change summary</span><Input v-model="versionForm.change_note" placeholder="Explain what will change" maxlength="1000" /></label>
                <p v-if="versionForm.errors.change_note" class="text-sm text-destructive">{{ versionForm.errors.change_note }}</p>
                <div class="flex flex-wrap gap-2"><Button :disabled="!versionForm.change_note.trim() || versionForm.processing" @click="createVersion">Create version</Button><Button variant="outline" @click="showNewVersion = false">Cancel</Button></div>
            </CardContent>
        </Card>
        <section
            aria-label="Templates"
            class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
            <button
                v-for="t in props.activeTemplates"
                :key="t.id"
                type="button"
                class="bg-background hover:border-foreground/40 flex min-h-24 items-start gap-3 rounded-lg border p-4 text-left"
                :class="
                    t.id === active.id
                        ? 'border-foreground ring-foreground ring-1'
                        : ''
                "
                @click="selectTemplate(t.id)"
            >
                <FileText class="mt-0.5 size-5" /><span
                    ><strong class="block">{{ t.name }}</strong
                    ><span class="text-muted-foreground mt-1 block text-sm"
                        >{{ versionName(t) }} · {{ t.status }}</span
                    ><span
                        v-if="t.status === 'draft'"
                        class="mt-2 block text-xs"
                        >Draft changes in progress</span
                    ></span
                ></button
            ><button
                v-if="false"
                type="button"
                class="text-muted-foreground min-h-24 rounded-lg border border-dashed text-sm"
                @click="showCreate = !showCreate"
            >
                <Plus class="mr-2 inline size-4" />New business
            </button>
        </section>
        <Card v-if="showCreate"
            ><CardHeader
                ><CardTitle
                    >Create another business template</CardTitle
                ></CardHeader
            ><CardContent
                ><form
                    class="grid gap-4 lg:grid-cols-4"
                    @submit.prevent="createBusiness"
                >
                    <label class="field"
                        ><span>Name</span
                        ><Input v-model="createForm.name" required /></label
                    ><label class="field"
                        ><span>Code</span
                        ><Input
                            v-model="createForm.code"
                            placeholder="Generated from name" /></label
                    ><label class="field"
                        ><span>Initial note</span
                        ><Input v-model="createForm.change_note" required
                    /></label>
                    <div class="flex items-end">
                        <Button class="w-full"><Plus />Create template</Button>
                    </div>
                </form></CardContent
            ></Card
        >
        <div
            class="template-workspace grid min-w-0 items-start gap-5"
        >
            <aside
                class="bg-background min-w-0 rounded-lg border"
            >
                <div class="flex items-center justify-between border-b p-3">
                    <div>
                        <h2 class="font-semibold">Sections</h2>
                        <p class="text-muted-foreground text-xs">
                            {{ workspace.sections.length }} sections
                        </p>
                    </div>
                    <Button
                        v-if="editable"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Add section"
                        @click="addSection()"
                        ><Plus
                    /></Button>
                </div>
                <nav class="flex flex-col gap-2 p-3">
                    <Button variant="outline" class="self-start" @click="addCategory"><Plus />Add category</Button>
                    <p class="text-xs text-muted-foreground px-3">Hold the grip briefly, then drag. Release at the marker to reorder. Save to keep changes.</p>
                    <p class="sr-only" role="status" aria-live="polite">{{ dragAnnouncement }}</p>
                    <button
                        type="button"
                        class="flex w-full gap-2 p-3 text-left text-sm"
                        :class="layoutMode ? 'bg-muted font-medium' : ''"
                        @click="openEditor('document')"
                    >
                        <Settings2 class="size-4" />Document layout</button
                    >
                    <section v-for="category in categories" :key="category.code" class="rounded-lg border p-3 space-y-3">
                        <div :data-category-code="category.code" class="category-controls relative flex flex-wrap items-end gap-3 rounded bg-muted p-3" :class="dragging === category.code ? 'shadow-xl ring-2 ring-primary z-20' : ''" :style="dragging === category.code ? { transform: `translateY(${dragOffset}px)`, pointerEvents: 'none' } : {}">
                            <div v-if="dropCode === category.code" class="absolute inset-x-0 h-1 bg-primary" :class="dropAfter ? '-bottom-1' : '-top-1'" />
                            <button type="button" class="touch-none cursor-grab p-3" :aria-label="`Drag category ${category.name}`" @pointerdown="dragSection($event, category.code, true)"><GripVertical class="size-5" /></button>
                            <div class="min-w-0 flex-1 basis-48"><p class="break-words font-semibold">{{ category.name }}</p><p class="text-xs text-muted-foreground">{{ category.type === 'professional' ? 'Professional fees' : 'Disbursements' }}</p></div>
                            <Button variant="outline" class="category-edit" @click="openEditor('category', category)">Edit category</Button>
                            <div class="flex gap-2"><Button variant="outline" :disabled="categories[0] === category" :aria-label="`Move ${category.name} up`" @click="moveCategory(category.code, -1)"><ArrowUp /></Button><Button variant="outline" :disabled="categories[categories.length - 1] === category" :aria-label="`Move ${category.name} down`" @click="moveCategory(category.code, 1)"><ArrowDown /></Button><Button variant="outline" :disabled="categories.length <= 1" :aria-label="`Delete category ${category.name}`" @click="deletingCategory = category; destinationCategory = ''"><Trash2 /></Button></div>
                        </div>
                        <p v-if="!workspace.sections.some(s => (s.category_id ?? s.category) === category.code)" class="text-sm text-muted-foreground">No sections. Add a section or assign an existing section to this category.</p>
                        <Button variant="outline" @click="addSection(category.code)"><Plus />Add section to this category</Button>
                        <div
                        v-for="s in workspace.sections.filter(s => (s.category_id ?? s.category) === category.code)"
                        :key="s.code"
                        :data-section-code="s.code"
                        class="relative flex min-w-0 items-center rounded border bg-background"
                        :class="dragging === s.code ? 'z-20 shadow-xl ring-2 ring-primary opacity-90' : ''"
                        :style="dragging === s.code ? { transform: `translateY(${dragOffset}px) scale(1.01)`, pointerEvents: 'none' } : {}"
                    >
                    <div v-if="dropCode === s.code" class="pointer-events-none absolute inset-x-0 h-1 rounded bg-primary" :class="dropAfter ? '-bottom-1.5' : '-top-1.5'" />
                    <button type="button" class="m-1 min-h-11 min-w-11 shrink-0 touch-none select-none rounded border bg-muted/50 p-3 hover:bg-muted active:cursor-grabbing active:bg-muted" :class="dragging === s.code ? 'cursor-grabbing' : 'cursor-grab'" :aria-label="`Drag ${s.name} to reorder`" title="Hold briefly, then drag to reorder" @pointerdown="dragSection($event, s.code)"><GripVertical class="size-4" /></button>
                    <button
                        type="button"
                        class="hover:bg-muted/50 flex w-full justify-between gap-2 p-3 text-left text-sm"
                        :class="
                            !layoutMode && section?.code === s.code
                                ? 'bg-muted font-medium'
                                : ''
                        "
                        @click="selectSection(s)"
                    >
                        <span class="min-w-0 break-words">{{ s.name }}</span
                        ><span class="text-muted-foreground text-xs">{{
                            s.items.length
                        }}</span>
                    </button>
                    </div>
                    </section>
                </nav>
            </aside>
            <main
                class="bg-background order-2 min-w-0 overflow-hidden rounded-lg border xl:order-1"
            >
                <div
                    v-if="workspace.layout.company_lines?.length"
                    class="border-b px-5 py-4 text-center text-xs leading-5"
                >
                    <p
                        v-for="line in workspace.layout.company_lines"
                        :key="line"
                    >
                        {{ line }}
                    </p>
                </div>
                <div class="border-b px-5 py-4 text-center">
                    <h2 class="text-lg font-semibold tracking-wide">
                        {{ workspace.layout.document_title }}
                    </h2>
                    <p class="text-muted-foreground mt-1 text-xs">
                        {{ form.name }} · {{ versionName(active) }}
                        {{ active.status }}
                    </p>
                </div>
                <div
                    class="grid grid-cols-[60px_minmax(0,1fr)] border-b text-sm sm:grid-cols-[60px_minmax(0,1fr)_60px_minmax(0,1fr)]"
                >
                    <b class="border-r p-2">PIC</b
                    ><span class="text-muted-foreground border-r p-2"
                        >Employee name</span
                    ><b class="border-r p-2">Date</b
                    ><span class="text-muted-foreground p-2">1 April 2026</span
                    ><b class="border-t border-r p-2">Client</b
                    ><span class="text-muted-foreground border-t border-r p-2"
                        >Client name</span
                    ><b class="border-t border-r p-2">Re</b
                    ><span class="text-muted-foreground border-t p-2"
                        >Matter description</span
                    >
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[620px] text-sm">
                        <thead class="bg-muted/40 text-xs">
                            <tr>
                                <th class="p-2 text-left">
                                    Item / Description
                                </th>
                                <th class="w-28 p-2 text-right">Amount (RM)</th>
                                <th class="w-28 p-2 text-right">Total (RM)</th>
                                <th class="w-24 p-2 text-right">SST</th>
                            </tr>
                        </thead>
                        <tbody
                            v-for="(s, si) in workspace.sections"
                            :key="s.code"
                        >
                            <tr
                                v-if="
                                    si === 0 ||
                                    (workspace.sections[si - 1].category_id ?? workspace.sections[si - 1].category) !==
                                        (s.category_id ?? s.category)
                                "
                                class="bg-muted border-y font-bold"
                            >
                                <th colspan="4" class="p-3 text-left">
                                    {{
                                        categories.find(c => c.code === (s.category_id ?? s.category))?.name
                                    }}
                                </th>
                            </tr>
                            <tr v-if="s.category === 'professional' && (si === 0 || (workspace.sections[si - 1].category_id ?? workspace.sections[si - 1].category) !== (s.category_id ?? s.category))"><td colspan="4" class="p-3 text-sm">{{ workspace.layout.professional_intro }}</td></tr>
                            <tr v-if="s.category === 'disbursement'" class="bg-muted/50 border-y">
                                <th
                                    colspan="4"
                                    class="p-2 text-left text-xs uppercase"
                                >
                                    {{ s.name }}
                                </th>
                            </tr>
                            <tr
                                v-for="(i, ii) in s.items"
                                :key="i.code"
                                class="hover:bg-muted/30 cursor-pointer border-b"
                                :class="
                                    itemCode === i.code
                                        ? 'bg-muted/20 outline outline-1 -outline-offset-1'
                                        : ''
                                "
                                @click="
                                    layoutMode = false;
                                    openEditor('item');
                                    sectionCode = s.code;
                                    itemCode = i.code;
                                "
                            >
                                <td
                                    class="p-2"
                                    :class="
                                        i.hidden
                                            ? 'text-muted-foreground line-through'
                                            : ''
                                    "
                                >
                                    {{ i.description }}
                                </td>
                                <td class="p-2 text-right">
                                    {{ money(i.amount) }}
                                </td>
                                <td />
                                <td class="p-2 text-right">
                                    {{
                                        i.sst
                                            ? money(
                                                  Number(i.amount ?? 0) *
                                                      Number(
                                                          active.rules
                                                              .sst_rate ?? 0.08,
                                                      ),
                                              )
                                            : '-'
                                    }}
                                </td>
                            </tr>
                            <tr v-if="editable">
                                <td colspan="4" class="p-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        class="w-full border border-dashed"
                                        @click="addItem(s)"
                                        ><Plus />Add item</Button
                                    >
                                </td>
                            </tr>
                            <tr v-if="si === workspace.sections.length - 1 || (workspace.sections[si + 1].category_id ?? workspace.sections[si + 1].category) !== (s.category_id ?? s.category)" class="border-b text-xs font-medium">
                                <td colspan="2" class="p-2 text-right">
                                </td>
                                <td class="p-2 text-right">
                                    {{ money(workspace.sections.filter(other => (other.category_id ?? other.category) === (s.category_id ?? s.category)).reduce((n, other) => n + subtotal(other), 0)) }}
                                </td>
                                <td />
                            </tr>
                        </tbody>
                        <tfoot class="font-semibold">
                            <tr class="border-t">
                                <td colspan="3" class="p-2 text-right">
                                    Total SST
                                </td>
                                <td class="p-2 text-right">{{ money(sst) }}</td>
                            </tr>
                            <tr class="border-t">
                                <td colspan="3" class="p-2 text-right">
                                    TOTAL PAYABLE INCLUSIVE OF SST
                                </td>
                                <td class="p-2 text-right">
                                    RM {{ money(total + sst) }}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <p class="text-muted-foreground border-t p-4 text-xs">
                    {{ workspace.layout.footer_note }}
                </p>
                <div
                    v-if="workspace.layout.payment_lines?.length"
                    class="text-muted-foreground border-t p-4 text-xs leading-5"
                >
                    <p
                        v-for="line in workspace.layout.payment_lines"
                        :key="line"
                        class="break-words"
                    >
                        {{ line }}
                    </p>
                </div>
            </main>
            <Sheet v-model:open="editorOpen">
            <SheetContent side="right" class="template-workspace w-full max-w-full gap-0 sm:w-[620px] sm:max-w-[620px]">
                <SheetHeader class="shrink-0 border-b p-5 pr-12"><SheetTitle>{{ editorMode === 'document' ? 'Template details' : editorMode === 'category' ? 'Category settings' : editorMode === 'version' ? 'New version' : editorMode === 'test' ? 'Test calculations' : 'Section & item settings' }}</SheetTitle><SheetDescription>Editing {{ versionName(active) }}. Closing keeps edits on this page. Save to persist them.</SheetDescription></SheetHeader>
                <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                <div v-if="editorMode === 'item'" class="space-y-4 p-5 pb-0"><div class="grid grid-cols-2 gap-2" aria-label="Editor options"><Button :variant="itemTab === 'section' ? 'default' : 'outline'" @click="itemTab = 'section'">Section</Button><Button :variant="itemTab === 'item' ? 'default' : 'outline'" :disabled="!section?.items.length" @click="itemTab = 'item'">Item & formula</Button></div><label v-if="itemTab === 'item'" class="field"><span>Editing item</span><select v-model="itemCode" class="w-full rounded-md border bg-background p-2"><option v-for="entry in section?.items ?? []" :key="entry.code" :value="entry.code">{{ entry.description }}</option></select></label></div>
                <div v-if="editorMode === 'category' && editingCategory" class="space-y-5 p-5"><label class="field"><span>Category name</span><Input v-model="editingCategory.name" maxlength="255" /></label><label class="field"><span>Calculation type</span><select v-model="editingCategory.type" class="w-full rounded border bg-background p-2" @change="arrangeSections"><option value="professional">Professional fees</option><option value="disbursement">Disbursements</option></select></label><p class="text-sm text-muted-foreground">Sections and items stay in this category. The calculation type determines which fee total includes them; SST remains controlled per item.</p></div>
                <div v-if="editorMode === 'version'" class="space-y-5 p-5"><p class="text-sm text-muted-foreground">Copies the saved version. Save existing edits before creating another version.</p><label class="field"><span>Change summary</span><Input v-model="versionForm.change_note" maxlength="1000" /></label><p v-if="versionForm.errors.change_note" class="text-sm text-destructive">{{ versionForm.errors.change_note }}</p></div>
                <fieldset
                    v-if="editorMode === 'item' && itemTab === 'section' && section"
                    :disabled="!editable"
                    class="min-w-0 space-y-4 border-b p-4"
                >
                    <h3 class="font-semibold">Section settings</h3>
                    <label class="field"
                        ><span>Section name</span
                        ><textarea
                            v-model="section.name"
                            class="form-textarea w-full"
                            rows="2"
                        />
                    </label>
                    <label class="field"
                        ><span>Category</span>
                        <Select :model-value="section.category_id ?? section.category" @update:model-value="value => { section!.category_id = String(value); arrangeSections(); }"
                            ><SelectTrigger class="w-full"
                                ><SelectValue /></SelectTrigger
                            ><SelectContent
                                ><SelectItem v-for="c in categories" :key="c.code" :value="c.code">{{ c.name }}</SelectItem></SelectContent
                            ></Select
                        >
                    </label>
                    <div class="grid grid-cols-2 gap-2">
                        <Button
                            variant="outline"
                            :disabled="
                                workspace.sections.indexOf(section) === 0
                            "
                            @click="moveSection(-1)"
                            ><ArrowUp />Move up</Button
                        >
                        <Button
                            variant="outline"
                            :disabled="
                                workspace.sections.indexOf(section) ===
                                workspace.sections.length - 1
                            "
                            @click="moveSection(1)"
                            ><ArrowDown />Move down</Button
                        >
                    </div>
                    <Button
                        variant="outline"
                        class="w-full"
                        :disabled="workspace.sections.length <= 1"
                        @click="removeSection"
                        ><Trash2 />Remove section and items</Button
                    >
                    <p class="text-muted-foreground text-xs">
                        Removal includes this section's items. Use Undo removal
                        to restore them before saving. Keep at least one
                        section.
                    </p>
                </fieldset>
                <fieldset
                    v-if="editorMode === 'document'"
                    :disabled="!editable"
                    class="space-y-4 p-4 disabled:opacity-70"
                >
                    <label class="field"
                        ><span>Template name</span
                        ><Input v-model="form.name" /></label
                    ><label class="field"
                        ><span>Document title</span
                        ><Input
                            v-model="workspace.layout.document_title" /></label
                    ><label class="field"
                        ><span>Version name</span
                        ><Input
                            v-model="form.rules.version_label"
                            placeholder="v2026.3.25 or v2026.3.25.1"
                        />
                        <span class="text-muted-foreground text-xs"
                            >Use a date for a release and add .1, .2 for minor
                            revisions. Published versions stay unchanged.</span
                        > </label
                    ><label v-if="false" class="field"
                        ><span>Document title</span
                        ><Input
                            v-model="workspace.layout.document_title" /></label
                    ><label class="field"
                        ><span>Main amount field label</span
                        ><Input
                            v-model="workspace.inputSchema.primary_amount_label"
                            placeholder="e.g. Loan Amount" /></label
                    ><label class="flex items-center gap-2 text-sm"
                        ><Checkbox
                            v-model="workspace.inputSchema.supports_financing"
                        />Show financing options</label
                    ><label class="flex items-center gap-2 text-sm"
                        ><Checkbox
                            v-model="workspace.inputSchema.supports_ccm_search"
                        />Show CCM Search input</label
                    ><label class="field"
                        ><span>Footer note</span
                        ><textarea
                            v-model="workspace.layout.footer_note"
                            class="form-textarea"
                            rows="5"
                        /></label
                    ><label class="field"
                        ><span>Company header (one line each)</span
                        ><textarea
                            :value="layoutLines('company_lines')"
                            class="form-textarea"
                            rows="4"
                            placeholder="Optional company letterhead"
                            @input="
                                setLayoutLines(
                                    'company_lines',
                                    ($event.target as HTMLTextAreaElement)
                                        .value,
                                )
                            "
                        /></label
                    ><label class="field"
                        ><span>Payment instructions (one line each)</span
                        ><textarea
                            :value="layoutLines('payment_lines')"
                            class="form-textarea"
                            rows="6"
                            placeholder="Optional payment details"
                            @input="
                                setLayoutLines(
                                    'payment_lines',
                                    ($event.target as HTMLTextAreaElement)
                                        .value,
                                )
                            "
                        /></label
                    ><label class="field"
                        ><span>SST rate (decimal: 0.08 = 8%)</span>
                        <Input
                            v-model.number="form.rules.sst_rate"
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                        /> </label
                    ><label v-if="false" class="field"
                        ><span>Rules version</span
                        ><Select v-model="form.rule_catalog_id"
                            ><SelectTrigger class="w-full"
                                ><SelectValue /></SelectTrigger
                            ><SelectContent
                                ><SelectItem
                                    v-for="c in props.ruleCatalogs"
                                    :key="c.id"
                                    :value="String(c.id)"
                                    >{{ c.name }} · v{{ c.version }}</SelectItem
                                ></SelectContent
                            ></Select
                        ></label
                    >
                </fieldset>
                <fieldset
                    v-else-if="editorMode === 'item' && itemTab === 'item' && item"
                    :disabled="!editable"
                    class="space-y-4 p-4 disabled:opacity-70"
                >
                    <label class="field"
                        ><span>Item name</span
                        ><Input v-model="item.description" /></label
                    ><label class="field"
                        ><span>Charging method</span
                        ><Select v-model="item.source" :disabled="item.locked"
                            ><SelectTrigger class="w-full"
                                ><SelectValue /></SelectTrigger
                            ><SelectContent
                                ><SelectItem value="fixed"
                                    >Fixed amount</SelectItem
                                ><SelectItem value="manual"
                                    >Employee enters amount</SelectItem
                                ><SelectItem value="rule"
                                    >Calculated by rule</SelectItem
                                ></SelectContent
                            ></Select
                        ></label
                    ><label v-if="item.source === 'fixed'" class="field"
                        ><span>Default amount (RM)</span
                        ><Input
                            v-model.number="item.amount"
                            type="number"
                            min="0"
                            step=".01"
                    /></label>
                    <div
                        v-if="item.source === 'rule'"
                        class="min-w-0 space-y-3"
                    >
                        <p class="text-muted-foreground text-xs">
                            This formula is saved with this template version.
                        </p>
                        <FeeRuleEditor
                            v-if="item.formula"
                            :rule="item.formula"
                            :disabled="!editable"
                        />
                        <Button
                            v-else
                            variant="outline"
                            @click="
                                item.formula = {
                                    method: 'percentage',
                                    basis: 'loan_amount',
                                    rate: 0,
                                    zero_when_basis_zero: true,
                                }
                            "
                            >Set up formula</Button
                        >
                    </div>
                    <label class="flex items-center gap-2 text-sm"
                        ><Checkbox v-model="item.sst" />Apply SST</label
                    ><label class="flex items-center gap-2 text-sm"
                        ><Checkbox v-model="item.hidden" />Hide by
                        default</label
                    ><label class="flex items-center gap-2 text-sm"
                        ><Checkbox v-model="item.editable" />Employee may
                        edit</label
                    >
                    <div class="grid grid-cols-2 gap-2">
                        <Button variant="outline" @click="move(-1)"
                            ><ArrowUp />Move up</Button
                        ><Button variant="outline" @click="move(1)"
                            ><ArrowDown />Move down</Button
                        ><Button variant="outline" @click="duplicateItem"
                            ><Copy />Duplicate</Button
                        ><Button
                            variant="outline"
                            :disabled="item.locked"
                            @click="removeItem"
                            ><Trash2 />Remove</Button
                        >
                    </div>
                    <p v-if="item.locked" class="text-muted-foreground text-xs">
                        This core row is protected in the legacy template.
                        Maintain its calculation in Rules & conditions.
                    </p>
                </fieldset>
                <div
                    v-else
                    class="text-muted-foreground p-8 text-center text-sm"
                >
                    Select an item in the preview.
                </div>
        <Card v-if="editorMode === 'test'"
            ><CardHeader
                ><CardTitle
                    >Test and compare before publishing</CardTitle
                ></CardHeader
            ><CardContent class="space-y-4"
                ><div class="grid gap-4 sm:grid-cols-[220px_auto] sm:items-end">
                    <label class="field"
                        ><span>Test loan amount (RM)</span
                        ><Input
                            v-model.number="impactLoan"
                            type="number"
                            min="0"
                            step="1000" /></label
                    ><Button
                        variant="outline"
                        :disabled="impactBusy"
                        @click="compareImpact"
                        >{{
                            impactBusy
                                ? 'Comparing…'
                                : 'Compare with current version'
                        }}</Button
                    >
                </div>
                <div
                    v-if="impactErrors.length"
                    role="alert"
                    class="text-destructive space-y-1 text-sm"
                >
                    <p v-for="error in impactErrors" :key="error">
                        {{ error }}
                    </p>
                </div>
                <div v-if="impact" class="space-y-4" aria-live="polite">
                    <div class="grid gap-3 sm:grid-cols-3">
                        <div class="rounded-md border p-3">
                            <span class="text-muted-foreground text-xs"
                                >Current v{{ impact.baseline.version }}</span
                            ><strong class="mt-1 block"
                                >RM
                                {{ money(impact.before.total_payable) }}</strong
                            >
                        </div>
                        <div class="rounded-md border p-3">
                            <span class="text-muted-foreground text-xs"
                                >Draft v{{ impact.candidate.version }}</span
                            ><strong class="mt-1 block"
                                >RM
                                {{ money(impact.after.total_payable) }}</strong
                            >
                        </div>
                        <div class="rounded-md border p-3">
                            <span class="text-muted-foreground text-xs"
                                >Difference</span
                            ><strong
                                class="mt-1 block"
                                :class="
                                    impact.total_delta > 0
                                        ? 'text-destructive'
                                        : ''
                                "
                                >{{ impact.total_delta >= 0 ? '+' : '' }}RM
                                {{ money(impact.total_delta) }}</strong
                            >
                        </div>
                    </div>
                    <p
                        v-if="!impact.items.length"
                        class="text-muted-foreground text-sm"
                    >
                        No item or amount changes for this test amount.
                    </p>
                    <div v-else class="overflow-x-auto rounded-md border">
                        <table class="w-full min-w-[560px] text-sm">
                            <thead class="bg-muted/50 text-xs">
                                <tr>
                                    <th class="p-2 text-left">Item</th>
                                    <th class="p-2 text-left">Change</th>
                                    <th class="p-2 text-right">Current</th>
                                    <th class="p-2 text-right">Draft</th>
                                    <th class="p-2 text-right">Difference</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in impact.items"
                                    :key="row.code"
                                    class="border-t"
                                >
                                    <td class="p-2">{{ row.description }}</td>
                                    <td class="p-2 capitalize">
                                        {{ row.status }}
                                    </td>
                                    <td class="p-2 text-right">
                                        {{ money(row.before) }}
                                    </td>
                                    <td class="p-2 text-right">
                                        {{ money(row.after) }}
                                    </td>
                                    <td class="p-2 text-right">
                                        {{ row.delta >= 0 ? '+' : ''
                                        }}{{ money(row.delta) }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div></CardContent
            ></Card
        >
                </div>
                <div class="flex shrink-0 flex-wrap gap-3 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="outline" class="flex-1" @click="editorOpen = false">Back to preview</Button><Button v-if="editorMode === 'version'" class="flex-1" :disabled="!versionForm.change_note.trim() || versionForm.processing" @click="createVersion">Create version</Button><Button v-else class="flex-1" :disabled="form.processing" @click="save">{{ form.processing ? 'Saving…' : 'Save this version' }}</Button></div>
            </SheetContent>
            </Sheet>
        </div>
        <Card
            ><CardHeader><CardTitle>Version history</CardTitle></CardHeader
            ><CardContent class="p-0"
                ><table class="hidden w-full table-fixed text-left text-sm xl:table" aria-label="Version history">
                    <thead
                        class="bg-muted/50 text-muted-foreground text-xs uppercase"
                    >
                        <tr>
                            <th scope="col" class="w-[18%] p-4">Version</th>
                            <th scope="col" class="w-[14%] p-4">Status</th>
                            <th scope="col" class="p-4">Change summary</th>
                            <th scope="col" class="w-[32%] p-4">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="v in history" :key="v.id" class="border-t">
                            <td class="p-4 font-medium">{{ versionName(v) }}</td>
                            <td class="p-4 capitalize">{{ v.status }}</td>
                            <td class="p-4 whitespace-pre-wrap">
                                {{ v.change_note || '-' }}
                            </td>
                            <td class="p-4"><div class="flex flex-wrap items-center gap-2">
                                <Button variant="outline" @click="selectTemplate(v.id)">Edit</Button>
                                <Button variant="outline" @click="deleteVersion(v)"><Trash2 />Delete</Button>
                                <Button
                                    v-if="v.status !== 'active'"
                                    variant="outline"
                                    @click="
                                        router.post(
                                            `/templates/${v.id}/activate`,
                                        )
                                    "
                                    >Set as Active</Button
                                >
                            </div></td>
                        </tr>
                    </tbody>
                </table>
                <div class="divide-y xl:hidden" aria-label="Version history">
                    <article
                        v-for="v in history"
                        :key="v.id"
                        class="min-w-0 space-y-4 p-4 sm:p-5"
                    >
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="min-w-0 break-words font-medium">{{ versionName(v) }}</span>
                            <span class="rounded bg-muted px-2 py-1 text-xs capitalize">{{ v.status }}</span>
                        </div>
                        <div class="space-y-1"><p class="text-xs font-medium text-muted-foreground">Change summary</p>
                        <p class="break-words whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                            {{ v.change_note || '-' }}
                        </p></div>
                        <div class="space-y-2 border-t pt-3"><p class="text-xs font-medium text-muted-foreground">Actions</p>
                        <div class="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap">
                        <Button variant="outline" @click="selectTemplate(v.id)">Edit</Button>
                        <Button variant="outline" @click="deleteVersion(v)"><Trash2 />Delete</Button>
                        <Button
                            v-if="v.status !== 'active'"
                            variant="outline"
                            @click="router.post(`/templates/${v.id}/activate`)"
                            >Set as Active</Button
                        >
                        </div></div>
                    </article>
                </div></CardContent
            ></Card
        >
    </div>
</template>

<style scoped>
.template-workspace :deep(.form-textarea) {
    border: 1px solid var(--input);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    background: var(--background);
}
.template-workspace .category-controls :deep(.category-edit) {
    width: auto;
    padding-inline: 0.75rem;
}
.template-workspace .category-controls :deep(button),
.template-workspace .category-controls :deep(input),
.template-workspace .category-controls :deep(select) {
    height: 2.5rem !important;
    min-height: 2.5rem !important;
}
.template-workspace .category-controls :deep(button) {
    width: 2.5rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.template-workspace :deep(fieldset),
.template-workspace :deep(.field) {
    min-width: 0;
}
.template-workspace :deep(button:not([role='checkbox']):not([role='switch'])) {
    white-space: normal;
    height: auto;
    min-height: 2.25rem;
}
.template-workspace :deep([data-slot='checkbox']) {
    width: 1rem;
    height: 1rem;
    min-height: 1rem;
    flex: 0 0 1rem;
}
.template-workspace :deep(label:has([data-slot='checkbox'])) {
    gap: 0.75rem;
    min-height: 2.75rem;
    align-items: center;
    line-height: 1.5;
}
.template-workspace :deep(fieldset) {
    padding: 1.5rem;
}
.template-workspace :deep(.field) {
    gap: 0.5rem;
}
.template-workspace :deep(th),
.template-workspace :deep(td) {
    vertical-align: top;
    overflow-wrap: anywhere;
}
.template-workspace :deep(textarea) {
    min-width: 0;
    max-width: 100%;
}
</style>
