// ==UserScript==
// @name         TurboWarp AI Chat Panel (Markdown Support)
// @namespace    http://tampermonkey.net/
// @version      2025-10-12
// @description  Adds a floating AI chat panel with @mentions and Markdown rendering to the TurboWarp editor
// @author       You & AI Assistant
// @match        https://turbowarp.org/editor
// @icon         https://www.google.com/s2/favicons?sz=64&domain=turbowarp.org
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/marked/marked.min.js
// @require      https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. STYLING ---
    const styles = `
        .ai-chat-panel {
            width: 0; height: 100%; background-color: #f0f0f0; transition: width 0.3s ease;
            overflow: hidden; box-shadow: -2px 0 5px rgba(0,0,0,0.2); flex-shrink: 0;
            flex-grow: 0; flex-basis: auto; order: 1; position: relative;
            display: flex; flex-direction: column; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        }
        .ai-chat-panel.open { width: 380px; }
        .ai-chat-display { flex: 1; padding: 1rem; overflow-y: auto; word-wrap: break-word; }
        .ai-chat-display > div { margin-bottom: 1rem; line-height: 1.5; }
        .ai-input-wrapper { display: flex; padding: 0.5rem; border-top: 1px solid #ccc; align-items: flex-end; }
        .ai-chat-input {
            flex: 1; padding: 0.5rem; font-size: 14px; border: 1px solid #ccc; border-radius: 4px;
            max-height: 150px; overflow-y: auto; background-color: white; line-height: 1.4;
        }
        .ai-chat-input:focus { outline: none; border-color: #4C97FF; }
        .mention-pill {
            background-color: #d1e7ff; color: #0c5460; border-radius: 4px;
            padding: 2px 5px; font-weight: 500; display: inline-block; cursor: default;
        }
        .ai-send-button {
            margin-left: 0.5rem; padding: 0.5rem 1rem; cursor: pointer; background-color: #4C97FF;
            color: white; border: none; border-radius: 4px; height: fit-content; align-self: flex-end;
        }
        .ai-send-button:disabled { background-color: #a0c7ff; cursor: not-allowed; }
        .mention-popup {
            position: absolute; bottom: 60px; left: 10px; right: 10px; background: white;
            border: 1px solid #ddd; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);
            max-height: 200px; overflow-y: auto; z-index: 1100;
        }
        .mention-item { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee; }
        .mention-item:last-child { border-bottom: none; }
        .mention-item:hover, .mention-item.selected { background-color: #f0f0f0; }

        /* --- Markdown Styles --- */
        .ai-chat-display pre {
            background-color: #2d2d2d; color: #f2f2f2; padding: 1rem;
            border-radius: 6px; overflow-x: auto; font-family: 'Courier New', Courier, monospace;
            font-size: 0.9em;
        }
        .ai-chat-display code {
            background-color: #eef; padding: 2px 4px; border-radius: 4px; font-size: 0.9em;
        }
        .ai-chat-display pre code {
            background-color: transparent; padding: 0;
        }
        .ai-chat-display h3 { margin-top: 0.5em; margin-bottom: 0.5em; }
        .ai-chat-display ul, .ai-chat-display ol { padding-left: 20px; }
        .gui_body-wrapper_-N0sA {overflow:hidden}
    `;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);


    // --- 2. ELEMENTS CREATION ---
    const container = document.querySelector("#app > div > div > div > div.gui_body-wrapper_-N0sA.box_box_2jjDp > div");
    if (!container) {
        console.error("Target container not found for AI Chat Panel");
        return;
    }

    const toggleButton = document.createElement("button");
    toggleButton.textContent = "AI";
    toggleButton.style = "position: fixed; right: 5px; top: 5px; z-index: 1000; padding: 10px; background-color: #4C97FF; color: white; border: none; border-radius: 5px; cursor: pointer;";

    const panel = document.createElement("div");
    panel.className = "ai-chat-panel";

    const closeButton = document.createElement("button");
    closeButton.textContent = "✖";
    closeButton.style = "position: absolute; right: 10px; top: 10px; background: none; border: none; font-size: 16px; cursor: pointer;";

    const chatDisplay = document.createElement("div");
    chatDisplay.className = "ai-chat-display";

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "ai-input-wrapper";

    const chatInput = document.createElement("div");
    chatInput.contentEditable = "true";
    chatInput.className = "ai-chat-input";
    chatInput.setAttribute("placeholder", "Type your message or @ to mention...");

    const sendButton = document.createElement("button");
    sendButton.textContent = "Send";
    sendButton.className = "ai-send-button";

    inputWrapper.appendChild(chatInput);
    inputWrapper.appendChild(sendButton);

    const mentionPopup = document.createElement('div');
    mentionPopup.className = 'mention-popup';
    mentionPopup.style.display = 'none';

    panel.appendChild(closeButton);
    panel.appendChild(chatDisplay);
    panel.appendChild(inputWrapper);
    panel.appendChild(mentionPopup);
    container.appendChild(toggleButton);
    container.appendChild(panel);

    // --- 3. FUNCTIONALITY ---

    let isOpen = false;
    const togglePanel = () => {
        isOpen = !isOpen;
        panel.classList.toggle('open', isOpen);
    };
    toggleButton.addEventListener("click", togglePanel);
    closeButton.addEventListener("click", togglePanel);

    // Mock AI reply function with Markdown content
    const getAIReply = async (message) => {
        return new Promise(resolve => {
            setTimeout(() => {
                const response = `### Creating a Jumping Script

Of course! To make a sprite jump when the space key is pressed, you can use a script like this. This example uses a variable called \`y velocity\` to simulate gravity.

1.  Create a new variable named \`y velocity\` for this sprite only.
2.  Use this script:

\`\`\`scratch
when green flag clicked
set [y velocity v] to (0)
forever
  if <key [space v] pressed?> and <(touching [ground v]?)> then
    set [y velocity v] to (15)
  end
  change [y v] by (y velocity)
  if <not <(touching [ground v]?)>> then
    change [y velocity v] by (-1)
  else
    set [y velocity v] to (0)
  end
end
\`\`\`

This script makes the sprite jump and fall back down realistically. The value \`15\` controls the jump height.`;
                resolve(response);
            }, 800);
        });
    };

    // Helper function to add messages to the display
    const appendMessage = (content, sender) => {
        const messageDiv = document.createElement('div');
        if (sender === 'user') {
            messageDiv.innerHTML = `<b>You:</b> `;
            // Use createTextNode to prevent user input from being interpreted as HTML
            messageDiv.appendChild(document.createTextNode(content));
        } else { // sender === 'ai'
            messageDiv.innerHTML = `<b>AI:</b><br>`;
            // Parse Markdown, sanitize it, and then append
            const rawHtml = marked.parse(content);
            const sanitizedHtml = DOMPurify.sanitize(rawHtml);
            messageDiv.innerHTML += sanitizedHtml;
        }
        chatDisplay.appendChild(messageDiv);
        chatDisplay.scrollTop = chatDisplay.scrollHeight;
    };

    const sendMessage = async () => {
        const messageText = chatInput.innerText.trim();
        if (!messageText) return;

        appendMessage(messageText, 'user');
        chatInput.innerHTML = "";

        sendButton.disabled = true;

        const reply = await getAIReply(messageText);
        appendMessage(reply, 'ai');

        sendButton.disabled = false;
        chatInput.focus();
    };

    sendButton.addEventListener("click", sendMessage);
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
        if (e.key === 'Backspace') {
            const selection = window.getSelection();
            if (selection.rangeCount > 0 && selection.isCollapsed) {
                const range = selection.getRangeAt(0);
                const node = range.startContainer;
                const offset = range.startOffset;
                if (node.nodeName === 'DIV' && offset > 0) {
                    const child = node.childNodes[offset - 1];
                    if (child && child.nodeName === 'SPAN' && child.classList.contains('mention-pill')) {
                        child.remove();
                        e.preventDefault();
                    }
                }
            }
        }
    });

    // --- 4. @MENTION LOGIC ---
    const mentionables = ['the current sprite', 'all scripts', 'the stage', 'variable "score"', 'variable "lives"'];
    let currentMentionQuery = null;

    const updateMentionPopup = () => {
        if (currentMentionQuery === null) {
            mentionPopup.style.display = 'none';
            return;
        }
        const filtered = mentionables.filter(item => item.toLowerCase().includes(currentMentionQuery.toLowerCase()));
        if (filtered.length > 0) {
            mentionPopup.innerHTML = filtered.map(item => `<div class="mention-item">${item}</div>`).join('');
            mentionPopup.style.display = 'block';
            document.querySelectorAll('.mention-item').forEach(item => {
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    insertMention(item.textContent);
                });
            });
        } else {
            mentionPopup.style.display = 'none';
        }
    };

    const insertMention = (text) => {
        chatInput.focus();
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const lengthToDelete = (currentMentionQuery ? currentMentionQuery.length : 0) + 1;
        if (range.startOffset >= lengthToDelete) {
            range.setStart(range.startContainer, range.startOffset - lengthToDelete);
        }
        range.deleteContents();
        const pill = document.createElement('span');
        pill.className = 'mention-pill';
        pill.contentEditable = 'false';
        pill.textContent = text;
        range.insertNode(pill);
        const space = document.createTextNode('\u00A0');
        range.setStartAfter(pill);
        range.setEndAfter(pill);
        range.insertNode(space);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        currentMentionQuery = null;
        updateMentionPopup();
    };

    chatInput.addEventListener('input', (e) => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const textNode = range.startContainer;
        if (textNode.nodeType !== Node.TEXT_NODE) {
            currentMentionQuery = null;
            updateMentionPopup();
            return;
        }
        const text = textNode.textContent.substring(0, range.startOffset);
        const atMatch = text.match(/@([\w\s]*)$/);
        if (atMatch) {
            currentMentionQuery = atMatch[1];
            updateMentionPopup();
        } else {
            currentMentionQuery = null;
            updateMentionPopup();
        }
    });

    chatInput.addEventListener('blur', () => {
        setTimeout(() => {
            mentionPopup.style.display = 'none';
        }, 200);
    });

})();