"use client";

import { useState } from "react";
import { useDeals } from "@/lib/dealsStore";
import { STAGES, type DealStage } from "@/lib/types";
import DealCard from "./DealCard";

export default function KanbanBoard() {
  const { visibleDeals, loading, loadError, retry, moveDeal, selectedDealId, selectDeal } = useDeals();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => (
          <div key={s.id} className="glass-soft h-72 animate-pulse rounded-3xl" />
        ))}
      </div>
    );
  }

  return (
    <>
      {loadError && (
        <div
          role="alert"
          className="glass mb-4 flex items-center gap-3 rounded-2xl border-rose-500/30 px-4 py-3 text-sm text-rose-200"
        >
          <span>Couldn&apos;t reach your pipeline. {loadError}</span>
          <button
            onClick={retry}
            className="ml-auto rounded-lg border border-rose-400/40 px-2.5 py-1 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-500/15"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((stage) => {
          const stageDeals = visibleDeals.filter((d) => d.stage === stage.id);
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
              className={`glass-soft flex min-h-[18rem] flex-col rounded-3xl p-3 transition-colors ${
                isDropTarget ? "!border-sky-400/50 bg-sky-400/[0.06]" : ""
              }`}
            >
              <header className="mb-3 flex items-center gap-2 px-1.5 pt-1">
                <span className={`h-2 w-2 rounded-full ${stage.accent} shadow-[0_0_10px] shadow-current`} />
                <h2 className="text-sm font-medium text-slate-100">{stage.label}</h2>
                <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-300 ring-1 ring-white/10">
                  {stageDeals.length}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-2.5">
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    isDragging={draggingId === deal.id}
                    isActive={selectedDealId === deal.id}
                    onClick={() => selectDeal(deal.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/deal-id", deal.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(deal.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                  />
                ))}
                {stageDeals.length === 0 && !loadError && (
                  <p className="mt-10 text-center text-xs text-slate-500">Drop a deal here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
