'use client';
import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const firstName = process.env.NEXT_PUBLIC_FIRST_NAME;
  const lastName = process.env.NEXT_PUBLIC_LAST_NAME;

  const displayFirstName = firstName || 'the candidate';
  const displayLastName = lastName || '';

  const [messages, setMessages] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: `👋 Hi! Ask me anything about ${displayFirstName}'s experience, skills, or projects.` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        let errorMessage = 'Sorry, something went wrong.';

        if (response.status === 429) {
          errorMessage = 'Rate limited. Please wait a moment and try again.';
        } else if (response.status === 500 || response.status === 503) {
          errorMessage = 'Server error. Please try again later.';
        } else if (response.status === 400) {
          errorMessage = 'Invalid request. Please try again.';
        } else if (response.status >= 500) {
          errorMessage = 'Server error. Please try again later.';
        }

        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      let messageAdded = false;

      if (!reader) {
        throw new Error('Response body is not readable');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              assistantMessage += data.content || '';

              // Add the assistant message on first content chunk
              if (!messageAdded) {
                setMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
                messageAdded = true;
              } else {
                // Update existing message
                setMessages(prev => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: assistantMessage
                  };
                  return newMessages;
                });
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      let userFriendlyMessage = 'Sorry, something went wrong. Please try again.';

      if (error instanceof TypeError) {
        // Network error or fetch-related error
        userFriendlyMessage = 'Network error. Please check your connection and try again.';
      } else if (error instanceof Error) {
        userFriendlyMessage = error.message;
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: userFriendlyMessage
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 shadow-lg">
        <h1 className="text-2xl font-bold">{firstName} {lastName} - Resume Bot</h1>
        <p className="text-blue-100 text-sm">Ask me anything about my experience, skills, and projects</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[70%] rounded-lg p-4 ${msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-800 shadow-md border border-gray-200'
                }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-lg p-4 shadow-md border border-gray-200">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce animate-delay-100"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce animate-delay-200"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-white p-4 shadow-lg">
        <div className="max-w-4xl mx-auto flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask about experience, skills, projects..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
