import { useState, useEffect, useRef } from "react";
import { Volume2, VolumeX } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "https://daml-duke-tours-fibm.onrender.com";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Props = {
  buildingSlug: string | null;
};

// Strip bullet markers and collapse into plain text for TTS.
// This keeps TTS word indices in sync with what FormattedMessage displays.
function cleanForSpeech(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+/, ""))
    .filter((line) => line.trim())
    .join(" ");
}

// Render assistant text with bullet formatting + optional per-word TTS highlighting.
function FormattedMessage({ text, activeWordIdx = -1 }: { text: string; activeWordIdx?: number }) {
  const lines = text.split("\n");
  let globalIdx = 0;

  return (
    <>
      {lines.map((line, li) => {
        const bulletMatch = line.match(/^\s*-\s+(.*)/);
        const content = bulletMatch ? bulletMatch[1] : line;
        if (!content.trim()) return null;

        const words = content.trim().split(/\s+/);
        const wordSpans = words.map((word, wi) => {
          const idx = globalIdx++;
          const active = activeWordIdx >= 0 && idx === activeWordIdx;
          return (
            <span
              key={wi}
              style={{
                marginRight: "0.28em",
                color: active ? "#2563eb" : "inherit",
                fontWeight: active ? 600 : undefined,
                transition: "color 0.1s",
              }}
            >
              {word}
            </span>
          );
        });

        if (bulletMatch) {
          return (
            <div key={li} style={{ display: "flex", gap: "0.5em", marginTop: "0.3em" }}>
              <span style={{ color: "#2563eb", fontWeight: 700, flexShrink: 0 }}>•</span>
              <span>{wordSpans}</span>
            </div>
          );
        }
        return (
          <p key={li} style={{ marginTop: li === 0 ? 0 : "0.4em" }}>{wordSpans}</p>
        );
      })}
    </>
  );
}

export default function Chat({ buildingSlug }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep ttsEnabled in both state (for rendering) and a ref (so speakText
  // always reads the live value instead of a stale closure copy).
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const ttsEnabledRef = useRef(false);
  const setTts = (val: boolean) => {
    ttsEnabledRef.current = val;
    setTtsEnabled(val);
  };

  const [speakingContent, setSpeakingContent] = useState<string | null>(null);
  const [wordIdx, setWordIdx] = useState(-1);

  // Track which utterance is "live" so cancelled/ended old utterances
  // can't clobber state that belongs to a newer utterance.
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const isPausedRef = useRef(false);
  const blurbRef = useRef<string | null>(null);

  // ── LocalStorage blurb watcher ──────────────────────────────────────────────
  useEffect(() => {
    const load = () => {
      const blurb = localStorage.getItem("pending_blurb");
      if (blurb) {
        blurbRef.current = blurb;
        setMessages([{ role: "assistant", content: blurb }]);
        localStorage.removeItem("pending_blurb");
      }
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── TTS ─────────────────────────────────────────────────────────────────────
  const speakText = (text: string) => {
    if (!("speechSynthesis" in window)) return;

    // Skip if audio is fully off and nothing is paused.
    // But if something is paused, a new message overrides it.
    if (!ttsEnabledRef.current && !isPausedRef.current) return;

    // Stamp what the "current" utterance will be.  Any stale onend/onerror
    // callbacks that fire after cancel() will see they're no longer active
    // and won't touch our state.
    const stamp = {};
    activeUtterance.current = stamp as any;

    window.speechSynthesis.cancel();   // stops any playing/paused speech
    isPausedRef.current = false;

    // If audio was off because of a pause, restore it
    if (!ttsEnabledRef.current) setTts(true);

    setSpeakingContent(text);
    setWordIdx(-1);

    // Use cleaned text for TTS so word indices match FormattedMessage's word count
    const speechText = cleanForSpeech(text);
    let count = 0;
    const utterance = new SpeechSynthesisUtterance(speechText);
    // Use the stamp so callbacks can detect staleness
    (utterance as any).__stamp = stamp;
    activeUtterance.current = utterance;

    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onboundary = (e) => {
      if (activeUtterance.current !== utterance) return;  // stale
      if (e.name === "word") {
        setWordIdx(count);
        count++;
      }
    };
    utterance.onend = () => {
      if (activeUtterance.current !== utterance) return;  // stale — ignore
      isPausedRef.current = false;
      activeUtterance.current = null;
      setSpeakingContent(null);
      setWordIdx(-1);
    };
    utterance.onerror = () => {
      if (activeUtterance.current !== utterance) return;  // stale — ignore
      isPausedRef.current = false;
      activeUtterance.current = null;
      setSpeakingContent(null);
      setWordIdx(-1);
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("TTS error:", err);
      activeUtterance.current = null;
      setSpeakingContent(null);
    }
  };

  const handleToggleTts = () => {
    const next = !ttsEnabledRef.current;
    setTts(next);

    if (!next && speakingContent !== null) {
      // Turning off while speaking → pause in place
      window.speechSynthesis.pause();
      isPausedRef.current = true;
    } else if (next && isPausedRef.current) {
      // Turning back on while paused → resume
      window.speechSynthesis.resume();
      isPausedRef.current = false;
    }
  };

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      let endpoint: string;
      let body: any;

      if (buildingSlug) {
        endpoint = "/chat-about-building";
        body = {
          building_id: buildingSlug,
          message: userMessage.content,
          history: messages,
          current_blurb: blurbRef.current,
        };
      } else {
        endpoint = "/chat";
        body = {
          message: userMessage.content,
          history: messages,
        };
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorData = await res.json();
          errorMsg = errorData.detail || errorMsg;
        } catch {
          const text = await res.text();
          errorMsg = text || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      const replyText = data.reply || "Sorry, I couldn't generate a response.";
      setMessages((prev) => [...prev, { role: "assistant", content: replyText }]);
      speakText(replyText);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to get response";
      console.error("Chat error:", err);
      setError(errorMsg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="w-full bg-secondary/50 rounded-xl p-4 flex flex-col max-h-96">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Chat</h3>
        <button
          onClick={handleToggleTts}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
            ttsEnabled
              ? "bg-blue-600 text-white shadow-md"
              : "bg-gray-200 text-gray-600 hover:bg-gray-300"
          }`}
          title={ttsEnabled ? "Text-to-speech enabled" : "Text-to-speech disabled"}
        >
          {ttsEnabled ? (
            <>
              <Volume2 className="w-4 h-4" />
              <span className="text-xs font-medium">Audio on</span>
            </>
          ) : (
            <>
              <VolumeX className="w-4 h-4" />
              <span className="text-xs font-medium">Audio off</span>
            </>
          )}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto mb-2 space-y-2">
        {error && (
          <div className="text-sm p-2 rounded bg-red-100 text-red-700">
            Error: {error}
          </div>
        )}
        {messages.map((msg, i) => {
          const isSpeaking = msg.role === "assistant" && msg.content === speakingContent;
          return (
            <div
              key={i}
              className={`text-sm p-2 rounded ${
                msg.role === "user"
                  ? "bg-blue-500 text-white self-end"
                  : "bg-gray-200 text-black self-start"
              }`}
            >
              <FormattedMessage
                text={msg.content}
                activeWordIdx={isSpeaking ? wordIdx : -1}
              />
            </div>
          );
        })}
        {loading && <div className="text-sm text-gray-400">Typing...</div>}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-2 py-1 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          onClick={sendMessage}
          className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
        >
          Send
        </button>
      </div>
    </div>
  );
}