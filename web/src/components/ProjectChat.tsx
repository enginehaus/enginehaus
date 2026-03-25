/**
 * Project Chat Component
 *
 * Natural language interface for querying project state.
 * Type questions like "what should I work on?" or "show me blocked tasks".
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ChatResponse } from '../api/client';
import './ProjectChat.css';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ProjectChatProps {
  className?: string;
}

export function ProjectChat({ className = '' }: ProjectChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      type: 'assistant',
      content: 'Ask me about your project. Try "what should I work on?" or "show blocked tasks".',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const chatMutation = useMutation({
    mutationFn: (message: string) => api.wheelhaus.chat(message),
    onSuccess: (response: ChatResponse) => {
      setMessages(prev => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          type: 'assistant',
          content: response.message,
          timestamp: new Date(response.timestamp),
        },
      ]);
    },
    onError: (error: Error) => {
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          type: 'assistant',
          content: `Error: ${error.message}. Please try again.`,
          timestamp: new Date(),
        },
      ]);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || chatMutation.isPending) return;

    // Add user message
    setMessages(prev => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        type: 'user',
        content: trimmedInput,
        timestamp: new Date(),
      },
    ]);

    // Clear input and send
    setInput('');
    chatMutation.mutate(trimmedInput);
  };

  const handleQuickAction = (query: string) => {
    setInput(query);
    inputRef.current?.focus();
  };

  return (
    <div className={`project-chat ${className}`}>
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message ${msg.type}`}>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}
        {chatMutation.isPending && (
          <div className="chat-message assistant">
            <div className="message-content typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-quick-actions">
        <button onClick={() => handleQuickAction('what should I work on?')}>
          Next task
        </button>
        <button onClick={() => handleQuickAction('show blocked tasks')}>
          Blocked
        </button>
        <button onClick={() => handleQuickAction('project status')}>
          Status
        </button>
        <button onClick={() => handleQuickAction('recent decisions')}>
          Decisions
        </button>
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about tasks, sessions, decisions..."
          disabled={chatMutation.isPending}
        />
        <button type="submit" disabled={!input.trim() || chatMutation.isPending}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
