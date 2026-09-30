import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sessionpipe/core/schema": path.resolve(__dirname, "packages/core/schema/v1.ts"),
      "@sessionpipe/core/control": path.resolve(__dirname, "packages/core/src/control/index.ts"),
      "@sessionpipe/core": path.resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["packages/*/src/**"] },
  },
});
