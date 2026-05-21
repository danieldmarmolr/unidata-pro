import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Subimos el limite del cuerpo de los server actions para
      // permitir subir archivos Excel de varios MB en /importar.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
