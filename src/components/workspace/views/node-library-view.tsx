"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Input, Panel, SectionHeader, ToolbarGroup } from "@/components/ui";
import { getProviders } from "@/components/workspace/client-api";
import type { ProviderModel } from "@/components/workspace/types";
import { getNodeCatalogEntries } from "@/lib/node-catalog";
import { buildUiDataAttributes } from "@/lib/design-system";
import { useRouter } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
import {
  buildAppHomeRoute,
  buildAppSettingsRoute,
  buildNodeLibraryDetailRoute,
} from "@/renderer/workspace-route";
import styles from "./node-library-view.module.css";

export function NodeLibraryView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data: providers = [] } = useQuery<ProviderModel[]>({
    queryKey: queryKeys.providers,
    queryFn: getProviders,
  });

  const entries = useMemo(() => getNodeCatalogEntries(providers), [providers]);
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return entries;
    }

    return entries.filter((entry) => {
      const haystack = [
        entry.label,
        entry.shortDescription,
        entry.category,
        entry.inputSummary,
        entry.outputSummary,
        entry.variantHint || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [entries, query]);

  const providerCount = new Set(providers.map((provider) => provider.providerId)).size;

  return (
    <main {...buildUiDataAttributes("app", "comfortable")} className={styles.page}>
      <section className={styles.hero}>
        <Panel variant="hero" className={styles.heroCard}>
          <div className={styles.kicker}>Node Registry</div>
          <h1>Node Library</h1>
          <p>
            Browse the canonical node catalog, inspect real node behavior, and use the detail pages as
            design/debug playgrounds for every built-in node type.
          </p>

          <ToolbarGroup className={styles.heroActions}>
            <Button
              onClick={() => {
                router.push(buildAppHomeRoute());
              }}
            >
              Back Home
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                router.push(buildAppSettingsRoute());
              }}
            >
              App Settings
            </Button>
          </ToolbarGroup>
        </Panel>

        <Panel variant="raised" className={styles.searchCard}>
          <div className={styles.kicker}>Search</div>
          <p>
            The gallery, insert picker, native add menus, model chooser, and prompt harness all pull from
            the same catalog now.
          </p>
          <Input
            className={styles.searchField}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search node names, categories, or I/O"
          />

          <div className={styles.metricGrid}>
            <Panel variant="subtle" className={styles.metric}>
              <span>Built-ins</span>
              <strong>{entries.length}</strong>
            </Panel>
            <Panel variant="subtle" className={styles.metric}>
              <span>Providers</span>
              <strong>{providerCount || "…"}</strong>
            </Panel>
            <Panel variant="subtle" className={styles.metric}>
              <span>Model Variants</span>
              <strong>{providers.length || "…"}</strong>
            </Panel>
            <Panel variant="subtle" className={styles.metric}>
              <span>Insertable</span>
              <strong>{entries.filter((entry) => entry.insertableOnCanvas).length}</strong>
            </Panel>
          </div>
        </Panel>
      </section>

      <Panel variant="panel" className={styles.gallerySection}>
        <SectionHeader
          eyebrow="Catalog"
          title="Built-In Nodes"
          description="Every card opens a detail page with the real canvas renderer and an ephemeral playground."
        />

        {filteredEntries.length === 0 ? (
          <div className={styles.empty}>No node types match that search.</div>
        ) : (
          <div className={styles.cardGrid}>
            {filteredEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={styles.card}
                onClick={() => {
                  router.push(buildNodeLibraryDetailRoute(entry.id));
                }}
              >
                  <div className={styles.cardHeader}>
                    <div>
                      <h3>{entry.label}</h3>
                      <p>{entry.shortDescription}</p>
                    </div>
                    <Badge variant="info" className={styles.category}>
                      {entry.category}
                    </Badge>
                  </div>

                  <div className={styles.metaRow}>
                    <Badge variant="neutral" className={styles.metaPill}>
                      {entry.inputSummary}
                    </Badge>
                    <Badge variant="neutral" className={styles.metaPill}>
                      {entry.outputSummary}
                    </Badge>
                    {entry.variantHint ? (
                      <Badge variant="accent" className={styles.metaPill}>
                        {entry.variantHint}
                      </Badge>
                    ) : null}
                  </div>

                  <div className={styles.metaRow}>
                    {entry.supportedDisplayModes.map((mode) => (
                      <Badge key={`${entry.id}-${mode}`} variant="neutral" className={styles.metaPill}>
                        {mode}
                      </Badge>
                    ))}
                  </div>
                </button>
            ))}
          </div>
        )}
      </Panel>
    </main>
  );
}
