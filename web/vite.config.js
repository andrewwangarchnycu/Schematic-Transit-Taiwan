import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

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
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.js",
        injectManifest: { injectionPoint: "self.__WB_MANIFEST" },
        includeAssets: ["icons/icon.svg"],
        manifest: {
          name: "Taiwan Transit Live",
          short_name: "TW Transit",
          description: "Nationwide bus, metro, TRA, THSR, and YouBike live arrivals and trip planning for Taiwan.",
          start_url: ".",
          scope: ".",
          display: "standalone",
          background_color: "#f2f3f8",
          theme_color: "#3457ea",
          lang: "zh-Hant",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
      }),
    ],
    base: "./",
  };
});
