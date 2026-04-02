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
    console.log("speakText called with:", text?.substring(0, 50), "...");
    console.log("ttsEnabled:", ttsEnabled);
    console.log("speechSynthesis supported:", "speechSynthesis" in window);
    
    if (!ttsEnabled) {
      console.log("TTS disabled by user");
      return;
    }
    
    if (!("speechSynthesis" in window)) {
      console.log("Speech synthesis not supported in this browser");
      return;
    }
    
    try {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;
      
      // Get voices
      let voices = window.speechSynthesis.getVoices();
      console.log("Available voices:", voices.length);
      
      if (voices.length > 0) {
        utterance.voice = voices[0];
        console.log("Using voice:", voices[0].name);
      }
      
      utterance.onstart = () => console.log("TTS: Speech started");
      utterance.onend = () => console.log("TTS: Speech ended");
      utterance.onerror = (event) => console.error("TTS: Speech error:", event.error);
      
      console.log("TTS: About to speak");
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("TTS: Exception:", err);
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
        // Use building-specific chat if a building is selected
        endpoint = "/chat-about-building";
        body = {
          building_id: buildingSlug,
          message: userMessage.content,
          history: messages,
          current_blurb: blurbRef.current,
        };
      } else {
        // Use generic chat endpoint
        endpoint = "/chat";
        body = {
          message: userMessage.content,
          history: messages,
        };
      }

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
      console.log("data.reply:", data.reply);
      console.log("typeof data.reply:", typeof data.reply);
      
      const replyText = data.reply || "Sorry, I couldn't generate a response.";
      setMessages((prev) => [...prev, { role: "assistant", content: replyText }]);
      // Speak the response if TTS is enabled
      speakText(replyText);
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