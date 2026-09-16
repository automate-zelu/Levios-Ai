import { useEffect, useRef, useState } from "react";
import { getToken, sdrApi } from "../../api.js";
import "./test-call-studio.css";

function downsample(float32, fromRate, toRate) {
  if (fromRate === toRate) return float32;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = float32[Math.floor(i * ratio)];
  return out;
}

function floatTo16Base64(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function wsUrl(path, token) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}?token=${encodeURIComponent(token || "")}`;
}

function fmtClock(total) {
  const n = Math.max(0, Number(total) || 0);
  const mm = String(Math.floor(n / 60)).padStart(2, "0");
  const ss = String(n % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function speakBrowser(text) {
  const spoken = (text || "").trim();
  if (!spoken || typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(spoken);
  u.rate = 1.02;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

export default function TestCallStudio({ open, form, allowPaid = false, onClose }) {
  const [phase, setPhase] = useState("permissions");
  const [status, setStatus] = useState("idle");
  const [lines, setLines] = useState([]);
  const [partial, setPartial] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState(null);
  const [billedSeconds, setBilledSeconds] = useState(0);
  const [credits, setCredits] = useState(null);
  const [latency, setLatency] = useState(null);
  const [arming, setArming] = useState(false);
  const wsRef = useRef(null);
  const micStopRef = useRef(null);
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const queueRef = useRef([]);
  const playingRef = useRef(false);
  const bottomRef = useRef(null);
  const startedAt = useRef(0);
  const budgetRef = useRef(0);
  const periodLeftRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setPhase("permissions");
      setStatus("idle");
      setLines([]);
      setError("");
      setBanner("");
      return undefined;
    }
    setPhase("permissions");
    setStatus("idle");
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "live" || status === "ended") return undefined;
    const t = setInterval(() => {
      if (!startedAt.current) return;
      const local = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsed((prev) => Math.max(prev, local));
      if (budgetRef.current) {
        setRemaining((prev) => {
          const next = Math.max(0, budgetRef.current - local);
          return prev == null ? next : Math.min(prev, next);
        });
      }
    }, 250);
    return () => clearInterval(t);
  }, [open, phase, status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, partial]);

  const drainAudio = async () => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    playingRef.current = true;
    const finish = () => {
      playingRef.current = false;
      drainAudio();
    };
    try {
      if (next.data) {
        const bin = Uint8Array.from(atob(next.data), (c) => c.charCodeAt(0));
        const ctx = audioCtxRef.current;
        if (ctx) {
          const copy = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
          const decoded = await ctx.decodeAudioData(copy);
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          src.onended = finish;
          src.start();
          return;
        }
        const blob = new Blob([bin], { type: next.mime || "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        if (audioRef.current) audioRef.current.pause();
        const audio = new Audio(url);
        audio.volume = 1;
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          finish();
        };
        await audio.play();
        return;
      }
      speakBrowser(next.text);
      setTimeout(finish, Math.min(12000, 400 + (next.text || "").length * 55));
    } catch {
      speakBrowser(next.text);
      setTimeout(finish, 800);
    }
  };

  const enqueueVoice = (payload) => {
    queueRef.current.push(payload);
    drainAudio();
  };

  const stopMedia = () => {
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    micStopRef.current?.();
    micStopRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    queueRef.current = [];
    playingRef.current = false;
  };

  const requestHangup = () => {
    try {
      wsRef.current?.send(JSON.stringify({ type: "end" }));
    } catch {
      /* ignore */
    }
    micStopRef.current?.();
    micStopRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setStatus("ended");
  };

  const attachMic = async (stream) => {
    const ctx = audioCtxRef.current || new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    proc.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== 1) return;
      const input = e.inputBuffer.getChannelData(0);
      const resampled = downsample(input, ctx.sampleRate, 16000);
      const data = floatTo16Base64(resampled);
      wsRef.current.send(JSON.stringify({ type: "pcm", data }));
    };
    src.connect(proc);
    proc.connect(silent);
    silent.connect(ctx.destination);
    micStopRef.current = () => {
      proc.disconnect();
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    };
  };

  const unlockSpeaker = async () => {
    const ctx = audioCtxRef.current || new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.00008;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  };

  const startLive = async (withMic) => {
    setArming(true);
    setError("");
    try {
      await unlockSpeaker();
      let stream = null;
      if (withMic) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      }
      setPhase("live");
      setStatus("connecting");
      startedAt.current = Date.now();
      const started = await sdrApi.startTestCall({
        systemPrompt: form.systemPrompt,
        assistantName: form.assistantName,
        assistantVoiceId: form.assistantVoiceId,
        allowPaid: !!allowPaid,
      });
      if (started.credits) {
        setCredits(started.credits);
        periodLeftRef.current = started.credits.testRemainingSeconds ?? started.credits.testRemaining;
      }
      budgetRef.current = started.budgetSeconds || 0;
      setRemaining(started.budgetSeconds ?? null);
      const ws = new WebSocket(wsUrl(started.path, getToken()));
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "status") setStatus(msg.status);
        if (msg.type === "line") {
          setLines(msg.lines || []);
          setPartial("");
        }
        if (msg.type === "partial") setPartial(msg.text || "");
        if (msg.type === "error" || msg.type === "stt_error") {
          setError(msg.message || "Call issue");
        }
        if (msg.type === "tts_error") {
          setError(msg.message || "Voice playback issue");
          enqueueVoice({ text: msg.speak || "" });
        }
        if (msg.type === "audio") {
          enqueueVoice({ data: msg.data, mime: msg.mime, text: msg.text });
        }
        if (msg.type === "credits") setCredits(msg.credits);
        if (msg.type === "latency") setLatency(msg);
        if (msg.type === "clock") {
          setElapsed(msg.elapsedSeconds ?? 0);
          setRemaining(msg.remainingSeconds ?? 0);
          setBilledSeconds(msg.billedSeconds ?? Math.round((msg.billedMinutes || 0) * 60));
        }
        if (msg.type === "minutes_exhausted") {
          setBanner(msg.message || "Minutes ran out. This rehearsal ended.");
          setStatus("ended");
          micStopRef.current?.();
          micStopRef.current = null;
        }
        if (msg.type === "ended") {
          setLines(msg.lines || []);
          if (msg.credits) setCredits(msg.credits);
          if (msg.message) setBanner(msg.message);
          setStatus("ended");
          stopMedia();
        }
      };
      ws.onerror = () => setError("Could not reach the rehearsal stream");
      ws.onopen = async () => {
        ws.send(JSON.stringify({ type: "start" }));
        if (stream) {
          try {
            await attachMic(stream);
          } catch {
            setError("Microphone connected, but audio capture failed — type below.");
          }
        }
      };
    } catch (err) {
      setError(err.message || "Could not start test call");
      if (err.name === "NotAllowedError" || /permission|denied/i.test(err.message || "")) {
        setError("Microphone permission is required to start a spoken test. Allow it, or continue with typing only.");
        setPhase("permissions");
        setStatus("idle");
      } else {
        setStatus("ended");
        setPhase("live");
      }
    } finally {
      setArming(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    return () => {
      try {
        wsRef.current?.send(JSON.stringify({ type: "end" }));
      } catch {
        /* ignore */
      }
      stopMedia();
      try {
        audioCtxRef.current?.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const name = form.assistantName || "Agent";
  const live = phase === "live" && status !== "ended" && status !== "idle";
  const low = remaining != null && remaining <= 15 && live;
  const periodLeft =
    credits && !credits.usingPaid
      ? Math.max(0, (periodLeftRef.current ?? credits.testRemainingSeconds ?? 0) - billedSeconds)
      : null;

  const sendText = (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || status === "ended" || !wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setDraft("");
  };

  return (
    <aside className="test-call" data-status={status} data-phase={phase} role="complementary" aria-label="Live test call">
      <header className="test-call-head">
        <div>
          <div className="test-call-kicker">Rehearsal · no phone</div>
          <h2>{name}</h2>
        </div>
        {phase === "live" && (
          <div className="test-call-meter" data-status={status} data-low={low ? "true" : "false"}>
            <span className="test-call-dot" />
            <span>{status}</span>
            <time dateTime={`PT${elapsed}S`}>{fmtClock(elapsed)}</time>
          </div>
        )}
      </header>

      {phase === "permissions" ? (
        <div className="test-call-gate">
          <p>
            This rehearsal uses the same ElevenLabs voice as live outbound calls. The browser will ask for your microphone, and we unlock the speaker so you can hear the agent.
          </p>
          <p>The call does not start — and time is not billed — until you allow access.</p>
          {error && <div className="test-call-error">{error}</div>}
          <button
            type="button"
            className="test-call-end"
            disabled={arming}
            onClick={() => startLive(true)}
          >
            {arming ? "Asking for access…" : "Allow mic & speaker, then start"}
          </button>
          <button
            type="button"
            className="test-call-end is-close"
            disabled={arming}
            onClick={() => startLive(false)}
          >
            Type only (no microphone)
          </button>
          <button type="button" className="sdr-agent-btn sdr-agent-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="test-call-budget" aria-live="polite">
            <div>
              <span>Billed</span>
              <strong>{fmtClock(billedSeconds)}</strong>
            </div>
            <div data-low={low ? "true" : "false"}>
              <span>Left in this call</span>
              <strong>{remaining == null ? "—" : fmtClock(remaining)}</strong>
            </div>
          </div>

          <p className="test-call-hint">
            Speak or type. You should hear the live-call voice. Time is billed by the second after you allow access.
          </p>

          {error && <div className="test-call-error">{error}</div>}
          {banner && <div className="test-call-banner">{banner}</div>}
          {credits?.usingPaid && status !== "ended" && (
            <div className="test-call-error">
              Drawing from paid calling minutes (
              {credits.paidRemainingSeconds != null
                ? fmtClock(credits.paidRemainingSeconds)
                : credits.paidRemaining}{" "}
              left this period).
            </div>
          )}
          {credits && !credits.usingPaid && (
            <p className="test-call-hint">
              Free test time this period: {fmtClock(periodLeft ?? credits.testRemainingSeconds)} /{" "}
              {fmtClock(credits.testLimitSeconds ?? credits.testLimit)}
            </p>
          )}
          {latency && (
            <p className="test-call-hint">
              Last turn {latency.totalMs}ms · STT {latency.sttMs} · LLM {latency.llmMs} · TTS {latency.ttsMs}
            </p>
          )}

          <div className="test-call-scroll">
            {lines.map((line) => (
              <div key={line.id} className={`test-call-line is-${line.speaker}`}>
                <span>{line.speaker === "you" ? "You" : name}</span>
                <p>{line.text}</p>
              </div>
            ))}
            {partial ? (
              <div className="test-call-line is-you is-partial">
                <span>You</span>
                <p>{partial}</p>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {status !== "ended" && (
            <form className="test-call-compose" onSubmit={sendText}>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a reply…"
                aria-label="Send a spoken turn as text"
              />
              <button type="submit">Send</button>
            </form>
          )}

          <div className="test-call-bar">
            {status === "ended" ? (
              <button type="button" className="test-call-end is-close" onClick={onClose}>
                Close
              </button>
            ) : (
              <button type="button" className="test-call-end" onClick={requestHangup}>
                End call
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
