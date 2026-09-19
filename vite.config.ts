import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], server: {
  host: "127.0.0.1", port: 5173, strictPort: true,
  // Prepare the development-only lazy entry before the first board request.
  warmup: { clientFiles: ["./src/ui/LocalBootstrap.tsx", "./src/ui/OnlineScreen.tsx"] },
} });
