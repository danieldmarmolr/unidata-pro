import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Redirect apex y www al subdominio principal `app.unidatacenter.com.ar`.
  // Asi quien teclea "unidatacenter.com.ar" cae siempre en la app y el SSL
  // queda servido desde Railway sobre un solo host canonico.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "unidatacenter.com.ar" }],
        destination: "https://app.unidatacenter.com.ar/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.unidatacenter.com.ar" }],
        destination: "https://app.unidatacenter.com.ar/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
