"use client";

import React from "react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface EnergyReadingRow {
  id: string;
  meterType: "ELECTRIC" | "GAS" | "STEAM" | "OTHER";
  meterName?: string | null;
  consumption: number;
  unit: string;
  consumptionKbtu: number;
  cost: number | null;
  source: string;
  periodStart: string | Date;
  periodEnd: string | Date;
}

interface ChartPoint {
  month: string;
  ELECTRIC: number;
  GAS: number;
  STEAM: number;
  OTHER: number;
}

function relativeTime(date: string | Date): { text: string; color: string } {
  const value = new Date(date);
  const now = new Date();
  const days = Math.floor((now.getTime() - value.getTime()) / 86_400_000);

  if (days <= 30) {
    return { text: `${days}d ago`, color: "#10b981" };
  }

  if (days <= 60) {
    return { text: `${days}d ago`, color: "#f59e0b" };
  }

  return { text: `${days}d ago`, color: "#ef4444" };
}

function buildChartData(rows: EnergyReadingRow[]) {
  const monthMap = new Map<string, ChartPoint>();
  let latestDate: Date | null = null;

  for (const reading of rows) {
    const periodStart = new Date(reading.periodStart);
    const key = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = `${periodStart.toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    })} '${String(periodStart.getUTCFullYear()).slice(2)}`;

    if (!monthMap.has(key)) {
      monthMap.set(key, {
        month: label,
        ELECTRIC: 0,
        GAS: 0,
        STEAM: 0,
        OTHER: 0,
      });
    }

    const point = monthMap.get(key);
    const meterType = reading.meterType as keyof Omit<ChartPoint, "month">;
    if (point && meterType in point) {
      point[meterType] += reading.consumptionKbtu;
    }

    if (!latestDate || periodStart > latestDate) {
      latestDate = periodStart;
    }
  }

  const chartData = Array.from(monthMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);

  const hasFuel = (fuel: keyof Omit<ChartPoint, "month">) =>
    chartData.some((entry) => entry[fuel] > 0);

  return { chartData, hasFuel, latestDate };
}

export function EnergyUsageChart({
  rows,
  heightClassName = "h-[260px]",
}: {
  rows: EnergyReadingRow[];
  heightClassName?: string;
}) {
  const { chartData, hasFuel, latestDate } = useMemo(() => buildChartData(rows), [rows]);

  if (chartData.length === 0) {
    return null;
  }

  const freshnessText = latestDate
    ? `Last data received: ${latestDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })}`
    : "";
  const freshness = latestDate ? relativeTime(latestDate) : null;

  return (
    <div className="space-y-3">
      <div className={`${heightClassName} border border-zinc-200 p-6`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barCategoryGap="25%">
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: "#71717a", fontWeight: 500 }}
              axisLine={{ stroke: "#e4e4e7" }}
              tickLine={false}
              dy={10}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#71717a", fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) =>
                value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value)
              }
              dx={-10}
            />
            <Tooltip
              contentStyle={{
                border: "1px solid #e4e4e7",
                borderRadius: "8px",
                fontSize: "12px",
                boxShadow:
                  "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
              }}
              formatter={(value) => [`${Number(value).toLocaleString()} kBtu`]}
              cursor={{ fill: "#f4f4f5" }}
            />
            {hasFuel("ELECTRIC") ? (
              <Bar
                dataKey="ELECTRIC"
                stackId="a"
                fill="#3b82f6"
                name="Electric"
                radius={[
                  hasFuel("GAS") || hasFuel("STEAM") || hasFuel("OTHER") ? 0 : 4,
                  hasFuel("GAS") || hasFuel("STEAM") || hasFuel("OTHER") ? 0 : 4,
                  0,
                  0,
                ]}
              />
            ) : null}
            {hasFuel("GAS") ? (
              <Bar
                dataKey="GAS"
                stackId="a"
                fill="#f59e0b"
                name="Gas"
                radius={[
                  hasFuel("STEAM") || hasFuel("OTHER") ? 0 : 4,
                  hasFuel("STEAM") || hasFuel("OTHER") ? 0 : 4,
                  0,
                  0,
                ]}
              />
            ) : null}
            {hasFuel("STEAM") ? (
              <Bar
                dataKey="STEAM"
                stackId="a"
                fill="#8b5cf6"
                name="Steam"
                radius={[hasFuel("OTHER") ? 0 : 4, hasFuel("OTHER") ? 0 : 4, 0, 0]}
              />
            ) : null}
            {hasFuel("OTHER") ? (
              <Bar
                dataKey="OTHER"
                stackId="a"
                fill="#71717a"
                name="Other"
                radius={[4, 4, 0, 0]}
              />
            ) : null}
            <Legend
              wrapperStyle={{
                fontSize: "12px",
                color: "#52525b",
                fontWeight: 500,
                paddingTop: "12px",
              }}
              iconType="circle"
              iconSize={8}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {freshness ? (
        <p className="text-xs font-medium text-zinc-500">
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full ring-1 ring-white/50"
            style={{ backgroundColor: freshness.color }}
          />
          {freshnessText} <span className="font-normal text-zinc-400">({freshness.text})</span>
        </p>
      ) : null}
    </div>
  );
}
