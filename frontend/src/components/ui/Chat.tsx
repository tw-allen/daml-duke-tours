import { useState, useEffect, useRef } from "react";
import { build } from "vite";
import { Volume2, VolumeX } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "https://daml-duke-tours-fibm.onrender.com";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Props = {
  buildingSlug: string | null;
};

export default function Chat({ buildingSlug }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const blurbRef = useRef<string | null>(null);

  useEffect(() => {
    const blurb = localStorage.getItem("pending_blurb");
    if (blurb) {
      blurbRef.current = blurb;
      setMessages([{ role: "assistant", content: blurb }]);
      localStorage.removeItem("pending_blurb");
    }

    const handleStorage = () => {
      const blurb = localStorage.getItem("pending_blurb");
      if (blurb) {
        blurbRef.current = blurb;
        setMessages([{ role: "assistant", content: blurb }]);
        localStorage.removeItem("pending_blurb");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const speakText = (text: string) => {
    if (!ttsEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    // For now, require a building selection since /chat endpoint isn't deployed yet
    if (!buildingSlug) {
      setError("Please select a building first to chat. Generic chat coming soon!");
      return;
    }

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const endpoint = "/chat-about-building";
      const body = {
        building_id: buildingSlug,
        message: userMessage.content,
        history: messages,
        current_blurb: blurbRef.current,
      };

      const url = `${API_BASE}${endpoint}`;
      console.log("Fetching:", url, "Body:", body);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      console.log("Response status:", res.status);

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorData = await res.json();
          errorMsg = errorData.detail || errorMsg;
        } catch (e) {
          const text = await res.text();
          errorMsg = text || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      console.log("Chat response:", data);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      // Speak the response if TTS is enabled
      speakText(data.reply);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to get response";
      console.error("Chat error details:", err);
      console.error("API_BASE:", API_BASE);
      setError(errorMsg);
      setMessages((prev) => prev.slice(0, -1)); // Remove user message on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-secondary/50 rounded-xl p-4 flex flex-col max-h-96">
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Chat</h3>
        <button
          onClick={() => setTtsEnabled(!ttsEnabled)}
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
      <div className="flex-1 min-h-0 overflow-y-auto mb-2 space-y-2">
        {error && (
          <div className="text-sm p-2 rounded bg-red-100 text-red-700">
            Error: {error}
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm p-2 rounded ${
              msg.role === "user"
                ? "bg-blue-500 text-white self-end"
                : "bg-gray-200 text-black self-start"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {loading && <div className="text-sm text-gray-400">Typing...</div>}
        <div ref={bottomRef} />
      </div>

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