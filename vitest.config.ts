import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], testTimeout: 20000 },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
