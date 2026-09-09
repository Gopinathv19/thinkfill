import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow large PDF uploads (up to 50MB)
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // pdfjs-dist and pdf-lib run server-side only; don't bundle them in the client
  serverExternalPackages: ["pdfjs-dist", "pdf-lib"],
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {
    resolveAlias: {
      canvas: "./noop.js",
    },
  },
};

export default nextConfig;
