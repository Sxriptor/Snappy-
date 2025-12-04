/**
 * Property-based tests for FingerprintGenerator
 * 
 * @module fingerprintGenerator.property.test
 */

import * as fc from 'fast-check';
import { FingerprintGenerator, FINGERPRINT_PROFILES } from '../../src/main/fingerprintGenerator';
import { BrowserFingerprint } from '../../src/types';

describe('FingerprintGenerator Property Tests', () => {
  let generator: FingerprintGenerator;

  beforeEach(() => {
    generator = new FingerprintGenerator();
  });

  // **Feature: multi-session, Property 3: Fingerprint Completeness**
  // **Validates: Requirements 2.2**
  describe('Property 3: Fingerprint Completeness', () => {
    it('should generate fingerprints with all required fields', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (_iteration) => {
            const fingerprint = generator.generate();

            // Check all required top-level fields
            expect(fingerprint.userAgent).toBeDefined();
            expect(typeof fingerprint.userAgent).toBe('string');
            expect(fingerprint.userAgent.length).toBeGreaterThan(0);

            expect(fingerprint.platform).toBeDefined();
            expect(typeof fingerprint.platform).toBe('string');

            expect(fingerprint.language).toBeDefined();
            expect(typeof fingerprint.language).toBe('string');

            expect(fingerprint.languages).toBeDefined();
            expect(Array.isArray(fingerprint.languages)).toBe(true);

            expect(fingerprint.timezone).toBeDefined();
            expect(typeof fingerprint.timezone).toBe('string');

            expect(typeof fingerprint.timezoneOffset).toBe('number');

            // Screen resolution
            expect(fingerprint.screenResolution).toBeDefined();
            expect(Array.isArray(fingerprint.screenResolution)).toBe(true);
            expect(fingerprint.screenResolution.length).toBe(2);
            expect(fingerprint.screenResolution[0]).toBeGreaterThan(0);
            expect(fingerprint.screenResolution[1]).toBeGreaterThan(0);

            expect(fingerprint.availableScreenResolution).toBeDefined();
            expect(Array.isArray(fingerprint.availableScreenResolution)).toBe(true);

            expect(typeof fingerprint.colorDepth).toBe('number');
            expect(fingerprint.colorDepth).toBeGreaterThan(0);

            expect(typeof fingerprint.pixelRatio).toBe('number');
            expect(fingerprint.pixelRatio).toBeGreaterThan(0);

            // Hardware
            expect(typeof fingerprint.hardwareConcurrency).toBe('number');
            expect(fingerprint.hardwareConcurrency).toBeGreaterThan(0);

            expect(typeof fingerprint.deviceMemory).toBe('number');
            expect(fingerprint.deviceMemory).toBeGreaterThan(0);

            // WebGL
            expect(fingerprint.webgl).toBeDefined();
            expect(fingerprint.webgl.vendor).toBeDefined();
            expect(typeof fingerprint.webgl.vendor).toBe('string');
            expect(fingerprint.webgl.renderer).toBeDefined();
            expect(typeof fingerprint.webgl.renderer).toBe('string');
            expect(fingerprint.webgl.unmaskedVendor).toBeDefined();
            expect(fingerprint.webgl.unmaskedRenderer).toBeDefined();

            // Canvas noise seed
            expect(fingerprint.canvas).toBeDefined();
            expect(typeof fingerprint.canvas.noiseSeed).toBe('number');

            // Audio noise seed
            expect(fingerprint.audio).toBeDefined();
            expect(typeof fingerprint.audio.noiseSeed).toBe('number');

            // Fonts and plugins
            expect(fingerprint.fonts).toBeDefined();
            expect(Array.isArray(fingerprint.fonts)).toBe(true);

            expect(fingerprint.plugins).toBeDefined();
            expect(Array.isArray(fingerprint.plugins)).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: multi-session, Property 2: Fingerprint Uniqueness**
  // **Validates: Requirements 2.1**
  describe('Property 2: Fingerprint Uniqueness', () => {
    it('should generate unique fingerprints (no hash collisions)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 50 }),
          (count) => {
            const localGenerator = new FingerprintGenerator();
            const hashes = new Set<string>();
            
            for (let i = 0; i < count; i++) {
              const fingerprint = localGenerator.generate();
              const hash = localGenerator.getHash(fingerprint);
              
              // Each hash should be unique
              expect(hashes.has(hash)).toBe(false);
              hashes.add(hash);
            }

            expect(hashes.size).toBe(count);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: multi-session, Property 17: Fingerprint Profile Validity**
  // **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**
  describe('Property 17: Fingerprint Profile Validity', () => {
    // Collect all valid values from profiles
    const allUserAgents = FINGERPRINT_PROFILES.flatMap(p => p.userAgents);
    const allPlatforms = FINGERPRINT_PROFILES.flatMap(p => p.platforms);
    const allScreenResolutions = FINGERPRINT_PROFILES.flatMap(p => p.screenResolutions);
    const allWebglCombos = FINGERPRINT_PROFILES.flatMap(p => p.webglCombos);
    const allHardwareConcurrency = FINGERPRINT_PROFILES.flatMap(p => p.hardwareConcurrency);
    const allDeviceMemory = FINGERPRINT_PROFILES.flatMap(p => p.deviceMemory);

    it('should generate fingerprints using only valid profile values', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (_iteration) => {
            const fingerprint = generator.generate();

            // User agent must be from curated list
            expect(allUserAgents).toContain(fingerprint.userAgent);

            // Platform must be from profiles
            expect(allPlatforms).toContain(fingerprint.platform);

            // Screen resolution must be from profiles
            const resMatch = allScreenResolutions.some(
              res => res[0] === fingerprint.screenResolution[0] && 
                     res[1] === fingerprint.screenResolution[1]
            );
            expect(resMatch).toBe(true);

            // WebGL vendor/renderer must be valid pair
            const webglMatch = allWebglCombos.some(
              combo => combo.vendor === fingerprint.webgl.vendor && 
                       combo.renderer === fingerprint.webgl.renderer
            );
            expect(webglMatch).toBe(true);

            // Hardware concurrency must be from profiles
            expect(allHardwareConcurrency).toContain(fingerprint.hardwareConcurrency);

            // Device memory must be from profiles
            expect(allDeviceMemory).toContain(fingerprint.deviceMemory);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate platform-consistent fingerprints', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (_iteration) => {
            const fingerprint = generator.generate();

            // Platform and user agent must be consistent
            if (fingerprint.platform === 'Win32') {
              expect(fingerprint.userAgent).toContain('Windows');
            } else if (fingerprint.platform === 'MacIntel') {
              expect(fingerprint.userAgent).toContain('Macintosh');
            } else if (fingerprint.platform.includes('Linux')) {
              expect(fingerprint.userAgent).toContain('Linux');
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate fingerprint combinations correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (_iteration) => {
            const fingerprint = generator.generate();
            
            // All generated fingerprints should pass validation
            expect(generator.validateCombination(fingerprint)).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
