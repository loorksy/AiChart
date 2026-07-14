import { requireEvidence } from "./evidence";
import type {
  EvidenceReferences,
  TradingDnaConclusion,
  TradingDnaReport,
  TradingDnaSnapshot,
  TradingPersonaVersion,
} from "./types";

const MAX_REPORT_CONCLUSIONS = 100;

function conclusions(snapshot: TradingDnaSnapshot, type: TradingDnaConclusion["type"]): TradingDnaConclusion[] {
  return snapshot.conclusions.filter((item) => item.type === type).slice(0, MAX_REPORT_CONCLUSIONS);
}

export function buildTradingDnaReport(
  snapshot: TradingDnaSnapshot,
  persona: TradingPersonaVersion,
): TradingDnaReport {
  if (snapshot.userId !== persona.userId || snapshot.snapshotId !== persona.snapshotId) {
    throw new Error("Trading DNA report tenant or snapshot mismatch");
  }
  for (const conclusion of snapshot.conclusions) requireEvidence(conclusion.evidence, conclusion.id);
  if (persona.persona !== "unclassified") requireEvidence(persona.evidence, "Trading persona report");
  return {
    schemaVersion: "aichart-trading-dna-report-v1",
    generatedAt: Date.now(),
    snapshot,
    persona,
    strengths: conclusions(snapshot, "strength"),
    weaknesses: conclusions(snapshot, "weakness"),
    patterns: conclusions(snapshot, "pattern"),
    riskProfile: conclusions(snapshot, "risk_profile"),
    strategyProfile: conclusions(snapshot, "strategy_profile"),
    confidenceProfile: conclusions(snapshot, "confidence_profile"),
    improvementSuggestions: conclusions(snapshot, "improvement"),
  };
}

export function renderTradingDnaJson(report: TradingDnaReport): string {
  return JSON.stringify(report, null, 2);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function evidenceText(evidence: EvidenceReferences): string {
  const parts = [
    evidence.recommendationIds.length ? `recommendations: ${evidence.recommendationIds.join(", ")}` : "",
    evidence.tradeIds.length ? `trades: ${evidence.tradeIds.join(", ")}` : "",
    evidence.learningEventIds.length ? `learning events: ${evidence.learningEventIds.join(", ")}` : "",
    evidence.backtestIds.length ? `backtests: ${evidence.backtestIds.join(", ")}` : "",
    evidence.artifactIds.length ? `artifacts: ${evidence.artifactIds.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

function section(title: string, items: TradingDnaConclusion[]): string {
  const content = items.length
    ? items
        .map(
          (item) =>
            `<li><p>${escapeHtml(item.text)}</p><small>Confidence ${(item.confidence * 100).toFixed(1)}% — ${escapeHtml(evidenceText(item.evidence))}</small></li>`,
        )
        .join("")
    : "<li>No evidence-supported conclusion.</li>";
  return `<section><h2>${escapeHtml(title)}</h2><ul>${content}</ul></section>`;
}

export function renderTradingDnaHtml(report: TradingDnaReport): string {
  const generated = new Date(report.generatedAt).toISOString();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AiChart Trading DNA Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#17202a}header{border-bottom:2px solid #1f6feb;margin-bottom:24px}section{break-inside:avoid;margin:24px 0}li{margin:12px 0}small{color:#52606d;overflow-wrap:anywhere}.badge{display:inline-block;padding:4px 8px;border-radius:8px;background:#e8f1ff}</style>
</head><body><header><h1>AiChart Trading DNA</h1><p>Generated ${escapeHtml(generated)}</p><p class="badge">Persona: ${escapeHtml(report.persona.persona)} (${(report.persona.confidence * 100).toFixed(1)}%)</p><p>${escapeHtml(report.persona.rationale)}</p></header>
${section("Strengths", report.strengths)}
${section("Weaknesses", report.weaknesses)}
${section("Patterns", report.patterns)}
${section("Risk profile", report.riskProfile)}
${section("Strategy profile", report.strategyProfile)}
${section("Confidence profile", report.confidenceProfile)}
${section("Improvement suggestions", report.improvementSuggestions)}
</body></html>`;
}

function ascii(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?");
}

function pdfEscape(value: string): string {
  return ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrap(value: string, width = 88): string[] {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function reportLines(report: TradingDnaReport): string[] {
  const lines = [
    "AiChart Trading DNA Report",
    `Snapshot: ${report.snapshot.snapshotId} version ${report.snapshot.version}`,
    `Persona: ${report.persona.persona} confidence ${(report.persona.confidence * 100).toFixed(1)}%`,
    report.persona.rationale,
  ];
  const sections: Array<[string, TradingDnaConclusion[]]> = [
    ["Strengths", report.strengths],
    ["Weaknesses", report.weaknesses],
    ["Patterns", report.patterns],
    ["Risk profile", report.riskProfile],
    ["Strategy profile", report.strategyProfile],
    ["Confidence profile", report.confidenceProfile],
    ["Improvement suggestions", report.improvementSuggestions],
  ];
  for (const [title, items] of sections) {
    lines.push(title);
    if (!items.length) lines.push("- No evidence-supported conclusion.");
    for (const item of items.slice(0, 1)) {
      lines.push(...wrap(`- ${item.text}`));
      lines.push(...wrap(`  Evidence: ${evidenceText(item.evidence).slice(0, 180)}`));
    }
  }
  return lines;
}

export function renderTradingDnaPdf(report: TradingDnaReport): Buffer {
  const lines = reportLines(report);
  const commands = ["BT", "/F1 10 Tf", "50 790 Td", "13 TL"];
  for (const [index, line] of lines.entries()) {
    if (index > 0) commands.push("T*");
    commands.push(`(${pdfEscape(line)}) Tj`);
  }
  commands.push("ET");
  const stream = `${commands.join("\n")}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}
