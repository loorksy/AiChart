/**
 * Push service worker.
 *
 * Deliberately minimal: it renders what the server sent and opens the relevant
 * chart on click. It holds no trading logic and makes no decisions — the
 * notification body is composed server-side, where the plan actually lives.
 */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "AiChart", body: event.data.text() };
  }

  const title = payload.title || "AiChart";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/favicon-32x32.png",
    // Collapse by plan so a busy symbol updates one card instead of stacking.
    tag: payload.tag || "aichart",
    renotify: true,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an open tab when there is one; a second window is rarely wanted.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
