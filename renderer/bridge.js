import { api } from "./api";
import { reactive, ref, defineComponent, h, nextTick } from "vue";
import { toast } from "vue-sonner";
export const page = reactive({
  url: "/quotations",
  props: { sidebarOpen: true },
});
export const view = ref("quotations"),
  viewProps = ref({}),
  viewKey = ref(0),
  dirty = ref(false),
  storage = ref({ mode: "local" });
let templates = [],
  quoteRevisions = new Map(),
  navigateSequence = 0;
export const setDirty = (value) => {
  dirty.value = value;
};
export async function unwrap(p) {
  const r = await p;
  if (r.error) throw new Error(r.error);
  return r.result;
}
export const rpc = (method, args = {}) =>
  unwrap(api.rpc(method, JSON.parse(JSON.stringify(args))));
export function legacyQuote(q) {
  quoteRevisions.set(q.id, q.revision);
  return {
    ...q.input,
    id: q.id,
    number: q.number,
    revision: q.revision,
    status: q.input.status,
    rule_set_id: q.calculation.template_snapshot.id,
    calculation_snapshot: q.calculation,
  };
}
const templateModel = (t) => ({
  ...t,
  rule_catalog_id: t.id,
  input_schema: t.rules.input_schema,
  status: t.status || "active",
  revision: t.revision || 1,
});
const activeTemplates = () =>
  templates
    .filter((t) => t.status === "active" || !t.status)
    .filter((t, i, a) => a.findIndex((v) => v.code === t.code) === i);
async function reloadTemplates() {
  templates = (await rpc("templates.list")).map(templateModel);
}
function templateProps(code) {
  const selected = templates.filter((t) => t.code === code);
  return {
    ruleSets: selected,
    activeTemplates: [
      ...selected.filter((t) => t.status === "active"),
      ...selected.filter((t) => t.status !== "active"),
    ].slice(0, 1),
    ruleCatalogs: templates.map((t) => ({
      id: t.id,
      name: t.name + " rules",
      version: t.version,
      status: t.status,
      sections: t.catalog_sections,
    })),
  };
}
export async function navigate(
  href,
  { force = false, historyMode = "push" } = {},
) {
  href = typeof href === "string" ? href : href.url;
  if (dirty.value && !force && !window.confirm("Discard unsaved changes?"))
    return;
  const ticket = ++navigateSequence;
  const u = new URL(href, "http://localhost"),
    exportMatch = u.pathname.match(/^\/quotations\/([^/]+)\/(pdf|excel)$/);
  if (exportMatch) return exportQuotation(exportMatch[1], exportMatch[2]);
  let nextView,
    nextProps = {};
  if (u.pathname === "/settings") {
    storage.value = await unwrap(api.settings());
    nextView = "settings";
  } else {
    await reloadTemplates();
    if (u.pathname === "/quotations/create") {
      const active = activeTemplates(),
        defaultTemplate =
          active.find((t) => t.code === "loan-refinance-title") || active[0];
      if (!defaultTemplate)
        throw new Error("No active template. Activate a template first.");
      nextView = "create";
      nextProps = { ruleSets: active, defaultRuleSetId: defaultTemplate.id };
    } else if (/^\/quotations\/[^/]+\/edit$/.test(u.pathname)) {
      const q = await rpc("quotations.get", { id: u.pathname.split("/")[2] }),
        t = templateModel(q.calculation.template_snapshot);
      nextView = "create";
      nextProps = {
        ruleSets: [t],
        defaultRuleSetId: t.id,
        quotation: legacyQuote(q),
      };
    } else if (u.pathname === "/templates") {
      nextView = "catalog";
      nextProps = {
        templates: [...new Set(templates.map((t) => t.code))].map((code) => ({
          name: templates.find((t) => t.code === code).name,
          url: `/templates/business/${code}`,
          version_count: templates.filter((t) => t.code === code).length,
        })),
      };
    } else if (u.pathname.startsWith("/templates/")) {
      const code =
        u.pathname.split("/").at(-1) === "loan-refinance"
          ? "loan-refinance-title"
          : u.pathname.split("/").at(-1);
      nextView = "templates";
      nextProps = templateProps(code);
      if (!nextProps.ruleSets.length) {
        nextView = "catalog";
        nextProps = { templates: [] };
      }
    } else {
      nextView = "quotations";
      const category = u.searchParams.get("category") || "loan-refinance-title",
        rows = await rpc("quotations.list");
      nextProps = {
        category,
        quotations: {
          data: rows
            .filter((q) => category === "all" || q.template_code === category)
            .map((q) => {
              quoteRevisions.set(q.id, q.revision);
              return {
                ...q,
                ...q.input,
                rule_set: { name: q.template_name, code: q.template_code },
                calculation_snapshot: { summary: q.calculation_summary },
              };
            }),
        },
      };
    }
  }
  if (ticket !== navigateSequence) return;
  dirty.value = false;
  if (historyMode !== "none" && location.pathname + location.search !== href) {
    history[historyMode === "replace" ? "replaceState" : "pushState"](
      {},
      "",
      href,
    );
  }
  page.url = href;
  view.value = nextView;
  viewProps.value = nextProps;
  viewKey.value++;
}
export async function exportQuotation(id, type) {
  try {
    const target = await unwrap(
      api.export(id, type === "excel" ? "xlsx" : type),
    );
    if (target) toast.success(`Downloaded ${target}`);
  } catch (e) {
    toast.error(e.message);
  }
}
async function mutate(url, method, data = {}) {
  const parts = url.split("/").filter(Boolean);
  let result;
  if (parts[0] === "quotations") {
    const id = parts[1];
    if (method === "DELETE")
      result = await rpc("quotations.delete", {
        id,
        revision: quoteRevisions.get(id),
      });
    else {
      const q = await rpc("quotations.save", {
        id,
        revision: quoteRevisions.get(id),
        template_id: data.rule_set_id,
        input: { ...data, status: "draft" },
      });
      const editUrl = `/quotations/${q.id}/edit`;
      history.replaceState({}, "", editUrl);
      page.url = editUrl;
      return legacyQuote(q);
    }
    await navigate(page.url, { force: true });
    return result;
  }
  if (parts[0] !== "templates") throw new Error("Unsupported operation.");
  const source = templates.find(
    (t) => t.id === (parts[1] || data.source_rule_set_id),
  );
  if (!source) throw new Error("Template not found. Reload the page.");
  if (parts.length === 1) {
    result = await rpc("templates.save", {
      template: {
        ...source,
        id: undefined,
        name: data.name,
        code: data.code,
        version: 0,
        revision: 1,
        status: "active",
      },
    });
    await navigate(`/templates/business/${result.code}`, { force: true });
    return result;
  }
  const operation =
    method === "DELETE"
      ? "delete"
      : parts[2] === "draft"
        ? "draft"
        : parts[2] === "activate"
          ? "activate"
          : "update";
  result = await rpc(`templates.${operation}`, {
    ...data,
    id: source.id,
    revision: source.revision,
  });
  if (parts[2] === "publish")
    result = await rpc("templates.activate", {
      id: source.id,
      revision: result.revision,
    });
  await reloadTemplates();
  if (!templates.some((t) => t.code === source.code)) {
    await navigate("/templates", { force: true });
    return result;
  }
  // Keep the original sheet open while refreshing its server-style props.
  viewProps.value = templateProps(source.code);
  await nextTick();
  dirty.value = false;
  toast.success("Template saved.");
  return result;
}
export async function toolRequest(url, options = {}) {
  try {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    const data = JSON.parse(options.body || "{}");
    let result;
    if (url === "/rule-catalogs/simulate")
      result = await rpc("rules.simulate", data);
    else if (url.endsWith("/impact"))
      result = await rpc("templates.impact", {
        ...data,
        id: url.split("/")[2],
      });
    else if (url.endsWith("/calculate"))
      result = await rpc("quotations.calculate", {
        id: url === "/quotations/calculate" ? undefined : url.split("/")[2],
        template_id: data.rule_set_id,
        input: data,
      });
    else result = await mutate(url, options.method || "POST", data);
    return { ok: true, json: async () => result };
  } catch (e) {
    if (e.name === "AbortError") throw e;
    return {
      ok: false,
      json: async () => ({ message: e.message, errors: { form: [e.message] } }),
    };
  }
}
export const router = {
  visit: (href) => navigate(href).catch((e) => toast.error(e.message)),
  get: (href) => navigate(href).catch((e) => toast.error(e.message)),
  delete: async (url, options = {}) => {
    try {
      await mutate(url, "DELETE");
      options.onSuccess?.();
    } catch (e) {
      toast.error(e.message);
      options.onError?.({ form: e.message });
    } finally {
      options.onFinish?.();
    }
  },
  post: async (url, data = {}, options = {}) => {
    try {
      await mutate(url, "POST", data);
      options.onSuccess?.();
    } catch (e) {
      toast.error(e.message);
      options.onError?.({ form: e.message });
    } finally {
      options.onFinish?.();
    }
  },
  flushAll: () => {},
  reload: () => navigate(page.url, { force: true }),
};
export function useForm(initial) {
  const keys = Object.keys(initial),
    form = reactive({
      ...structuredClone(initial),
      errors: {},
      processing: false,
    });
  const submit = async (method, url, options = {}) => {
    form.processing = true;
    form.errors = {};
    try {
      await mutate(
        url,
        method,
        Object.fromEntries(keys.map((k) => [k, form[k]])),
      );
      await options.onSuccess?.();
    } catch (e) {
      form.errors = { form: e.message };
      options.onError?.(form.errors);
    } finally {
      form.processing = false;
      options.onFinish?.();
    }
  };
  form.post = (url, options) => submit("POST", url, options);
  form.put = (url, options) => submit("PUT", url, options);
  form.reset = () => Object.assign(form, structuredClone(initial));
  return form;
}
export const usePage = () => page;
export const Head = defineComponent({
  props: ["title"],
  setup: () => () => null,
});
export const Link = defineComponent({
  inheritAttrs: false,
  props: ["href", "as", "prefetch", "method"],
  setup(props, { slots, attrs }) {
    return () =>
      h(
        props.as || "a",
        {
          ...attrs,
          ...(props.as === "button"
            ? { type: "button" }
            : {
                href:
                  typeof props.href === "string" ? props.href : props.href?.url,
              }),
          onClick: (e) => {
            if (
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey ||
              e.altKey ||
              e.button !== 0
            )
              return;
            e.preventDefault();
            attrs.onClick?.(e);
            router.visit(props.href);
          },
        },
        slots.default?.(),
      );
  },
});
