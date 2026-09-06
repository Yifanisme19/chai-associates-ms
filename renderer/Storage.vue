<script setup>
import { ref, onMounted } from "vue";
import { storage, unwrap } from "./bridge";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Database,
  ShieldCheck,
  RefreshCw,
  HardDrive,
  RotateCcw,
} from "@lucide/vue";
const busy = ref(false),
  error = ref(""),
  message = ref(""),
  preview = ref(null);
const date = (v) => new Date(v).toLocaleString();
const size = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
async function action(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const refresh = () =>
  action(async () => {
    storage.value = await unwrap(api.settings());
  });
const backup = () =>
  action(async () => {
    const r = await unwrap(api.backup());
    storage.value = r.settings;
    message.value = `Backup created: ${r.file}`;
  });
const check = () =>
  action(async () => {
    const r = await unwrap(api.checkData());
    storage.value = r.settings;
    message.value = `Integrity check passed · ${date(r.checkedAt)}`;
  });
const automatic = (enabled) =>
  action(async () => {
    storage.value = await unwrap(api.dataOptions(enabled));
  });
const prepare = (name) =>
  action(async () => {
    preview.value = await unwrap(api.prepareRestore(name));
  });
const cancel = () =>
  action(async () => {
    if (preview.value) await unwrap(api.cancelRestore(preview.value.token));
    preview.value = null;
  });
const restore = () =>
  action(async () => {
    const r = await unwrap(api.restore(preview.value.token));
    storage.value = r.settings;
    preview.value = null;
    message.value = `Restored ${r.quotations} quotations and ${r.templates} template versions. Previous data retained in safety backup: ${r.safetyBackup}`;
  });
onMounted(refresh);
</script>
<template>
  <div class="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6" :aria-busy="busy">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Settings & Storage</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Manage your local workspace and recovery backups.
        </p>
      </div>
      <Button variant="outline" :disabled="busy" @click="refresh"
        ><RefreshCw class="size-4" />Refresh</Button
      >
    </div>
    <p
      v-if="error"
      role="alert"
      class="break-words rounded-lg border border-destructive p-4 text-sm text-destructive"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
      class="break-all rounded-lg border bg-muted/30 p-4 text-sm"
    >
      {{ message }}
    </p>
    <div class="grid gap-6 lg:grid-cols-2">
      <Card class="min-w-0"
        ><CardHeader
          ><CardTitle class="flex items-center gap-2"
            ><Database class="size-5" />Local database</CardTitle
          ></CardHeader
        ><CardContent class="space-y-4"
          ><p class="font-medium">{{ storage.database }}</p>
          <div class="flex flex-wrap gap-4 text-sm">
            <span
              ><strong>{{ storage.counts?.quotations || 0 }}</strong>
              quotations</span
            ><span
              ><strong>{{ storage.counts?.templates || 0 }}</strong> template
              versions</span
            >
          </div>
          <p class="text-sm text-muted-foreground">
            Your data is stored in the local Docker MySQL volume. Restarting or
            updating the application keeps saved records.
          </p>
          <Button variant="outline" :disabled="busy" @click="check"
            ><ShieldCheck class="size-4" />Check integrity</Button
          ></CardContent
        ></Card
      >
      <Card class="min-w-0"
        ><CardHeader
          ><CardTitle class="flex items-center gap-2"
            ><HardDrive class="size-5" />Backups</CardTitle
          ></CardHeader
        ><CardContent class="space-y-4"
          ><p class="text-sm text-muted-foreground">
            Backups include saved quotations, calculations, fee rules and
            template versions. They are stored separately from MySQL in the
            local Docker backup volume.
          </p>
          <Button :disabled="busy" @click="backup">Create backup</Button
          ><label class="flex items-start gap-3 rounded-md border p-3 text-sm"
            ><input
              type="checkbox"
              class="mt-0.5 size-4 shrink-0"
              :checked="storage.autoBackup"
              :disabled="busy"
              @change="automatic($event.target.checked)"
            /><span
              ><strong class="block">Automatic daily backups</strong
              ><span class="text-muted-foreground"
                >Keep the latest 14 daily backups while Docker is running.
                Manual and recovery backups are retained.</span
              ></span
            ></label
          >
          <p
            v-if="storage.autoBackupError"
            role="alert"
            class="text-sm text-destructive"
          >
            {{ storage.autoBackupError }}
          </p></CardContent
        ></Card
      >
    </div>
    <Card
      ><CardHeader><CardTitle>Backup history</CardTitle></CardHeader
      ><CardContent
        ><p
          v-if="!storage.backups?.length"
          class="text-sm text-muted-foreground"
        >
          No backups yet. Create your first backup above.
        </p>
        <ul v-else class="divide-y">
          <li
            v-for="b in storage.backups"
            :key="b.name"
            class="flex flex-wrap items-center justify-between gap-3 py-4"
          >
            <div class="min-w-0 flex-1">
              <p class="break-all text-sm font-medium">{{ b.name }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ date(b.created_at) }} · {{ size(b.size) }} · {{ b.kind }}
              </p>
            </div>
            <Button variant="outline" :disabled="busy" @click="prepare(b.name)"
              ><RotateCcw class="size-4" />Restore</Button
            >
          </li>
        </ul></CardContent
      ></Card
    >
    <Dialog
      :open="!!preview"
      @update:open="
        (v) => {
          if (!v && !busy) cancel();
        }
      "
      ><DialogContent
        :show-close-button="!busy"
        class="max-h-[85vh] overflow-y-auto"
        ><DialogHeader
          ><DialogTitle>Restore backup</DialogTitle
          ><DialogDescription
            >Review the backup before replacing the current
            workspace.</DialogDescription
          ></DialogHeader
        ><template v-if="preview"
          ><p class="break-all text-sm">{{ preview.file }}</p>
          <p class="text-sm">
            <strong>{{ preview.quotations }}</strong> quotations ·
            <strong>{{ preview.templates }}</strong> template versions
          </p>
          <p class="rounded-md border bg-muted/40 p-3 text-sm">
            This replaces the current quotations and templates. A safety backup
            of the current data is created first. If anything fails, the
            database transaction is rolled back.
          </p></template
        ><DialogFooter
          ><Button variant="outline" :disabled="busy" @click="cancel"
            >Cancel</Button
          ><Button :disabled="busy" @click="restore">{{
            busy ? "Restoring…" : "Back up & restore"
          }}</Button></DialogFooter
        ></DialogContent
      ></Dialog
    >
  </div>
</template>
