<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { FilePenLine, FilePlus2, Trash2 } from '@lucide/vue';
import { ref } from 'vue';
import { confirmAction } from '@/lib/confirmAction';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';
defineOptions({
    layout: { breadcrumbs: [{ title: 'Quotations', href: '/quotations' }] },
});
defineProps<{ category: string; quotations: { data: Array<any> } }>();
const money = (v: number) =>
    new Intl.NumberFormat('en-MY', {
        style: 'currency',
        currency: 'MYR',
    }).format(v);
const deletingId = ref<number | null>(null);
async function deleteDraft(quotation: any) {
    if (!await confirmAction(`Delete draft ${quotation.number}?`)) return;
    deletingId.value = quotation.id;
    router.delete(`/quotations/${quotation.id}`, {
        preserveScroll: true,
        onFinish: () => (deletingId.value = null),
    });
}
</script>
<template>
    <Head title="Quotations" />
    <div class="min-w-0 p-4 sm:p-6">
        <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div class="min-w-0">
                <h1 class="text-2xl font-semibold">Quotations</h1>
                <p class="text-muted-foreground mt-1 text-sm">
                    Saved quotation records and exports.
                </p>
            </div>
            <Link
                href="/quotations/create"
                :class="cn(buttonVariants(), 'shrink-0')"
                ><FilePlus2 :size="16" />Loan Refinance</Link
            >
        </div>
        <div
            class="mb-4 flex flex-wrap items-center gap-2"
            aria-label="Quotation category"
        >
            <span class="mr-2 text-sm font-medium">Category</span>
            <Link
                href="/quotations?category=loan-refinance-title"
                :class="
                    buttonVariants({
                        variant:
                            category === 'loan-refinance-title'
                                ? 'default'
                                : 'outline',
                    })
                "
                >Loan Refinance</Link
            >
            <Link
                href="/quotations?category=all"
                :class="
                    buttonVariants({
                        variant: category === 'all' ? 'default' : 'outline',
                    })
                "
                >All records</Link
            >
        </div>
        <Card class="gap-0 overflow-hidden py-0">
            <CardContent class="overflow-x-auto p-0">
                <table class="w-full min-w-[860px] text-left text-sm">
                    <thead
                        class="bg-muted/50 text-muted-foreground text-xs uppercase"
                    >
                        <tr>
                            <th class="p-3">Number</th>
                            <th>Client</th>
                            <th>Category</th>
                            <th>Date</th>
                            <th>Loan amount</th>
                            <th>Total</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="q in quotations.data"
                            :key="q.id"
                            class="border-t"
                        >
                            <td class="p-3 font-medium">{{ q.number }}</td>
                            <td>{{ q.client_name }}</td>
                            <td>
                                {{
                                    q.rule_set?.code === 'loan-refinance-title'
                                        ? 'Loan Refinance'
                                        : (q.rule_set?.name ?? '—')
                                }}
                            </td>
                            <td>{{ formatDate(q.quotation_date) }}</td>
                            <td>{{ money(q.loan_amount) }}</td>
                            <td>
                                {{
                                    money(
                                        q.calculation_snapshot.summary
                                            .total_payable,
                                    )
                                }}
                            </td>
                            <td class="pr-3">
                                <div
                                    class="flex items-center justify-end gap-2"
                                >
                                    <Link
                                        :href="`/quotations/${q.id}/edit`"
                                        :class="
                                            cn(
                                                buttonVariants({
                                                    variant: 'outline',
                                                    size: 'sm',
                                                }),
                                            )
                                        "
                                        ><FilePenLine :size="15" />Open</Link
                                    >
                                    <a
                                        :href="`/quotations/${q.id}/pdf`"
                                        class="text-primary font-medium underline-offset-4 hover:underline"
                                        >PDF</a
                                    ><a
                                        :href="`/quotations/${q.id}/excel`"
                                        class="text-primary font-medium underline-offset-4 hover:underline"
                                        >Excel</a
                                    >
                                    <Button
                                        v-if="q.status === 'draft'"
                                        variant="ghost"
                                        size="sm"
                                        class="text-destructive hover:text-destructive"
                                        :disabled="deletingId === q.id"
                                        @click="deleteDraft(q)"
                                        ><Trash2 :size="15" />Delete</Button
                                    >
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!quotations.data.length">
                            <td
                                colspan="7"
                                class="text-muted-foreground p-12 text-center"
                            >
                                No quotations yet.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </CardContent>
        </Card>
    </div>
</template>
