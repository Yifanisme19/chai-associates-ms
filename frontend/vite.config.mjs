import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  base: "/",
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/legacy", import.meta.url)),
      "@inertiajs/vue3": fileURLToPath(
        new URL("./src/bridge.js", import.meta.url),
      ),
    },
  },
});
