<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { ArrowRight, FileText } from '@lucide/vue';
defineOptions({ layout: { breadcrumbs: [{ title: 'Templates', href: '/templates' }] } });
defineProps<{ templates: { name: string; url: string; version_count: number }[] }>();
</script>
<template>
    <Head title="Templates" />
    <div class="mx-auto w-full max-w-7xl space-y-6 p-4 lg:p-6">
        <header><h1 class="text-2xl font-semibold">Templates</h1><p class="mt-2 text-sm text-muted-foreground">Choose a business template to edit its layout, sections, formulas and versions.</p></header>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Link v-for="template in templates" :key="template.url" :href="template.url" class="group flex min-w-0 items-start gap-4 rounded-xl border bg-card p-6 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring">
                <FileText class="size-6 shrink-0" />
                <div class="min-w-0 flex-1 space-y-2"><h2 class="font-semibold">{{ template.name }}</h2><p class="text-sm text-muted-foreground">{{ template.version_count }} version(s)</p><span class="inline-flex items-center gap-2 text-sm font-medium">Edit template <ArrowRight class="size-4" /></span></div>
            </Link>
        </div>
        <p v-if="!templates.length" class="rounded-lg border p-6 text-muted-foreground">No template versions remain. Contact your administrator to restore a template.</p>
    </div>
</template>
