import type { NextConfig } from "next";

// NOTA: el dominio unidatacenter.com.ar quedo en standby (Tomi no respondio
// con los DNS de NIC.ar). Por ahora la app vive en las URLs de Railway
// (frontend-production-7d1c.up.railway.app + backend-production-c1ee.up
// .railway.app) y todo el flujo apunta ahi. Cuando se desbloquee Tomi,
// se reactivan los redirects de apex/www -> app.unidatacenter.com.ar.

const nextConfig: NextConfig = {
  // Sin redirects activos por ahora. Los registros DNS de NIC.ar no estan
  // propagando todavia y depender de ese dominio bloquearia el acceso.
};

export default nextConfig;
