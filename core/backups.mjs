import { mkdirSync, readdirSync, statSync, unlinkSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
export class Backups {
  constructor(directory, scope = "default") {
    this.scope = createHash("sha256").update(scope).digest("hex").slice(0, 10);
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }
  list() {
    return readdirSync(this.directory)
      .filter((n) =>
        /^chai-(auto|manual|before-import|before-restore)-[\w.-]+\.sqlite$/.test(
          n,
        ),
      )
      .map((name) => {
        const info = statSync(join(this.directory, name));
        return {
          name,
          size: info.size,
          created_at: info.mtime.toISOString(),
          kind: name.startsWith("chai-auto-")
            ? "automatic"
            : name.startsWith("chai-manual-")
              ? "manual"
              : "safety",
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  path(name) {
    if (!this.list().some((b) => b.name === name))
      throw new Error("Backup not found.");
    return join(this.directory, name);
  }
  async create(store, kind = "manual") {
    if (!["auto", "manual", "before-import", "before-restore"].includes(kind))
      throw new Error("Invalid backup kind.");
    const name = `chai-${kind}-${this.scope}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.sqlite`,
      file = join(this.directory, name);
    const pending = `${file}.partial`;
    try {
      await store.backupTo(pending);
      renameSync(pending, file);
    } catch (error) {
      rmSync(pending, { force: true });
      throw error;
    }
    return file;
  }
  async daily(store) {
    const day = new Date().toISOString().slice(0, 10);
    if (
      this.list().some(
        (b) =>
          b.kind === "automatic" &&
          b.name.startsWith(`chai-auto-${this.scope}-${day}`),
      )
    )
      return null;
    const file = await this.create(store, "auto");
    for (const b of this.list()
      .filter((b) => b.name.startsWith(`chai-auto-${this.scope}-`))
      .slice(14))
      unlinkSync(join(this.directory, b.name));
    return file;
  }
}
