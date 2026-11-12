import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";
import { AppError } from "../server/errors.mjs";
export function privateAddress(raw) {
  const a = String(raw)
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (a === "::" || a === "::1" || a.startsWith("::ffff:")) return true;
  if (net.isIPv4(a)) {
    const [x, y] = a.split(".").map(Number);
    return (
      x === 0 ||
      x === 10 ||
      x === 127 ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && (y === 168 || y === 0)) ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 198 && (y === 18 || y === 19)) ||
      x >= 224
    );
  }
  return /^(fc|fd|fe[89ab]|ff)/.test(a);
}
export async function networkFetch(
  raw,
  { allowPrivate = false, signal, ...options } = {},
) {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new AppError(
      "UNSAFE_URL",
      "Only credential-free HTTP(S) URLs are allowed.",
      400,
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.lookup(host, { all: true, verbatim: true });
  if (
    !addresses.length ||
    (!allowPrivate && addresses.some((a) => privateAddress(a.address)))
  )
    throw new AppError(
      "UNSAFE_URL",
      "Private network destinations are blocked.",
      403,
    );
  const chosen = addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, opts, cb) =>
        opts.all ? cb(null, [chosen]) : cb(null, chosen.address, chosen.family),
    },
  });
  try {
    const response = await fetch(url, {
      ...options,
      signal,
      redirect: "error",
      dispatcher,
    });
    if (!response.body) {
      await dispatcher.close();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            await dispatcher.close();
          } else controller.enqueue(value);
        } catch (e) {
          controller.error(e);
          await dispatcher.destroy();
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
        await dispatcher.destroy();
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (e) {
    await dispatcher.destroy();
    throw e;
  }
}
export async function boundedText(response, max = 2_000_000) {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new AppError(
      "RESPONSE_TOO_LARGE",
      "Remote response exceeds the size limit.",
      502,
    );
  }
  const reader = response.body.getReader(),
    parts = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max)
        throw new AppError(
          "RESPONSE_TOO_LARGE",
          "Remote response exceeds the size limit.",
          502,
        );
      parts.push(value);
    }
    return Buffer.concat(parts).toString("utf8");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
