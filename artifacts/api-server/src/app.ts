import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  allowedRequestOrigin,
  normalizeOrigin,
  originHost,
} from "./middlewares/origin-security";

const app: Express = express();

const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "1");
if (
  !Number.isInteger(trustedProxyHops) ||
  trustedProxyHops < 0 ||
  trustedProxyHops > 5
) {
  throw new Error("TRUST_PROXY_HOPS must be an integer from 0 through 5");
}
app.set("trust proxy", trustedProxyHops);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(helmet({ contentSecurityPolicy: false }));

const frontendOrigins = [process.env.FRONTEND_ORIGIN, process.env.FRONTEND_ORIGINS]
    .filter(Boolean)
    .flatMap((origins) => origins!.split(","))
    .map((origin) => origin.trim());
const configuredOrigins = new Set(
  frontendOrigins
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => origin !== null),
);
const trustedHostnames = new Set(
  [
    process.env.REPLIT_DOMAINS,
    process.env.REPLIT_DEV_DOMAIN,
    ...frontendOrigins,
  ]
    .filter(Boolean)
    .flatMap((value) => value!.split(","))
    .map((value) => originHost(value.trim()))
    .filter((host): host is string => host !== null),
);

app.use((req, res, next) => {
  const origin = req.get("Origin");
  const allowedOrigin = origin
    ? allowedRequestOrigin({
        origin,
        requestHostname: req.hostname,
        requestProtocol: req.protocol,
        configuredOrigins,
        trustedHostnames,
      })
    : null;
  if (origin && !allowedOrigin) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  if (origin) {
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin!);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (
    req.path.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
  ) {
    if (!origin || req.get("Sec-Fetch-Site") === "cross-site") {
      res.status(403).json({ error: "A same-origin request is required" });
      return;
    }
  }
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  handler: (_req, res) => res.status(429).json({ error: "Too many requests" }),
});
const submissionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: "Too many submissions" }),
});
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: "Too many admin requests" }),
});

app.use("/api", apiLimiter);
app.use(
  "/api/campaigns/:campaignId/submissions",
  submissionLimiter,
);
app.use(
  "/api/campaigns/:campaignId/reward-pool",
  adminLimiter,
);
app.use(
  "/api/campaigns/:campaignId/celo-reward-pool",
  adminLimiter,
);

app.use(express.json({ limit: "64kb", strict: true }));
app.use(express.urlencoded({ extended: true, limit: "16kb", parameterLimit: 100 }));

app.use("/api", router);

// Optional single-service hosting: when the web apps have been built, serve them
// from this server so one container can run the whole product. On Replit the web
// apps are served by the platform instead, and these directories are simply absent.
const webRoot = process.env.WEB_ROOT ?? process.cwd();

function serveSinglePageApp(mount: string, relativeDir: string): void {
  const dir = path.resolve(webRoot, relativeDir);
  const indexFile = path.join(dir, "index.html");
  if (!fs.existsSync(indexFile)) return;

  app.use(
    mount,
    express.static(dir, {
      index: false,
      setHeaders(res, filePath) {
        const hashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader(
          "Cache-Control",
          hashedAsset ? "public, max-age=31536000, immutable" : "public, max-age=300",
        );
      },
    }),
  );

  // Page routes only: paths that end in a file extension (a missing script or
  // image) fall through to the 404 below instead of returning the app shell.
  const noFileExtension = "(?![^?]*\\.[A-Za-z0-9]+$)";
  const pattern =
    mount === "/"
      ? new RegExp(`^\\/(?!api(\\/|$))${noFileExtension}.*`)
      : new RegExp(`^${mount.replace(/\/$/, "")}(\\/${noFileExtension}.*)?$`);
  app.get(pattern, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  });

  logger.info({ mount, dir }, "Serving web app");
}

// The more specific mount must be registered before "/".
serveSinglePageApp("/ggs-brand-site", "artifacts/ggs-brand-site/dist/public");
serveSinglePageApp("/", "artifacts/ggs-marketplace/dist/public");

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;
  if (status === 500) logger.error({ err: error }, "Unhandled API error");
  res.status(status).json({
    error: status === 413 ? "Request body too large" : status === 400 ? "Invalid request" : "Internal server error",
  });
});

export default app;
