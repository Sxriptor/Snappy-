Proposed Plan


  # Discord Control Bot Integration for Snappy  
  (Local, In-Process)

  ## Summary

  Implement a local Discord bot inside
  Snappy’s Electron main process that listens   
  for mentions in guild channels, authorizes    
  via a trusted Discord user ID allowlist,      
  routes deterministic commands to Snappy’s     
  existing session manager/control paths, and   
  replies with compact summaries.

  Add a new bottom item in the left sidebar     
  (under sessions) that opens a dedicated       
  Discord settings pane to manage:              
                                                
  - Bot token                                   
  - Enabled/disabled auto-start flag            
  - Multiple trusted Discord user IDs           
    (editable list)                             
                                                
  Startup behavior: auto-start only when        
  enabled.                                      
                                                
  ———                                           
                                                
  ## Scope and Decisions Locked                 
                                                
  - Runtime: single local process, no external  
    API/service layer.                          
  - Message ingestion: Discord gateway via      
    discord.js.                                 
  - Command scope: mention-based commands in    
    guilds only.                                
  - Authorization: trusted IDs only (hard deny  
    for others).                                
  - Parser: deterministic command grammar only  
    (no LLM in v1).                             
  - Command set v1: read-only + safe controls.  
  - Reply style: compact summaries.             
  - UI placement: new left-sidebar bottom       
    Settings entry and dedicated Discord pane.  
                                                
  ———                                           
                                                
  ## Architecture                               
                                                
  ### 1. New Discord Service Layer (Main        
  Process)                                      
                                                
  Create a dedicated module (for example src/   
  main/discordBotManager.ts) responsible for:   
                                                
  - Bootstrapping discord.js client             
  - Connect/disconnect lifecycle                
  - Mention detection and command parsing       
  - Authorization checks                        
  - Command execution against existing Snappy   
    session/bot/server control functions        
  - Structured result formatting                
  - Emitting status events to renderer via IPC  
                                                
  ### 2. Command Router                         
                                                
  Inside discordBotManager, split:              
                                                
  - parseMentionCommand(rawMessage, botId) ->   
    ParsedCommand | ParseError                  
  - executeCommand(parsed) -> CommandResult     
  - formatReply(result) -> string               
                                                
  Keep parser deterministic and explicit:       
                                                
  - Primary shape: @snappy <verb> [args]        
  - Normalize whitespace/case                   
  - Ignore bot authored messages                
  - Ignore non-mentions and non-guild messages  
                                                
  ### 3. Snappy Bridge                          
                                                
  Execution layer should call existing in-      
  process controls:                             
                                                
  - Session list/status via session manager     
    (getAllSessions, filtered by active/bot     
    status)                                     
  - Session start/stop actions by invoking      
    existing control pathways used by           
    renderer/main (not duplicate logic)         
  - Platform targeting resolution from session  
    config/site URL/name (instagram, snapchat,  
    threads, reddit)                            
                                                
  ### 4. Renderer Integration                   
                                                
  Add left-sidebar bottom Settings button and   
  Discord settings pane:                        
                                                
  - Token input (masked)                        
  - Enabled toggle                              
  - Trusted IDs editable list (add/remove,      
    comma/newline tolerant input)               
  - Connection status indicator (offline,       
    connecting, online, error)                  
  - Test/reconnect button (optional v1.1; keep  
    hook ready)                                 
  - Persist settings through new IPC endpoints  
    (main-owned source of truth)                
                                                
  ———                                           
                                                
  ## Public Interfaces / Types to Add           
                                                
  ### Config                                    
                                                
  Extend global configuration type (in src/     
  types.ts) with:                               
                                                
  - discordBot?: {                              
      - enabled: boolean                        
      - token: string                           
      - trustedUserIds: string[]                
      - allowedGuildIds?: string[] (optional,   
        keep reserved for v1.1)                 
  - }                                           
                                                
  Defaults:                                     
                                                
  - enabled: false                              
  - token: ''                                   
  - trustedUserIds: []                          
                                                
  ### Main IPC                                  
                                                
  Add IPC handlers in src/main/main.ts +        
  preload bridge in src/preload/preload.ts:     
                                                
  - discordBot:getConfig -> { enabled,          
    tokenMasked, trustedUserIds }               
  - discordBot:saveConfig(payload) ->           
    { success, error? }                         
  - discordBot:getStatus -> { state, botTag?,   
    guildCount?, error? }                       
  - discordBot:start -> { success, error? }     
  - discordBot:stop -> { success, error? }      
                                                
  Notes:                                        
                                                
  - Never return raw token in read APIs;        
    renderer sees masked token placeholder.     
  - Save path uses existing user config         
    persistence pattern.                        
                                                
  ### Internal Types                            
                                                
  - DiscordBotState = 'offline' | 'connecting'  
    | 'online' | 'error'                        
  - ParsedCommand union:                        
      - help                                    
      - list                                    
      - status                                  
      - start { target }                        
      - stop { target }                         
  - CommandTarget:                              
      - all                                     
      - platform:<platform>                     
      - session:<sessionRef> (id/name/index     
        alias resolution)                       
                                                
  ———                                           
                                                
  ## Command Spec (v1)                          
                                                
  ### Accepted                                  
                                                
  - @snappy help                                
  - @snappy list                                
  - @snappy status                              
  - @snappy start all                           
  - @snappy stop all                            
  - @snappy start platform instagram            
  - @snappy stop platform threads               
  - @snappy start session <id|name|index>       
  - @snappy stop session <id|name|index>        
                                                
  ### Rejected / Not in v1                      
                                                
  - pause/resume/restart/duration commands      
  - free-form natural language intents          
  - DMs/private channel commands                
                                                
  ### Authorization                             
                                                
  - If author ID not in trusted list: ignore    
    silently (or optionally short deny          
    reaction; default silent).                  
  - Trusted list empty: deny all command        
    execution (explicit safe default).          
                                                
  ———                                           
                                                
  ## UI/UX Plan (Left Sidebar Settings)         
                                                
  ### Layout                                    
                                                
  - Keep top + session button.                  
  - Keep existing bottom update button.         
  - Add new bottom settings button in same      
    bottom cluster.                             
  - Clicking opens a dedicated Discord          
    settings panel/view.                        
                                                
  ### Pane Contents                             
                                                
  - Enabled toggle (auto-start on app launch    
    when true)                                  
  - Token field (password type, save/clear)     
  - Trusted IDs list editor:                    
      - Add row input                           
      - Remove row control                      
      - Validation: numeric Discord snowflake   
        shape                                   
  - Status line:                                
      - Current bot state + tag + last error    
  - Action buttons:                             
      - Save                                    
      - Start/Stop (manual override)            
                                                
  ### Validation                                
                                                
  - Token required if enabling.                 
  - Trusted IDs required for command execution  
    warning (but config can still save).        
                                                
  ———                                           
                                                
  ## Lifecycle and Startup                      
                                                
  - On app start:                               
      - load config                             
      - if enabled=true and token exists ->     
        discordBotManager.start()               
  - On token/config change:                     
      - if running, restart bot gracefully      
        with new settings                       
  - On app exit:                                
      - disconnect Discord client cleanly       
                                                
  ———                                           
                                                
  ## Error Handling / Safety                    
                                                
  - Rate-limit outbound replies per command     
    context (basic guard).                      
  - Catch gateway disconnects and update        
    renderer status.                            
  - Parser errors return compact help hint.     
  - Target resolution ambiguity (multiple       
    sessions match): reply with disambiguation  
    list.                                       
  - Command execution failures return compact   
    error, no stack traces.                     
                                                
  ———                                           
                                                
  ## Test Plan                                  
                                                
  ### Unit Tests                                
                                                
  1. Parser                                     
                                                
  - mention stripping variations (<@id>, <@!    
    id>)                                        
  - valid/invalid command grammar               
  - argument normalization                      
                                                
  2. Authorization                              
                                                
  - trusted ID allowed                          
  - untrusted denied                            
  - empty allowlist denied                      
                                                
  3. Target resolution                          
                                                
  - platform mapping from session metadata      
  - session by id/name/index                    
  - ambiguous and not-found paths               
                                                
  4. Formatter                                  
                                                
  - compact list/status response shape          
  - error/help responses                        
                                                
  ### Integration Tests (Main + Mock Discord    
  Client)                                       
                                                
  1. Startup with enabled/disabled settings     
  2. Runtime config update triggers restart     
  3. messageCreate mention from trusted user    
     executes command                           
  4. untrusted user ignored                     
  5. start/stop command bridges into Snappy     
     control layer and reports result           
  6. disconnect/reconnect updates status event  
     stream                                     
                                                
  ### Renderer/UI Tests                         
                                                
  1. Sidebar settings button present at bottom  
     and opens pane                             
  2. Save token/trusted IDs persists across     
     restart                                    
  3. Status updates render (online/error/       
     offline)                                   
  4. Manual start/stop buttons call IPC and     
     refresh status                             
                                                
  ———   