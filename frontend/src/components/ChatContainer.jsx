import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import { useEffect, useRef, useState } from "react";
import axios from "axios";

import ChatHeader from "./ChatHeader";
import MessageInput from "./MessageInput";
import MessageSkeleton from "./skeletons/MessageSkeleton";
import { formatMessageTime } from "../lib/utils";

const ChatContainer = () => {
  const {
    messages,
    getMessages,
    isMessagesLoading,
    selectedUser,
    subscribeToMessages,
    unsubscribeFromMessages,
    sendMessage,
  } = useChatStore();
  const { authUser } = useAuthStore();

  const [smartReplies, setSmartReplies] = useState([]);
  const messageEndRef = useRef(null);

  // Fetch smart replies
  const fetchSmartReplies = async (message, history) => {
    try {
      const res = await axios.post("http://localhost:5001/api/smart-replies", {
        message,
        history,
      });

      let suggestions = res.data.suggestions;

      // Parse if it's a stringified JSON
      if (typeof suggestions === "string") {
        try {
          suggestions = JSON.parse(suggestions);
        } catch {
          suggestions = [];
        }
      }

      // Ensure it's an array of strings
      if (!Array.isArray(suggestions)) {
        suggestions = [];
      }

      setSmartReplies(suggestions);
    } catch (err) {
      console.error("Error fetching smart replies:", err);
    }
  };

  // Load messages for selected user
  useEffect(() => {
    if (!selectedUser?._id) return;
    getMessages(selectedUser._id);
    subscribeToMessages();
    return () => unsubscribeFromMessages();
  }, [selectedUser?._id, getMessages, subscribeToMessages, unsubscribeFromMessages]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messageEndRef.current && messages) {
      messageEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Trigger smart replies ONLY for the other user's last message in active chat
  useEffect(() => {
    if (!messages.length || !selectedUser?._id) return;

    const lastMessage = messages[messages.length - 1];

    // Only fetch if it's from the selected user (not me)
    if (lastMessage.senderId === selectedUser._id) {
      const history = messages.map((msg) => ({
        role: msg.senderId === authUser._id ? "user" : "assistant",
        content: msg.text || "",
      }));

      fetchSmartReplies(lastMessage.text, history);
    } else {
      // If I sent the message, hide smart replies
      setSmartReplies([]);
    }
  }, [messages, selectedUser?._id, authUser._id]);

  // Handle sending from suggestion
  const handleSuggestionClick = (reply) => {
    sendMessage({ text: reply });
    setSmartReplies([]); // Hide suggestions after sending
  };

  if (isMessagesLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-auto">
        <ChatHeader />
        <MessageSkeleton />
        <MessageInput onMessageSent={fetchSmartReplies} messages={messages} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <ChatHeader />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message._id}
            className={`chat ${message.senderId === authUser._id ? "chat-end" : "chat-start"}`}
            ref={messageEndRef}
          >
            <div className="chat-image avatar">
              <div className="size-10 rounded-full border">
                <img
                  src={
                    message.senderId === authUser._id
                      ? authUser.profilePic || "/avatar.png"
                      : selectedUser.profilePic || "/avatar.png"
                  }
                  alt="profile pic"
                />
              </div>
            </div>
            <div className="chat-header mb-1">
              <time className="text-xs opacity-50 ml-1">
                {formatMessageTime(message.createdAt)}
              </time>
            </div>
            <div className="chat-bubble flex flex-col">
              {message.image && (
                <img
                  src={message.image}
                  alt="Attachment"
                  className="sm:max-w-[200px] rounded-md mb-2"
                />
              )}
              {message.text && <p>{message.text}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Smart replies UI */}
      {smartReplies.length > 0 && (
        <div className="flex gap-2 px-4 pb-2">
          {smartReplies.map((reply, idx) => (
            <button
              key={idx}
              onClick={() => handleSuggestionClick(reply)}
              className="btn btn-xs btn-outline"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      <MessageInput
        onMessageSent={() => setSmartReplies([])} // Hide after sending manually too
        messages={messages}
      />
    </div>
  );
};

export default ChatContainer;
