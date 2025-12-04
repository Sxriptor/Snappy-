/**
 * Fingerprint Generator
 * Generates unique, realistic browser fingerprints for anti-detection
 * 
 * @module fingerprintGenerator
 */

import * as crypto from 'crypto';
import {
  BrowserFingerprint,
  FingerprintProfile,
  PluginData
} from '../types';

// ============================================================================
// Realistic Fingerprint Profiles (derived from real browser telemetry)
// ============================================================================

const WINDOWS_CHROME_PROFILE: FingerprintProfile = {
  name: 'windows-chrome',
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ],
  platforms: ['Win32'],
  screenResolutions: [[1920, 1080], [2560, 1440], [1366, 768], [1536, 864], [1440, 900]],
  colorDepths: [24, 32],
  webglCombos: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  ],
  hardwareConcurrency: [4, 6, 8, 12, 16],
  deviceMemory: [4, 8, 16, 32],
  languages: ['en-US', 'en'],
  timezones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London']
};

const MACOS_CHROME_PROFILE: FingerprintProfile = {
  name: 'macos-chrome',
  userAgents: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
  platforms: ['MacIntel'],
  screenResolutions: [[2560, 1600], [1920, 1080], [2880, 1800], [1440, 900]],
  colorDepths: [24, 30],
  webglCombos: [
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)' },
  ],
  hardwareConcurrency: [8, 10, 12],
  deviceMemory: [8, 16, 32],
  languages: ['en-US', 'en'],
  timezones: ['America/New_York', 'America/Los_Angeles', 'America/Chicago']
};

const LINUX_CHROME_PROFILE: FingerprintProfile = {
  name: 'linux-chrome',
  userAgents: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ],
  platforms: ['Linux x86_64'],
  screenResolutions: [[1920, 1080], [2560, 1440], [1366, 768]],
  colorDepths: [24],
  webglCombos: [
    { vendor: 'Google Inc. (NVIDIA Corporation)', renderer: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1080/PCIe/SSE2, OpenGL 4.5)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series, OpenGL 4.6)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)' },
  ],
  hardwareConcurrency: [4, 8, 12, 16],
  deviceMemory: [8, 16, 32],
  languages: ['en-US', 'en'],
  timezones: ['America/New_York', 'Europe/London', 'UTC']
};

export const FINGERPRINT_PROFILES: FingerprintProfile[] = [
  WINDOWS_CHROME_PROFILE,
  MACOS_CHROME_PROFILE,
  LINUX_CHROME_PROFILE
];

// Common Chrome plugins
const CHROME_PLUGINS: PluginData[] = [
  { name: 'PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Chrome PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Chromium PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
];

// Common fonts by platform
const WINDOWS_FONTS = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana'];
const MACOS_FONTS = ['Arial', 'Helvetica', 'Helvetica Neue', 'Menlo', 'Monaco', 'San Francisco', 'Times New Roman', 'Verdana'];
const LINUX_FONTS = ['Arial', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Ubuntu', 'Verdana'];

/**
 * FingerprintGenerator class
 * Generates unique, realistic browser fingerprints
 */
export class FingerprintGenerator {
  private usedHashes: Set<string> = new Set();

  /**
   * Generate a new unique fingerprint
   */
  generate(): BrowserFingerprint {
    let fingerprint: BrowserFingerprint;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      const profile = this.selectRandomProfile();
      fingerprint = this.generateFromProfile(profile);
      attempts++;
    } while (!this.isUnique(fingerprint) && attempts < maxAttempts);

    this.markUsed(fingerprint);
    return fingerprint;
  }

  /**
   * Generate fingerprint from a specific profile
   */
  generateFromProfile(profile: FingerprintProfile): BrowserFingerprint {
    const userAgent = this.randomElement(profile.userAgents);
    const platform = this.randomElement(profile.platforms);
    const screenResolution = this.randomElement(profile.screenResolutions);
    const colorDepth = this.randomElement(profile.colorDepths);
    const webgl = this.randomElement(profile.webglCombos);
    const hardwareConcurrency = this.randomElement(profile.hardwareConcurrency);
    const deviceMemory = this.randomElement(profile.deviceMemory);
    const timezone = this.randomElement(profile.timezones);
    const language = this.randomElement(profile.languages);

    // Get fonts based on platform
    let fonts: string[];
    if (platform === 'Win32') {
      fonts = [...WINDOWS_FONTS];
    } else if (platform === 'MacIntel') {
      fonts = [...MACOS_FONTS];
    } else {
      fonts = [...LINUX_FONTS];
    }

    return {
      userAgent,
      platform,
      language,
      languages: [language, language.split('-')[0]],
      timezone,
      timezoneOffset: this.getTimezoneOffset(timezone),
      screenResolution,
      availableScreenResolution: [screenResolution[0], screenResolution[1] - 40], // Account for taskbar
      colorDepth,
      pixelRatio: screenResolution[0] > 1920 ? 2 : 1,
      hardwareConcurrency,
      deviceMemory,
      webgl: {
        vendor: webgl.vendor,
        renderer: webgl.renderer,
        unmaskedVendor: webgl.vendor,
        unmaskedRenderer: webgl.renderer
      },
      canvas: {
        noiseSeed: this.generateNoiseSeed()
      },
      audio: {
        noiseSeed: this.generateNoiseSeed()
      },
      fonts,
      plugins: [...CHROME_PLUGINS]
    };
  }

  /**
   * Generate fingerprint by profile name
   */
  generateByProfileName(profileName: string): BrowserFingerprint {
    const profile = FINGERPRINT_PROFILES.find(p => p.name === profileName);
    if (!profile) {
      // Fall back to windows-chrome if profile not found
      return this.generateFromProfile(WINDOWS_CHROME_PROFILE);
    }
    return this.generateFromProfile(profile);
  }

  /**
   * Calculate hash of fingerprint for uniqueness checking
   */
  getHash(fingerprint: BrowserFingerprint): string {
    const hashData = JSON.stringify({
      ua: fingerprint.userAgent,
      platform: fingerprint.platform,
      screen: fingerprint.screenResolution,
      webgl: fingerprint.webgl,
      hw: fingerprint.hardwareConcurrency,
      mem: fingerprint.deviceMemory,
      canvas: fingerprint.canvas.noiseSeed,
      audio: fingerprint.audio.noiseSeed
    });
    return crypto.createHash('sha256').update(hashData).digest('hex').substring(0, 16);
  }

  /**
   * Check if fingerprint is unique (not used before)
   */
  isUnique(fingerprint: BrowserFingerprint): boolean {
    return !this.usedHashes.has(this.getHash(fingerprint));
  }

  /**
   * Mark fingerprint as used
   */
  markUsed(fingerprint: BrowserFingerprint): void {
    this.usedHashes.add(this.getHash(fingerprint));
  }

  /**
   * Release a fingerprint (allow reuse)
   */
  releaseFingerprint(fingerprint: BrowserFingerprint): void {
    this.usedHashes.delete(this.getHash(fingerprint));
  }

  /**
   * Validate that fingerprint has consistent combinations
   */
  validateCombination(fingerprint: BrowserFingerprint): boolean {
    // Check all required fields exist
    if (!fingerprint.userAgent || !fingerprint.platform || !fingerprint.language) {
      return false;
    }
    if (!fingerprint.screenResolution || fingerprint.screenResolution.length !== 2) {
      return false;
    }
    if (!fingerprint.webgl || !fingerprint.webgl.vendor || !fingerprint.webgl.renderer) {
      return false;
    }
    if (typeof fingerprint.hardwareConcurrency !== 'number' || fingerprint.hardwareConcurrency < 1) {
      return false;
    }
    if (typeof fingerprint.deviceMemory !== 'number' || fingerprint.deviceMemory < 1) {
      return false;
    }
    if (typeof fingerprint.canvas?.noiseSeed !== 'number') {
      return false;
    }
    if (typeof fingerprint.audio?.noiseSeed !== 'number') {
      return false;
    }

    // Validate platform/UA consistency
    const isWindows = fingerprint.platform === 'Win32';
    const isMac = fingerprint.platform === 'MacIntel';
    const isLinux = fingerprint.platform.includes('Linux');

    const uaHasWindows = fingerprint.userAgent.includes('Windows');
    const uaHasMac = fingerprint.userAgent.includes('Macintosh');
    const uaHasLinux = fingerprint.userAgent.includes('Linux');

    if (isWindows && !uaHasWindows) return false;
    if (isMac && !uaHasMac) return false;
    if (isLinux && !uaHasLinux) return false;

    return true;
  }

  /**
   * Get all available profile names
   */
  getProfileNames(): string[] {
    return FINGERPRINT_PROFILES.map(p => p.name);
  }

  /**
   * Get count of used fingerprints
   */
  getUsedCount(): number {
    return this.usedHashes.size;
  }

  /**
   * Clear all used fingerprints
   */
  clearUsed(): void {
    this.usedHashes.clear();
  }

  // Private helper methods

  private selectRandomProfile(): FingerprintProfile {
    // Weight towards Windows as it's most common
    const weights = [0.7, 0.2, 0.1]; // Windows, macOS, Linux
    const random = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < FINGERPRINT_PROFILES.length; i++) {
      cumulative += weights[i];
      if (random < cumulative) {
        return FINGERPRINT_PROFILES[i];
      }
    }
    return FINGERPRINT_PROFILES[0];
  }

  private randomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }

  private generateNoiseSeed(): number {
    return crypto.randomInt(0, 2147483647);
  }

  private getTimezoneOffset(timezone: string): number {
    const offsets: Record<string, number> = {
      'America/New_York': 300,
      'America/Chicago': 360,
      'America/Denver': 420,
      'America/Los_Angeles': 480,
      'Europe/London': 0,
      'UTC': 0
    };
    return offsets[timezone] ?? 0;
  }
}

// Export singleton instance for convenience
export const fingerprintGenerator = new FingerprintGenerator();
