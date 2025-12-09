/**
 * Llama.cpp Server Manager
 * 
 * Manages starting and stopping the llama.cpp AI server process.
 * Handles process lifecycle, error handling, and status tracking.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { LlamaServerConfig, LlamaServerStatus } from '../types';

export class LlamaServerManager {
  private process: ChildProcess | null = null;
  private config: LlamaServerConfig | null = null;
  private startTime: number | null = null;
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
   * Start the llama.cpp server
   */
  async start(): Promise<LlamaServerStatus> {
    if (!this.config) {
      return {
        running: false,
        error: 'Server not configured'
      };
    }

    if (this.process) {
      return {
        running: true,
        pid: this.process.pid,
        startTime: this.startTime || undefined
      };
    }

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
        
        // Use start command to open a new visible command prompt window
        this.process = spawn('cmd.exe', ['/c', `start "Llama Server" /wait cmd.exe /k "${cleanedCommand}"`], {
          cwd: buildPath,
          stdio: 'ignore',
          shell: true,
          detached: false
        });
      } else {
        // Parse the command for non-Windows platforms
        const args = this.parseCommand(startCommand);
        const executable = args.shift();

        if (!executable) {
          throw new Error('Invalid start command');
        }

        this.process = spawn(executable, args, {
          cwd: buildPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
          detached: false
        });
      }

      this.startTime = Date.now();

      // Handle stdout
      this.process.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          console.log('[LlamaServer]', output);
        }
      });

      // Handle stderr
      this.process.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          console.log('[LlamaServer] ERROR:', output);
        }
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[LlamaServerManager] Process exited with code ${code}, signal ${signal}`);
        this.process = null;
        this.startTime = null;
        this.notifyStatus({
          running: false,
          error: `Process exited with code ${code}`
        });
      });

      // Handle process error
      this.process.on('error', (err) => {
        console.error('[LlamaServerManager] Process error:', err);
        this.process = null;
        this.startTime = null;
        this.notifyStatus({
          running: false,
          error: err.message
        });
      });

      // Give the process a moment to start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if process is still running
      if (!this.process || this.process.killed) {
        throw new Error('Process failed to start');
      }

      const status: LlamaServerStatus = {
        running: true,
        pid: this.process.pid,
        startTime: this.startTime
      };

      this.notifyStatus(status);
      console.log('[LlamaServerManager] Server started successfully, PID:', this.process.pid);
      return status;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[LlamaServerManager] Failed to start server:', errorMsg);

      this.process = null;
      this.startTime = null;

      const status: LlamaServerStatus = {
        running: false,
        error: errorMsg
      };

      this.notifyStatus(status);
      return status;
    }
  }

  /**
   * Stop the llama.cpp server
   */
  async stop(): Promise<LlamaServerStatus> {
    if (!this.process) {
      return {
        running: false
      };
    }

    try {
      console.log('[LlamaServerManager] Stopping server, PID:', this.process.pid);

      return new Promise((resolve) => {
        if (!this.process) {
          resolve({ running: false });
          return;
        }

        // Set a timeout for forceful termination
        const killTimeout = setTimeout(() => {
          console.log('[LlamaServerManager] Force killing process');
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
        }, 5000);

        // Try graceful termination first
        this.process.once('exit', () => {
          clearTimeout(killTimeout);
          this.process = null;
          this.startTime = null;

          const status: LlamaServerStatus = {
            running: false
          };

          this.notifyStatus(status);
          console.log('[LlamaServerManager] Server stopped');
          resolve(status);
        });

        this.process.kill('SIGTERM');
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[LlamaServerManager] Error stopping server:', errorMsg);

      this.process = null;
      this.startTime = null;

      return {
        running: false,
        error: errorMsg
      };
    }
  }

  /**
   * Get current server status
   */
  getStatus(): LlamaServerStatus {
    if (!this.process) {
      return {
        running: false
      };
    }

    return {
      running: !this.process.killed,
      pid: this.process.pid,
      startTime: this.startTime || undefined
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
    if (this.process) {
      await this.stop();
    }
  }
}

// Export singleton instance
export const llamaServerManager = new LlamaServerManager();
