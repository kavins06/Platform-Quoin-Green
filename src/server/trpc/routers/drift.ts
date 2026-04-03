import { z } from "zod";
import { tenantProcedure, router } from "../init";
import { TRPCError } from "@trpc/server";

/**
 * Drift Alerts tRPC Router
 *
 * Provides queries for listing/filtering drift alerts and mutations
 * for acknowledging/resolving them.
 */

const alertOutputSchema = z.object({
  id: z.string(),
  buildingId: z.string(),
  ruleId: z.string(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  status: z.enum(["ACTIVE", "ACKNOWLEDGED", "RESOLVED"]),
  title: z.string(),
  description: z.string(),
  currentValue: z.number(),
  threshold: z.number(),
  aiRootCause: z.string().nullable(),
  detectedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});

export const driftRouter = router({
  /**
   * List drift alerts for a building, ordered by most recent first.
   */
  listAlerts: tenantProcedure
    .input(
      z.object({
        buildingId: z.string(),
        status: z.enum(["ACTIVE", "ACKNOWLEDGED", "RESOLVED"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .output(z.array(alertOutputSchema))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        buildingId: input.buildingId,
      };
      if (input.status) {
        where.status = input.status;
      }

      const alerts = await ctx.tenantDb.driftAlert.findMany({
        where,
        orderBy: { detectedAt: "desc" },
        take: input.limit,
      });

      return alerts.map((a: {
        id: string;
        buildingId: string;
        ruleId: string;
        severity: string;
        status: string;
        title: string;
        description: string;
        currentValue: number;
        threshold: number;
        aiRootCause: string | null;
        detectedAt: Date;
        acknowledgedAt: Date | null;
        resolvedAt: Date | null;
      }) => ({
        id: a.id,
        buildingId: a.buildingId,
        ruleId: a.ruleId,
        severity: a.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        status: a.status as "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED",
        title: a.title,
        description: a.description,
        currentValue: a.currentValue,
        threshold: a.threshold,
        aiRootCause: a.aiRootCause,
        detectedAt: a.detectedAt.toISOString(),
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: a.resolvedAt?.toISOString() ?? null,
      }));
    }),

  /**
   * Get summary counts of alerts by severity for a building.
   */
  alertSummary: tenantProcedure
    .input(z.object({ buildingId: z.string() }))
    .output(
      z.object({
        total: z.number(),
        active: z.number(),
        critical: z.number(),
        high: z.number(),
        medium: z.number(),
        low: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const activeAlerts = await ctx.tenantDb.driftAlert.findMany({
        where: {
          buildingId: input.buildingId,
          status: "ACTIVE",
        },
        select: { severity: true },
      });

      return {
        total: activeAlerts.length,
        active: activeAlerts.length,
        critical: activeAlerts.filter((a: { severity: string }) => a.severity === "CRITICAL").length,
        high: activeAlerts.filter((a: { severity: string }) => a.severity === "HIGH").length,
        medium: activeAlerts.filter((a: { severity: string }) => a.severity === "MEDIUM").length,
        low: activeAlerts.filter((a: { severity: string }) => a.severity === "LOW").length,
      };
    }),

  /**
   * Acknowledge an alert (mark as seen but not resolved).
   */
  acknowledge: tenantProcedure
    .input(z.object({ alertId: z.string() }))
    .output(z.object({ id: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const alert = await ctx.tenantDb.driftAlert.findUnique({
        where: { id: input.alertId },
      });
      if (!alert) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      }

      const updated = await ctx.tenantDb.driftAlert.update({
        where: { id: input.alertId },
        data: {
          status: "ACKNOWLEDGED",
          acknowledgedAt: new Date(),
        },
      });

      return { id: updated.id, status: updated.status };
    }),

  /**
   * Resolve an alert (mark as fixed/no longer relevant).
   */
  resolve: tenantProcedure
    .input(z.object({ alertId: z.string() }))
    .output(z.object({ id: z.string(), status: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const alert = await ctx.tenantDb.driftAlert.findUnique({
        where: { id: input.alertId },
      });
      if (!alert) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      }

      const updated = await ctx.tenantDb.driftAlert.update({
        where: { id: input.alertId },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
        },
      });

      return { id: updated.id, status: updated.status };
    }),
});
