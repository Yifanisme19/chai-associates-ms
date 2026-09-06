<script setup>
import { api } from "./api";
import { ref, computed, onMounted, watchEffect } from "vue";
import {
  page,
  view,
  viewProps,
  viewKey,
  navigate,
  unwrap,
  storage,
  dirty,
} from "./bridge";
import { toast } from "vue-sonner";
import Layout from "./legacy/layouts/AppLayout.vue";
import QuotationIndex from "./legacy/pages/quotations/Index.vue";
import QuotationCreate from "./legacy/pages/quotations/Create.vue";
import Templates from "./legacy/pages/rules/Index.vue";
import Catalog from "./legacy/pages/rules/Catalog.vue";
import Storage from "./Storage.vue";
const ready = ref(false),
  error = ref("");
const component = computed(
  () =>
    ({
      quotations: QuotationIndex,
      create: QuotationCreate,
      templates: Templates,
      catalog: Catalog,
      settings: Storage,
    })[view.value],
);
const title = computed(
  () =>
    ({
      quotations: "Quotations",
      create: "Loan Refinance",
      templates: "Templates",
      catalog: "Templates",
      settings: "Settings & Storage",
    })[view.value] || "Quotations",
);
onMounted(async () => {
  try {
    if (!api) throw new Error("Start the local Docker service.");
    storage.value = await unwrap(api.settings());
    await navigate(
      location.pathname === "/"
        ? "/quotations"
        : location.pathname + location.search,
      { force: true, historyMode: "replace" },
    );
    ready.value = true;
  } catch (e) {
    error.value = e.message;
  }
});
watchEffect(() => {
  document.title = `${title.value} · Chai & Associates`;
});
window.addEventListener("popstate", async () => {
  try {
    await navigate(location.pathname + location.search, {
      historyMode: "none",
    });
    if (page.url !== location.pathname + location.search)
      history.pushState({}, "", page.url);
  } catch (e) {
    toast.error(e.message);
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("click", (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
    return;
  const a = e.target.closest?.("a");
  const href = a?.getAttribute("href");
  if (href?.startsWith("/") && !e.defaultPrevented) {
    e.preventDefault();
    navigate(href).catch((e) => toast.error(e.message));
  }
});
</script>
<template>
  <Layout :breadcrumbs="[{ title, href: page.url }]"
    ><p
      v-if="error"
      role="alert"
      class="m-6 rounded-lg border border-destructive p-4 text-destructive"
    >
      {{ error }}
    </p>
    <component
      v-else-if="ready"
      :is="component"
      v-bind="viewProps"
      :key="viewKey"
    />
    <p v-else class="p-6 text-sm text-muted-foreground">
      Opening your local workspace…
    </p></Layout
  >
</template>
