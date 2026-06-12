"use client";

import type { CommitteeResult, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

function voteColor(vote: string): string {
  if (vote === "approve") return "text-green-600";
  if (vote === "reject") return "text-red-500";
  return "text-amber-600";
}

export function CommitteeFeed({
  recommendations,
}: {
  recommendations: Recommendation[];
}) {
  const withCommittee = recommendations.filter((r) => r.committee_json);

  if (!withCommittee.length) {
    return (
      <p className="text-xs text-muted-foreground">لا قرارات لجنة حديثة.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {withCommittee.slice(0, 5).map((rec) => {
        let committee: CommitteeResult | null = null;
        try {
          committee = JSON.parse(rec.committee_json!) as CommitteeResult;
        } catch {
          return null;
        }
        if (!committee) return null;
        return (
          <li
            key={rec.id}
            className="rounded-lg border border-border/50 bg-secondary/30 px-2 py-2 text-xs"
          >
            <p className="font-medium" dir="ltr">
              {rec.symbol} · {rec.action} · {rec.confidence}%
            </p>
            <p className="mt-1 text-muted-foreground">{committee.summary_ar}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {(["aggressive", "riskOfficer", "macro"] as const).map((k) => (
                <span key={k} className={cn("font-medium", voteColor(committee![k].vote))}>
                  {k === "aggressive"
                    ? "عدواني"
                    : k === "riskOfficer"
                      ? "مخاطر"
                      : "ماكرو"}
                  : {committee![k].vote}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
