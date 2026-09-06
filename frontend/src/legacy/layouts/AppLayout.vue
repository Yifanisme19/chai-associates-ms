<script setup lang="ts">
import AppLayout from '@/layouts/app/AppSidebarLayout.vue';
import ConfirmAction from '@/components/ConfirmAction.vue';
import type { BreadcrumbItem } from '@/types';

const { breadcrumbs = [] } = defineProps<{
    breadcrumbs?: BreadcrumbItem[];
}>();
</script>

<template>
    <AppLayout :breadcrumbs="breadcrumbs">
        <slot />
        <ConfirmAction />
    </AppLayout>
</template>
