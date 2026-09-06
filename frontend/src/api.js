export async function request(method, args = {}) {
  const response = await fetch("/api.php", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Chai-Request": "1" },
    body: JSON.stringify({ method, args }),
  });
  const data = await response.json();
  if (!response.ok && !data.error)
    throw new Error("The service is unavailable. Check Docker is running.");
  return data;
}
export const api = {
  rpc: request,
  settings: () => request("settings"),
  dataOptions: (enabled) => request("data-options", { enabled }),
  backup: () => request("backup"),
  prepareRestore: (name) => request("prepare-restore", { name }),
  cancelRestore: (token) => request("cancel-restore", { token }),
  restore: (token) => request("restore", { token }),
  checkData: () => request("check-data"),
  async export(id, format) {
    const response = await fetch("/api.php", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chai-Request": "1" },
      body: JSON.stringify({ method: "export", args: { id, format } }),
    });
    if (!response.ok) return await response.json();
    const file =
      response.headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || `quotation.${format}`;
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { result: file };
  },
};
