import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built site works whether it's served at the domain
// root or under a GitHub Pages project subpath (https://user.github.io/repo/).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && !env.VITE_API_BASE) {
    // Fail the build loudly instead of silently baking in the dev-only
    // localhost fallback, which is unreachable from every other device and
    // previously shipped to production without anyone noticing.
    throw new Error(
      "VITE_API_BASE is not set for a production build. Set it in web/.env.local for local builds, " +
        "or as a repo Settings > Secrets and variables > Actions > Variables entry for CI."
    );
  }

  return {
    plugins: [react()],
    base: "./",
  };
});
