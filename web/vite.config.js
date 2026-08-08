import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built site works whether it's served at the domain
// root or under a GitHub Pages project subpath (https://user.github.io/repo/).
export default defineConfig({
  plugins: [react()],
  base: "./",
});
