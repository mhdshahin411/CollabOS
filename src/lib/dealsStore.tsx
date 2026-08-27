"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { Channel, Deal, DealStage } from "@/lib/types";

export type ChannelFilter = Channel | "all";

interface DealsContextValue {
  deals: Deal[];
  visibleDeals: Deal[];
  loading: boolean;
  loadError: string | null;
  retry: () => void;
  moveDeal: (dealId: string, stage: DealStage) => Promise<void>;
  selectedDealId: string | null;
  selectDeal: (id: string | null) => void;
  selectedDeal: Deal | null;
  channelFilter: ChannelFilter;
  setChannelFilter: (c: ChannelFilter) => void;
  query: string;
  setQuery: (q: string) => void;
}

const DealsContext = createContext<DealsContextValue | null>(null);

export function useDeals(): DealsContextValue {
  const ctx = useContext(DealsContext);
  if (!ctx) throw new Error("useDeals must be used within <DealsProvider>");
  return ctx;
}

export function DealsProvider({ children }: { children: React.ReactNode }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [query, setQuery] = useState("");

  const dealsRef = useRef<Deal[]>([]);
  dealsRef.current = deals;

  // Initial load + realtime. Handles both the cold-start race (buffer events
  // that arrive before the snapshot resolves) and reconnect (refetch on every
  // SUBSCRIBED), and never blanks the board on a failed load.
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
        console.error("Failed to load deals:", error);
        setLoadError(error.message);
        setLoading(false);
        return;
      }
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
          loaded = false;
          buffer.length = 0;
          void load();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLoadError((prev) => prev ?? "Live updates disconnected — this board may be stale.");
        }
      });

    void load();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

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
      setDeals(previous);
    }
  }, []);

  const selectDeal = useCallback((id: string | null) => setSelectedDealId(id), []);

  const visibleDeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deals.filter((d) => {
      if (channelFilter !== "all" && d.source_channel !== channelFilter) return false;
      if (q) {
        const hay = `${d.brand_name} ${d.contact_name ?? ""} ${d.summary ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deals, channelFilter, query]);

  const selectedDeal = useMemo(
    () => (selectedDealId ? deals.find((d) => d.id === selectedDealId) ?? null : null),
    [deals, selectedDealId],
  );

  const value: DealsContextValue = {
    deals,
    visibleDeals,
    loading,
    loadError,
    retry,
    moveDeal,
    selectedDealId,
    selectDeal,
    selectedDeal,
    channelFilter,
    setChannelFilter,
    query,
    setQuery,
  };

  return <DealsContext.Provider value={value}>{children}</DealsContext.Provider>;
}
