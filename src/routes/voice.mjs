import { json, body } from "../server/http.mjs";

export async function voiceRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p === "/api/voice/config")
    return json(res, 200, {
      azureConfigured: ctx.voice.azureReady,
      cloudSpeechEnabled: ctx.voice.cloudEnabled,
      hybrid: true,
      languages: ctx.voice.locales,
      modes: ["hands-free"],
    });
  if (p === "/api/voice/transcribe" && method === "POST") {
    const input = await body(req);
    const result = await ctx.voice.transcribe(
      input.audio,
      input.language || "auto",
      input.mime || "audio/wav",
    );
    return json(
      res,
      200,
      typeof result === "string" ? { text: result } : result,
    );
  }
  if (p === "/api/voice/synthesize" && method === "POST") {
    const b = await body(req);
    return json(res, 200, await ctx.voice.synthesize(b.text, b.language));
  }
}
