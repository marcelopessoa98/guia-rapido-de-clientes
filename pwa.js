(() => {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // A aplicação continua funcionando normalmente quando o navegador não aceita PWA.
    });
  });
})();
