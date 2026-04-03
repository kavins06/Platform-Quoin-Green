import "dotenv/config";
import "./lib/config"; // Validate env vars before starting workers
import { startDataIngestionWorker } from "./pipelines/data-ingestion/worker";
import { startUtilityBillExtractionWorker } from "./pipelines/utility-bill-extraction/worker";
import { startPortfolioManagerImportWorker } from "./pipelines/portfolio-manager-import/worker";
import { startPortfolioManagerMeterSetupWorker } from "./pipelines/portfolio-manager-meter-setup/worker";
import { startPortfolioManagerProvisioningWorker } from "./pipelines/portfolio-manager-provisioning/worker";
import { startPortfolioManagerSetupWorker } from "./pipelines/portfolio-manager-setup/worker";
import { startPortfolioManagerUsageWorker } from "./pipelines/portfolio-manager-usage/worker";
import {
  startPortfolioManagerProviderSyncPollingLoop,
  startPortfolioManagerProviderSyncWorker,
} from "./pipelines/portfolio-manager-provider-sync/worker";
import { createLogger } from "./lib/logger";
import { publishWorkerHeartbeat } from "./lib/runtime-health";

const logger = createLogger({
  component: "worker-entrypoint",
});

logger.info("Starting Quoin worker process");

const workers = [
  startDataIngestionWorker(),
  startUtilityBillExtractionWorker(),
  startPortfolioManagerProvisioningWorker(),
  startPortfolioManagerImportWorker(),
  startPortfolioManagerSetupWorker(),
  startPortfolioManagerMeterSetupWorker(),
  startPortfolioManagerUsageWorker(),
  startPortfolioManagerProviderSyncWorker(),
  // Future: startPathwayAnalysisWorker(),
  // Future: startCapitalStructuringWorker(),
  // Future: startDriftDetectionWorker(),
];

const providerSyncPoller = startPortfolioManagerProviderSyncPollingLoop();

const workerNames = [
  "data-ingestion",
  "utility-bill-extraction",
  "portfolio-manager-provisioning",
  "portfolio-manager-import",
  "portfolio-manager-setup",
  "portfolio-manager-meter-setup",
  "portfolio-manager-usage",
  "portfolio-manager-provider-sync",
];

logger.info("Quoin workers started", {
  workerCount: workers.length,
});

void publishWorkerHeartbeat(workerNames).catch((error) => {
  logger.warn("Failed to publish initial worker heartbeat", { error });
});

const heartbeatInterval = setInterval(() => {
  void publishWorkerHeartbeat(workerNames).catch((error) => {
    logger.warn("Failed to publish worker heartbeat", { error });
  });
}, 30_000);

async function shutdown(signal: string) {
  logger.info("Worker shutdown requested", { signal });
  clearInterval(heartbeatInterval);
  clearInterval(providerSyncPoller);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
