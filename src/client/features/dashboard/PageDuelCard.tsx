import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { CardShell } from "@/client/components/CardShell";
import { MetricsTable, percentChange } from "@/client/components/MetricsTable";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/client/components/ui/chart";
import { moreDetailsClass } from "@/client/features/dashboard/cardParts";
import {
  formatCount,
  formatCtr,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { getPageDuelDashboardReport } from "@/serverFunctions/pageduel";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const visitorsChartConfig = {
  visitors: { label: "Visitors", color: "var(--color-primary)" },
} satisfies ChartConfig;

function formatTrendDay(date: string): string {
  // Local time on purpose: Date.parse("2026-08-01") is UTC midnight, which
  // renders as the previous day west of Greenwich.
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatRevenue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function Change({ current, previous }: { current: number; previous: number }) {
  const change = percentChange(current, previous);
  if (change === null) return undefined;
  return (
    <span
      className={
        change > 0
          ? "text-success"
          : change < 0
            ? "text-destructive"
            : "text-muted-foreground"
      }
    >
      {change > 0 ? "+" : ""}
      {change}%
    </span>
  );
}

/** The dashboard's PageDuel card: totals vs the previous period plus a daily
 *  visitors trend over the last 28 complete UTC days. */
export function PageDuelCard({ projectId }: { projectId: string }) {
  const reportQuery = useQuery({
    queryKey: ["dashboardPageDuelReport", projectId],
    queryFn: () => getPageDuelDashboardReport({ data: { projectId } }),
    staleTime: FIVE_MINUTES_MS,
  });
  const report = reportQuery.data;

  if (reportQuery.isPending || (report && !report.connected)) return null;

  return (
    <CardShell
      title="PageDuel traffic"
      action={
        <Link
          to="/p/$projectId/settings/integrations"
          params={{ projectId }}
          hash="pageduel"
          className={moreDetailsClass}
        >
          Manage
        </Link>
      }
    >
      {!report ? (
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load PageDuel data. Try again shortly.
        </p>
      ) : "problem" in report ? (
        <p className="text-sm text-muted-foreground">
          PageDuel rejected the saved API key.{" "}
          <Link
            to="/p/$projectId/settings/integrations"
            params={{ projectId }}
            hash="pageduel"
            className="underline"
          >
            Reconnect in Settings
          </Link>
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {report.site.name} · Last 28 days
          </p>
          {report.current.visitors === 0 ? (
            <p className="text-sm text-muted-foreground">
              No visitors recorded in the last 28 days yet.
            </p>
          ) : (
            <div className="space-y-4">
              <MetricsTable
                showChange
                rows={[
                  {
                    label: "Visitors",
                    value: formatCount(report.current.visitors),
                    change: (
                      <Change
                        current={report.current.visitors}
                        previous={report.previous.visitors}
                      />
                    ),
                  },
                  {
                    label: "Pageviews",
                    value: formatCount(report.current.pageviews),
                    change: (
                      <Change
                        current={report.current.pageviews}
                        previous={report.previous.pageviews}
                      />
                    ),
                  },
                  {
                    label: "Conversion rate",
                    value: formatCtr(report.current.conversionRate),
                  },
                  {
                    label: "Revenue",
                    value: formatRevenue(report.current.revenue),
                    change: (
                      <Change
                        current={report.current.revenue}
                        previous={report.previous.revenue}
                      />
                    ),
                  },
                ]}
              />
              <ChartContainer config={visitorsChartConfig} className="h-24">
                <AreaChart
                  data={report.trend}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <XAxis dataKey="date" hide />
                  <YAxis hide domain={[0, "auto"]} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(label: unknown) =>
                          typeof label === "string" ? formatTrendDay(label) : ""
                        }
                        valueFormatter={(value) => formatCount(Number(value))}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="visitors"
                    stroke="var(--color-visitors)"
                    strokeWidth={2}
                    fill="var(--color-visitors)"
                    fillOpacity={0.08}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}
