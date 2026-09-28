import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "lcov"], include: ["packages/*/src/**"] },
  },
});
