import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
export function voiceService({ nativeRuntime, DIR, env = process.env }) {
  const clean = (v, n = 10000) =>
    String(v ?? "")
      .replace(/\0/g, "")
      .slice(0, n);
  const cloudEnabled = ![false, "false"].includes(env.FABRIC_ALLOW_CLOUD_AI);
  const configuredSTT = env.FABRIC_STT_URL || "";
  let localSTT = false;
  try {
    const url = new URL(configuredSTT);
    localSTT =
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {}
  const STT_URL = cloudEnabled || localSTT ? configuredSTT : "",
    AZURE_SPEECH_KEY = env.AZURE_SPEECH_KEY || "",
    AZURE_SPEECH_REGION = env.AZURE_SPEECH_REGION || "",
    AZURE_SPEECH_READY = !!(
      cloudEnabled &&
      AZURE_SPEECH_KEY &&
      /^[a-z0-9-]+$/i.test(AZURE_SPEECH_REGION)
    );
  function runBinary(bin, args, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const p = spawn(bin, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }),
        out = [],
        err = [];
      let n = 0,
        done = false,
        t = setTimeout(() => {
          p.kill();
          finish(Error(bin + " timed out"));
        }, timeout);
      function finish(e, v) {
        if (done) return;
        done = true;
        clearTimeout(t);
        e ? reject(e) : resolve(v);
      }
      p.stdout.on("data", (c) => {
        if (n < 2e6) {
          out.push(c);
          n += c.length;
        }
      });
      p.stderr.on("data", (c) => err.push(c));
      p.on("error", finish);
      p.on("close", (code) =>
        code === 0
          ? finish(null, Buffer.concat(out).toString("utf8"))
          : finish(
              Error(
                Buffer.concat(err).toString("utf8").slice(0, 300) ||
                  bin + " failed",
              ),
            ),
      );
    });
  }
  async function windowsSpeech(data) {
    const wav = path.join(DIR, "voice-" + crypto.randomUUID() + ".wav"),
      quoted = wav.replace(/'/g, "''"),
      script =
        "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Speech;$r=New-Object System.Speech.Recognition.SpeechRecognitionEngine;$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar));$r.SetInputToWaveFile('" +
        quoted +
        "');$o=$r.Recognize();if($null -ne $o){[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$o.Text}";
    await fs.promises.writeFile(wav, data, { mode: 0o600 });
    try {
      const text = (
        await runBinary(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
          ],
          65000,
        )
      ).trim();
      if (!text)
        throw Error("No speech was detected by Windows Speech Recognition.");
      return clean(text, 30000);
    } catch (e) {
      throw Object.assign(
        Error(
          "Windows Speech Recognition could not transcribe the recording. Enable an installed Windows speech language, confirm the microphone, or use Win+H voice typing. Details: " +
            clean(e.message, 220),
        ),
        { status: 503 },
      );
    } finally {
      await fs.promises.rm(wav, { force: true }).catch(() => {});
    }
  }
  async function transcribeAudio(audio, mime = "audio/wav", language = "en") {
    if (!/^[A-Za-z0-9+/=]+$/.test(audio || ""))
      throw Object.assign(Error("Invalid audio payload"), { status: 400 });
    const data = Buffer.from(audio, "base64");
    if (!data.length || data.length > 18e6)
      throw Object.assign(Error("Audio must be between 1 byte and 18 MB"), {
        status: 413,
      });
    if (!STT_URL && !env.FABRIC_NATIVE_STT_URL) {
      if (process.platform === "win32") return windowsSpeech(data);
      throw Object.assign(
        Error(
          "This operating system has no built-in speech recognizer available to Fabric. Use browser speech recognition or type your message.",
        ),
        { status: 503 },
      );
    }
    let endpoint,
      native = false;
    if (STT_URL) endpoint = new URL(STT_URL);
    else {
      const base = await nativeRuntime.ensureStt();
      endpoint = new URL(base + "/inference");
      native = true;
    }
    const form = new FormData(),
      name = mime.includes("wav")
        ? "voice.wav"
        : mime.includes("ogg")
          ? "voice.ogg"
          : "voice.webm";
    if (endpoint.pathname.includes("/v1/audio/transcriptions")) {
      form.set("file", new Blob([data], { type: mime }), name);
      form.set("model", env.FABRIC_STT_MODEL || "whisper-1");
      if (clean(language, 12) !== "auto")
        form.set("language", clean(language, 12) || "en");
    } else if (native) {
      form.set("file", new Blob([data], { type: mime }), name);
      form.set("response_format", "json");
      if (clean(language, 12) !== "auto")
        form.set("language", clean(language, 12) || "en");
    } else form.set("audio_file", new Blob([data], { type: mime }), name);
    let r;
    try {
      r = await fetch(endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      throw Object.assign(
        Error(
          native
            ? "Configured Fabric Voice endpoint is not reachable."
            : "Configured speech service is not reachable at " +
                endpoint.origin,
        ),
        { status: 503 },
      );
    }
    const text = await r.text();
    if (!r.ok)
      throw Object.assign(
        Error("Voice transcription failed (HTTP " + r.status + ")."),
        { status: 502 },
      );
    let value = text;
    try {
      const j = JSON.parse(text);
      value = j.text || j.transcript || j.result || "";
    } catch {}
    return clean(value, 30000).trim();
  }

  const VOICE_LOCALES = ["en-IN", "hi-IN", "mr-IN"],
    VOICE_AUTO_DETECT = env.FABRIC_VOICE_AUTO_DETECT !== "0",
    VOICE_MAP = {
      "en-IN": "en-IN-NeerjaNeural",
      "hi-IN": "hi-IN-SwaraNeural",
      "mr-IN": "mr-IN-AarohiNeural",
    };
  function voiceLocale(value) {
    const raw = clean(value, 16);
    return (
      VOICE_LOCALES.find((x) => x.toLowerCase() === raw.toLowerCase()) || "auto"
    );
  }
  function xmlEscape(value) {
    return String(value || "").replace(
      /[<>&"']/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
  }
  async function azureRecognize(data, locale) {
    const u = new URL(
      "https://" +
        AZURE_SPEECH_REGION +
        ".stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
    );
    u.searchParams.set("language", locale);
    u.searchParams.set("format", "detailed");
    const r = await fetch(u, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          Accept: "application/json",
        },
        body: data,
        signal: AbortSignal.timeout(45000),
      }),
      raw = await r.text();
    if (!r.ok)
      throw Object.assign(
        Error("Azure Speech recognition failed (HTTP " + r.status + ")."),
        { status: 503 },
      );
    let j;
    try {
      j = JSON.parse(raw);
    } catch {
      throw Object.assign(Error("Azure Speech returned an invalid response."), {
        status: 502,
      });
    }
    const best = j.NBest?.[0],
      text = clean(
        best?.Display || best?.Lexical || j.DisplayText || "",
        30000,
      ).trim(),
      confidence = Number(best?.Confidence) || 0;
    if (!text)
      throw Object.assign(Error("No speech was detected."), { status: 422 });
    return { text, language: locale, confidence };
  }
  async function azureTranscribe(audio, language = "auto") {
    if (!AZURE_SPEECH_READY)
      throw Object.assign(Error("Azure Speech is not configured."), {
        status: 503,
      });
    if (!/^[A-Za-z0-9+/=]+$/.test(audio || ""))
      throw Object.assign(Error("Invalid audio payload"), { status: 400 });
    const data = Buffer.from(audio, "base64");
    if (!data.length || data.length > 18e6)
      throw Object.assign(Error("Audio must be between 1 byte and 18 MB"), {
        status: 413,
      });
    const locale = voiceLocale(language);
    if (locale !== "auto") return azureRecognize(data, locale);
    if (!VOICE_AUTO_DETECT)
      return azureRecognize(
        data,
        voiceLocale(env.FABRIC_VOICE_DEFAULT_LOCALE || "en-IN"),
      );
    const settled = await Promise.allSettled(
        VOICE_LOCALES.map((x) => azureRecognize(data, x)),
      ),
      results = settled
        .filter((x) => x.status === "fulfilled")
        .map((x) => x.value);
    if (!results.length)
      throw (
        settled.find((x) => x.status === "rejected")?.reason ||
        Error("Speech was not recognized.")
      );
    return results.sort(
      (a, b) => b.confidence - a.confidence || b.text.length - a.text.length,
    )[0];
  }
  async function azureSynthesize(text, language = "en-IN") {
    if (!AZURE_SPEECH_READY)
      throw Object.assign(Error("Azure Speech is not configured."), {
        status: 503,
      });
    const value = clean(text, 6000)
      .replace(/```[\s\S]*?```/g, " Code block omitted. ")
      .replace(/[*_#>`\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!value)
      throw Object.assign(Error("Text is required."), { status: 400 });
    let locale = voiceLocale(language);
    if (locale === "auto") locale = "en-IN";
    const ssml =
        '<speak version="1.0" xml:lang="' +
        locale +
        '"><voice name="' +
        VOICE_MAP[locale] +
        '">' +
        xmlEscape(value) +
        "</voice></speak>",
      url =
        "https://" +
        AZURE_SPEECH_REGION +
        ".tts.speech.microsoft.com/cognitiveservices/v1",
      r = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "Fabric-Voice",
        },
        body: ssml,
        signal: AbortSignal.timeout(45000),
      });
    if (!r.ok)
      throw Object.assign(
        Error("Azure Speech synthesis failed (HTTP " + r.status + ")."),
        { status: 503 },
      );
    const audio = Buffer.from(await r.arrayBuffer());
    return {
      audio: audio.toString("base64"),
      mime: "audio/mpeg",
      language: locale,
      voice: VOICE_MAP[locale],
    };
  }

  return {
    azureReady: AZURE_SPEECH_READY,
    cloudEnabled,
    locales: VOICE_LOCALES,
    transcribe: (audio, language = "auto", mime = "audio/wav") =>
      AZURE_SPEECH_READY
        ? azureTranscribe(audio, language)
        : transcribeAudio(audio, mime, language),
    synthesize: azureSynthesize,
  };
}
