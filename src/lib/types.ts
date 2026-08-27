export type DealStage = "new_pitch" | "negotiating" | "drafting" | "completed";
export type DealPriority = "low" | "medium" | "high";
export type Channel = "gmail" | "instagram" | "whatsapp";
export type MessageDirection = "inbound" | "outbound";

export interface Deal {
  id: string;
  user_id: string;
  brand_name: string;
  contact_name: string | null;
  budget: number | null;
  currency: string | null;
  deliverables: string[];
  deadline: string | null; // ISO date (YYYY-MM-DD)
  priority: DealPriority;
  stage: DealStage;
  summary: string | null;
  source_channel: Channel;
  external_thread_id: string | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  deal_id: string;
  user_id: string;
  channel: Channel;
  direction: MessageDirection;
  sender: string | null;
  raw_text: string;
  external_message_id: string | null;
  external_thread_id: string | null;
  received_at: string;
  created_at: string;
}

export const STAGES: { id: DealStage; label: string; accent: string }[] = [
  { id: "new_pitch", label: "New Pitch", accent: "bg-sky-400" },
  { id: "negotiating", label: "Negotiating", accent: "bg-amber-400" },
  { id: "drafting", label: "Drafting", accent: "bg-violet-400" },
  { id: "completed", label: "Completed", accent: "bg-emerald-400" },
];

export const CHANNEL_LABELS: Record<Channel, string> = {
  gmail: "Gmail",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};
