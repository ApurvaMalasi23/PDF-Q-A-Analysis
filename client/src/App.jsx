import React, { useState, useRef, useEffect } from "react";
import axios from "axios";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const API_KEY = import.meta.env.VITE_SERVER_API_KEY || "dev_token";

// Generate unique session ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function App(){
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Welcome! Upload a PDF document and start asking questions about its content. I'm here to help you understand and explore your documents."}
  ]);
  const [question, setQuestion] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [sessionId, setSessionId] = useState(() => generateSessionId());
  const [currentDocument, setCurrentDocument] = useState(null);
  const chatRef = useRef();
  const fileInputRef = useRef();

  useEffect(()=> { 
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const appendMessage = (msg) => setMessages(prev => [...prev, msg]);

  const startNewSession = () => {
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    setCurrentDocument(null);
    setFile(null);
    setMessages([
      { role: "assistant", text: "New session started! Upload a PDF document and start asking questions about its content."}
    ]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  async function handleUpload(e){
    e.preventDefault();
    if(!file) return;
    
    const form = new FormData();
    form.append("file", file);
    form.append("sessionId", sessionId);

    try{
      setLoading(true);
      const resp = await axios.post(`${SERVER_URL}/api/upload`, form, {
        headers: { "x-api-key": API_KEY, "Content-Type": "multipart/form-data" }
      });
      
      setCurrentDocument({
        name: file.name,
        uploadedAt: new Date(),
        chunks: resp.data.uploaded_chunks
      });
      
      appendMessage({ 
        role: "assistant", 
        text: `✅ Successfully processed "${file.name}"!\n\nDocument has been analyzed and indexed into ${resp.data.uploaded_chunks} searchable chunks. You can now ask me questions about the content of this specific document.`
      });
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    }catch(err){
      console.error(err);
      appendMessage({ 
        role: "assistant", 
        text: `❌ Upload failed: ${err?.response?.data?.error || "Please check your connection and try again."}`
      });
    }finally{ 
      setLoading(false); 
    }
  }

  async function handleAsk(e){
    e?.preventDefault();
    if(!question.trim()) return;
    
    appendMessage({ role: "user", text: question });
    const currentQuestion = question;
    setQuestion("");
    setLoading(true);
    
    try{
      const resp = await axios.post(`${SERVER_URL}/api/ask`, { 
        question: currentQuestion,
        sessionId: sessionId 
      }, {
        headers: { "x-api-key": API_KEY }
      });
      appendMessage({ role: "assistant", text: resp.data.answer });
      
      if(resp.data.sources && resp.data.sources.length){
        const sourcesText = resp.data.sources
          .map(s => `📄 ${s.source} (section ${s.chunk_index + 1})`)
          .join("\n");
        appendMessage({ 
          role: "system", 
          text: `Sources referenced:\n${sourcesText}`
        });
      }
    }catch(err){
      console.error(err);
      appendMessage({ 
        role: "assistant", 
        text: `I apologize, but I encountered an error: ${err?.response?.data?.error || err.message}. Please try rephrasing your question.`
      });
    }finally{ 
      setLoading(false); 
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const clearChat = () => {
    setMessages([
      { role: "assistant", text: "Chat cleared. Upload a PDF and start asking questions!" }
    ]);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo-section">
            <div className="logo">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
              </svg>
            </div>
            <div className="header-text">
              <h1 className="title">PDF Assistant</h1>
              <p className="subtitle">Intelligent document analysis</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="session-btn" onClick={startNewSession} title="Start new session">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z" />
              </svg>
              <span>New Session</span>
            </button>
            <button className="clear-btn" onClick={clearChat} title="Clear conversation">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="main-content">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="upload-section">
            <h3 className="section-title">Upload Document</h3>
            <form className="upload-form" onSubmit={handleUpload}>
              <div className="file-input-wrapper">
                <input 
                  type="file" 
                  accept="application/pdf" 
                  onChange={e=>setFile(e.target.files[0])}
                  ref={fileInputRef}
                  className="file-input"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="file-label">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                  </svg>
                  {file ? file.name : "Choose PDF file"}
                </label>
              </div>
              <button 
                className={`upload-btn ${uploadSuccess ? 'success' : ''}`}
                type="submit" 
                disabled={loading || !file}
              >
                {loading ? (
                  <>
                    <div className="spinner"></div>
                    Processing...
                  </>
                ) : uploadSuccess ? (
                  <>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z" />
                    </svg>
                    Success!
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z" />
                    </svg>
                    Upload & Analyze
                  </>
                )}
              </button>
            </form>
            
            <div className="help-text">
              <p>Upload PDF documents up to 10MB. Each session focuses on one document at a time for precise answers.</p>
            </div>
          </div>

          {/* Current Document */}
          {currentDocument && (
            <div className="documents-section">
              <h3 className="section-title">Current Document</h3>
              <div className="document-item">
                <div className="document-icon">📄</div>
                <div className="document-info">
                  <div className="document-name">{currentDocument.name}</div>
                  <div className="document-meta">
                    {currentDocument.chunks} chunks • {currentDocument.uploadedAt.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Messages */}
          <div className="recent-section">
            <h3 className="section-title">Recent Activity</h3>
            <div className="recent-messages">
              {messages.slice(-4).map((m,i)=> (
                <div key={i} className={`recent-message ${m.role}`}>
                  <div className="message-role">
                    {m.role === 'user' ? '👤' : m.role === 'assistant' ? '🤖' : '📋'}
                  </div>
                  <div className="message-preview">
                    {m.text.slice(0, 80)}{m.text.length > 80 ? '...' : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Chat Area */}
        <main className="chat-container">
          <div className="chat" ref={chatRef}>
            {messages.map((m,i)=> (
              <div key={i} className={`message ${m.role}`}>
                <div className="message-avatar">
                  {m.role === 'user' ? (
                    <div className="avatar user-avatar">You</div>
                  ) : m.role === 'system' ? (
                    <div className="avatar system-avatar">📋</div>
                  ) : (
                    <div className="avatar assistant-avatar">AI</div>
                  )}
                </div>
                <div className="message-content">
                  <div className="message-text">{m.text}</div>
                  <div className="message-time">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="message assistant">
                <div className="message-avatar">
                  <div className="avatar assistant-avatar">AI</div>
                </div>
                <div className="message-content">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="input-container">
            <div className="input-wrapper">
              <textarea
                placeholder={currentDocument ? `Ask a question about "${currentDocument.name}"...` : "Upload a PDF document first to start asking questions..."}
                value={question}
                onChange={e=>setQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                rows="1"
                className="message-input"
                disabled={!currentDocument}
              />
              <button 
                className="send-btn"
                onClick={handleAsk}
                disabled={loading || !question.trim() || !currentDocument}
                title="Send message"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M2,21L23,12L2,3V10L17,12L2,14V21Z" />
                </svg>
              </button>
            </div>
            <div className="input-footer">
              <span className="tip">
                {currentDocument ? "Press Enter to send • Shift+Enter for new line" : "Upload a document to enable chat"}
              </span>
              <span className="session-id">Session: {sessionId.split('_')[1]}</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;