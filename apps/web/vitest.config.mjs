import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    env: {
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test"
    }
  }
})
