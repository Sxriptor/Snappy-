/**
 * Llama.cpp Server Manager
 * 
 * Manages starting and stopping the llama.cpp AI server process.
 * Handles process lifecycle, error handling, and status tracking.
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { LlamaServerConfig, LlamaServerStatus } from '../types';

export class LlamaServerManager {
  private processes: Map<number, { process: ChildProcess; startTime: number; cmdPid?: number }> = new Map();
  private cmdPids: Set<number> = new Set(); // Track CMD window PIDs separately
  private config: LlamaServerConfig | null = null;
  private statusCallback: ((status: LlamaServerStatus) => void) | null = null;

  /**
   * Set configuration for the server
   */
  setConfig(config: LlamaServerConfig): void {
    this.config = config;
    console.log('[LlamaServerManager] Configuration updated:', {
      buildPath: config.buildPath,
      startCommand: config.startCommand,
      enabled: config.enabled
    });
  }

  /**
   * Register callback for status updates
   */
  onStatusChange(callback: (status: LlamaServerStatus) => void): void {
    this.statusCallback = callback;
  }

  /**
   * Clear all tracking (call on app startup to reset stale state)
   */
  clearTracking(): void {
    console.log('[LlamaServerManager] Clearing all tracked PIDs');
    this.cmdPids.clear();
    this.processes.clear();
  }

  /**
   * Start the llama.cpp server
   */
  async start(): Promise<LlamaServerStatus> {
    if (!this.config) {
      return {
        running: false,
        error: 'Server not configured'
      };
    }

    // Allow multiple CMD windows - don't check if process already exists
    // Each start request will open a new CMD window

    try {
      const { buildPath, startCommand } = this.config;

      // Validate paths
      if (!buildPath || !startCommand) {
        throw new Error('Build path and start command are required');
      }

      console.log('[LlamaServerManager] Starting server...');
      console.log('[LlamaServerManager] Working directory:', buildPath);
      console.log('[LlamaServerManager] Command:', startCommand);

      // On Windows, spawn a visible command prompt and run the command
      if (process.platform === 'win32') {
        console.log('[LlamaServerManager] Running exact command:', startCommand);
        
        // Parse and clean the command first
        const args = this.parseCommand(startCommand);
        const executable = args.shift();
        
        if (!executable) {
          throw new Error('Invalid start command');
        }
        
        // Create the cleaned command string
        const cleanedCommand = [executable, ...args].join(' ');
        console.log('[LlamaServerManager] Cleaned command for cmd:', cleanedCommand);
        
        const startTime = Date.now();
        
        // Use PowerShell to start CMD and capture its PID
        const psScript = `
          $process = Start-Process cmd.exe -ArgumentList '/k ${cleanedCommand.replace(/'/g, "''")}' -WorkingDirectory '${buildPath.replace(/'/g, "''")}' -PassThru
          Write-Output $process.Id
        `;
        
        // Wait for PowerShell to return the CMD PID
        const cmdPid = await new Promise<number | null>((resolve) => {
          const newProcess = spawn('powershell.exe', ['-Command', psScript], {
            cwd: buildPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false
          });
          
          let capturedPid: number | null = null;
          
          newProcess.stdout?.on('data', (data) => {
            const output = data.toString().trim();
            const pid = parseInt(output, 10);
            if (!isNaN(pid)) {
              capturedPid = pid;
              console.log(`[LlamaServerManager] Captured CMD PID from PowerShell: ${pid}`);
            }
          });
          
          newProcess.stderr?.on('data', (data) => {
            console.log(`[LlamaServerManager] PowerShell stderr: ${data.toString().trim()}`);
          });
          
          newProcess.on('exit', () => {
            resolve(capturedPid);
          });
          
          newProcess.on('error', (err) => {
            console.error(`[LlamaServerManager] PowerShell error: ${err.message}`);
            resolve(null);
          });
          
          if (newProcess.pid) {
            this.processes.set(newProcess.pid, { process: newProcess, startTime });
          }
        });
        
        if (cmdPid) {
          this.cmdPids.add(cmdPid);
          console.log(`[LlamaServerManager] Added CMD PID ${cmdPid} to tracking set. Total tracked: ${this.cmdPids.size}`);
          
          // Return early with the CMD PID for Windows
          const status: LlamaServerStatus = {
            running: true,
            pid: cmdPid,  // Return the CMD PID, not the PowerShell launcher PID
            startTime
          };
          this.notifyStatus(status);
          console.log('[LlamaServerManager] Server started successfully, CMD PID:', cmdPid);
          return status;
        } else {
          console.error('[LlamaServerManager] Failed to capture CMD PID!');
          throw new Error('Failed to capture CMD process ID');
        }
      } else {
        // Parse the command for non-Windows platforms
        const args = this.parseCommand(startCommand);
        const executable = args.shift();

        if (!executable) {
          throw new Error('Invalid start command');
        }

        const newProcess = spawn(executable, args, {
          cwd: buildPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
          detached: false
        });
        
        const startTime = Date.now();
        if (newProcess.pid) {
          this.processes.set(newProcess.pid, { process: newProcess, startTime });
        }
      }

      const currentProcess = Array.from(this.processes.values()).pop();
      if (!currentProcess) {
        throw new Error('Failed to create process');
      }

      // Handle stdout
      currentProcess.process.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          console.log(`[LlamaServer:${currentProcess.process.pid}]`, output);
        }
      });

      // Handle stderr
      currentProcess.process.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          console.log(`[LlamaServer:${currentProcess.process.pid}] ERROR:`, output);
        }
      });

      // Handle process exit
      currentProcess.process.on('exit', (code, signal) => {
        const pid = currentProcess.process.pid;
        console.log(`[LlamaServerManager] Process ${pid} exited with code ${code}, signal ${signal}`);
        if (pid) {
          this.processes.delete(pid);
        }
        this.notifyStatus({
          running: this.processes.size > 0,
          error: this.processes.size === 0 ? `Last process exited with code ${code}` : undefined
        });
      });

      // Handle process error
      currentProcess.process.on('error', (err) => {
        const pid = currentProcess.process.pid;
        console.error(`[LlamaServerManager] Process ${pid} error:`, err);
        if (pid) {
          this.processes.delete(pid);
        }
        this.notifyStatus({
          running: this.processes.size > 0,
          error: this.processes.size === 0 ? err.message : undefined
        });
      });

      // Give the process a moment to start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if process is still running
      if (!currentProcess.process || currentProcess.process.killed) {
        throw new Error('Process failed to start');
      }

      const status: LlamaServerStatus = {
        running: true,
        pid: currentProcess.process.pid,
        startTime: currentProcess.startTime
      };

      this.notifyStatus(status);
      console.log('[LlamaServerManager] Server started successfully, PID:', currentProcess.process.pid);
      console.log('[LlamaServerManager] Total running processes:', this.processes.size);
      return status;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[LlamaServerManager] Failed to start server:', errorMsg);

      const status: LlamaServerStatus = {
        running: this.processes.size > 0,
        error: errorMsg
      };

      this.notifyStatus(status);
      return status;
    }
  }

  /**
   * Stop a specific llama.cpp server by its CMD PID
   */
  async stopByPid(pid: number): Promise<LlamaServerStatus> {
    try {
      console.log(`[LlamaServerManager] Stopping server with PID ${pid}...`);
      console.log(`[LlamaServerManager] Currently tracked PIDs: ${Array.from(this.cmdPids).join(', ')}`);

      if (!this.cmdPids.has(pid)) {
        console.log(`[LlamaServerManager] PID ${pid} not found in tracked processes`);
        return { running: this.cmdPids.size > 0, error: `PID ${pid} not tracked` };
      }

      // On Windows, kill the CMD and its child processes (llama-server.exe)
      // /T kills the process tree, /F forces termination
      if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
          console.log(`[LlamaServerManager] Executing: taskkill /F /T /PID ${pid}`);
          exec(`taskkill /F /T /PID ${pid}`, (error, stdout) => {
            if (error) {
              console.log(`[LlamaServerManager] taskkill PID ${pid} error: ${error.message}`);
            } else {
              console.log(`[LlamaServerManager] Successfully killed PID ${pid} and children: ${stdout.trim()}`);
            }
            resolve();
          });
        });
      }

      // Remove from tracking
      this.cmdPids.delete(pid);

      const status: LlamaServerStatus = {
        running: this.cmdPids.size > 0
      };

      this.notifyStatus(status);
      console.log(`[LlamaServerManager] Server PID ${pid} stopped. Remaining tracked: ${Array.from(this.cmdPids).join(', ') || 'none'}`);
      return status;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[LlamaServerManager] Error stopping PID ${pid}:`, errorMsg);
      return { running: this.cmdPids.size > 0, error: errorMsg };
    }
  }

  /**
   * Get all tracked PIDs
   */
  getTrackedPids(): number[] {
    return Array.from(this.cmdPids);
  }

  /**
   * Stop all llama.cpp server processes started by this manager
   * Only kills processes we explicitly tracked - does not affect other sessions
   */
  async stop(): Promise<LlamaServerStatus> {
    try {
      console.log('[LlamaServerManager] Stopping tracked servers only...');
      console.log('[LlamaServerManager] Tracked CMD PIDs:', Array.from(this.cmdPids));

      if (this.cmdPids.size === 0 && this.processes.size === 0) {
        console.log('[LlamaServerManager] No tracked processes to stop');
        return { running: false };
      }

      // On Windows, kill only the tracked PIDs
      if (process.platform === 'win32') {
        // Kill each tracked CMD PID directly using taskkill with /T to kill child processes too
        const killByPidPromises = Array.from(this.cmdPids).map(pid => {
          return new Promise<void>((resolve) => {
            console.log(`[LlamaServerManager] Killing tracked CMD PID ${pid} and its children...`);
            // Use taskkill with /T to kill the process tree (CMD + llama-server)
            exec(`taskkill /F /T /PID ${pid}`, (error, stdout) => {
              if (error) {
                console.log(`[LlamaServerManager] taskkill PID ${pid} error (may already be closed): ${error.message}`);
              } else {
                console.log(`[LlamaServerManager] Successfully killed PID ${pid}: ${stdout.trim()}`);
              }
              resolve();
            });
          });
        });
        
        await Promise.all(killByPidPromises);
        
        // Clear tracked PIDs
        this.cmdPids.clear();
      }

      // Also kill the tracked launcher processes
      const stopPromises = Array.from(this.processes.values()).map(({ process }) => {
        return new Promise<void>((resolve) => {
          if (!process || process.killed) {
            resolve();
            return;
          }

          // Set a timeout for forceful termination
          const killTimeout = setTimeout(() => {
            console.log('[LlamaServerManager] Force killing launcher process', process.pid);
            if (!process.killed) {
              process.kill('SIGKILL');
            }
          }, 2000);

          // Try graceful termination first
          process.once('exit', () => {
            clearTimeout(killTimeout);
            console.log('[LlamaServerManager] Launcher process stopped:', process.pid);
            resolve();
          });

          process.kill('SIGTERM');
        });
      });

      await Promise.all(stopPromises);
      this.processes.clear();

      const status: LlamaServerStatus = {
        running: false
      };

      this.notifyStatus(status);
      console.log('[LlamaServerManager] Tracked servers stopped');
      return status;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[LlamaServerManager] Error stopping servers:', errorMsg);

      this.processes.clear();
      this.cmdPids.clear();

      return {
        running: false,
        error: errorMsg
      };
    }
  }

  /**
   * Get current server status
   * Note: This returns aggregate status. Per-session tracking is done in the renderer.
   */
  getStatus(): LlamaServerStatus {
    // On Windows, we track CMD PIDs
    if (this.cmdPids.size > 0) {
      return {
        running: true
      };
    }

    // For non-Windows or fallback
    if (this.processes.size === 0) {
      return {
        running: false
      };
    }

    const latestProcess = Array.from(this.processes.values()).pop();
    if (!latestProcess) {
      return {
        running: false
      };
    }

    return {
      running: !latestProcess.process.killed,
      pid: latestProcess.process.pid,
      startTime: latestProcess.startTime
    };
  }

  /**
   * Parse command string into executable and arguments
   * Handles quoted arguments and Windows batch file syntax (^ line continuations)
   */
  private parseCommand(command: string): string[] {
    // Handle Windows batch file line continuations (^)
    // Replace ^ followed by any whitespace (including newlines) with a single space
    const cleanCommand = command
      .replace(/\^\s*\r?\n\s*/g, ' ')  // Handle ^ with newlines
      .replace(/\^\s+/g, ' ')          // Handle ^ with spaces
      .replace(/\s+/g, ' ')            // Normalize multiple spaces
      .trim();
    
    console.log('[LlamaServerManager] Cleaned command:', cleanCommand);
    
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < cleanCommand.length; i++) {
      const char = cleanCommand[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    console.log('[LlamaServerManager] Parsed args:', args);
    return args;
  }

  /**
   * Notify status change
   */
  private notifyStatus(status: LlamaServerStatus): void {
    if (this.statusCallback) {
      this.statusCallback(status);
    }
  }

  /**
   * Cleanup on shutdown
   */
  async cleanup(): Promise<void> {
    if (this.processes.size > 0) {
      await this.stop();
    }
  }
}

// Export singleton instance
export const llamaServerManager = new LlamaServerManager();
