import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { CardShell } from "@/client/components/CardShell";
import { useAppForm } from "@/client/components/form/useAppForm";
import { PermissionHint } from "@/client/components/PermissionHint";
import { QueryError } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  connectPageDuel,
  disconnectPageDuel,
  getPageDuelConnection,
  listPageDuelSites,
} from "@/serverFunctions/pageduel";

const PROBLEM_COPY = {
  invalid_key:
    "PageDuel rejected this API key. Check that you copied it in full.",
  no_api_access:
    "This PageDuel plan does not include API access. Upgrade to a paid plan.",
  rate_limited: "PageDuel rate limit reached. Try again later.",
} as const;

const formSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^pd_[0-9a-f]{40}$/, "Enter a PageDuel API key (starts with pd_)."),
  siteId: z.string(),
});

const pageDuelConnectionQueryKey = (projectId: string) =>
  ["pageduelConnection", projectId] as const;

export function PageDuelConnectionCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [sites, setSites] = useState<Array<{
    id: string;
    name: string;
    domain: string;
  }> | null>(null);

  const connectionQuery = useQuery({
    queryKey: pageDuelConnectionQueryKey(projectId),
    queryFn: () => getPageDuelConnection({ data: { projectId } }),
  });
  const connection = connectionQuery.data;

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: pageDuelConnectionQueryKey(projectId),
    });
    await queryClient.invalidateQueries({
      queryKey: ["dashboardPageDuelReport", projectId],
    });
  };

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectPageDuel({ data: { projectId } }),
    onSuccess: refresh,
  });

  const form = useAppForm({
    defaultValues: { apiKey: "", siteId: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: formSchema },
    onSubmit: async ({ value, formApi }) => {
      const apiKey = value.apiKey.trim();
      let siteId = value.siteId;
      if (!sites) {
        const listed = await listPageDuelSites({ data: { projectId, apiKey } });
        if ("problem" in listed) {
          formApi.setErrorMap({
            onSubmit: { fields: { apiKey: PROBLEM_COPY[listed.problem] } },
          });
          return;
        }
        if (listed.sites.length === 0) {
          formApi.setErrorMap({
            onSubmit: {
              fields: { apiKey: "This key can't read any PageDuel sites." },
            },
          });
          return;
        }
        if (listed.sites.length > 1) {
          setSites(listed.sites);
          formApi.setFieldValue("siteId", listed.sites[0].id);
          return;
        }
        siteId = listed.sites[0].id;
      }
      const result = await connectPageDuel({
        data: { projectId, apiKey, siteId },
      });
      if ("problem" in result) {
        formApi.setErrorMap({
          onSubmit: { fields: { apiKey: PROBLEM_COPY[result.problem] } },
        });
        return;
      }
      setSites(null);
      formApi.reset();
      await refresh();
    },
  });

  return (
    <CardShell
      title="PageDuel"
      action={
        connection ? (
          <Badge variant={connection.connected ? "success" : "outline"}>
            <span className="size-1.5 rounded-full bg-current" />
            {connection.connected ? "Connected" : "Not connected"}
          </Badge>
        ) : undefined
      }
    >
      {connectionQuery.isPending ? (
        <div
          role="status"
          aria-label="Loading connection"
          className="space-y-3"
        >
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-24" />
        </div>
      ) : !connection ? (
        <QueryError
          error={connectionQuery.error}
          fallback="Couldn't check this project's PageDuel connection."
          onRetry={() => void connectionQuery.refetch()}
          isRetrying={connectionQuery.isFetching}
        />
      ) : !connection.encryptionConfigured ? (
        <p className="text-sm text-muted-foreground">
          PageDuel isn't set up yet. An admin sets{" "}
          <code>BETTER_AUTH_SECRET</code> to at least 32 characters. It encrypts
          your PageDuel API key.
        </p>
      ) : connection.connected ? (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{connection.siteName}</span>{" "}
            <span className="text-muted-foreground">
              {connection.siteDomain}
            </span>
          </p>
          {connection.connectedAt ? (
            <p className="text-sm text-muted-foreground">
              Connected {new Date(connection.connectedAt).toLocaleDateString()}
            </p>
          ) : null}
          {connection.canManage ? (
            <Button
              variant="outline"
              size="sm"
              pending={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      ) : connection.canManage ? (
        <form.AppForm>
          <form.Form className="space-y-3">
            <p className="text-sm text-muted-foreground">
              See your PageDuel traffic on the dashboard and let your agent read
              it. Create an API key in PageDuel under Settings, API keys.
            </p>
            <form.AppField name="apiKey">
              {(field) => (
                <field.TextField
                  label="API key"
                  type="password"
                  autoComplete="off"
                  data-ph-mask
                  className="font-mono"
                  placeholder="pd_..."
                  disabled={sites !== null}
                  required
                />
              )}
            </form.AppField>
            {sites ? (
              <form.AppField name="siteId">
                {(field) => (
                  <field.SelectField
                    label="Site"
                    items={sites.map((site) => ({
                      value: site.id,
                      label: `${site.name} (${site.domain})`,
                    }))}
                  />
                )}
              </form.AppField>
            ) : null}
            <form.SubmitButton>
              {sites ? "Connect" : "Find sites"}
            </form.SubmitButton>
          </form.Form>
        </form.AppForm>
      ) : (
        <PermissionHint action="connect PageDuel to this project" />
      )}
      {disconnectMutation.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {getStandardErrorMessage(disconnectMutation.error)}
        </p>
      ) : null}
    </CardShell>
  );
}
