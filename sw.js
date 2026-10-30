// Ski Tag Board: zeigt die Erinnerung an, auch wenn die Seite gerade zu ist. Speichert nichts zwischen.
self.addEventListener("push", (ev) => {
  let d = {};
  try { d = ev.data.json(); } catch {}
  ev.waitUntil(self.registration.showNotification(d.title || "Ski Tag Board", {
    body: d.body || "Schau heute noch einmal kurz rein.",
    icon: "icon-192.png",
    tag: "taegliche-erinnerung",
  }));
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (open[0]) { await open[0].focus(); return open[0].navigate ? open[0].navigate("neu.html").catch(() => {}) : null; }
    return self.clients.openWindow("neu.html");
  })());
});
