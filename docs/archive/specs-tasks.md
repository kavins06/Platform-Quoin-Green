# Phase A Step 1: Prisma Schema + RLS + Seed

## Tasks

- [DONE] Initialize Next.js 14 project with TypeScript, Tailwind, ESLint, App Router
- [DONE] Install Prisma + @prisma/client + @prisma/adapter-pg
- [DONE] Create prisma/schema.prisma with all 12 models, 30 enums, relations, indexes
- [DONE] Create init migration SQL (00000000000000_init)
- [DONE] Create RLS migration SQL (00000000000001_rls_policies) for 11 tenant tables
- [DONE] Create prisma/seed.ts (3 orgs, 10 buildings, 3 users, 10 compliance snapshots)
- [DONE] Create docker-compose.yml (PostgreSQL 16 + Redis 7)
- [DONE] Configure .env with DATABASE_URL
- [DONE] Create src/server/lib/db.ts (singleton Prisma client with PrismaPg adapter)
- [DONE] TypeScript strict compilation passes

---

# Phase A Step 2: Clerk Authentication Integration

## Tasks

- [DONE] Install @clerk/nextjs@6, zod, svix
- [DONE] Add Clerk env vars to .env (publishable key, secret key, webhook secret, URL configs)
- [DONE] Create src/server/lib/config.ts (Zod-validated env schema)
- [DONE] Wrap root layout.tsx in ClerkProvider
- [DONE] Create src/middleware.ts (clerkMiddleware with public route matcher)
- [DONE] Create sign-in page (src/app/(auth)/sign-in/[[...sign-in]]/page.tsx)
- [DONE] Create sign-up page (src/app/(auth)/sign-up/[[...sign-up]]/page.tsx)
- [DONE] Create dashboard placeholder (src/app/(dashboard)/dashboard/page.tsx)
- [DONE] Create Clerk webhook handler (src/app/api/webhooks/clerk/route.ts)
  - Handles: organization.created/updated/deleted, organizationMembership.created/updated/deleted, user.created/updated
  - Svix signature verification
  - Clerk role → UserRole enum mapping
  - Uses base Prisma client (bypasses RLS)
- [DONE] Create src/server/lib/auth.ts (getServerAuth helper)
- [DONE] TypeScript strict compilation passes

---

# Phase A Step 3: RLS Prisma Client Extension + Cross-Tenant Integration Test

## Tasks

- [DONE] Install vitest, add test/test:watch scripts to package.json
- [DONE] Update src/server/lib/db.ts: export `prisma` (admin) + `getTenantClient(orgId)` (RLS-scoped)
  - Batch transaction: set_config → SET LOCAL ROLE quoin_app → query
  - CUID regex validation prevents SQL injection
  - quoin_app role enforces RLS (superuser `quoin` bypasses it)
- [DONE] Create vitest.config.ts (node env, dotenv setup, path alias)
- [DONE] Create test/integration/rls-isolation.test.ts — 12 tests:
  - Org A sees own buildings, cannot see Org B buildings
  - Org B sees own buildings, cannot see Org A buildings
  - Direct ID lookup across tenants returns null
  - Invalid/empty org ID throws
  - SQL injection attempt throws
  - ComplianceSnapshot isolation
  - User isolation (bidirectional)
  - Admin client sees all data across tenants
- [DONE] All 12 tests pass, TypeScript compiles clean

---

# Phase A Step 4: tRPC Setup + Building Router

## Tasks

- [DONE] Install @trpc/server, @trpc/client, @trpc/next, @trpc/react-query, @tanstack/react-query, superjson
- [DONE] Create src/server/trpc/init.ts (context, middleware: publicProcedure, protectedProcedure, tenantProcedure)
  - tenantProcedure: looks up org by clerkOrgId, injects RLS-scoped tenantDb client
- [DONE] Create src/server/trpc/routers/building.ts (list, get, create, update, portfolioStats)
  - list: pagination, sort, filter by propertyType, search by name/address
  - get: includes latest ComplianceSnapshot
  - create: auto-calculates maxPenaltyExposure
  - update: recalculates maxPenaltyExposure on GSF change
  - portfolioStats: aggregates compliance status counts, penalty exposure, avg score
- [DONE] Create src/server/trpc/routers/index.ts (root router, exports AppRouter type)
- [DONE] Create src/app/api/trpc/[trpc]/route.ts (fetchRequestHandler)
- [DONE] Create src/lib/trpc.ts (createTRPCReact client)
- [DONE] Create src/components/providers.tsx (TRPCProvider with React Query + httpBatchLink + superjson)
- [DONE] Update src/app/layout.tsx (wrap children in TRPCProvider inside ClerkProvider)
- [DONE] Create src/components/dashboard/dashboard-content.tsx (client component with tRPC hooks)
- [DONE] Update src/app/(dashboard)/dashboard/page.tsx (server wrapper → client DashboardContent)
- [DONE] TypeScript compiles clean, all 12 existing RLS tests pass

---

# Phase A Step 5: ESPM API Client

## Tasks

- [DONE] Install fast-xml-parser, p-throttle, msw@2
- [DONE] Create src/server/integrations/espm/errors.ts (ESPMError, ESPMAuthError, ESPMNotFoundError, ESPMRateLimitError, ESPMValidationError)
- [DONE] Create src/server/integrations/espm/xml-config.ts (fast-xml-parser config, ignoreAttributes: false, isArray for repeating elements)
- [DONE] Create src/server/integrations/espm/types.ts (ESPMPropertyMetrics, PropertyMetrics, ESPMProperty, ESPMMeter, ConsumptionDataEntry, etc.)
- [DONE] Create src/server/integrations/espm/client.ts (HTTP Basic auth, 3 req/s rate limiting via p-throttle, exponential backoff retries, timeout, error mapping)
- [DONE] Create src/server/integrations/espm/metrics.ts (getPropertyMetrics, getReasonsForNoScore, parseMetrics)
- [DONE] Create src/server/integrations/espm/property.ts (getProperty, listProperties, searchProperties)
- [DONE] Create src/server/integrations/espm/meter.ts (listMeters, getMeter, createMeter)
- [DONE] Create src/server/integrations/espm/consumption.ts (pushConsumptionData with 120 entry limit, getConsumptionData)
- [DONE] Create src/server/integrations/espm/index.ts (ESPM facade class, createESPMClient factory)
- [DONE] Create test/fixtures/espm/ (3 XML fixtures: compliant, non-compliant, no-score with xsi:nil)
- [DONE] Create test/unit/espm-client.test.ts — 12 tests:
  - Parse compliant metrics (score 78, all fields)
  - Parse non-compliant metrics (score 45)
  - Parse xsi:nil score as null
  - Handle empty metrics array
  - Map 401 → ESPMAuthError
  - Map 404 → ESPMNotFoundError
  - Map 400 → ESPMValidationError with extracted message
  - Retry on 500 and succeed
  - Exhaust retries on persistent 500
  - Build valid consumption XML
  - Reject empty consumption data
  - Reject >120 consumption entries
- [DONE] Update src/server/lib/config.ts (ESPM_BASE_URL, ESPM_USERNAME, ESPM_PASSWORD — optional for dev)
- [DONE] All 24 tests pass (12 RLS + 12 ESPM), TypeScript compiles clean

---

# Phase A Step 6: Eval Framework Skeleton

## Tasks

- [DONE] Create test/fixtures/golden/golden-datasets.ts (3 golden buildings with hand-verified penalties, pathways, eligibility)
  - Building A: Office 150K SF, NON_COMPLIANT, Performance pathway best ($750K vs $1.34M vs $900K)
  - Building B: Multifamily 80K SF, AT_RISK, Standard pathway best (4 pts to close), AHRA eligible
  - Building C: Hotel 200K SF, COMPLIANT, $0 penalty
  - referencePenaltyCalc() and referenceAHRAScreener() reference implementations
  - verifyGoldenDatasets() self-verification
- [DONE] Create test/eval/runner.ts (CLI eval runner with suite filter, verbose mode, scorecard, exit codes)
- [DONE] Create test/eval/suites/penalty-eval.ts — 12 eval cases:
  - Golden self-verification
  - Building A: max penalty, performance, standard, prescriptive penalties
  - Building B: max penalty, standard, performance penalties
  - Building C: compliant = $0
  - Penalty cap at $7.5M
  - AHRA eligibility (eligible + ineligible)
- [DONE] Add eval/eval:verbose scripts to package.json
- [DONE] All 12 eval cases pass, 24 vitest tests pass, TypeScript compiles clean

---

# Phase A Step 7: CSV Upload + Normalization Pipeline

## Tasks

- [DONE] Install papaparse + @types/papaparse
- [DONE] Create src/server/pipelines/data-ingestion/types.ts (ParsedRow, NormalizedReading, ColumnMapping, UploadResult, ValidationResult)
- [DONE] Create src/server/pipelines/data-ingestion/csv-parser.ts (parseCSV, detectColumns, extractRows, parseDate, parseNumber)
  - Early empty-input guard before PapaParse
  - Column auto-detection via regex scoring (date, consumption, cost patterns)
  - Multi-format date parsing (MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY)
  - Number parsing strips $, commas, whitespace
- [DONE] Create src/server/pipelines/data-ingestion/normalizer.ts (ESPM kBtu conversion factors, normalizeReading, getConversionFactor)
- [DONE] Create src/server/pipelines/data-ingestion/validator.ts (validateReading with blocking errors + warnings, findDuplicatePeriods)
- [DONE] Create src/server/pipelines/data-ingestion/logic.ts (processCSVUpload orchestrator)
- [DONE] Create src/app/api/upload/route.ts (multipart POST, auth, file validation, building ownership check)
- [DONE] Create test/fixtures/csv/ (pepco-electric-12months.csv, washington-gas-12months.csv, malformed.csv)
- [DONE] Create test/unit/csv-pipeline.test.ts — 25 tests:
  - Pepco/Washington Gas column detection and row parsing
  - kBtu conversions (kWh, CCF, therms)
  - Normalization with meter type and unit mapping
  - Date parsing (MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY, empty)
  - Number parsing ($, commas, whitespace, empty/invalid)
  - Validation: negative, zero, future dates, pre-2010, anomalous consumption
  - Duplicate period detection
  - Empty/header-only/malformed CSV handling
  - Column confidence scoring
- [DONE] All 49 tests pass (12 RLS + 12 ESPM + 25 CSV), TypeScript compiles clean

---

# Phase A Step 8: Data Ingestion Pipeline — Full Orchestration

## Tasks

- [DONE] Install bullmq, ioredis
- [DONE] Create src/server/lib/redis.ts (ioredis singleton)
- [DONE] Create src/server/lib/queue.ts (BullMQ queue factory with connection config, default job options, QUEUES constants)
- [DONE] Create src/server/pipelines/data-ingestion/snapshot.ts — pure functions:
  - calculateEUI (site/source EUI with source-site ratios per meter type)
  - determineComplianceStatus (COMPLIANT/AT_RISK/NON_COMPLIANT/PENDING_DATA)
  - calculateComplianceGap, estimatePenalty, computeDataQualityScore
  - buildSnapshotData (assembles ComplianceSnapshot data object)
- [DONE] Create src/server/pipelines/data-ingestion/espm-sync.ts (push consumption, pull metrics, chunking)
- [DONE] Extend logic.ts with runIngestionPipeline (load building → EUI → optional ESPM sync → snapshot → PipelineRun audit)
- [DONE] Create src/server/pipelines/data-ingestion/worker.ts (BullMQ worker, concurrency 3)
- [DONE] Update src/app/api/upload/route.ts (enqueue DATA_INGESTION job after CSV processing)
- [DONE] Add tRPC routes: pipelineRuns (activity log), latestSnapshot (latest per building)
- [DONE] Create test/unit/snapshot.test.ts — 31 tests:
  - EUI calculation: electric-only, dual-fuel, empty readings, zero GSF, month counting, STEAM ratio
  - Compliance status: compliant, at-target, AT_RISK, NON_COMPLIANT, PENDING_DATA
  - Compliance gap: positive, negative, zero, null
  - Penalty estimate: compliant $0, null $0, proportional, cap at 1.0, $7.5M cap
  - Data quality score: perfect, empty, rejected, warnings, incomplete, poor, clamp
  - buildSnapshotData: non-compliant, compliant, pending data, penalty cap
- [DONE] All 80 tests pass (12 RLS + 12 ESPM + 25 CSV + 31 snapshot), TypeScript compiles clean

---

# Phase A Steps 9-10: Dashboard + Building Pages

## Tasks

- [DONE] Install recharts, lucide-react
- [DONE] Update globals.css (system font stack, tabular-nums, loading bar animation, remove dark mode)
- [DONE] Update root layout.tsx (remove local fonts, clean body class)
- [DONE] Create src/app/(dashboard)/layout.tsx (sidebar + topbar + main area, auth check)
- [DONE] Create src/components/layout/sidebar.tsx (200px fixed nav, mobile hamburger, active states)
- [DONE] Create src/components/layout/topbar.tsx (48px, Clerk UserButton + OrganizationSwitcher)
- [DONE] Create src/components/layout/page-header.tsx (reusable title + actions)
- [DONE] Create src/components/dashboard/status-dot.tsx (colored dot + label per compliance status)
- [DONE] Create src/components/dashboard/kpi-row.tsx (4 stats in grid, typography hierarchy)
- [DONE] Create src/components/dashboard/building-table.tsx (sortable table with score, status, penalty, relative time)
- [DONE] Rewrite src/components/dashboard/dashboard-content.tsx (KPI row + status filter tabs + search + building table)
- [DONE] Update dashboard page.tsx (delegate auth to layout)
- [DONE] Add tRPC routes: energyReadings (24-month chart data), complianceHistory (snapshot timeline)
- [DONE] Update building.list to include latestSnapshot via complianceSnapshots include
- [DONE] Create src/components/building/building-header.tsx (name, address, type/GSF/year, upload button)
- [DONE] Create src/components/building/score-section.tsx (3 KPIs: score, status, penalty)
- [DONE] Create src/components/building/energy-tab.tsx (Recharts stacked BarChart + data freshness + readings table)
- [DONE] Create src/components/building/compliance-tab.tsx (snapshot timeline with vertical line)
- [DONE] Create src/components/building/upload-modal.tsx (drag-and-drop, file validation, result display)
- [DONE] Create src/components/building/building-detail.tsx (header + score + tabs + upload modal orchestration)
- [DONE] Create src/app/(dashboard)/buildings/[id]/page.tsx (dynamic route)
- [DONE] All 80 tests pass, TypeScript compiles clean

---

# Phase A Step 11: Mapbox Map with Building Pins

## Tasks

- [DONE] Install mapbox-gl, react-map-gl; remove deprecated @types/mapbox-gl (v3 ships own types)
- [DONE] Fix @types/mapbox__point-geometry stub issue (npm overrides → redirect to @mapbox/point-geometry)
- [DONE] Create src/components/dashboard/building-map.tsx (react-map-gl v8, DC center, light-v11 style, colored pins, click popup, navigate to detail)
- [DONE] Update src/components/dashboard/dashboard-content.tsx (Table/Map toggle, conditional rendering)
- [DONE] Update src/server/lib/config.ts (NEXT_PUBLIC_MAPBOX_TOKEN optional)
- [DONE] Graceful fallback when no Mapbox token
- [DONE] All 80 tests pass, TypeScript compiles clean

---

# Phase A Step 12: Green Button OAuth Flow

## Tasks

- [DONE] Add missing Green Button fields to Prisma schema (accessToken, refreshToken, subscriptionId, connectedAt) + migration
- [DONE] Regenerate Prisma client
- [DONE] Create src/server/integrations/green-button/types.ts (GreenButtonTokens, GreenButtonConfig, ESPIIntervalReading, ESPIReadingType, GreenButtonReading, GreenButtonNotification)
- [DONE] Create src/server/integrations/green-button/oauth.ts (buildAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken, generateState, extractSubscriptionId)
- [DONE] Create src/server/integrations/green-button/token-manager.ts (AES-256-GCM encrypt/decrypt, getValidToken with auto-refresh)
- [DONE] Create src/server/integrations/green-button/espi-parser.ts (parseESPIXml, aggregateToMonthly, UOM/commodity/multiplier handling)
- [DONE] Create src/server/integrations/green-button/client.ts (fetchSubscriptionData, fetchNotificationData with 30s timeout)
- [DONE] Create src/server/integrations/green-button/index.ts (barrel export)
- [DONE] Create src/app/api/green-button/authorize/route.ts (OAuth redirect with CSRF state)
- [DONE] Create src/app/api/green-button/callback/route.ts (token exchange, encrypted storage, status update)
- [DONE] Create src/app/api/green-button/webhook/route.ts (push notification handler, enqueue BullMQ job)
- [DONE] Update src/server/lib/config.ts (7 optional GB env vars)
- [DONE] Create test/fixtures/green-button/ (electric-daily.xml, gas-therms.xml)
- [DONE] Create test/unit/green-button.test.ts — 19 tests:
  - ESPI Parser: parse electricity, powerOfTenMultiplier, estimated detection, gas therms, kBtu conversion, empty IntervalBlocks, invalid XML, period start/end
  - Aggregation: monthly totals, empty input
  - Token Encryption: round-trip, random IV, wrong key, invalid format, empty string
  - OAuth: authorization URL params, state generation, subscriptionId extraction
- [DONE] All 87 unit tests pass (31 snapshot + 25 CSV + 19 green-button + 12 ESPM), TypeScript compiles clean

---

# Phase A Step 13: Penalty Calculator

## Tasks

- [DONE] Create src/server/pipelines/pathway-analysis/types.ts (PenaltyInput, PerformancePathwayInput, StandardTargetInput, PrescriptivePathwayInput, PenaltyResult, AllPathwaysResult)
- [DONE] Create src/server/pipelines/pathway-analysis/penalty-calculator.ts — pure functions:
  - calculateMaxPenalty (GSF × $10, capped $7.5M)
  - calculatePerformancePenalty (proportional to % of 20% Site EUI reduction)
  - calculateStandardTargetPenalty (TWO-STEP: initial performance adj + gap closure, BEPS Guidebook Table 23)
  - calculatePrescriptivePenalty (points earned / points needed)
  - calculateAllPathways (all three, recommends lowest)
- [DONE] Create src/server/pipelines/pathway-analysis/index.ts (barrel export)
- [DONE] Update src/server/pipelines/data-ingestion/snapshot.ts (use real calculateMaxPenalty)
- [DONE] Update golden datasets: Building B standard penalty → two-step formula, update referencePenaltyCalc
- [DONE] Wire eval framework to real penalty calculator (replace all stubs)
- [DONE] Create test/unit/penalty-calculator.test.ts — 39 tests:
  - Max penalty: 7 cases (normal, cap, zero, negative)
  - Performance: 7 cases (compliant, exceeds, proportional, zero, negative EUI, boundary)
  - Standard Target two-step: 6 cases (compliant, exceeds, Guidebook example, large gap, no gains, boundary)
  - Prescriptive: 5 cases (compliant, proportional, zero, boundary)
  - All Pathways: 3 cases (comparison, compliant, missing data)
  - Golden dataset validation: 6 cases (A×3, B×2, C×1)
  - Edge cases: 3 cases (zero GSF, exact boundaries)
- [DONE] Eval framework: 12/12 cases pass with real calculator (no stubs)
- [DONE] All 126 unit tests pass (31 snapshot + 25 CSV + 19 green-button + 12 ESPM + 39 penalty), TypeScript compiles clean

---

# Phase A Step 14: Onboarding Wizard

## Tasks

- [DONE] Create src/app/(onboarding)/layout.tsx (minimal layout: auth check, logo topbar, max-w-lg centered content)
- [DONE] Create src/components/onboarding/wizard-shell.tsx (5-step progress bar: numbered dots, connecting lines, completed ✓)
- [DONE] Create src/components/onboarding/beps-targets.ts (BEPS_TARGET_SCORES lookup, PROPERTY_TYPE_LABELS, DC_WARD_OPTIONS)
- [DONE] Create src/components/onboarding/building-form.tsx (reusable form: DC lat/lng validation, GSF ≥ 10K, auto-populated BEPS target score)
- [DONE] Create src/components/onboarding/step-org.tsx (Step 1: create org or continue with existing)
- [DONE] Create src/components/onboarding/step-building.tsx (Step 2: add first building via BuildingForm + tRPC mutation)
- [DONE] Create src/components/onboarding/step-data.tsx (Step 3: CSV upload with drag-and-drop, skip option)
- [DONE] Create src/components/onboarding/step-connect.tsx (Step 4: ESPM connection instructions, skip option)
- [DONE] Create src/components/onboarding/step-done.tsx (Step 5: summary with link to dashboard)
- [DONE] Create src/app/(onboarding)/onboarding/page.tsx (client component: step state, WizardShell + step components)
- [DONE] Add building.onboardingStatus tRPC route (protectedProcedure: hasOrg, orgSynced, hasBuilding, isComplete)
- [DONE] Fix: thread buildingId from Step 2 → Step 3 (StepData) for CSV upload
- [DONE] All 126 unit tests pass, TypeScript compiles clean, ESLint clean

---

# Phase A Step 15: Staging Deploy (AWS Free Tier)

## Tasks

- [DONE] Update next.config.mjs (output: "standalone" for self-contained production build)
- [DONE] Create Dockerfile (multi-stage: deps → build → production with standalone output)
- [DONE] Create .dockerignore
- [DONE] Create src/server/worker-entrypoint.ts (standalone BullMQ worker process with graceful shutdown)
- [DONE] Create tsconfig.worker.json (CommonJS output for Node.js worker)
- [DONE] Add worker/worker:build/worker:prod scripts to package.json
- [DONE] Create docker-compose.prod.yml (app + worker + Redis containers)
- [DONE] Create nginx/quoin.conf (reverse proxy + TLS + security headers)
- [DONE] Create deploy/setup-ec2.sh (one-time EC2 provisioning: Docker, Nginx, Certbot)
- [DONE] Create deploy/deploy.sh (pull, build, restart, migrate)
- [DONE] Create .env.production.template (all required env vars documented)
- [DONE] Create src/app/api/health/route.ts (public health check endpoint)
- [DONE] Update middleware.ts (add /api/health to public routes)
- [DONE] Create .github/workflows/ci.yml (Postgres + Redis services, tsc, test, eval)
- [DONE] All 126 unit tests pass, TypeScript compiles clean, ESLint clean

---

# Phase 2: Engineering Tasks

## Section 1: Robust Data Ingestion & Metric Generation

- [DONE] csv-parser.ts outputs valid EnergyReading records (kWh, Therms, CCF)
- [DONE] xml-parser.ts: ESPM XML mock service via fast-xml-parser (score, siteEui, weatherNormalizedSiteEui)
- [DONE] Added weatherNormalizedSiteEui to ComplianceSnapshot schema + types
- [DONE] Worker pipeline wires CSV → normalize → validate → persist → ESPM sync → ComplianceSnapshot
- [DONE] Migration: 20260306100000_add_weather_normalized_eui

## Section 2: Pathway-Specific Compliance Math & Exemptions

- [DONE] determineApplicablePathway(): score-based routing (>55 Standard, ≤55 Performance)
- [DONE] exemption-screener.ts: Low Occupancy, Financial Distress, Recent Construction checks

## Section 3: ECM Generation & Capital Structuring

- [DONE] ecm-scorer.ts: 10 ECMs, Quick Win/Deep Retrofit prioritization by pathway
- [DONE] eligibility/cleer.ts, cpace.ts, ahra.ts: Boolean funding screeners
- [DONE] logic.ts: Capital stack assembly (Grants → Debt → CPACE → Equity)

## Section 4: Active Monitoring & DOEE Reporting

- [DONE] rules-engine.ts: 5 drift detection rules (EUI Spike, Score Drop, Anomaly, Seasonal, Sustained)
- [DONE] worker.ts: BullMQ drift detection worker
- [DONE] report.ts: tRPC router (getComplianceReport, getExemptionReport)
- [DONE] 211 unit tests pass. 1 integration test pending DB migration.
