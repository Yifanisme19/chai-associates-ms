<script setup>
import { ref, onMounted } from "vue";
import { storage, unwrap, dirty } from "./bridge";
import { toast } from "vue-sonner";
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
  Download,
  Upload,
  ShieldCheck,
  FolderOpen,
  RefreshCw,
} from "@lucide/vue";
const busy = ref(false),
  error = ref(""),
  message = ref(""),
  preview = ref(null),
  mode = ref("merge");
const size = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
const date = (v) => new Date(v).toLocaleString();
async function refresh() {
  storage.value = await unwrap(window.desktop.settings());
}
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
const backup = () =>
  action(async () => {
    const r = await unwrap(window.desktop.managedBackup());
    storage.value = r.settings;
    message.value = `Backup created: ${r.file}`;
  });
const saveBackup = () =>
  action(async () => {
    const p = await unwrap(window.desktop.backup());
    if (p) message.value = `SQLite backup saved: ${p}`;
  });
const exportData = () =>
  action(async () => {
    const p = await unwrap(window.desktop.exportData());
    if (p) message.value = `Data exported: ${p}`;
  });
const choose = (kind) =>
  action(async () => {
    const s = await unwrap(window.desktop.chooseDatabase(kind));
    if (s) {
      storage.value = s;
      dirty.value = false;
      message.value =
        "Database switched. Your previous file has been retained.";
    }
  });
const automatic = (enabled) =>
  action(async () => {
    storage.value = await unwrap(window.desktop.dataOptions(enabled));
  });
const reveal = (name) =>
  action(async () => {
    await unwrap(window.desktop.reveal(name));
  });
const check = () =>
  action(async () => {
    const r = await unwrap(window.desktop.checkData());
    storage.value = r.settings;
    message.value = `Integrity check passed · ${date(r.checkedAt)}`;
  });
const prepare = (name) =>
  action(async () => {
    const result = await unwrap(window.desktop.prepareImport(name));
    if (result) {
      preview.value = result;
      mode.value = name ? "restore" : "merge";
    }
  });
async function closePreview() {
  if (busy.value) return;
  preview.value = null;
  await unwrap(window.desktop.cancelImport());
}
async function apply() {
  await action(async () => {
    const r = await unwrap(
      window.desktop.applyImport(preview.value.token, mode.value),
    );
    storage.value = r.settings;
    dirty.value = false;
    preview.value = null;
    message.value = `${mode.value === "restore" ? "Restored" : "Imported"} ${r.quotations} quotations and ${r.templates} template versions. ${r.skipped} identical records skipped; ${r.conflicts.length} conflicts left unchanged. Safety backup: ${r.safetyBackup}`;
    toast.success(
      mode.value === "restore" ? "Backup restored." : "Data imported.",
    );
  });
}
onMounted(() => action(refresh));
</script>
<template>
  <div
    class="mx-auto w-full min-w-0 max-w-5xl space-y-6 p-4 lg:p-6"
    :aria-busy="busy"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Settings & Storage</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Manage your personal workspace, backups and data transfers.
        </p>
      </div>
      <Button variant="outline" :disabled="busy" @click="action(refresh)"
        ><RefreshCw class="size-4" />Refresh</Button
      >
    </div>
    <p
      v-if="error"
      role="alert"
      class="break-words rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
      class="break-all rounded-md border bg-muted/40 p-4 text-sm"
    >
      {{ message }}
    </p>
    <Card
      ><CardHeader
        ><CardTitle class="flex items-center gap-2"
          ><Database class="size-4" />Local database</CardTitle
        ></CardHeader
      ><CardContent class="min-w-0 space-y-4">
        <div class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <span
            ><strong>{{ storage.counts?.quotations ?? 0 }}</strong>
            quotations</span
          ><span
            ><strong>{{ storage.counts?.templates ?? 0 }}</strong> template
            versions</span
          >
        </div>
        <p class="break-all rounded-md bg-muted p-3 font-mono text-xs">
          {{ storage.database }}
        </p>
        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" :disabled="busy" @click="reveal(null)"
            ><FolderOpen class="size-4" />Show database file</Button
          ><Button variant="outline" :disabled="busy" @click="check"
            ><ShieldCheck class="size-4" />Check integrity</Button
          ><Button variant="outline" :disabled="busy" @click="choose('move')"
            >Copy & switch location</Button
          >
        </div>
        <p class="text-xs text-muted-foreground">
          The location must be a local disk. Copying keeps the original
          database.
        </p>
      </CardContent></Card
    >
    <div class="grid min-w-0 gap-6 lg:grid-cols-2">
      <Card class="min-w-0"
        ><CardHeader><CardTitle>Backup & Export</CardTitle></CardHeader
        ><CardContent class="space-y-4">
          <p class="text-sm text-muted-foreground">
            A full backup includes quotations, fee rules, template versions and
            saved calculation snapshots.
          </p>
          <div class="flex flex-col gap-2">
            <Button :disabled="busy" @click="backup"
              ><Download class="size-4" />Create backup</Button
            ><Button variant="outline" :disabled="busy" @click="saveBackup"
              >Save SQLite backup as…</Button
            ><Button variant="outline" :disabled="busy" @click="exportData"
              >Export data as JSON</Button
            >
          </div>
          <label
            class="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
            ><input
              type="checkbox"
              class="mt-0.5 size-4 shrink-0 accent-black"
              :checked="storage.autoBackup"
              :disabled="busy"
              @change="automatic($event.target.checked)"
            /><span
              ><strong class="block font-medium">Automatic daily backups</strong
              ><span
                class="mt-1 block text-xs leading-relaxed text-muted-foreground"
                >While the app is running, keep the latest 14 daily backups per
                database. Manual and safety backups are retained.</span
              ></span
            ></label
          >
          <p
            v-if="storage.autoBackupError"
            role="alert"
            class="text-sm text-destructive"
          >
            Automatic backup failed: {{ storage.autoBackupError }}
          </p>
          <p class="text-xs leading-relaxed text-muted-foreground">
            Local backups protect against accidental edits. Use “Save SQLite
            backup as…” to keep another copy on an external drive.
          </p>
        </CardContent></Card
      >
      <Card class="min-w-0"
        ><CardHeader><CardTitle>Import & Restore</CardTitle></CardHeader
        ><CardContent class="space-y-4">
          <p class="text-sm text-muted-foreground">
            Import a Chai desktop SQLite backup or JSON export. Review its
            contents before making changes.
          </p>
          <Button
            class="w-full"
            variant="outline"
            :disabled="busy"
            @click="prepare(null)"
            ><Upload class="size-4" />Import data / Restore backup</Button
          >
          <div class="space-y-3 text-sm">
            <p>
              <strong class="font-medium">Merge data</strong
              ><span class="mt-1 block text-muted-foreground"
                >Add new records to this workspace. Identical records are
                skipped; conflicting records stay unchanged.</span
              >
            </p>
            <p>
              <strong class="font-medium">Restore workspace</strong
              ><span class="mt-1 block text-muted-foreground"
                >Open a restored copy as your workspace. The previous database
                and an automatic safety backup are retained.</span
              >
            </p>
          </div>
          <p class="text-xs text-muted-foreground">
            PDF, Excel and legacy Laravel databases are not import formats. This
            version imports Chai desktop backups and data exports.
          </p>
        </CardContent></Card
      >
    </div>
    <Card class="min-w-0"
      ><CardHeader
        ><CardTitle>Backup history</CardTitle>
        <p class="break-all text-xs text-muted-foreground">
          {{ storage.backupDirectory }}
        </p></CardHeader
      ><CardContent class="min-w-0">
        <div
          v-if="!storage.backups?.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No backups yet. Create your first backup above.
        </div>
        <ul v-else class="divide-y">
          <li
            v-for="b in storage.backups"
            :key="b.name"
            class="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 text-sm">
                <span class="font-medium">{{ date(b.created_at) }}</span
                ><span
                  class="rounded bg-muted px-2 py-0.5 text-xs capitalize"
                  >{{ b.kind }}</span
                ><span class="text-xs text-muted-foreground">{{
                  size(b.size)
                }}</span>
              </div>
              <p class="mt-1 break-all text-xs text-muted-foreground">
                {{ b.name }}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                :disabled="busy"
                @click="reveal(b.name)"
                >Show file</Button
              ><Button
                size="sm"
                variant="outline"
                :disabled="busy"
                @click="prepare(b.name)"
                >Restore</Button
              >
            </div>
          </li>
        </ul>
      </CardContent></Card
    >
    <Dialog
      :open="!!preview"
      @update:open="
        (open) => {
          if (!open) closePreview();
        }
      "
      ><DialogContent
        class="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        @escape-key-down="
          (e) => {
            if (busy) e.preventDefault();
          }
        "
        @interact-outside="
          (e) => {
            if (busy) e.preventDefault();
          }
        "
        ><DialogHeader
          ><DialogTitle>Review imported data</DialogTitle
          ><DialogDescription
            >Nothing changes until you confirm. A safety backup is created
            before applying data.</DialogDescription
          ></DialogHeader
        >
        <template v-if="preview"
          ><p class="break-all rounded bg-muted p-3 font-mono text-xs">
            {{ preview.file }}
          </p>
          <p class="text-sm">
            <strong>{{ preview.quotations }}</strong> quotations ·
            <strong>{{ preview.templates }}</strong> template versions in this
            file
          </p>
          <label class="flex gap-3 rounded-md border p-3 text-sm"
            ><input
              v-model="mode"
              value="merge"
              type="radio"
              :disabled="busy"
            /><span
              ><strong>Merge into current workspace</strong
              ><span class="mt-1 block text-muted-foreground"
                >Add {{ preview.merge.quotations }} quotations and
                {{ preview.merge.templates }} template versions. Skip
                {{ preview.merge.skipped }} identical records; keep
                {{ preview.merge.conflictCount }} conflicting records
                unchanged.</span
              ></span
            ></label
          >
          <label class="flex gap-3 rounded-md border p-3 text-sm"
            ><input
              v-model="mode"
              value="restore"
              type="radio"
              :disabled="busy"
            /><span
              ><strong>Restore as current workspace</strong
              ><span class="mt-1 block text-muted-foreground"
                >Switch to a restored copy of all
                {{ preview.quotations }} quotations and
                {{ preview.templates }} template versions. Your current database
                is kept intact.</span
              ></span
            ></label
          >
          <details
            v-if="mode === 'merge' && preview.merge.conflictCount"
            class="text-sm"
          >
            <summary class="cursor-pointer">
              View conflicts ({{ preview.merge.conflictCount }})
            </summary>
            <ul
              class="mt-2 max-h-36 overflow-y-auto text-xs text-muted-foreground"
            >
              <li v-for="(c, i) in preview.merge.conflicts" :key="i">
                {{ c.type }}: {{ c.name }}
              </li>
            </ul>
            <p v-if="preview.merge.conflictCount > 50" class="text-xs">
              Showing the first 50 conflicts.
            </p>
          </details>
          <p v-if="error" role="alert" class="text-sm text-destructive">
            {{ error }}
          </p>
          <DialogFooter class="gap-2"
            ><Button variant="outline" :disabled="busy" @click="closePreview"
              >Cancel</Button
            ><Button :disabled="busy" @click="apply">{{
              busy
                ? "Applying…"
                : mode === "restore"
                  ? "Back up & restore"
                  : "Back up & merge"
            }}</Button></DialogFooter
          >
        </template>
      </DialogContent></Dialog
    >
  </div>
</template>
