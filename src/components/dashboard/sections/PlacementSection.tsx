"use client";

import type { PlacementData } from "@/lib/studentDetails";

interface PlacementSectionProps {
  studentName: string;
  placementData?: PlacementData | null;
  handleUpdate: () => void;
  updateStatus: "loading" | "success" | "error" | null;
  isCooldownActive: boolean;
  formatTime: string;
}

// TODO: full port pending (next commit) — placeholder keeps the dashboard shell compiling.
export default function PlacementSection(_props: PlacementSectionProps) {
  return <div className="dashboard-section-placeholder">Placements — coming soon</div>;
}
