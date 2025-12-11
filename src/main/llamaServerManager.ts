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
  private processes: Map<number, { process: ChildProcess; startTime: number }> = new Map();
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
        
        // Use start command to open a new visible command prompt window
        const newProcess = spawn('cmd.exe', ['/c', `start "Llama Server" /wait cmd.exe /k "${cleanedCommand}"`], {
          cwd: buildPath,
          stdio: 'ignore',
          shell: true,
          detached: false
        });
        
        const startTime = Date.now();
        if (newProcess.pid) {
          this.processes.set(newProcess.pid, { process: newProcess, startTime });
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
   * Stop all llama.cpp server processes
   */
  async stop(): Promise<LlamaServerStatus> {
    if (this.processes.size === 0) {
      return {
        running: false
      };
    }

    try {
      console.log('[LlamaServerManager] Stopping all servers, count:', this.processes.size);

      const stopPromises = Array.from(this.processes.values()).map(({ process }) => {
        return new Promise<void>((resolve) => {
          if (!process || process.killed) {
            resolve();
            return;
          }

          // Set a timeout for forceful termination
          const killTimeout = setTimeout(() => {
            console.log('[LlamaServerManager] Force killing process', process.pid);
            if (!process.killed) {
              process.kill('SIGKILL');
            }
          }, 5000);

          // Try graceful termination first
          process.once('exit', () => {
            clearTimeout(killTimeout);
            console.log('[LlamaServerManager] Process stopped:', process.pid);
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
      console.log('[LlamaServerManager] All servers stopped');
      return status;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[LlamaServerManager] Error stopping servers:', errorMsg);

      this.processes.clear();

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
    if (this.processes.size === 0) {
      return {
        running: false
      };
    }

    // Return status of the most recent process
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
