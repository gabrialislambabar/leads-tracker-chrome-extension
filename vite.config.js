import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "index.html"),
        usage: resolve(__dirname, "usage.html"),
      },
    },
  },
});
