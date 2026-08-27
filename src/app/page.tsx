import KanbanBoard from "@/components/KanbanBoard";
import VoiceBriefing from "@/components/VoiceBriefing";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">CollabOS</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every pitch, DM and email — one pipeline.
          </p>
        </div>
        <VoiceBriefing />
      </header>
      <KanbanBoard />
    </main>
  );
}
