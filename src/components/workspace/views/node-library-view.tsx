"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui";
import { getProviders } from "@/components/workspace/client-api";
import { NodeLibrarySpecimen } from "@/components/workspace/node-library-specimen";
import type { ProviderModel } from "@/components/workspace/types";
import { getNodeCatalogEntries } from "@/lib/node-catalog";
import { buildUiDataAttributes } from "@/lib/design-system";
import { useRouter } from "@/renderer/navigation";
import { queryKeys } from "@/renderer/query";
import {
  buildAppHomeRoute,
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
  const cards = useMemo(
    () =>
      entries.map((entry) => ({
        entry,
        fixture: entry.buildPlaygroundFixture(providers),
      })),
    [entries, providers]
  );
  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return cards;
    }

    return cards.filter(({ entry }) => {
      const haystack = [
        entry.label,
        entry.shortDescription,
        entry.category,
        entry.variantHint || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [cards, query]);

  return (
    <main {...buildUiDataAttributes("app", "comfortable")} className={styles.page}>
      <div className={styles.pageShell}>
        <header className={styles.topBar}>
          <div className={styles.titleGroup}>
            <button
              type="button"
              className={styles.homeButton}
              onClick={() => {
                router.push(buildAppHomeRoute());
              }}
            >
              Home
            </button>
            <h1>Node Library</h1>
          </div>
          <Input
            className={styles.searchField}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search nodes"
          />
        </header>

        {filteredCards.length === 0 ? (
          <div className={styles.empty}>No node types match that search.</div>
        ) : (
          <div className={styles.galleryGrid}>
            {filteredCards.map(({ entry, fixture }) => (
              <button
                key={entry.id}
                type="button"
                className={styles.card}
                onClick={() => {
                  router.push(buildNodeLibraryDetailRoute(entry.id));
                }}
              >
                <div className={styles.stageFrame}>
                  <NodeLibrarySpecimen fixture={fixture} providerModels={providers} />
                </div>

                <div className={styles.cardFooter}>
                  <div className={styles.cardCopy}>
                    <h2>{entry.label}</h2>
                    <p>{entry.shortDescription}</p>
                  </div>
                  {entry.id === "model" && entry.variantHint ? (
                    <div className={styles.cardStat}>{entry.variantHint}</div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
