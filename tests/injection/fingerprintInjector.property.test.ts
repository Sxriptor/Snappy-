/**
 * Property-based tests for FingerprintInjector
 * 
 * @module fingerprintInjector.property.test
 */

import * as fc from 'fast-check';
import {
  createFingerprintInjectorScript,
  scriptContainsFingerprint,
  scriptContainsWebRTCBlocking,
  applyCanvasNoise
} from '../../src/injection/fingerprintInjector';
import { FingerprintGenerator } from '../../src/main/fingerprintGenerator';
import { BrowserFingerprint, FingerprintInjectorConfig } from '../../src/types';

describe('FingerprintInjector Property Tests', () => {
  let generator: FingerprintGenerator;

  beforeEach(() => {
    generator = new FingerprintGenerator();
  });

  // **Feature: multi-session, Property 4: Canvas Noise Determinism**
  // **Validates: Requirements 2.4**
  describe('Property 4: Canvas Noise Determinism', () => {
    it('should produce identical output for same seed and input', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2147483647 }), // seed
          fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 400 }), // image data (RGBA)
          (seed, pixelData) => {
            // Ensure length is multiple of 4 (RGBA)
            const length = Math.floor(pixelData.length / 4) * 4;
            const imageData = new Uint8ClampedArray(pixelData.slice(0, length));
            
            // Apply noise twice with same seed
            const result1 = applyCanvasNoise(imageData, seed);
            const result2 = applyCanvasNoise(imageData, seed);
            
            // Results should be identical
            expect(result1.length).toBe(result2.length);
            for (let i = 0; i < result1.length; i++) {
              expect(result1[i]).toBe(result2[i]);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce different output for different seeds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2147483646 }), // seed1
          fc.integer({ min: 1, max: 2147483647 }), // seed2 offset
          fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 40, maxLength: 400 }),
          (seed1, offset, pixelData) => {
            const seed2 = (seed1 + offset) % 2147483647;
            if (seed1 === seed2) return true; // Skip if seeds happen to be equal
            
            const length = Math.floor(pixelData.length / 4) * 4;
            if (length < 4) return true; // Skip if too small
            
            const imageData = new Uint8ClampedArray(pixelData.slice(0, length));
            
            const result1 = applyCanvasNoise(imageData, seed1);
            const result2 = applyCanvasNoise(imageData, seed2);
            
            // Results should be different (at least one pixel different)
            let hasDifference = false;
            for (let i = 0; i < result1.length; i++) {
              if (result1[i] !== result2[i]) {
                hasDifference = true;
                break;
              }
            }
            
            expect(hasDifference).toBe(true);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: multi-session, Property 5: Fingerprint Injector Script Correctness**
  // **Validates: Requirements 2.5**
  describe('Property 5: Fingerprint Injector Script Correctness', () => {
    it('should generate script containing exact fingerprint values', () => {
      fc.assert(
        fc.property(
          fc.boolean(), // disableWebRTC
          (disableWebRTC) => {
            const fingerprint = generator.generate();
            const config: FingerprintInjectorConfig = {
              fingerprint,
              disableWebRTC
            };
            
            const script = createFingerprintInjectorScript(config);
            
            // Script should contain all key fingerprint values
            expect(script).toContain(fingerprint.userAgent);
            expect(script).toContain(fingerprint.platform);
            expect(script).toContain(String(fingerprint.screenResolution[0]));
            expect(script).toContain(String(fingerprint.screenResolution[1]));
            expect(script).toContain(fingerprint.webgl.vendor);
            expect(script).toContain(fingerprint.webgl.renderer);
            expect(script).toContain(String(fingerprint.hardwareConcurrency));
            expect(script).toContain(String(fingerprint.deviceMemory));
            expect(script).toContain(String(fingerprint.colorDepth));
            expect(script).toContain(fingerprint.timezone);
            expect(script).toContain(String(fingerprint.canvas.noiseSeed));
            expect(script).toContain(String(fingerprint.audio.noiseSeed));
            
            // Helper function should also confirm
            expect(scriptContainsFingerprint(script, fingerprint)).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate valid JavaScript syntax', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (disableWebRTC) => {
            const fingerprint = generator.generate();
            const config: FingerprintInjectorConfig = {
              fingerprint,
              disableWebRTC
            };
            
            const script = createFingerprintInjectorScript(config);
            
            // Script should be parseable JavaScript (basic check)
            expect(script).toBeDefined();
            expect(typeof script).toBe('string');
            expect(script.length).toBeGreaterThan(0);
            
            // Should contain expected structure
            expect(script).toContain('use strict');
            expect(script).toContain('navigator');
            expect(script).toContain('screen');
            expect(script).toContain('WebGLRenderingContext');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: multi-session, Property 7: WebRTC Blocking in Injector**
  // **Validates: Requirements 4.1**
  describe('Property 7: WebRTC Blocking in Injector', () => {
    it('should include WebRTC blocking code when proxy is enabled', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (_iteration) => {
            const fingerprint = generator.generate();
            const config: FingerprintInjectorConfig = {
              fingerprint,
              disableWebRTC: true // Proxy enabled = WebRTC should be blocked
            };
            
            const script = createFingerprintInjectorScript(config);
            
            // Script should contain WebRTC blocking code
            expect(scriptContainsWebRTCBlocking(script)).toBe(true);
            expect(script).toContain('RTCPeerConnection');
            expect(script).toContain('WebRTC disabled');
            expect(script).toContain('RTCSessionDescription');
            expect(script).toContain('RTCIceCandidate');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not include WebRTC blocking when proxy is disabled', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (_iteration) => {
            const fingerprint = generator.generate();
            const config: FingerprintInjectorConfig = {
              fingerprint,
              disableWebRTC: false
            };
            
            const script = createFingerprintInjectorScript(config);
            
            // Script should NOT contain WebRTC blocking code
            expect(scriptContainsWebRTCBlocking(script)).toBe(false);
            expect(script).toContain('WebRTC not blocked');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
