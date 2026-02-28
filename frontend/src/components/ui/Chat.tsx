import { useState, useEffect, useRef } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

    const bottomRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);
  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: "user", content: input };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: userMessage.content }),
      });

      const data = await res.json();

      const botMessage: Message = {
        role: "assistant",
        content: data.reply,
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      console.error("Chat error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-secondary/50 rounded-xl p-4 flex flex-col max-h-96">
      <div className="flex-1 min-h-0 overflow-y-auto mb-2 space-y-2">
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
        {loading && <div className="    ext-sm text-gray-400">Typing...</div>}
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