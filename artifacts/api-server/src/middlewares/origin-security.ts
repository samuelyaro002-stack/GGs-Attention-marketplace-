export function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== value.replace(/\/$/, "")
    ) {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function allowedRequestOrigin(input: {
  origin: string;
  requestHostname: string;
  requestProtocol: string;
  configuredOrigins: ReadonlySet<string>;
  trustedHostnames: ReadonlySet<string>;
}): string | null {
  const normalized = normalizeOrigin(input.origin);
  if (!normalized) return null;
  if (input.configuredOrigins.has(normalized)) return normalized;

  const requestHostname = input.requestHostname.toLowerCase();
  if (!input.trustedHostnames.has(requestHostname)) return null;
  const parsedOrigin = new URL(normalized);
  const requestProtocol = input.requestProtocol.replace(/:$/, "").toLowerCase();
  const defaultPort = parsedOrigin.protocol === "https:" ? "443" : "80";
  return parsedOrigin.hostname.toLowerCase() === requestHostname &&
    parsedOrigin.protocol === `${requestProtocol}:` &&
    (!parsedOrigin.port || parsedOrigin.port === defaultPort)
    ? normalized
    : null;
}

export function originHost(value: string): string | null {
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    const parsed = new URL(candidate);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}