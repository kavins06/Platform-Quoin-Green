import { router } from "../init";
import { buildingRouter } from "./building";
import { driftRouter } from "./drift";
import { provenanceRouter } from "./provenance";
import { benchmarkingRouter } from "./benchmarking";
import { portfolioManagerRouter } from "./portfolio-manager";
import { organizationRouter } from "./organization";

export const appRouter = router({
  organization: organizationRouter,
  building: buildingRouter,
  drift: driftRouter,
  provenance: provenanceRouter,
  benchmarking: benchmarkingRouter,
  portfolioManager: portfolioManagerRouter,
});

export type AppRouter = typeof appRouter;
