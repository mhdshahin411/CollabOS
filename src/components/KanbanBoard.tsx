"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { STAGES, type Deal, type DealStage } from "@/lib/types";
import DealCard from "./DealCard";
import DealDetailsModal from "./DealDetailsModal";

export default function KanbanBoard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const dealsRef = useRef<Deal[]>([]);
  dealsRef.current = deals;

  // Initial load + realtime subscription.
  //
  // Two races are handled deliberately:
  //  (a) Cold start — realtime events can arrive before the initial select()
  //      resolves. We buffer them and replay onto the snapshot, so an INSERT/
  //      UPDATE/DELETE that landed mid-flight is never clobbered or resurrected.
  //  (b) Reconnect — Supabase Realtime does NOT replay changes missed while the
  //      socket was down. We drive the fetch from the SUBSCRIBED callback, so
  //      every (re)subscribe re-syncs the board instead of leaving it stale.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let loaded = false;
    const buffer: RealtimePostgresChangesPayload<Deal>[] = [];

    const apply = (prev: Deal[], p: RealtimePostgresChangesPayload<Deal>): Deal[] => {
      if (p.eventType === "INSERT") {
        const row = p.new as Deal;
        return [row, ...prev.filter((d) => d.id !== row.id)];
      }
      if (p.eventType === "UPDATE") {
        const row = p.new as Deal;
        // upsert, not map — the row may not be in state yet (cold-start race)
        return prev.some((d) => d.id === row.id)
          ? prev.map((d) => (d.id === row.id ? row : d))
          : [row, ...prev];
      }
      if (p.eventType === "DELETE") {
        const row = p.old as Partial<Deal>;
        return prev.filter((d) => d.id !== row.id);
      }
      return prev;
    };

    const load = async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        // Do NOT blank `deals` — an empty array is an affirmative "you have no
        // deals" claim, indistinguishable from a real failure. Keep the last
        // known board and surface a retry instead.
        console.error("Failed to load deals:", error);
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      // Snapshot first, then replay everything the socket delivered in flight.
      let next = (data as Deal[]) ?? [];
      for (const p of buffer) next = apply(next, p);
      buffer.length = 0;
      loaded = true;
      setLoadError(null);
      setDeals(next);
      setLoading(false);
    };

    const channel = supabase
      .channel("deals-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, (p) => {
        const payload = p as RealtimePostgresChangesPayload<Deal>;
        if (!loaded) {
          buffer.push(payload);
          return;
        }
        setDeals((prev) => apply(prev, payload));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // (Re)subscribed — resync from scratch, replaying anything buffered.
          loaded = false;
          buffer.length = 0;
          void load();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLoadError((prev) => prev ?? "Live updates disconnected — this board may be stale.");
        }
      });

    // Kick off the first load immediately too, so a slow/failed subscribe still
    // resolves the skeleton rather than hanging on it forever.
    void load();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reloadKey]);

  // Optimistic stage move with rollback on failure
  const moveDeal = useCallback(async (dealId: string, stage: DealStage) => {
    const previous = dealsRef.current;
    const deal = previous.find((d) => d.id === dealId);
    if (!deal || deal.stage === stage) return;

    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage } : d)));

    const { error } = await getSupabaseBrowser()
      .from("deals")
      .update({ stage })
      .eq("id", dealId);
    if (error) {
      console.error("Failed to move deal:", error);
      setDeals(previous); // roll back
    }
  }, []);

  // Derive the open deal from live state so the modal reflects realtime updates
  // and closes on its own if the deal is deleted.
  const selectedDeal = selectedDealId ? deals.find((d) => d.id === selectedDealId) ?? null : null;

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => (
          <div key={s.id} className="h-64 animate-pulse rounded-xl bg-slate-900" />
        ))}
      </div>
    );
  }

  return (
    <>
      {loadError && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
        >
          <span>Couldn&apos;t reach your pipeline. {loadError}</span>
          <button
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setReloadKey((k) => k + 1);
            }}
            className="ml-auto rounded-md border border-rose-700 px-2.5 py-1 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-900/50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage === stage.id);
          const isDropTarget = dragOverStage === stage.id;

          return (
            <section
              key={stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(stage.id);
              }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                const dealId = e.dataTransfer.getData("text/deal-id");
                if (dealId) moveDeal(dealId, stage.id);
              }}
              className={`flex min-h-[16rem] flex-col rounded-xl border bg-slate-900/60 p-3 transition-colors ${
                isDropTarget ? "border-sky-500/60 bg-slate-900" : "border-slate-800"
              }`}
            >
              <header className="mb-3 flex items-center gap-2 px-1">
                <span className={`h-2 w-2 rounded-full ${stage.accent}`} />
                <h2 className="text-sm font-medium text-slate-200">{stage.label}</h2>
                <span className="ml-auto rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  {stageDeals.length}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-2">
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    isDragging={draggingId === deal.id}
                    onClick={() => setSelectedDealId(deal.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/deal-id", deal.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(deal.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                  />
                ))}
                {/* Only claim emptiness when the load actually succeeded. */}
                {stageDeals.length === 0 && !loadError && (
                  <p className="mt-8 text-center text-xs text-slate-600">Drop a deal here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {selectedDeal && (
        <DealDetailsModal deal={selectedDeal} onClose={() => setSelectedDealId(null)} />
      )}
    </>
  );
}
