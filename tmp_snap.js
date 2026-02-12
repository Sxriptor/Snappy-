
(function() {
  if (window.__SNAPPY_RUNNING__) {
    console.log('[Snappy] Already running');
    return;
  }
  window.__SNAPPY_RUNNING__ = true;
  
  const CONFIG = {};
  const seenMessages = new Set();
  const lastRepliedMessage = new Map(); // Track last message we replied to per user: username -> messageText
  let pollInterval = null;
  let isProcessing = false; // Lock to prevent concurrent processing

  // Log storage for polling
  window.__SNAPPY_LOGS__ = window.__SNAPPY_LOGS__ || [];
  
  function log(msg) {
    console.log('[Snappy] ' + msg);
    window.__SNAPPY_LOGS__.push(msg);
    if (window.__SNAPPY_LOGS__.length > 50) {
      window.__SNAPPY_LOGS__ = window.__SNAPPY_LOGS__.slice(-50);
    }
  }
  
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  
  // ============ MEMORY SYSTEM (localStorage) ============
  const MEMORY_KEY = 'snappy_memories';
  
  // Load all memories from localStorage
  function loadAllMemories() {
    try {
      const data = localStorage.getItem(MEMORY_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      log('Error loading memories: ' + e);
      return {};
    }
  }
  
  // Save all memories to localStorage
  function saveAllMemories(memories) {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
    } catch (e) {
      log('Error saving memories: ' + e);
    }
  }
  
  // Get memory for a specific user
  function getUserMemory(username) {
    const memories = loadAllMemories();
    if (!memories[username]) {
      memories[username] = {
        username: username,
        messages: [],
        firstSeen: Date.now(),
        lastSeen: Date.now()
      };
      saveAllMemories(memories);
    }
    return memories[username];
  }
  
  // Add a message to user's memory
  function addToMemory(username, text, isFromThem) {
    const memories = loadAllMemories();
    if (!memories[username]) {
      memories[username] = {
        username: username,
        messages: [],
        firstSeen: Date.now(),
        lastSeen: Date.now()
      };
    }
    
    // Add the message
    memories[username].messages.push({
      text: text,
      from: isFromThem ? 'them' : 'me',
      timestamp: Date.now()
    });
    
    // Keep only last 100 messages per user
    if (memories[username].messages.length > 100) {
      memories[username].messages = memories[username].messages.slice(-100);
    }
    
    memories[username].lastSeen = Date.now();
    saveAllMemories(memories);
    
    log('Memory saved for ' + username + ': ' + (isFromThem ? 'THEM' : 'ME') + ' - "' + text.substring(0, 30) + '..."');
  }
  
  // Get conversation summary for a user
  function getMemorySummary(username) {
    const memory = getUserMemory(username);
    const msgCount = memory.messages.length;
    const theirMsgs = memory.messages.filter(m => m.from === 'them').length;
    const myMsgs = memory.messages.filter(m => m.from === 'me').length;
    
    // Get last few messages for context
    const recent = memory.messages.slice(-5).map(m => 
      (m.from === 'them' ? 'Them: ' : 'Me: ') + m.text.substring(0, 50)
    ).join(' | ');
    
    return {
      total: msgCount,
      fromThem: theirMsgs,
      fromMe: myMsgs,
      recent: recent,
      firstSeen: memory.firstSeen,
      lastSeen: memory.lastSeen
    };
  }
  
  // List all users in memory
  function listAllUsers() {
    const memories = loadAllMemories();
    return Object.keys(memories);
  }
  
  // Expose memory functions globally for UI access
  window.__SNAPPY_MEMORY__ = {
    getUser: getUserMemory,
    addMessage: addToMemory,
    getSummary: getMemorySummary,
    listUsers: listAllUsers,
    loadAll: loadAllMemories
  };
  
  // ============ END MEMORY SYSTEM ============
  
  // Scan the DOM to find clickable chat items
  // SNAPCHAT USES: .O4POs for each chat row
  function findClickableChats() {
    // EXACT SELECTOR: .O4POs = every chat row in sidebar
    const chatRows = Array.from(document.querySelectorAll('.O4POs'));
    log('Found ' + chatRows.length + ' chat rows (.O4POs)');
    return chatRows;
  }
  
  // Check if a chat has a new INCOMING message (not our outgoing "Delivered" messages)
  // SNAPCHAT USES:
  //   .qFDXZ class on .O4POs = unread message
  //   .GQKvA span = message status ("Received", "Sent", "Delivered", etc.)
  function isNewIncomingChat(element) {
    // STEP 0: Block Snapchat official accounts
    const username = getUsernameFromChatRow(element);
    if (username) {
      const usernameLower = username.toLowerCase();

      // Block list: Snapchat official accounts
      const blockedAccounts = [
        'my ai',
        'team snapchat',
        'snapchat',
        'snapchat support',
        'snapchat team'
      ];

      for (const blocked of blockedAccounts) {
        if (usernameLower.includes(blocked)) {
          log('Skipping blocked account: "' + username + '"');
          return false;
        }
      }
    }

    // STEP 1: MUST have unread indicator - this is the PRIMARY requirement
    // .qFDXZ = unread class on chat row
    const isUnread = element.classList.contains('qFDXZ');

    // STEP 2: Check for "New Chat" or "New Snap" status text (also indicates unread)
    const chatText = (element.textContent || '').toLowerCase();
    const hasNewChatText = chatText.includes('new chat') || chatText.includes('new snap');

    // STEP 3: Check for unread badge/indicator element
    const hasUnreadBadge = element.querySelector('.HEkDJ') !== null ||
                          element.querySelector('[class*="badge"]') !== null;

    // MUST have at least one unread indicator
    if (!isUnread && !hasNewChatText && !hasUnreadBadge) {
      return false;
    }

    if (isUnread) {
      log('Chat has unread indicator (.qFDXZ)');
    }
    if (hasNewChatText) {
      log('Chat has "new chat" text');
    }
    if (hasUnreadBadge) {
      log('Chat has unread badge element');
    }

    // STEP 4: Check the message status - must NOT be an outgoing status or already-handled status
    const statusSpan = element.querySelector('.GQKvA .tGtEY .nonIntl') || element.querySelector('.GQKvA');
    if (statusSpan) {
      const status = statusSpan.textContent.trim().toLowerCase();
      log('Message status: "' + status + '"');

      // CRITICAL: Skip BOTH outgoing statuses AND already-received statuses
      // Outgoing = we sent it to them
      // Received/Delivered = either we got their message OR they got ours (ambiguous!)
      const skipStatuses = [
        'delivered',   // Message was delivered (either direction - skip to be safe)
        'sent',        // We sent a message
        'opened',      // They opened our message
        'viewed',      // They viewed our message
        'screenshot',  // They screenshotted
        'replayed',    // They replayed
        'received'     // Message received (either direction - skip to be safe)
      ];

      if (skipStatuses.includes(status)) {
        log('Skipping - status "' + status + '" indicates already-handled or outgoing message');
        return false;
      }

      // ONLY accept clearly new/incoming statuses
      const acceptedStatuses = [
        'typing',
        'typing...',
        'typing…',
        'new chat',
        'new snap'
      ];

      if (acceptedStatuses.some(s => status.includes(s))) {
        log('Status "' + status + '" with unread indicator = NEW incoming message');
        return true;
      }

      // If status is not in skip list OR accept list, log and skip to be safe
      log('Unknown status "' + status + '" - skipping to be safe');
      return false;
    }

    // Has unread indicator but no status - accept as incoming (might be a new message loading)
    log('Has unread indicator but no status - assuming incoming');
    return true;
  }
  
  // Debug function to analyze a chat element
  function debugChatElement(element, index) {
    const text = (element.textContent || '').substring(0, 50);
    const cls = (element.className || '').substring(0, 50);

    // Check key indicators
    const hasQFDXZ = element.classList.contains('qFDXZ');
    const username = getUsernameFromChatRow(element);
    const statusSpan = element.querySelector('.GQKvA');
    const status = statusSpan ? statusSpan.textContent.trim() : 'none';

    log('Chat ' + index + ': user="' + (username || 'unknown') + '" status="' + status + '" unread=' + hasQFDXZ);
    log('  Text: "' + text + '"');
    log('  Classes: "' + cls + '"');
  }
  
  // Find the input field
  function findInput() {
    // Try contenteditable first
    let input = document.querySelector('[contenteditable="true"]');
    if (input) return input;
    
    // Try textarea
    input = document.querySelector('textarea');
    if (input) return input;
    
    // Try input
    input = document.querySelector('input[type="text"]');
    if (input) return input;
    
    return null;
  }
  
  // Find send button
  function findSendButton() {
    // Try various selectors
    const selectors = [
      'button[type="submit"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      '[class*="send" i]',
      '[class*="Send"]'
    ];
    
    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn) return btn;
      } catch(e) {}
    }
    
    // Look for button with send icon or text
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('send') || ariaLabel.includes('send')) {
        return btn;
      }
    }
    
    return null;
  }
  
  // Track messages we've sent to avoid replying to ourselves
  const sentMessages = new Set();
  
  // Check if text looks like a status/UI element
  function isStatusText(text) {
    const lower = text.toLowerCase().trim();
    const statusWords = [
      'typing', 'delivered', 'opened', 'received', 'sent', 'viewed',
      'new chat', 'new snap', 'streak', 'screenshot', 'tap to',
      'swipe', 'double tap', 'just now', 'today', 'yesterday',
      'spotlight', 'stories', 'discover', 'map', 'camera'
    ];
    
    // Exact matches
    if (statusWords.includes(lower)) return true;
    
    // Partial matches for short text
    if (text.length < 20) {
      for (const word of statusWords) {
        if (lower.includes(word)) return true;
      }
    }
    
    // Timestamps
    if (/^\d{1,2}:\d{2}/.test(text)) return true;
    if (/^\d+[smhd]\s*(ago)?$/i.test(text)) return true;
    
    return false;
  }
  
  // Get visible text content from chat area
  // expectedSender: The username we expect to see (to verify we're not reading stale cache)
  function getVisibleMessages(expectedSender) {
    const messages = [];
    let detectedSender = null;

    // SNAPCHAT MESSAGE STRUCTURE:
    // <ul class="MibAa"> (main container)
    //   <li class="T1yt2"> (date group - e.g. "December 4")
    //     <div>
    //       <ul class="ujRzj"> (messages for that date)
    //   <li class="T1yt2"> (LAST = most recent date!)
    //     <div>
    //       <ul class="ujRzj"> (NEWEST messages - this is what we want!)

    // STEP 1: Find the main container (ul.MibAa)
    const mainContainer = document.querySelector('ul.MibAa');
    let messageList = null;

    if (mainContainer) {
      log('Found main container (ul.MibAa)');

      // STEP 2: Get ALL <li class="T1yt2"> (these can be date headers OR message groups)
      const allDateGroups = Array.from(mainContainer.querySelectorAll(':scope > li.T1yt2'));
      log('Found ' + allDateGroups.length + ' li.T1yt2 elements');

      // Filter to only those that have ul.ujRzj (actual message groups, not just date headers)
      const messageGroups = allDateGroups.filter(li => li.querySelector('ul.ujRzj') !== null);
      log('Filtered to ' + messageGroups.length + ' groups with messages');

      if (messageGroups.length > 0) {
        // Get the LAST message group
        const lastGroup = messageGroups[messageGroups.length - 1];
        log('Using LAST message group (index ' + (messageGroups.length - 1) + ')');

        // DEBUG: Show what's in this group
        const header = lastGroup.querySelector('header.R1ne3 span.nonIntl');
        const sender = header ? header.textContent.trim() : 'unknown';
        log('  Sender in last group: "' + sender + '"');

        // STEP 3: Find ul.ujRzj inside this last group
        const nestedUl = lastGroup.querySelector('ul.ujRzj');
        if (nestedUl) {
          messageList = nestedUl;
          const msgCount = nestedUl.querySelectorAll(':scope > li').length;
          log('  Found ul.ujRzj with ' + msgCount + ' messages');
        } else {
          log('WARNING: No ul.ujRzj found in last group!');
        }
      }
    } else {
      log('Main container (ul.MibAa) not found, trying fallback...');

      // FALLBACK: Find largest visible ul.ujRzj (old method)
      const allMessageLists = Array.from(document.querySelectorAll('ul.ujRzj'));
      log('Found ' + allMessageLists.length + ' ul.ujRzj elements (fallback)');

      let maxArea = 0;
      for (const ul of allMessageLists) {
        const rect = ul.getBoundingClientRect();
        const area = rect.width * rect.height;

        if (rect.width > 0 && rect.height > 200 && area > maxArea) {
          const isInViewport = rect.top < window.innerHeight && rect.bottom > 0 &&
                              rect.left < window.innerWidth && rect.right > 0;
          if (isInViewport) {
            messageList = ul;
            maxArea = area;
          }
        }
      }
    }

    if (!messageList) {
      log('ERROR: Could not find any visible message list');
      return messages;
    }

    // DEBUG: Log details about the selected message list
    const listItemCount = messageList.querySelectorAll(':scope > li').length;
    log('Selected message list with ' + listItemCount + ' message items');

    // The messageList is now always a ul.ujRzj (nested), so process its direct <li> children
    let messagesToProcess = [];
    const messageItems = Array.from(messageList.querySelectorAll(':scope > li'));

    for (const item of messageItems) {
      messagesToProcess.push({
        group: messageList.closest('li.T1yt2') || messageList.parentElement,
        item: item,
        index: messagesToProcess.length
      });
    }

    // OLD FALLBACK CODE (kept for reference, but shouldn't be needed now)
    if (messagesToProcess.length === 0) {
      // messageList is the main container, need to find nested ul.ujRzj inside <li class="T1yt2">
      const allTopLevelLis = Array.from(messageList.querySelectorAll(':scope > li.T1yt2, :scope > li'));
      log('Found ' + allTopLevelLis.length + ' top-level message groups');
      
      if (allTopLevelLis.length === 0) {
        log('No message groups found');
        return messages;
      }

      // ONLY process the LAST 2 top-level groups (most recent messages)
      // Each group is usually a date section (e.g., "December 5")
      const groupsToCheck = Math.min(2, allTopLevelLis.length);
      log('Processing last ' + groupsToCheck + ' message groups (most recent)');

      for (let i = allTopLevelLis.length - 1; i >= allTopLevelLis.length - groupsToCheck; i--) {
        const group = allTopLevelLis[i];
        
        // Within each group, find the nested <ul class="ujRzj"> inside a <div>
        // Structure: <li class="T1yt2"> -> <div> -> <ul class="ujRzj"> -> <li> (messages)
        let nestedUl = null;
        
        // Look for divs that contain ul.ujRzj
        const divs = group.querySelectorAll('div');
        for (const div of divs) {
          // Check if this div has a direct child ul.ujRzj
          const directUl = Array.from(div.children).find(child => 
            child.tagName === 'UL' && child.classList.contains('ujRzj')
          );
          if (directUl) {
            nestedUl = directUl;
            log('Group ' + i + ': Found nested ul.ujRzj as direct child of div');
            break;
          }
        }
        
        // If not found, look for any ul.ujRzj within the group
        if (!nestedUl) {
          const allUls = Array.from(group.querySelectorAll('ul.ujRzj'));
          for (const ul of allUls) {
            // Verify it's nested (inside a div within the group)
            const parentDiv = ul.closest('div');
            if (parentDiv && group.contains(parentDiv)) {
              nestedUl = ul;
              log('Group ' + i + ': Found nested ul.ujRzj via querySelector');
              break;
            }
          }
        }
        
        if (nestedUl) {
          const nestedLis = Array.from(nestedUl.querySelectorAll(':scope > li'));
          log('Group ' + i + ': Found nested ul.ujRzj with ' + nestedLis.length + ' message items');
          
          // Process each nested <li> in this group
          for (const nestedLi of nestedLis) {
            messagesToProcess.push({ group: group, item: nestedLi, index: messagesToProcess.length });
          }
        } else {
          // Check if this group has a direct message bubble (no nested ul)
          const directBubble = group.querySelector('div.KB4Aq');
          if (directBubble) {
            log('Group ' + i + ': Found direct message bubble (no nested ul)');
            messagesToProcess.push({ group: group, item: group, index: messagesToProcess.length, isDirect: true });
          }
        }
      }
    }
    
    log('Total messages to process: ' + messagesToProcess.length);

    // PRIORITY: Process ONLY the LAST group (most recent messages) first
    // If the user just sent a message, we want to see their LATEST message, not old cached ones
    if (messagesToProcess.length > 0) {
      log('Prioritizing LAST message group (index ' + (messagesToProcess.length - 1) + ') as most recent');
    }

    // Process the last few messages (keep in chronological order: oldest -> newest)
    messagesToProcess = messagesToProcess.slice(-5); // Get last 5 messages

    for (const msgData of messagesToProcess) {
      const messageItem = msgData.item;
      const parentGroup = msgData.group;
      
      // Check if this message item or its parent group has a header (indicates sender)
      const header = messageItem.querySelector('header.R1ne3') || parentGroup.querySelector('header.R1ne3');
      
      let isOutgoing = false;
      let isIncoming = false;

      if (header) {
        // Has header - determine sender from header color and text
        const headerStyle = window.getComputedStyle(header);
        const headerColor = headerStyle.color || header.getAttribute('style') || '';
        
        // Check header color: blue typically means incoming, red might mean outgoing
        // Also check the text content
        const meSpan = header.querySelector('span.nonIntl');
        const senderName = meSpan ? meSpan.textContent.trim() : '';
        
        // If sender is exactly "Me", it's our message (outgoing)
        if (senderName === 'Me') {
          isOutgoing = true;
          isIncoming = false;
          log('Message from header: "Me" [OUTGOING] color=' + headerColor);
        } else if (senderName && senderName.length > 0) {
          // Has a sender name that's not "Me", so it's incoming
          isOutgoing = false;
          isIncoming = true;

          // Track the detected sender name
          if (!detectedSender) {
            detectedSender = senderName;
          }

          log('Message from header: "' + senderName + '" [INCOMING] color=' + headerColor);
        } else {
          // No sender name, use color as fallback
          // Blue (rgb(14, 173, 255) or similar) usually means incoming
          // Red (rgb(242, 60, 87)) means outgoing
          const isBlue = headerColor.includes('rgb(14, 173, 255)') || headerColor.includes('rgb(14,173,255)') || 
                        headerColor.includes('blue') || headerColor.includes('#0eadff');
          const isRed = headerColor.includes('rgb(242, 60, 87)') || headerColor.includes('rgb(242,60,87)') ||
                       headerColor.includes('red');
          if (isBlue) {
            isIncoming = true;
            log('Message from header color: BLUE [INCOMING]');
          } else if (isRed) {
            isOutgoing = true;
            log('Message from header color: RED [OUTGOING]');
          }
        }
      }

      // Find the actual message text in span.ogn1z.nonIntl (deep in nested structure)
      // CRITICAL: Only look inside message bubbles (div.KB4Aq), NOT in headers
      // The header has span.nonIntl with the username, but we want span.ogn1z inside div.KB4Aq
      const messageBubbles = messageItem.querySelectorAll('div.KB4Aq');
      const seenTexts = new Set();

      if (messageBubbles.length === 0) {
        log('No message bubbles found in this item');
        continue;
      }

      for (const bubble of messageBubbles) {
        // CRITICAL: Only look for message text in the specific path: div.KB4Aq > div.p8r1z > span.ogn1z.nonIntl
        // This ensures we only get the actual message text, not header text
        const p8r1zDiv = bubble.querySelector('div.p8r1z');
        if (!p8r1zDiv) {
          log('No div.p8r1z found in bubble, skipping');
          continue;
        }
        
        // Look specifically for span.ogn1z.nonIntl inside div.p8r1z
        const messageTextSpans = p8r1zDiv.querySelectorAll('span.ogn1z.nonIntl[dir="auto"], span.ogn1z.nonIntl, span.ogn1z[dir="auto"]');
        
        if (messageTextSpans.length === 0) {
          log('No span.ogn1z found in div.p8r1z');
          continue;
        }
        
        for (const span of messageTextSpans) {
          // Triple-check: make sure this span is NOT inside a header (shouldn't be possible if we're in div.p8r1z, but be safe)
          if (span.closest('header.R1ne3')) {
            log('Skipping span inside header: "' + (span.textContent || '').substring(0, 20) + '"');
            continue;
          }
          
          // Make sure the span is actually inside the bubble we're processing
          if (!bubble.contains(span)) {
            log('Skipping span not in bubble');
            continue;
          }
          
          const text = span.textContent ? span.textContent.trim() : '';
          
          // Skip if empty
          if (!text || text.length < 1) {
            continue;
          }
          
          // Skip very short text (1-2 characters) that might be usernames or single letters
          if (text.length <= 2 && !text.match(/^[a-z]{2}$/i)) {
            log('Skipping very short text (likely not a message): "' + text + '"');
            continue;
          }
          
          // Skip if already seen
          if (seenTexts.has(text)) {
            log('Skipping duplicate text: "' + text + '"');
            continue;
          }
          
          // Skip if status text
          if (isStatusText(text)) {
            log('Skipping status text: "' + text + '"');
            continue;
          }
          
          // Skip if this element has child elements with text (avoid duplicates)
          const hasTextChildren = Array.from(span.children).some(child =>
            child.textContent && child.textContent.trim().length > 0
          );
          if (hasTextChildren) {
            log('Skipping span with text children: "' + text.substring(0, 30) + '"');
            continue;
          }

          seenTexts.add(text);
          
          // If we determined direction from header, use it; otherwise check message bubble
          let msgIsIncoming = isIncoming;
          if (!isIncoming && !isOutgoing) {
            // No header info, check the message bubble div.KB4Aq
            const bubbleStyle = bubble.getAttribute('style') || '';
            const bubbleColor = window.getComputedStyle(bubble).borderColor || '';
            // Blue border (rgb(14, 173, 255)) usually means incoming
            // Red border (rgb(242, 60, 87)) means outgoing
            const isBlueBubble = bubbleStyle.includes('rgb(14, 173, 255)') || bubbleStyle.includes('rgb(14,173,255)') ||
                                bubbleColor.includes('rgb(14, 173, 255)') || bubbleColor.includes('rgb(14,173,255)');
            const isRedBubble = bubbleStyle.includes('rgb(242, 60, 87)') || bubbleStyle.includes('rgb(242,60,87)') ||
                               bubbleColor.includes('rgb(242, 60, 87)') || bubbleColor.includes('rgb(242,60,87)');
            if (isBlueBubble) {
              msgIsIncoming = true;
            } else if (isRedBubble) {
              msgIsIncoming = false;
            }
          }
          
          const direction = msgIsIncoming ? 'INCOMING' : 'OUTGOING';
          log('  -> ' + direction + ': "' + text + '"');
          messages.push({ text, isIncoming: msgIsIncoming });
        }
      }
    }

    // If we didn't find messages, fall back to processing all groups more thoroughly
    if (messages.length === 0) {
      log('No messages found with new approach, processing all groups with fallback...');
      for (const group of allTopLevelLis) {
        // Find nested ul.ujRzj inside this group
        const nestedUl = group.querySelector('div > ul.ujRzj, ul.ujRzj');
        if (nestedUl) {
          const nestedLis = Array.from(nestedUl.querySelectorAll(':scope > li'));
          for (const nestedLi of nestedLis) {
            const header = nestedLi.querySelector('header.R1ne3') || group.querySelector('header.R1ne3');
            let isOutgoing = false;
            let isIncoming = false;

            if (header) {
              const meSpan = header.querySelector('span.nonIntl');
              const senderName = meSpan ? meSpan.textContent.trim() : '';
              if (senderName === 'Me') {
                isOutgoing = true;
              } else if (senderName && senderName.length > 0) {
                isIncoming = true;
              } else {
                // Check color
                const headerColor = header.getAttribute('style') || '';
                if (headerColor.includes('rgb(14, 173, 255)') || headerColor.includes('rgb(14,173,255)')) {
                  isIncoming = true;
                } else if (headerColor.includes('rgb(242, 60, 87)') || headerColor.includes('rgb(242,60,87)')) {
                  isOutgoing = true;
                }
              }
            }

            // Only look inside message bubbles, not headers
            const messageBubbles = nestedLi.querySelectorAll('div.KB4Aq');
            const seenTexts = new Set();
            for (const bubble of messageBubbles) {
              const textSpans = bubble.querySelectorAll('span.ogn1z.nonIntl, span.ogn1z');
              for (const span of textSpans) {
                // Skip if inside header
                if (span.closest('header.R1ne3')) continue;
                
                const text = span.textContent ? span.textContent.trim() : '';
                if (!text || text.length < 1 || seenTexts.has(text) || isStatusText(text)) continue;
                const hasTextChildren = Array.from(span.children).some(child =>
                  child.textContent && child.textContent.trim().length > 0
                );
                if (hasTextChildren) continue;
                seenTexts.add(text);
                
                // Determine direction if not already set
                let msgIsIncoming = isIncoming;
                if (!isIncoming && !isOutgoing) {
                  const bubbleStyle = bubble.getAttribute('style') || '';
                  if (bubbleStyle.includes('rgb(14, 173, 255)') || bubbleStyle.includes('rgb(14,173,255)')) {
                    msgIsIncoming = true;
                  } else if (bubbleStyle.includes('rgb(242, 60, 87)') || bubbleStyle.includes('rgb(242,60,87)')) {
                    msgIsIncoming = false;
                  }
                }
                
                const direction = msgIsIncoming ? 'INCOMING' : 'OUTGOING';
                log('  -> ' + direction + ': "' + text + '"');
                messages.push({ text, isIncoming: msgIsIncoming });
              }
            }
          }
        }
      }
    }

    log('Total messages collected: ' + messages.length);

    // CRITICAL VERIFICATION: Check if the detected sender matches the expected one
    if (expectedSender && detectedSender) {
      // Clean both for comparison (remove emojis, extra spaces, etc.)
      const cleanExpected = expectedSender.replace(/[^ws]/g, '').trim().toLowerCase();
      const cleanDetected = detectedSender.replace(/[^ws]/g, '').trim().toLowerCase();

      if (cleanDetected !== cleanExpected && !cleanExpected.includes(cleanDetected) && !cleanDetected.includes(cleanExpected)) {
        log('WARNING: Sender mismatch! Expected "' + expectedSender + '" but found "' + detectedSender + '"');
        log('This is likely stale/cached DOM! Returning empty to force retry.');
        return []; // Return empty to indicate stale data
      } else {
        log('Sender verification passed: "' + detectedSender + '" matches expected "' + expectedSender + '"');
      }
    }

    return messages;
  }
  
  // Scan page and report what we find
  function scanPage() {
    log('=== PAGE SCAN ===');
    
    // Count all interactive elements
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input, textarea, [contenteditable]').length;
    const links = document.querySelectorAll('a').length;
    log('Buttons: ' + buttons + ', Inputs: ' + inputs + ', Links: ' + links);
    
    // Find chat-like elements
    const chats = findClickableChats();
    log('Potential chat items: ' + chats.length);

    // Check for unread
    let unreadCount = 0;
    chats.forEach(c => {
      if (isNewIncomingChat(c)) unreadCount++;
    });
    log('Items with unread indicators: ' + unreadCount);
    
    // Check input
    const input = findInput();
    log('Input field: ' + (input ? 'FOUND (' + input.tagName + ')' : 'NOT FOUND'));
    
    // Check send button
    const sendBtn = findSendButton();
    log('Send button: ' + (sendBtn ? 'FOUND' : 'NOT FOUND'));
    
    // Sample some class names from the page
    const classes = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      const cls = el.className;
      if (typeof cls === 'string') {
        cls.split(' ').forEach(c => {
          if (c.length > 3 && c.length < 30) classes.add(c);
        });
      }
    });
    const classArr = Array.from(classes).slice(0, 20);
    log('Sample classes: ' + classArr.join(', '));
    
    log('=== END SCAN ===');
  }
  
  // Type a message
  async function typeMessage(text) {
    const input = findInput();
    if (!input) {
      log('ERROR: Input not found');
      return false;
    }

    log('Typing into: ' + input.tagName);

    // CRITICAL: Click into the input field first to show natural user behavior
    // This ensures Snapchat sees an active user clicking before typing
    window.focus(); // Ensure window has focus
    input.click(); // Click the input field
    await sleep(100); // Brief pause after click (natural behavior)
    input.focus(); // Then focus it

    // Clear first
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = '';
    } else if ('value' in input) {
      input.value = '';
    }
    
    // Type character by character (fast defaults, still human-like)
    const delays = CONFIG.typingDelayRangeMs || [10, 35];
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Simulate key events so this behaves like typing, not paste.
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));

      if (input.getAttribute('contenteditable') === 'true') {
        // Prefer insertText semantics for contenteditable inputs.
        const inserted = document.execCommand ? document.execCommand('insertText', false, char) : false;
        if (!inserted) {
          input.textContent = (input.textContent || '') + char;
        }
      } else if ('value' in input) {
        const el = input;
        const start = typeof el.selectionStart === 'number' ? el.selectionStart : (el.value || '').length;
        const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
        if (typeof el.setRangeText === 'function') {
          el.setRangeText(char, start, end, 'end');
        } else {
          el.value = (el.value || '') + char;
        }
      }

      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), bubbles: true, cancelable: true }));
      
      const delay = Math.floor(Math.random() * (delays[1] - delays[0])) + delays[0];
      await sleep(delay);
    }
    
    log('Typed: ' + text.substring(0, 30) + '...');
    return true;
  }
  
  // Send the message
  async function sendMessage() {
    const input = findInput();
    
    // Method 1: Try Enter key on input (most reliable for Snapchat)
    if (input) {
      input.focus();
      
      // Try multiple Enter key event variations
      const enterEvents = [
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
        new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
      ];
      
      for (const event of enterEvents) {
        input.dispatchEvent(event);
      }
      
      // Also try dispatching on document
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      
      log('Pressed Enter key');
      await sleep(200);
    }
    
    // Method 2: Try clicking send button as backup
    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
      log('Also clicked send button');
      return true;
    }
    
    return input !== null;
  }
  
  // Find reply based on message - now async with AI support
  async function findReply(text, username) {
    const rules = CONFIG.replyRules || [];
    const lower = text.toLowerCase();
    
    // Skip UI elements that aren't real messages
    const uiElements = ['spotlight', 'drag & drop', 'upload', 'type a message', 'send a chat', 'new chat', 'add friends'];
    if (uiElements.some(ui => lower.includes(ui))) {
      log('Skipping UI element: ' + text.substring(0, 30));
      return null;
    }
    
    // First try rule-based matching (fast path)
    for (const rule of rules) {
      const match = (rule.caseSensitive ? rule.match : rule.match.toLowerCase());
      if (lower.includes(match)) {
        log('Rule matched: ' + rule.match);
        return rule.reply;
      }
    }
    
    // Try AI if enabled - use pending request system for renderer to handle
    if (CONFIG.ai && CONFIG.ai.enabled) {
      log('Requesting AI reply for: "' + text.substring(0, 30) + '..."');
      
      // Build conversation context from memory
      const memory = getUserMemory(username);
      const messages = [];
      
      // Add system prompt
      messages.push({
        role: 'system',
        content: CONFIG.ai.systemPrompt || 'You are a friendly person chatting casually. Keep responses brief and natural.'
      });
      
      // Add conversation history from memory (last N messages)
      if (CONFIG.ai.contextHistoryEnabled && memory.messages.length > 0) {
        const historyLimit = CONFIG.ai.maxContextMessages || 10;
        const recentMsgs = memory.messages.slice(-historyLimit);
        recentMsgs.forEach(m => {
          messages.push({
            role: m.from === 'them' ? 'user' : 'assistant',
            content: m.text
          });
        });
      }
      
      // Add current message
      messages.push({ role: 'user', content: text });
      
      // Store pending AI request for renderer to pick up
      const requestId = 'ai-' + Date.now();
      window.__SNAPPY_AI_REQUEST__ = {
        id: requestId,
        username: username,
        messages: messages,
        config: CONFIG.ai
      };
      
      // Wait for response (renderer will poll and fill this)
      log('Waiting for AI response...');
      const maxWait = 30000;
      const pollInterval = 100;
      let waited = 0;
      
      while (waited < maxWait) {
        await sleep(pollInterval);
        waited += pollInterval;
        
        if (window.__SNAPPY_AI_RESPONSE__ && window.__SNAPPY_AI_RESPONSE__.id === requestId) {
          const reply = window.__SNAPPY_AI_RESPONSE__.reply;
          window.__SNAPPY_AI_RESPONSE__ = null;
          window.__SNAPPY_AI_REQUEST__ = null;
          
          if (reply) {
            log('AI reply received: "' + reply.substring(0, 30) + '..."');
            return reply;
          } else {
            log('AI returned empty reply');
            break;
          }
        }
      }
      
      window.__SNAPPY_AI_REQUEST__ = null;
      log('AI request timed out, falling back to defaults');
    }
    
    // Default responses (fallback)
    if (lower.includes('?')) return "Let me check and get back to you!";
    if (lower.includes('hi') || lower.includes('hey') || lower.includes('hello')) return "Hey! Whats up?";
    if (lower.includes('how are') || lower.includes('whats up')) return "I am good, thanks! How about you?";
    if (lower.includes('thanks') || lower.includes('thank you')) return "You are welcome!";
    if (lower.includes('bye') || lower.includes('later')) return "Talk to you later!";
    
    return null;
  }
  
  // Try to click an element properly
  function clickElement(el) {
    // CRITICAL: Ensure window has focus first (Snapchat detects this)
    // Focus the window to show user presence
    window.focus();

    // Focus the document body to ensure clicks register
    if (document.body) {
      document.body.focus();
    }

    // Focus the element itself if possible
    if (el.focus) {
      el.focus();
    }

    // Try multiple click methods

    // Method 1: Direct click
    el.click();

    // Method 2: Dispatch mouse events (more realistic to Snapchat)
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Dispatch full mouse event sequence with proper focus
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: centerX, clientY: centerY }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: centerX, clientY: centerY }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: centerX, clientY: centerY }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: centerX, clientY: centerY }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: centerX, clientY: centerY }));

    // Method 3: Try clicking a child button or link if exists
    const clickable = el.querySelector('button, a, [role="button"]');
    if (clickable) {
      clickable.click();
    }
  }
  
  // Check if an element is positioned on the right side (outgoing message)
  function isOutgoingMessage(el) {
    // Check class names for outgoing indicators
    const classChain = (el.className || '') + ' ' + (el.parentElement?.className || '') + ' ' + (el.parentElement?.parentElement?.className || '');
    const classLower = classChain.toLowerCase();
    
    if (classLower.includes('sent') || classLower.includes('outgoing') || 
        classLower.includes('self') || classLower.includes('right') ||
        classLower.includes('me') || classLower.includes('own')) {
      return true;
    }
    
    // Check computed style for right-alignment
    const style = window.getComputedStyle(el);
    const parentStyle = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
    
    if (style.textAlign === 'right' || style.marginLeft === 'auto' ||
        (parentStyle && (parentStyle.justifyContent === 'flex-end' || parentStyle.alignItems === 'flex-end'))) {
      return true;
    }
    
    // Check position - if element is on right half of container, likely outgoing
    const rect = el.getBoundingClientRect();
    const containerWidth = el.parentElement?.getBoundingClientRect().width || window.innerWidth;
    if (rect.left > containerWidth * 0.5) {
      return true;
    }
    
    return false;
  }

  // Get all text content from the main chat area
  function getAllChatText() {
    // Find the main content area (usually right side of screen)
    const mainArea = document.querySelector('main, [role="main"], [class*="main"], [class*="content"], [class*="chat"]');
    
    // Get all text elements - prefer leaf nodes to avoid concatenated text
    const textElements = [];
    const seen = new Set();
    const selector = 'p, span, div';
    const elements = mainArea ? mainArea.querySelectorAll(selector) : document.querySelectorAll(selector);
    
    elements.forEach(el => {
      // Skip if this element has child elements with text (to avoid duplicates)
      const hasTextChildren = Array.from(el.children).some(child => 
        child.textContent && child.textContent.trim().length > 0
      );
      if (hasTextChildren) return;
      
      const text = el.textContent?.trim();
      if (text && text.length > 2 && text.length < 300 && !seen.has(text)) {
        // Skip if it's a timestamp or UI element
        if (!/^\d{1,2}:\d{2}/.test(text) && !/^(Send|Type|Message|Chat)/.test(text)) {
          // Skip status text
          if (!isStatusText(text)) {
            seen.add(text);
            const isOutgoing = isOutgoingMessage(el) || sentMessages.has(text.toLowerCase().trim());
            textElements.push({ text, element: el, isOutgoing });
          }
        }
      }
    });
    
    return textElements;
  }
  
  // Clean username by removing status indicators
  // Extract username from chat row element
  // SNAPCHAT USES: .mYSR9 > .FiLwP > .nonIntl (deeply nested!)
  function getUsernameFromChatRow(chatRow) {
    // Try nested path first (most accurate)
    const nestedSpan = chatRow.querySelector('.mYSR9 .FiLwP .nonIntl');
    if (nestedSpan) {
      return nestedSpan.textContent.trim();
    }

    // Fallback to .mYSR9 directly
    const usernameSpan = chatRow.querySelector('.mYSR9');
    if (usernameSpan) {
      return usernameSpan.textContent.trim();
    }

    return null;
  }

  // Legacy function - keep for compatibility but use getUsernameFromChatRow instead
  function cleanUsername(rawText) {
    // Status words that get appended to usernames in Snapchat
    const statusPatterns = [
      /Typing\.{0,3}$/i,
      /Delivered$/i,
      /Opened$/i,
      /Received$/i,
      /Sent$/i,
      /Viewed$/i,
      /New Chat$/i,
      /New Snap$/i,
      /\d+[smhd]\s*(ago)?$/i,  // "2m ago", "5h"
      /\d+:\d+\s*(AM|PM)?$/i,  // timestamps
      /Just now$/i,
      /Today$/i,
      /Yesterday$/i
    ];

    let cleaned = rawText.split(/[·\n]/)[0].trim();

    // Remove status suffixes
    for (const pattern of statusPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }

    return cleaned;
  }

  function findChatRowByUsername(username) {
    if (!username) return null;
    const target = username.trim().toLowerCase();
    const chats = findClickableChats();
    for (const row of chats) {
      const rowUsername = getUsernameFromChatRow(row);
      if (rowUsername && rowUsername.trim().toLowerCase() === target) {
        return row;
      }
    }
    return null;
  }

  async function refocusCurrentChat(username) {
    const row = findChatRowByUsername(username);
    if (!row) {
      log('Could not re-focus current chat row for: ' + username);
      return false;
    }
    clickElement(row);
    await sleep(200);
    log('Re-focused current chat: ' + username);
    return true;
  }
  
  // Process a chat
  async function processChat(chatEl, chatText) {
    // Extract username directly from .mYSR9 span (exact selector)
    const username = getUsernameFromChatRow(chatEl);

    if (!username) {
      // Fallback to old method if .mYSR9 not found
      log('WARNING: .mYSR9 not found, falling back to text parsing');
      const fallbackUsername = cleanUsername(chatText);
      if (!fallbackUsername || fallbackUsername.length < 2) {
        log('Invalid username, skipping');
        return;
      }
      log('Opening chat with (fallback): ' + fallbackUsername);
      // Continue with fallback username
      return processChat_internal(chatEl, fallbackUsername);
    }

    log('Opening chat with: ' + username);

    // Skip if username is empty or too short
    if (username.length < 2) {
      log('Invalid username, skipping');
      return;
    }

    return processChat_internal(chatEl, username);
  }

  // Track which chat we're currently monitoring
  let currentMonitoredChat = {
    username: null,
    lastMessageId: null,
    checkInterval: null
  };

  // Hard lock to prevent hopping to other conversations while processing one.
  let conversationLock = {
    active: false,
    username: null
  };

  function lockConversation(username) {
    if (!username) return;
    conversationLock.active = true;
    conversationLock.username = username;
    log('Conversation lock ON: ' + username);
  }

  function unlockConversation(reason) {
    if (!conversationLock.active) return;
    log('Conversation lock OFF (' + reason + '): ' + (conversationLock.username || 'unknown'));
    conversationLock.active = false;
    conversationLock.username = null;
  }

  // Internal chat processing (separated to avoid duplication)
  async function processChat_internal(chatEl, username) {
    lockConversation(username);

    // Load and display memory for this user
    const memory = getUserMemory(username);
    if (memory.messages.length > 0) {
      const summary = getMemorySummary(username);
      log('MEMORY: ' + summary.total + ' previous messages with ' + username);
      log('Recent: ' + summary.recent);
    } else {
      log('No previous memory for ' + username);
    }

    // Try clicking
    clickElement(chatEl);
    log('Clicked chat: ' + username);

    // Wait briefly for conversation DOM swap, then scroll to hydrate messages.
    log('Waiting for chat to load and messages to populate...');
    await sleep(900);

    // CRITICAL: Click into the input field to ensure Snapchat detects user presence
    // This prevents the "doesn't seem to be present" detection
    try {
      const inputField = document.querySelector('[contenteditable="true"], textarea, input[type="text"]');
      if (inputField) {
        window.focus(); // Ensure window has focus
        inputField.focus(); // Focus the input field
        inputField.click(); // Click it for good measure
        log('Focused into input field to show presence');
      } else {
        log('Warning: Could not find input field to focus');
      }
    } catch (e) {
      log('Error focusing input field: ' + e.message);
    }

    await sleep(150); // Brief pause after focusing

    // Force scroll to bottom MULTIPLE times with waits to trigger lazy loading
    await scrollToLatestMessages();

    log('Finished scrolling, messages should be loaded now');

    // Process the initial messages
    const processingOutcome = await processCurrentChatMessages(username);
    if (processingOutcome === 'sent' || processingOutcome === 'no_new') {
      unlockConversation(processingOutcome);
    }

    // Start monitoring this chat for new messages
    startChatMonitoring(username);
  }

  // Helper function to scroll to latest messages
  async function scrollToLatestMessages() {
    for (let scrollAttempt = 0; scrollAttempt < 2; scrollAttempt++) {
      try {
        // Find ALL ul.ujRzj and scroll the LARGEST one (most likely to be active)
        const allLists = document.querySelectorAll('ul.ujRzj');
        log('Scroll attempt ' + (scrollAttempt + 1) + ': found ' + allLists.length + ' ul.ujRzj elements');

        let largestList = null;
        let maxHeight = 0;

        for (const list of allLists) {
          const rect = list.getBoundingClientRect();
          if (rect.height > maxHeight && rect.width > 0) {
            maxHeight = rect.height;
            largestList = list;
          }
        }

        if (largestList) {
          log('  Scrolling largest list (height=' + maxHeight.toFixed(0) + 'px)');

          // Scroll to bottom
          largestList.scrollTop = largestList.scrollHeight;

          // Also try to find and scroll the parent container
          const messageContainer = largestList.closest('[role="main"]') ||
                                  largestList.closest('.chat-container') ||
                                  largestList.parentElement;
          if (messageContainer && messageContainer.scrollTo) {
            messageContainer.scrollTop = messageContainer.scrollHeight;
          }

          // Short settle; we want quick reaction while still allowing lazy content to render.
          await sleep(350);
        } else {
          log('  No visible list found (all have height=0)');
        }
      } catch(e) {
        log('Scroll attempt ' + (scrollAttempt + 1) + ' FAILED: ' + e);
      }
    }
  }

  // Process messages in the currently open chat
  async function processCurrentChatMessages(username) {
    // Get messages using multiple methods
    // Pass expected username to verify we're not reading stale cache
    let messages = getVisibleMessages(username);
    log('Method 1 found ' + messages.length + ' messages');

    // If no messages found, try getting all text
    if (messages.length === 0) {
      const allText = getAllChatText();
      log('Method 2 found ' + allText.length + ' text elements');

      // Convert to messages format, using proper outgoing detection
      messages = allText
        .filter(t => !isStatusText(t.text))
        .map(t => ({
          text: t.text,
          isIncoming: !t.isOutgoing && !sentMessages.has(t.text.toLowerCase().trim())
        }));
    }

    log('Total messages: ' + messages.length);

    if (messages.length === 0) {
      log('No messages found - DOM may not have loaded yet');
      return 'no_new';
    }

    // CRITICAL CHECK: If ALL messages are from us, the DOM is stale/cached
    const incomingCount = messages.filter(m => m.isIncoming).length;
    const outgoingCount = messages.filter(m => !m.isIncoming).length;
    log('Message breakdown: ' + incomingCount + ' incoming, ' + outgoingCount + ' outgoing');

    if (incomingCount === 0 && outgoingCount > 0) {
      log('WARNING: All messages are from us - DOM is showing stale/cached data!');
      log('Chat was marked as "New Chat" or "Received" but we only see our own messages.');
      log('Possible causes: 1) DOM not fully loaded, 2) Message was deleted, 3) False unread indicator');
      return 'no_new';
    }

    // Build the latest contiguous incoming batch from the end of the chat.
    // This captures rapid multi-message sends (e.g. 3 quick messages).
    const latestIncomingBatch = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isIncoming) {
        latestIncomingBatch.push(messages[i].text);
      } else if (latestIncomingBatch.length > 0) {
        break;
      } else {
        // Last message is outgoing; nothing new to process.
        break;
      }
    }
    latestIncomingBatch.reverse();

    if (latestIncomingBatch.length === 0) {
      log('No incoming message batch found');
      return 'no_new';
    }

    const latestIncomingText = latestIncomingBatch.join('\n');
    const normalizedIncoming = latestIncomingBatch.map(m => m.toLowerCase().trim()).join(' || ');

    // Skip if this is actually a message we sent
    if (sentMessages.has(normalizedIncoming)) {
      log('Skipping - this is our own message');
      return 'no_new';
    }

    log('Incoming batch (' + latestIncomingBatch.length + '): ' + latestIncomingText.substring(0, 80));

    // Check if this is the same message we last replied to for this user
    const lastReplied = lastRepliedMessage.get(username);
    if (lastReplied && lastReplied === normalizedIncoming) {
      log('Already replied to this exact message from ' + username + ': "' + lastReplied.substring(0, 30) + '"');
      return 'no_new';
    }

    // Log what we last replied to for debugging
    if (lastReplied) {
      log('Last replied message from ' + username + ' was: "' + lastReplied.substring(0, 30) + '"');
      log('Current message: "' + normalizedIncoming.substring(0, 30) + '" - NEW, will process');
    } else {
      log('First message from ' + username + ', will process');
    }

    // Find reply (now async with AI support)
    const reply = await findReply(latestIncomingText, username);
    if (!reply) {
      log('No matching reply');
      // Still mark as replied so we don't keep trying to reply to a message with no match
      lastRepliedMessage.set(username, normalizedIncoming);
      return 'handled';
    }

    // Random skip
    if (Math.random() < (CONFIG.randomSkipProbability || 0.15)) {
      log('Random skip');
      // Mark as replied so we don't process again
      lastRepliedMessage.set(username, normalizedIncoming);
      return 'handled';
    }
    
    // Start typing immediately after reply generation.
    log('AI reply ready, typing now');
    
    // Type and send
    const typed = await typeMessage(reply);
    if (!typed) return 'handled';
    
    await sleep(500);
    const sent = await sendMessage();
    
    if (sent) {
      log('SUCCESS: Sent reply: ' + reply);

      // Track this as the last message we replied to for this user
      lastRepliedMessage.set(username, normalizedIncoming);
      log('Saved last replied message for ' + username + ': "' + normalizedIncoming.substring(0, 30) + '"');

      // Track this message as sent by us (to avoid replying to ourselves)
      sentMessages.add(reply.toLowerCase().trim());

      // Save their message to memory (username already cleaned above)
      latestIncomingBatch.forEach(msg => addToMemory(username, msg, true));

      // Save our reply to memory
      addToMemory(username, reply, false);

      // Log memory summary
      const summary = getMemorySummary(username);
      log('Memory for ' + username + ': ' + summary.total + ' msgs (' + summary.fromThem + ' from them, ' + summary.fromMe + ' from me)');

      // Keep the bot anchored in this conversation instead of jumping to another chat.
      await refocusCurrentChat(username);
      return 'sent';
    }
    return 'handled';
  }

  // Start monitoring the currently open chat for new messages
  function startChatMonitoring(username) {
    // Clear any existing monitor
    if (currentMonitoredChat.checkInterval) {
      clearInterval(currentMonitoredChat.checkInterval);
      log('Stopped monitoring previous chat: ' + currentMonitoredChat.username);
    }

    log('Starting to monitor chat: ' + username);
    currentMonitoredChat.username = username;
    currentMonitoredChat.lastMessageId = null;

    // Check for new messages frequently while staying in the current chat.
    const monitorIntervalMs = CONFIG.chatMonitorIntervalMs || 1000;
    currentMonitoredChat.checkInterval = setInterval(async () => {
      if (!window.__SNAPPY_RUNNING__) {
        clearInterval(currentMonitoredChat.checkInterval);
        return;
      }

      try {
        // Re-scan the DOM for messages
        let messages = getVisibleMessages(username);

        if (messages.length === 0) {
          return;
        }

        // Build the latest contiguous incoming batch for change detection.
        const latestIncomingBatch = [];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].isIncoming) {
            latestIncomingBatch.push(messages[i].text);
          } else if (latestIncomingBatch.length > 0) {
            break;
          } else {
            break;
          }
        }
        latestIncomingBatch.reverse();

        if (latestIncomingBatch.length === 0) {
          return;
        }

        // Create a unique ID for this incoming batch.
        const msgId = username + '::' + latestIncomingBatch.map(m => m.toLowerCase().trim()).join(' || ');

        // Check if this is a NEW message we haven't seen before
        if (currentMonitoredChat.lastMessageId === null) {
          // First check - just record the message ID
          currentMonitoredChat.lastMessageId = msgId;
          log('[Monitor] Initial batch recorded (' + latestIncomingBatch.length + ')');
        } else if (currentMonitoredChat.lastMessageId !== msgId) {
          // NEW MESSAGE DETECTED!
          log('[Monitor] NEW MESSAGE DETECTED!');
          currentMonitoredChat.lastMessageId = msgId;

          // Scroll to see the latest
          await scrollToLatestMessages();

          // Short settle before parsing message nodes
          await sleep(150);

          // Process the new message
          await processCurrentChatMessages(username);
        }
      } catch (e) {
        log('[Monitor] Error checking for new messages: ' + e);
      }
    }, monitorIntervalMs);
  }

  // Stop monitoring when we leave the chat
  function stopChatMonitoring() {
    if (currentMonitoredChat.checkInterval) {
      clearInterval(currentMonitoredChat.checkInterval);
      log('Stopped monitoring chat: ' + currentMonitoredChat.username);
      currentMonitoredChat.username = null;
      currentMonitoredChat.lastMessageId = null;
      currentMonitoredChat.checkInterval = null;
    }
  }

  // Main poll function
  let pollCount = 0;
  async function poll() {
    if (!window.__SNAPPY_RUNNING__) return;

    // Check if already processing - if so, skip this poll cycle
    if (isProcessing) {
      log('Already processing, skipping this poll cycle');
      return;
    }

    if (conversationLock.active && conversationLock.username) {
      const lockedChat = findChatRowByUsername(conversationLock.username);
      if (!lockedChat) {
        log('Conversation lock active but row not found for: ' + conversationLock.username);
        return;
      }

      isProcessing = true;
      try {
        const chatText = lockedChat.textContent?.trim().substring(0, 50) || 'Unknown';
        await processChat(lockedChat, chatText);
      } finally {
        isProcessing = false;
        log('Finished locked conversation poll cycle');
      }
      return;
    }

    pollCount++;
    log('--- Poll #' + pollCount + ' ---');
    
    const chats = findClickableChats();
    log('Found ' + chats.length + ' chat items');

    // Debug first 5 chats on every poll (to see what we're detecting)
    if (chats.length > 0) {
      log('Showing first ' + Math.min(5, chats.length) + ' chats:');
      for (let i = 0; i < Math.min(5, chats.length); i++) {
        debugChatElement(chats[i], i);
      }
    }

    // Find chats with unread
    const unreadChats = [];
    for (const chat of chats) {
      if (isNewIncomingChat(chat)) {
        unreadChats.push(chat);
      }
    }

    log('Unread chats: ' + unreadChats.length);

    // Only process chats with actual unread indicators
    if (unreadChats.length === 0) {
      log('No unread messages to process');
      return;
    }

    // Prefer staying in the currently monitored conversation if it still exists.
    let chat = unreadChats[0];
    let username = getUsernameFromChatRow(chat);
    if (currentMonitoredChat.username) {
      const currentUsername = currentMonitoredChat.username;
      const matchingUnread = unreadChats.find(c => {
        const name = getUsernameFromChatRow(c);
        return name && name.trim().toLowerCase() === currentUsername.trim().toLowerCase();
      });
      const matchingAny = matchingUnread || findChatRowByUsername(currentUsername);
      if (matchingAny) {
        chat = matchingAny;
        username = getUsernameFromChatRow(chat);
        log('Keeping focus on current chat: ' + currentUsername);
      }
    }

    if (currentMonitoredChat.username && username !== currentMonitoredChat.username) {
      log('New unread chat from different user, switching from ' + currentMonitoredChat.username + ' to ' + username);
      stopChatMonitoring();
    }

    // Process first unread chat (set lock to prevent concurrent processing)
    isProcessing = true;
    try {
      const chatText = chat.textContent?.trim().substring(0, 50) || 'Unknown';
      await processChat(chat, chatText);
    } finally {
      isProcessing = false;
      log('Finished processing, ready for next poll');
    }
  }
  
  // Start
  log('Bot started!');
  log('Rules: ' + (CONFIG.replyRules?.length || 0));
  
  // Initial scan after short delay
  setTimeout(scanPage, 1500);
  
  // Start polling after brief delay
  setTimeout(() => {
    log('Starting message polling...');
    poll();
    pollInterval = setInterval(poll, 5000);
  }, 2000);
  
  // Stop function
  window.__SNAPPY_STOP__ = function() {
    window.__SNAPPY_RUNNING__ = false;
    if (pollInterval) clearInterval(pollInterval);
    log('Bot stopped');
  };
})();
