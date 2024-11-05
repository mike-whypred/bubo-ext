document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded');
  
  // Check for stored API key first
  const apiKey = await getStoredApiKey();
  if (apiKey) {
    console.log('Found stored API key');
    showChatScreen(apiKey);
  } else {
    console.log('No stored API key found');
    // Make sure API key screen is visible by default
    document.getElementById('api-key-screen').style.display = 'flex';
    document.getElementById('chat-screen').style.display = 'none';
    
    // Set up API key form listener
    const apiKeyForm = document.getElementById('api-key-form');
    if (apiKeyForm) {
      apiKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const apiKey = document.getElementById('api-key').value.trim();
        
        if (!apiKey.startsWith('sk-')) {
          alert('Please enter a valid OpenAI API key');
          return;
        }

        await storeApiKey(apiKey);
        
        showChatScreen(apiKey);
      });
    }
  }
});

function showChatScreen(apiKey) {
  console.log('Showing chat screen');
  document.getElementById('api-key-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  setupChatHandlers(apiKey);
}

function setupChatHandlers(apiKey) {
  console.log('Setting up chat handlers');
  
  // Send button handler
  const sendButton = document.getElementById('send-button');
  if (sendButton) {
    console.log('Adding send button handler');
    sendButton.onclick = () => handleSendMessage(apiKey);
  }

  // Input enter key handler
  const promptInput = document.getElementById('prompt-input');
  if (promptInput) {
    console.log('Adding input handler');
    promptInput.onkeypress = (e) => {
      if (e.key === 'Enter') handleSendMessage(apiKey);
    };
  }

  // Settings/logout button handler
  const logoutButton = document.querySelector('.logout-button');
  if (logoutButton) {
    console.log('Adding logout button handler');
    logoutButton.onclick = async () => {
      await chrome.storage.local.remove(['encryptedApiKey', 'apiKeyTimestamp']);
      location.reload();
    };
  }
}

async function handleSendMessage(apiKey) {
  const promptInput = document.getElementById('prompt-input');
  const prompt = promptInput.value.trim();
  
  if (!prompt) return;

  addMessageToChat('user', prompt);
  promptInput.value = '';

  const loadingMessage = addMessageToChat('system', 'Capturing screenshot and processing...');

  try {
    const screenshot = await chrome.runtime.sendMessage({ action: 'captureScreen' });
    loadingMessage.textContent = 'Asking AI...';
    
    const response = await sendToOpenAI(prompt, screenshot, apiKey);
    
    loadingMessage.remove();
    
    // Check if response contains JSON data
    if (prompt.toLowerCase().includes('extract') && prompt.toLowerCase().includes('json')) {
      try {
        // Try to find JSON in the response
        const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                         response.match(/{[\s\S]*?}/);
                         
        if (jsonMatch) {
          const jsonData = jsonMatch[1] || jsonMatch[0];
          const parsedJson = JSON.parse(jsonData.trim());
          
          // Add download button to message
          const messageDiv = addMessageToChat('assistant', response);
          addJsonDownloadButton(messageDiv, parsedJson);
        } else {
          addMessageToChat('assistant', response);
        }
      } catch (error) {
        console.error('JSON parsing error:', error);
        addMessageToChat('assistant', response);
      }
    } else {
      addMessageToChat('assistant', response);
    }
  } catch (error) {
    loadingMessage.remove();
    addMessageToChat('error', 'Error: ' + error.message);
  }
}

function addJsonDownloadButton(messageDiv, jsonData) {
  const downloadButton = document.createElement('button');
  downloadButton.className = 'json-download-button';
  downloadButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"></path>
    </svg>
    Download JSON
  `;
  
  downloadButton.onclick = () => downloadJson(jsonData);
  messageDiv.appendChild(downloadButton);
}

function downloadJson(jsonData) {
  const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `extracted-data-${timestamp}.json`;
  
  const downloadLink = document.createElement('a');
  downloadLink.href = url;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
}

async function sendToOpenAI(prompt, screenshot, apiKey) {
  const base64Image = screenshot.replace(/^data:image\/[a-z]+;base64,/, '');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: "You're an AI assistant in the browser, you will be given a screenshot of the browser that the user is looking at, answer the questions asked based on the screenshot."
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 500
    })
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('OpenAI API Error:', data);
    throw new Error(data.error?.message || 'API request failed');
  }
  
  return data.choices[0].message.content;
}

function addMessageToChat(role, content) {
  const chatContainer = document.getElementById('chat-container');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  if (role === 'system' && content === 'Capturing screenshot and processing...') {
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'typing-dot';
      typingIndicator.appendChild(dot);
    }
    messageDiv.appendChild(typingIndicator);
  } else {
    messageDiv.textContent = content;
  }
  
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return messageDiv;
}

// Utility functions for encryption/decryption
async function encryptData(data) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  // Generate a random key
  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  
  // Generate a random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  // Encrypt the data
  const encryptedData = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    dataBuffer
  );
  
  // Export the key
  const exportedKey = await window.crypto.subtle.exportKey('raw', key);
  
  return {
    encrypted: Array.from(new Uint8Array(encryptedData)),
    iv: Array.from(iv),
    key: Array.from(new Uint8Array(exportedKey))
  };
}

async function decryptData(encryptedObj) {
  const key = await window.crypto.subtle.importKey(
    'raw',
    new Uint8Array(encryptedObj.key),
    'AES-GCM',
    true,
    ['decrypt']
  );
  
  const decryptedData = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(encryptedObj.iv) },
    key,
    new Uint8Array(encryptedObj.encrypted)
  );
  
  return new TextDecoder().decode(decryptedData);
}

// Store API key securely
async function storeApiKey(apiKey) {
  try {
    const encryptedData = await encryptData(apiKey);
    await chrome.storage.local.set({
      encryptedApiKey: encryptedData,
      apiKeyTimestamp: Date.now()
    });
  } catch (error) {
    console.error('Error storing API key:', error);
    throw error;
  }
}

// Retrieve API key securely
async function getStoredApiKey() {
  try {
    const { encryptedApiKey } = await chrome.storage.local.get('encryptedApiKey');
    if (!encryptedApiKey) return null;
    
    return await decryptData(encryptedApiKey);
  } catch (error) {
    console.error('Error retrieving API key:', error);
    return null;
  }
} 