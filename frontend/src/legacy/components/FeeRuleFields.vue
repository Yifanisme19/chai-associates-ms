<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { feeInputs, ruleSummary, type FeeRule } from '@/lib/fee-rule';

const props = withDefaults(
    defineProps<{ rule: FeeRule; disabled?: boolean; depth?: number }>(),
    { disabled: false, depth: 0 },
);
const methods = [
    ['fixed', 'Fixed amount'],
    ['percentage', 'Percentage of an amount'],
    ['per_unit', 'Price × quantity'],
    ['first_additional', 'First item + additional items'],
    ['tiered', 'Progressive percentage tiers'],
    ['banded', 'Fixed fee by amount band'],
    ['conditional', 'Different fee by condition'],
    ['note', 'Reference note only'],
];
const bases = computed(() => {
    const values: Array<readonly [string, string]> = [...feeInputs];
    if (props.rule.basis && !values.some(([key]) => key === props.rule.basis))
        values.push([props.rule.basis, props.rule.basis.replaceAll('_', ' ')]);
    return values;
});
const pct = (value?: number | null) =>
    value == null ? '' : Number((value * 100).toFixed(8));
function methodChanged(value: unknown) {
    if (typeof value !== 'string') return;
    props.rule.method = value;
    if (value === 'per_unit') props.rule.unit_size ??= 1;
    if (value === 'first_additional') props.rule.additional_amount ??= 0;
    if (value === 'tiered') props.rule.tiers ??= [{ up_to: null, rate: 0 }];
    if (value === 'banded') props.rule.bands ??= [{ up_to: null, amount: 0 }];
    if (value === 'conditional')
        props.rule.cases ??= [
            {
                when: { citizenship: 'local' },
                rule: { method: 'fixed', amount: 0 },
            },
        ];
}
function changeCaseField(index: number, oldKey: string, value: unknown) {
    if (typeof value !== 'string') return;
    const when = props.rule.cases![index].when;
    if (value !== oldKey && !(value in when)) {
        const previous = when[oldKey];
        delete when[oldKey];
        when[value] = previous;
    }
}
</script>

<template>
    <div class="space-y-4">
        <p class="bg-muted rounded-md p-3 text-sm">{{ ruleSummary(rule) }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-2 text-sm"
                ><span>How is this fee charged?</span>
                <Select
                    :model-value="rule.method"
                    :disabled="disabled"
                    @update:model-value="methodChanged"
                    ><SelectTrigger
                        class="w-full"
                        aria-label="How is this fee charged?"
                        ><SelectValue /></SelectTrigger
                    ><SelectContent>
                        <SelectItem
                            v-if="rule.method === 'formula'"
                            value="formula"
                            >Legacy formula / reference</SelectItem
                        >
                        <SelectItem
                            v-for="[value, label] in methods.filter(
                                ([value]) =>
                                    depth < 5 || value !== 'conditional',
                            )"
                            :key="value"
                            :value="value"
                            >{{ label }}</SelectItem
                        >
                    </SelectContent></Select
                >
            </label>
            <label
                v-if="
                    !['fixed', 'conditional', 'note', 'formula'].includes(
                        rule.method,
                    )
                "
                class="space-y-2 text-sm"
                ><span>Calculate using</span>
                <Select v-model="rule.basis" :disabled="disabled"
                    ><SelectTrigger class="w-full" aria-label="Calculate using"
                        ><SelectValue
                            placeholder="Choose an amount or quantity" /></SelectTrigger
                    ><SelectContent
                        ><SelectItem
                            v-for="[value, label] in bases"
                            :key="value"
                            :value="value"
                            >{{ label }}</SelectItem
                        ></SelectContent
                    ></Select
                >
            </label>
            <label
                v-if="
                    ['fixed', 'per_unit', 'first_additional'].includes(
                        rule.method,
                    )
                "
                class="space-y-2 text-sm"
                ><span>{{
                    rule.method === 'first_additional'
                        ? 'First item fee (RM)'
                        : 'Amount (RM)'
                }}</span
                ><Input
                    :model-value="rule.amount ?? ''"
                    type="number"
                    min="0"
                    step="0.01"
                    :disabled="disabled"
                    @update:model-value="
                        rule.amount = $event === '' ? null : Number($event)
                    "
            /></label>
            <label
                v-if="
                    rule.method === 'percentage' ||
                    (rule.method === 'tiered' && !rule.tiers?.length)
                "
                class="space-y-2 text-sm"
                ><span>Percentage (%)</span
                ><Input
                    :model-value="pct(rule.rate)"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    :disabled="disabled"
                    @update:model-value="
                        rule.rate = $event === '' ? null : Number($event) / 100
                    "
                /><span class="text-muted-foreground text-xs"
                    >Enter 1.25 for 1.25%.</span
                ></label
            >
            <label v-if="rule.method === 'per_unit'" class="space-y-2 text-sm"
                ><span>Units covered by this price</span
                ><Input
                    v-model.number="rule.unit_size"
                    type="number"
                    min="0.0001"
                    :disabled="disabled"
                    placeholder="1"
                /><span class="text-muted-foreground text-xs"
                    >Partial units round up. Example: RM1 per RM250 of annual
                    rent.</span
                ></label
            >
            <label
                v-if="rule.method === 'first_additional'"
                class="space-y-2 text-sm"
                ><span>Each additional item (RM)</span
                ><Input
                    v-model.number="rule.additional_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    :disabled="disabled"
            /></label>
        </div>
        <div v-if="rule.method === 'tiered'" class="space-y-3">
            <p class="text-muted-foreground text-sm">
                Each percentage applies only to the portion in that tier. Limits
                are inclusive; leave the last limit blank for no upper limit.
            </p>
            <p v-if="!rule.tiers?.length" class="text-sm">
                This legacy record contains only part of a scale. Keep its rate
                for existing templates, or configure a complete scale before
                linking it to a new item.
            </p>
            <div
                v-for="(tier, index) in rule.tiers"
                :key="index"
                class="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
                <label class="space-y-1 text-sm"
                    ><span>{{
                        index
                            ? 'Next portion up to (RM)'
                            : 'First portion up to (RM)'
                    }}</span
                    ><Input
                        :model-value="tier.up_to ?? ''"
                        type="number"
                        min="0"
                        :disabled="disabled"
                        placeholder="No upper limit"
                        @update:model-value="
                            tier.up_to = $event === '' ? null : Number($event)
                        "
                /></label>
                <label class="space-y-1 text-sm"
                    ><span>Rate (%)</span
                    ><Input
                        :model-value="pct(tier.rate)"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        :disabled="disabled"
                        @update:model-value="tier.rate = Number($event) / 100"
                /></label>
                <Button
                    v-if="!disabled"
                    variant="outline"
                    @click="rule.tiers!.splice(index, 1)"
                    >Remove tier</Button
                >
            </div>
            <Button
                v-if="!disabled"
                variant="outline"
                @click="(rule.tiers ??= []).push({ up_to: null, rate: 0 })"
                >Add tier</Button
            >
        </div>
        <div v-if="rule.method === 'banded'" class="space-y-3">
            <p class="text-muted-foreground text-sm">
                One fixed fee for the matching band, not a progressive total.
                Limits are inclusive; leave the final limit blank for no upper
                limit.
            </p>
            <div
                v-for="(band, index) in rule.bands"
                :key="index"
                class="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
                <label class="space-y-1 text-sm"
                    ><span>Amount up to (RM)</span
                    ><Input
                        :model-value="band.up_to ?? ''"
                        type="number"
                        min="0"
                        :disabled="disabled"
                        placeholder="No upper limit"
                        @update:model-value="
                            band.up_to = $event === '' ? null : Number($event)
                        "
                /></label>
                <label class="space-y-1 text-sm"
                    ><span>Fee (RM)</span
                    ><Input
                        v-model.number="band.amount"
                        type="number"
                        min="0"
                        step="0.01"
                        :disabled="disabled"
                /></label>
                <Button
                    v-if="!disabled"
                    variant="outline"
                    @click="rule.bands!.splice(index, 1)"
                    >Remove band</Button
                >
            </div>
            <Button
                v-if="!disabled"
                variant="outline"
                @click="(rule.bands ??= []).push({ up_to: null, amount: 0 })"
                >Add band</Button
            >
        </div>
        <div v-if="rule.method === 'conditional'" class="space-y-3">
            <p class="text-muted-foreground text-sm">
                Cases are checked from top to bottom. The first match is used.
                Put Otherwise last.
            </p>
            <div
                v-for="(item, index) in rule.cases"
                :key="index"
                class="space-y-3 rounded-md border p-3"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-sm font-medium">Case {{ index + 1 }}</span
                    ><Button
                        v-if="!disabled"
                        variant="outline"
                        @click="rule.cases!.splice(index, 1)"
                        >Remove case</Button
                    >
                </div>
                <p v-if="!Object.keys(item.when).length" class="text-sm">
                    Otherwise (no previous case matched)
                </p>
                <div
                    v-for="(expected, field) in item.when"
                    :key="field"
                    class="grid gap-3 sm:grid-cols-2"
                >
                    <label class="space-y-1 text-sm"
                        ><span>When (all conditions must match)</span
                        ><Select
                            :model-value="String(field)"
                            :disabled="disabled"
                            @update:model-value="
                                changeCaseField(index, String(field), $event)
                            "
                            ><SelectTrigger class="w-full"
                                ><SelectValue /></SelectTrigger
                            ><SelectContent
                                ><SelectItem
                                    v-if="!bases.some(([key]) => key === field)"
                                    :value="String(field)"
                                    >{{ field }}</SelectItem
                                ><SelectItem
                                    v-for="[key, label] in bases"
                                    :key="key"
                                    :value="key"
                                    >{{ label }}</SelectItem
                                ></SelectContent
                            ></Select
                        ></label
                    >
                    <label class="space-y-1 text-sm"
                        ><span>Value type</span
                        ><Select
                            :model-value="typeof expected"
                            :disabled="disabled"
                            @update:model-value="
                                item.when[field] =
                                    $event === 'boolean'
                                        ? true
                                        : $event === 'number'
                                          ? 0
                                          : ''
                            "
                            ><SelectTrigger class="w-full"
                                ><SelectValue /></SelectTrigger
                            ><SelectContent
                                ><SelectItem value="string">Text</SelectItem
                                ><SelectItem value="number">Number</SelectItem
                                ><SelectItem value="boolean"
                                    >Yes / No</SelectItem
                                ></SelectContent
                            ></Select
                        ></label
                    >
                    <label class="space-y-1 text-sm"
                        ><span>Equals</span
                        ><Select
                            v-if="typeof expected === 'boolean'"
                            :model-value="String(expected)"
                            :disabled="disabled"
                            @update:model-value="
                                item.when[field] = $event === 'true'
                            "
                            ><SelectTrigger class="w-full"
                                ><SelectValue /></SelectTrigger
                            ><SelectContent
                                ><SelectItem value="true">Yes</SelectItem
                                ><SelectItem value="false"
                                    >No</SelectItem
                                ></SelectContent
                            ></Select
                        ><Input
                            v-else
                            :model-value="String(expected)"
                            :type="
                                typeof expected === 'number' ? 'number' : 'text'
                            "
                            :disabled="disabled"
                            @update:model-value="
                                item.when[field] =
                                    typeof expected === 'number'
                                        ? Number($event)
                                        : String($event)
                            "
                    /></label>
                    <Button
                        v-if="!disabled"
                        variant="outline"
                        class="self-end"
                        @click="delete item.when[field]"
                        >Remove condition</Button
                    >
                </div>
                <Button
                    v-if="!disabled"
                    variant="outline"
                    :disabled="bases.every(([key]) => key in item.when)"
                    @click="
                        item.when[
                            bases.find(([key]) => !(key in item.when))![0]
                        ] = ''
                    "
                    >Add matching condition</Button
                >
                <FeeRuleFields
                    :rule="item.rule"
                    :disabled="disabled"
                    :depth="depth + 1"
                />
            </div>
            <Button
                v-if="!disabled"
                variant="outline"
                @click="
                    (rule.cases ??= []).push({
                        when: {},
                        rule: { method: 'fixed', amount: 0 },
                    })
                "
                >Add case</Button
            >
        </div>
        <div
            v-if="!['note', 'formula'].includes(rule.method)"
            class="grid gap-4 sm:grid-cols-2"
        >
            <label class="space-y-1 text-sm"
                ><span>Minimum fee (RM, optional)</span
                ><Input
                    :model-value="rule.minimum ?? ''"
                    type="number"
                    min="0"
                    step="0.01"
                    :disabled="disabled"
                    @update:model-value="
                        rule.minimum = $event === '' ? null : Number($event)
                    "
            /></label>
            <label class="space-y-1 text-sm"
                ><span>Maximum fee (RM, optional)</span
                ><Input
                    :model-value="rule.maximum ?? ''"
                    type="number"
                    min="0"
                    step="0.01"
                    :disabled="disabled"
                    @update:model-value="
                        rule.maximum = $event === '' ? null : Number($event)
                    "
            /></label>
            <label
                v-if="!['fixed', 'conditional'].includes(rule.method)"
                class="flex items-center gap-2 text-sm sm:col-span-2"
                ><Checkbox
                    v-model="rule.zero_when_basis_zero"
                    :disabled="disabled"
                />
                Charge RM0 when the selected amount / quantity is zero</label
            >
        </div>
    </div>
</template>
