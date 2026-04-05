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

function cleanForSpeech(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+/, ""))
    .filter((line) => line.trim())
    .join(" ");
}

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

  const [ttsEnabled, setTtsEnabled] = useState(false);
  const ttsEnabledRef = useRef(false);
  const setTts = (val: boolean) => {
    ttsEnabledRef.current = val;
    setTtsEnabled(val);
  };

  const [speakingContent, setSpeakingContent] = useState<string | null>(null);
  const [wordIdx, setWordIdx] = useState(-1);

  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const isPausedRef = useRef(false);
  const blurbRef = useRef<string | null>(null);

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

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const speakText = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    if (!ttsEnabledRef.current && !isPausedRef.current) return;

    const stamp = {};
    activeUtterance.current = stamp as any;

    window.speechSynthesis.cancel();
    isPausedRef.current = false;

    if (!ttsEnabledRef.current) setTts(true);

    setSpeakingContent(text);
    setWordIdx(-1);

    const speechText = cleanForSpeech(text);
    let count = 0;
    const utterance = new SpeechSynthesisUtterance(speechText);
    (utterance as any).__stamp = stamp;
    activeUtterance.current = utterance;

    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onboundary = (e) => {
      if (activeUtterance.current !== utterance) return;
      if (e.name === "word") {
        setWordIdx(count);
        count++;
      }
    };
    utterance.onend = () => {
      if (activeUtterance.current !== utterance) return;
      isPausedRef.current = false;
      activeUtterance.current = null;
      setSpeakingContent(null);
      setWordIdx(-1);
    };
    utterance.onerror = () => {
      if (activeUtterance.current !== utterance) return;
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
      window.speechSynthesis.pause();
      isPausedRef.current = true;
    } else if (next && isPausedRef.current) {
      window.speechSynthesis.resume();
      isPausedRef.current = false;
    }
  };

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

  return (
    <div className="w-full bg-secondary/50 rounded-xl p-4 flex flex-col max-h-96">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Chat</h3>
        <button
          onClick={handleToggleTts}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
            ttsEnabled
              ? "text-blue-600 border-blue-200 bg-blue-50 dark:text-blue-400 dark:border-blue-800 dark:bg-blue-950"
              : "text-muted-foreground border-border bg-transparent hover:bg-secondary"
          }`}
          title={ttsEnabled ? "Text-to-speech enabled" : "Text-to-speech disabled"}
        >
          {ttsEnabled ? (
            <>
              <Volume2 className="w-3.5 h-3.5" />
              <span>Audio on</span>
            </>
          ) : (
            <>
              <VolumeX className="w-3.5 h-3.5" />
              <span>Audio off</span>
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
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] text-sm px-3 py-2 rounded-2xl leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-secondary text-foreground rounded-bl-sm"
              }`}>
                <FormattedMessage
                  text={msg.content}
                  activeWordIdx={isSpeaking ? wordIdx : -1}
                />
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-2xl rounded-bl-sm px-3 py-2 flex gap-1">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: `${d * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-400 transition-colors"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          onClick={sendMessage}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}