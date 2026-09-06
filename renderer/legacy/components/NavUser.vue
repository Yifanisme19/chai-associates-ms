<script setup lang="ts">
import { computed } from "vue";
import { HardDrive } from "@lucide/vue";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
const { state, isMobile } = useSidebar();
const iconOnly = computed(() => state.value === "collapsed" && !isMobile.value);
</script>
<template>
  <SidebarMenu
    ><SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        as="div"
        tooltip="Personal workspace · Local SQLite"
        aria-label="Personal workspace · Local SQLite"
        :class="iconOnly ? 'justify-center !p-0' : 'min-w-0'"
        data-testid="personal-workspace"
      >
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
        >
          <HardDrive class="size-4 shrink-0" />
        </div>
        <div
          v-if="!iconOnly"
          class="grid min-w-0 flex-1 text-left text-sm leading-tight"
        >
          <span class="truncate font-medium">Personal workspace</span
          ><span class="truncate text-xs text-muted-foreground"
            >Local SQLite</span
          >
        </div>
      </SidebarMenuButton>
    </SidebarMenuItem></SidebarMenu
  >
</template>
