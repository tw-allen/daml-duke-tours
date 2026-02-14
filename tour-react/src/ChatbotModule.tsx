interface ChatbotProps {
    onSendMessage: (text: string) => void;
}

export function ChatbotModule({ onSendMessage }: ChatbotProps) {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            onSendMessage(e.currentTarget.value);
            e.currentTarget.value = '';
        }
    };

    return (
        <div className = "chat-container">
            <div className = "chat-header">Assistant</div>
            <div className = "chat-messages">
                <p>Click a building to learn more.</p>
            </div>
            <div className="chat-input-area">
                <input
                    className="chat-input"
                    type="text"
                    onKeyDown={handleKeyDown}
                    placeholder="Send a message..."
                />
            </div>
        </div>
    );
}