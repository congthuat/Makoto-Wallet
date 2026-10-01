import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Vite plugin that captures browser runtime errors and persists them
 * to .vulcan/errors.json for the agent to read.
 *
 * @param {{ vulcanDir: string }} options
 */
export default function viteErrorReporter({ vulcanDir }) {
  const errorsPath = join(vulcanDir, "errors.json");

  function writeErrors(errors) {
    try {
      mkdirSync(vulcanDir, { recursive: true });
      writeFileSync(errorsPath, JSON.stringify({
        status: errors.length ? "error" : "ok",
        errors,
        updated_at: Math.floor(Date.now() / 1000),
      }) + "\n");
    } catch {
      // Error reporting must not interrupt the app when its output path is unavailable.
    }
  }

  // Clear errors on plugin init (dev server start/restart)
  writeErrors([]);

  return {
    name: "vulcan-error-reporter",

    configureServer(server) {
      // Middleware: receive error reports from browser
      server.middlewares.use("/_vulcan/errors", (req, res) => {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const { errors: incoming } = JSON.parse(body);
              if (!Array.isArray(incoming)) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "errors must be array" }));
                return;
              }

              // Read existing errors
              let existing = [];
              try {
                existing = JSON.parse(readFileSync(errorsPath, "utf8")).errors || [];
              } catch {
                // No prior report exists yet; start with the current batch.
              }

              // Deduplicate by message+file+line, keep newest first, cap at 50
              const seen = new Set();
              const merged = [...incoming, ...existing].filter((e) => {
                const key = `${e.message}:${e.file || ""}:${e.line || ""}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              }).slice(0, 50);

              writeErrors(merged);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, count: merged.length }));
            } catch (err) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        } else if (req.method === "DELETE") {
          // Allow agent to clear errors
          writeErrors([]);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(405);
          res.end();
        }
      });
    },

    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children: `
(function() {
  const errors = [];
  let timer = null;

  function push(err) {
    errors.push(err);
    if (!timer) {
      timer = setTimeout(flush, 2000);
    }
  }

  function flush() {
    timer = null;
    if (!errors.length) return;
    const batch = errors.splice(0);
    fetch("/_vulcan/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ errors: batch }),
    }).catch(() => {});
  }

  window.addEventListener("error", (ev) => {
    push({
      type: "uncaught_error",
      message: ev.message || String(ev.error),
      file: ev.filename || "",
      line: ev.lineno || 0,
      column: ev.colno || 0,
      stack: ev.error?.stack || "",
      timestamp: Math.floor(Date.now() / 1000),
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    push({
      type: "unhandled_rejection",
      message: reason?.message || String(reason),
      file: "",
      line: 0,
      column: 0,
      stack: reason?.stack || "",
      timestamp: Math.floor(Date.now() / 1000),
    });
  });
})();
`,
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
