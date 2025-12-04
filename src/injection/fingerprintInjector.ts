/**
 * Fingerprint Injector
 * Generates JavaScript code to inject into webviews for fingerprint spoofing
 * 
 * @module fingerprintInjector
 */

import { BrowserFingerprint, FingerprintInjectorConfig } from '../types';

/**
 * Generate deterministic noise for canvas fingerprinting
 * Uses a seeded pseudo-random number generator
 */
function generateCanvasNoiseFunction(seed: number): string {
  return `
    (function() {
      // Seeded PRNG (Mulberry32)
      function mulberry32(a) {
        return function() {
          var t = a += 0x6D2B79F5;
          t = Math.imul(t ^ t >>> 15, t | 1);
          t ^= t + Math.imul(t ^ t >>> 7, t | 61);
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
      }
      
      const prng = mulberry32(${seed});
      
      // Store original methods
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      
      // Add noise to image data
      function addNoise(imageData) {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          // Add small noise to RGB channels (not alpha)
          const noise = Math.floor((prng() - 0.5) * 4);
          data[i] = Math.max(0, Math.min(255, data[i] + noise));
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        }
        return imageData;
      }
      
      // Override toDataURL
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            addNoise(imageData);
            ctx.putImageData(imageData, 0, 0);
          } catch (e) {
            // Canvas may be tainted, ignore
          }
        }
        return originalToDataURL.apply(this, args);
      };
      
      // Override toBlob
      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          try {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            addNoise(imageData);
            ctx.putImageData(imageData, 0, 0);
          } catch (e) {
            // Canvas may be tainted, ignore
          }
        }
        return originalToBlob.call(this, callback, ...args);
      };
      
      // Override getImageData
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        const imageData = originalGetImageData.apply(this, args);
        return addNoise(imageData);
      };
    })();
  `;
}

/**
 * Generate audio context noise injection
 */
function generateAudioNoiseFunction(seed: number): string {
  return `
    (function() {
      // Seeded PRNG for audio
      function mulberry32(a) {
        return function() {
          var t = a += 0x6D2B79F5;
          t = Math.imul(t ^ t >>> 15, t | 1);
          t ^= t + Math.imul(t ^ t >>> 7, t | 61);
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
      }
      
      const prng = mulberry32(${seed});
      
      // Override AudioBuffer.getChannelData
      const originalGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(channel) {
        const data = originalGetChannelData.call(this, channel);
        // Add tiny noise to audio data
        for (let i = 0; i < data.length; i += 100) {
          data[i] += (prng() - 0.5) * 0.0001;
        }
        return data;
      };
      
      // Override AnalyserNode.getFloatFrequencyData
      const originalGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function(array) {
        originalGetFloatFrequencyData.call(this, array);
        for (let i = 0; i < array.length; i++) {
          array[i] += (prng() - 0.5) * 0.1;
        }
      };
    })();
  `;
}

/**
 * Generate WebRTC blocking code
 */
function generateWebRTCBlockingCode(): string {
  return `
    (function() {
      // Block RTCPeerConnection to prevent IP leaks
      const noop = function() {};
      
      // Override RTCPeerConnection
      window.RTCPeerConnection = function() {
        return {
          createDataChannel: noop,
          createOffer: function() { return Promise.reject(new Error('WebRTC disabled')); },
          createAnswer: function() { return Promise.reject(new Error('WebRTC disabled')); },
          setLocalDescription: noop,
          setRemoteDescription: noop,
          addIceCandidate: noop,
          getStats: function() { return Promise.resolve(new Map()); },
          close: noop,
          addEventListener: noop,
          removeEventListener: noop,
          onicecandidate: null,
          ontrack: null,
          ondatachannel: null,
          localDescription: null,
          remoteDescription: null,
          signalingState: 'closed',
          iceConnectionState: 'closed',
          connectionState: 'closed'
        };
      };
      window.RTCPeerConnection.prototype = {};
      
      // Also block webkit and moz prefixed versions
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
      window.mozRTCPeerConnection = window.RTCPeerConnection;
      
      // Block RTCSessionDescription
      window.RTCSessionDescription = function() { return {}; };
      window.RTCIceCandidate = function() { return {}; };
      
      // Block navigator.mediaDevices.getUserMedia for extra protection
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = function() {
          return Promise.reject(new Error('getUserMedia disabled'));
        };
        navigator.mediaDevices.enumerateDevices = function() {
          return Promise.resolve([]);
        };
      }
    })();
  `;
}

/**
 * Create the complete fingerprint injection script
 */
export function createFingerprintInjectorScript(config: FingerprintInjectorConfig): string {
  const { fingerprint, disableWebRTC } = config;
  
  const script = `
    (function() {
      'use strict';
      
      // ========================================
      // Navigator Property Overrides
      // ========================================
      
      const navigatorProps = {
        userAgent: '${escapeString(fingerprint.userAgent)}',
        platform: '${escapeString(fingerprint.platform)}',
        language: '${escapeString(fingerprint.language)}',
        languages: ${JSON.stringify(fingerprint.languages)},
        hardwareConcurrency: ${fingerprint.hardwareConcurrency},
        deviceMemory: ${fingerprint.deviceMemory}
      };
      
      // Override navigator properties
      for (const [prop, value] of Object.entries(navigatorProps)) {
        try {
          Object.defineProperty(navigator, prop, {
            get: function() { return value; },
            configurable: true
          });
        } catch (e) {}
      }
      
      // Override navigator.plugins
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          return ${JSON.stringify(fingerprint.plugins)};
        },
        configurable: true
      });
      
      // ========================================
      // Screen Property Overrides
      // ========================================
      
      const screenProps = {
        width: ${fingerprint.screenResolution[0]},
        height: ${fingerprint.screenResolution[1]},
        availWidth: ${fingerprint.availableScreenResolution[0]},
        availHeight: ${fingerprint.availableScreenResolution[1]},
        colorDepth: ${fingerprint.colorDepth},
        pixelDepth: ${fingerprint.colorDepth}
      };
      
      for (const [prop, value] of Object.entries(screenProps)) {
        try {
          Object.defineProperty(screen, prop, {
            get: function() { return value; },
            configurable: true
          });
        } catch (e) {}
      }
      
      // Override devicePixelRatio
      Object.defineProperty(window, 'devicePixelRatio', {
        get: function() { return ${fingerprint.pixelRatio}; },
        configurable: true
      });
      
      // ========================================
      // Timezone Overrides
      // ========================================
      
      // Override Date.prototype.getTimezoneOffset
      const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = function() {
        return ${fingerprint.timezoneOffset};
      };
      
      // Override Intl.DateTimeFormat
      const originalDateTimeFormat = Intl.DateTimeFormat;
      Intl.DateTimeFormat = function(locales, options) {
        const dtf = new originalDateTimeFormat(locales, options);
        const originalResolvedOptions = dtf.resolvedOptions.bind(dtf);
        dtf.resolvedOptions = function() {
          const opts = originalResolvedOptions();
          opts.timeZone = '${escapeString(fingerprint.timezone)}';
          return opts;
        };
        return dtf;
      };
      Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
      Intl.DateTimeFormat.supportedLocalesOf = originalDateTimeFormat.supportedLocalesOf;
      
      // ========================================
      // WebGL Overrides
      // ========================================
      
      const webglVendor = '${escapeString(fingerprint.webgl.vendor)}';
      const webglRenderer = '${escapeString(fingerprint.webgl.renderer)}';
      
      const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(param) {
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) return webglVendor;
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) return webglRenderer;
        // VENDOR
        if (param === 7936) return webglVendor;
        // RENDERER
        if (param === 7937) return webglRenderer;
        return originalGetParameter.call(this, param);
      };
      
      // Also override WebGL2
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(param) {
          if (param === 37445) return webglVendor;
          if (param === 37446) return webglRenderer;
          if (param === 7936) return webglVendor;
          if (param === 7937) return webglRenderer;
          return originalGetParameter2.call(this, param);
        };
      }
      
    })();
    
    // Canvas fingerprint noise
    ${generateCanvasNoiseFunction(fingerprint.canvas.noiseSeed)}
    
    // Audio fingerprint noise
    ${generateAudioNoiseFunction(fingerprint.audio.noiseSeed)}
    
    ${disableWebRTC ? generateWebRTCBlockingCode() : '// WebRTC not blocked'}
  `;
  
  return script;
}

/**
 * Escape string for safe inclusion in JavaScript
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Check if the generated script contains required fingerprint values
 * Used for testing
 */
export function scriptContainsFingerprint(script: string, fingerprint: BrowserFingerprint): boolean {
  return (
    script.includes(fingerprint.userAgent) &&
    script.includes(fingerprint.platform) &&
    script.includes(String(fingerprint.screenResolution[0])) &&
    script.includes(String(fingerprint.screenResolution[1])) &&
    script.includes(fingerprint.webgl.vendor) &&
    script.includes(fingerprint.webgl.renderer)
  );
}

/**
 * Check if script contains WebRTC blocking code
 */
export function scriptContainsWebRTCBlocking(script: string): boolean {
  return (
    script.includes('RTCPeerConnection') &&
    script.includes('WebRTC disabled')
  );
}

/**
 * Apply deterministic canvas noise to image data (for testing)
 */
export function applyCanvasNoise(imageData: Uint8ClampedArray, seed: number): Uint8ClampedArray {
  // Mulberry32 PRNG
  let a = seed;
  function prng(): number {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  
  const result = new Uint8ClampedArray(imageData);
  for (let i = 0; i < result.length; i += 4) {
    const noise = Math.floor((prng() - 0.5) * 4);
    result[i] = Math.max(0, Math.min(255, result[i] + noise));
    result[i + 1] = Math.max(0, Math.min(255, result[i + 1] + noise));
    result[i + 2] = Math.max(0, Math.min(255, result[i + 2] + noise));
  }
  return result;
}
