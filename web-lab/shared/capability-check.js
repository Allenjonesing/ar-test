/**
 * CapabilityChecker — standalone IIFE, sets window.CapabilityChecker
 * No ES-module syntax; safe to load with a plain <script> tag.
 */
(function (global) {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────

  function pass(detail) { return { status: 'pass', detail: detail || '' }; }
  function fail(detail) { return { status: 'fail', detail: detail || '' }; }
  function unknown(detail) { return { status: 'unknown', detail: detail || '' }; }

  // ── Individual checks ──────────────────────────────────────────────────────

  function checkHttps() {
    var isHttps = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return isHttps
      ? pass('Protocol: ' + location.protocol)
      : fail('Page served over HTTP — WebXR and Geolocation require HTTPS');
  }

  function checkCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail('navigator.mediaDevices.getUserMedia not available');
    }
    return unknown('Camera API present — permission not yet requested');
  }

  function checkGeolocation() {
    if (!navigator.geolocation) {
      return fail('navigator.geolocation not available');
    }
    return unknown('Geolocation API present — permission not yet requested');
  }

  function checkWebXR() {
    if (!navigator.xr) {
      return fail('navigator.xr not available — WebXR not supported by this browser');
    }
    // Return unknown; actual session support requires an async isSessionSupported() call
    return unknown('navigator.xr present — session support requires async check');
  }

  function checkMotionSensors() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      return fail('DeviceOrientationEvent not available');
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: permission required before sensors activate
      return unknown('DeviceOrientationEvent.requestPermission required (iOS)');
    }
    return unknown('DeviceOrientationEvent available — listening for first event');
  }

  // ── Async WebXR session check ──────────────────────────────────────────────

  function checkWebXRAsync() {
    if (!navigator.xr) {
      return Promise.resolve(fail('navigator.xr not available'));
    }
    return navigator.xr.isSessionSupported('immersive-ar')
      .then(function (supported) {
        return supported
          ? pass('immersive-ar session supported')
          : fail('immersive-ar not supported on this device/browser');
      })
      .catch(function (err) {
        return fail('Error checking WebXR session support: ' + err.message);
      });
  }

  // ── Camera permission probe ────────────────────────────────────────────────

  function checkCameraAsync() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(fail('getUserMedia not available'));
    }
    if (navigator.permissions && navigator.permissions.query) {
      return navigator.permissions.query({ name: 'camera' })
        .then(function (result) {
          if (result.state === 'granted') return pass('Camera permission granted');
          if (result.state === 'denied')  return fail('Camera permission denied');
          return unknown('Camera permission not yet requested');
        })
        .catch(function () {
          return unknown('Permissions API query failed — camera status unknown');
        });
    }
    return Promise.resolve(unknown('Permissions API not available'));
  }

  // ── Geolocation permission probe ───────────────────────────────────────────

  function checkGeolocationAsync() {
    if (!navigator.geolocation) {
      return Promise.resolve(fail('Geolocation API not available'));
    }
    if (navigator.permissions && navigator.permissions.query) {
      return navigator.permissions.query({ name: 'geolocation' })
        .then(function (result) {
          if (result.state === 'granted') return pass('Geolocation permission granted');
          if (result.state === 'denied')  return fail('Geolocation permission denied');
          return unknown('Geolocation permission not yet requested');
        })
        .catch(function () {
          return unknown('Permissions API query failed — geolocation status unknown');
        });
    }
    return Promise.resolve(unknown('Permissions API not available'));
  }

  // ── Motion sensor async probe ──────────────────────────────────────────────

  function checkMotionSensorsAsync() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      return Promise.resolve(fail('DeviceOrientationEvent not supported'));
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      return Promise.resolve(unknown('iOS motion permission not yet requested — call DeviceOrientationEvent.requestPermission()'));
    }
    // Non-iOS: listen briefly for an event
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        resolve(unknown('No DeviceOrientation event received in 1 s — sensors may be unavailable'));
      }, 1000);
      window.addEventListener('deviceorientation', function handler() {
        clearTimeout(timeout);
        window.removeEventListener('deviceorientation', handler);
        resolve(pass('DeviceOrientation events firing'));
      }, { once: true });
    });
  }

  // ── checkAll ───────────────────────────────────────────────────────────────

  function checkAll() {
    return Promise.all([
      checkWebXRAsync(),
      checkCameraAsync(),
      checkGeolocationAsync(),
      checkMotionSensorsAsync()
    ]).then(function (results) {
      return {
        timestamp: new Date().toISOString(),
        https: checkHttps(),
        camera: results[1],
        geolocation: results[2],
        webxr: results[0],
        motionSensors: results[3]
      };
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  global.CapabilityChecker = {
    checkAll: checkAll,
    checkHttps: function () { return Promise.resolve(checkHttps()); },
    checkCamera: checkCameraAsync,
    checkGeolocation: checkGeolocationAsync,
    checkWebXR: checkWebXRAsync,
    checkMotionSensors: checkMotionSensorsAsync
  };

}(typeof window !== 'undefined' ? window : this));
