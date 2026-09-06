<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

defineOptions({
    inheritAttrs: false,
});

type Props = {
    className?: HTMLAttributes['class'];
};

defineProps<Props>();
</script>

<template>
    <img
        :src="'./images/chai-associates-logo.jpg'"
        alt="CHAI & ASSOCIATES"
        :class="className"
        class="object-cover object-center"
        v-bind="$attrs"
    />
</template>
