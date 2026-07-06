(() => {
  const PANEL_CLASS = "aichart-odysseus-panel";

  function normalizeOptions(options = {}) {
    return {
      symbol: String(options.symbol || "EURUSD").toUpperCase().replace(/[^A-Z0-9._:-]/g, "") || "EURUSD",
      interval: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"].includes(options.interval)
        ? options.interval
        : "15m",
      source: options.source === "ea" ? "ea" : "oanda",
      sessionId: options.sessionId || options.session || "",
      recommendationId: options.recommendationId || "",
      embedUrl: options.embedUrl || "",
    };
  }

  async function resolveEmbedUrl(options) {
    if (options.embedUrl) return options.embedUrl;
    const params = new URLSearchParams({
      symbol: options.symbol,
      interval: options.interval,
      source: options.source,
    });
    if (options.sessionId) params.set("session_id", options.sessionId);
    if (options.recommendationId) params.set("recommendation_id", options.recommendationId);
    const response = await fetch(`/api/aichart/chart-url?${params}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`AiChart chart-url failed: HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data.embedUrl !== "string") throw new Error("AiChart chart-url returned no embedUrl");
    return data.embedUrl;
  }

  function buildPanel(embedUrl, options) {
    const panel = document.createElement("section");
    panel.className = PANEL_CLASS;
    panel.dir = "rtl";
    panel.innerHTML = `
      <header class="aichart-odysseus-panel__header">
        <strong>AiChart</strong>
        <span>${options.symbol} · ${options.interval} · ${options.source.toUpperCase()}</span>
        <button type="button" data-aichart-close aria-label="Close AiChart">×</button>
      </header>
      <iframe
        title="AiChart Trading Workspace"
        src="${embedUrl.replace(/"/g, "&quot;")}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allow="clipboard-write; fullscreen"
      ></iframe>
    `;
    panel.querySelector("[data-aichart-close]")?.addEventListener("click", () => panel.remove());
    return panel;
  }

  function closeChart(mount = null) {
    const root = mount || document;
    root.querySelectorAll?.(`.${PANEL_CLASS}`).forEach((node) => node.remove());
  }

  async function openChart(rawOptions = {}, mount = null) {
    const options = normalizeOptions(rawOptions);
    const embedUrl = await resolveEmbedUrl(options);
    const panel = buildPanel(embedUrl, options);
    const target = mount || document.querySelector("[data-aichart-chat-mount]") || document.querySelector("#chat-history") || document.querySelector("main") || document.body;
    target.appendChild(panel);
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return panel;
  }

  async function updateChart(rawOptions = {}, mount = null) {
    closeChart(mount);
    return openChart(rawOptions, mount);
  }

  window.OdysseusAiChart = Object.freeze({ openChart, closeChart, updateChart, normalizeOptions });
})();
