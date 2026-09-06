<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { desktopRequest } from '../../bridge';
import FeeRuleFields from '@/components/FeeRuleFields.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { inputLabel, type FeeRule } from '@/lib/fee-rule';

const props = defineProps<{ rule: FeeRule; disabled?: boolean }>();
const inputs = ref<Record<string, string | number | boolean>>({});
const result = ref<{ amount: number; steps: unknown[] } | null>(null);
const errors = ref<string[]>([]);
const busy = ref(false);
const fields = computed(() => {
    const found = new Map<string, string | number | boolean>();
    function visit(rule: FeeRule) {
        if (
            rule.basis &&
            !['fixed', 'conditional', 'note', 'formula'].includes(rule.method)
        )
            found.set(rule.basis, 0);
        if (rule.method === 'conditional')
            for (const item of rule.cases ?? []) {
                for (const [key, value] of Object.entries(item.when))
                    found.set(key, value);
                visit(item.rule);
            }
    }
    visit(props.rule);
    return [...found].map(([key, example]) => ({ key, example }));
});
watch(
    fields,
    (values) => {
        for (const { key, example } of values)
            if (typeof inputs.value[key] !== typeof example)
                inputs.value[key] = typeof example === 'number' ? 0 : example;
    },
    { immediate: true },
);
let sequence = 0;
watch(
    [() => props.rule, inputs],
    () => {
        sequence++;
        result.value = null;
        errors.value = [];
    },
    { deep: true, flush: 'sync' },
);
async function simulate() {
    const ticket = ++sequence;
    busy.value = true;
    errors.value = [];
    result.value = null;
    try {
        const token = decodeURIComponent(
            document.cookie
                .split('; ')
                .find((v) => v.startsWith('XSRF-TOKEN='))
                ?.split('=')[1] ?? '',
        );
        const response = await desktopRequest('/rule-catalogs/simulate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-XSRF-TOKEN': token,
            },
            body: JSON.stringify({ rule: props.rule, inputs: inputs.value }),
        });
        const data = await response.json();
        if (ticket !== sequence) return;
        if (!response.ok)
            errors.value = data.errors
                ? (Object.values(data.errors).flat() as string[])
                : [data.message ?? 'Unable to calculate.'];
        else result.value = data;
    } catch {
        if (ticket === sequence)
            errors.value = [
                'Unable to reach the calculator. Please try again.',
            ];
    } finally {
        busy.value = false;
    }
}
function explain(step: unknown): string {
    const row = step as Record<string, unknown>;
    if (row.description) return String(row.description);
    if (row.portion !== undefined)
        return `Portion RM${row.portion} × ${Number((Number(row.rate) * 100).toFixed(6))}%`;
    if (row.up_to !== undefined)
        return row.up_to === null
            ? 'Final amount band'
            : `Amount band up to RM${row.up_to}`;
    if (row.method)
        return `Matching case: ${String(row.method).replaceAll('_', ' ')}`;
    return 'Calculated fee';
}
const amountOf = (step: unknown) =>
    Number((step as { amount: number }).amount).toFixed(2);
</script>

<template>
    <div class="space-y-5">
        <label class="block space-y-2 text-sm"
            ><span>Rule name</span
            ><Input v-model="rule.label" :disabled="disabled"
        /></label>
        <FeeRuleFields :rule="rule" :disabled="disabled" />
        <div class="bg-muted/20 space-y-3 rounded-md border p-4">
            <h3 class="font-medium">Try this rule</h3>
            <p class="text-muted-foreground text-sm">
                Uses the same PHP calculator as quotations. This does not save
                or publish anything.
            </p>
            <div class="grid gap-3 sm:grid-cols-2">
                <label
                    v-for="field in fields"
                    :key="field.key"
                    class="space-y-1 text-sm"
                    ><span>{{ inputLabel(field.key) }}</span>
                    <select
                        v-if="typeof field.example === 'boolean'"
                        :value="String(inputs[field.key])"
                        class="bg-background h-9 w-full rounded-md border px-3"
                        @change="
                            inputs[field.key] =
                                ($event.target as HTMLSelectElement).value ===
                                'true'
                        "
                    >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                    </select>
                    <Input
                        v-else
                        :model-value="String(inputs[field.key] ?? '')"
                        :type="
                            typeof field.example === 'number'
                                ? 'number'
                                : 'text'
                        "
                        min="0"
                        @update:model-value="
                            inputs[field.key] =
                                typeof field.example === 'number'
                                    ? Number($event)
                                    : String($event)
                        "
                    />
                </label>
            </div>
            <Button
                :disabled="busy || ['note', 'formula'].includes(rule.method)"
                @click="simulate"
                >{{ busy ? 'Calculating…' : 'Calculate test fee' }}</Button
            >
            <p
                v-if="['note', 'formula'].includes(rule.method)"
                class="text-muted-foreground text-sm"
            >
                This is a reference note. Choose a structured charging method to
                make it calculable.
            </p>
            <div
                v-if="errors.length"
                role="alert"
                class="text-destructive space-y-1 text-sm"
            >
                <p v-for="error in errors" :key="error">{{ error }}</p>
            </div>
            <div v-if="result" aria-live="polite" class="space-y-2">
                <p class="text-lg font-semibold">
                    Test fee: RM{{ result.amount.toFixed(2) }}
                </p>
                <div
                    v-for="(step, index) in result.steps"
                    :key="index"
                    class="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"
                >
                    <span>{{ explain(step) }}</span
                    ><span>RM{{ amountOf(step) }}</span>
                </div>
            </div>
        </div>
    </div>
</template>
