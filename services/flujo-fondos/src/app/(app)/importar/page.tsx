import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImportarClient } from './importar-client';
import { PlantillaErogacionesClient } from './plantilla-erogaciones-client';
import { PlantillaFacturacionClient } from './plantilla-facturacion-client';
import { PlantillaIngresosPuntualesClient } from './plantilla-ingresos-puntuales-client';

export default function ImportarPage() {
  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Importar Excel</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Cuatro modos de carga masiva. Descargá la plantilla del tipo que querés
          cargar, llenala con tus datos y subila. Si tenés el Excel del simulador
          original con las hojas Proveedores / Gastos / Facturacion, usá el ultimo
          tab.
        </p>
      </div>

      <Tabs defaultValue="erogaciones">
        <TabsList>
          <TabsTrigger value="erogaciones">Plantilla erogaciones</TabsTrigger>
          <TabsTrigger value="ingresos">Plantilla ingresos puntuales</TabsTrigger>
          <TabsTrigger value="facturacion">Plantilla facturacion</TabsTrigger>
          <TabsTrigger value="simulador">Excel del simulador</TabsTrigger>
        </TabsList>

        <TabsContent value="erogaciones" className="mt-4">
          <PlantillaErogacionesClient />
        </TabsContent>

        <TabsContent value="ingresos" className="mt-4">
          <PlantillaIngresosPuntualesClient />
        </TabsContent>

        <TabsContent value="facturacion" className="mt-4">
          <PlantillaFacturacionClient />
        </TabsContent>

        <TabsContent value="simulador" className="mt-4">
          <ImportarClient />
        </TabsContent>
      </Tabs>
    </div>
  );
}
