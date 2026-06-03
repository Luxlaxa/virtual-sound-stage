// ═══════════════════════════════════════════════════════════════
// STATE — shared state and event bus for Virtual Sound Stage
// ═══════════════════════════════════════════════════════════════

const listeners = {};

export const state = {
    cameraMode: 'fly',         // 'orbit' | 'fly' | 'track'
    cameraLocked: false,
    trackTarget: null,         // 'Phop' | 'Davinci' | null
    activeCameraId: null,
    focalLength: 50,
    aperture: 2.8,
    focusDistance: 3.0,
    bodyId: 'arri-alexa-35',
    lensId: 'cooke-s7i',
    keysDown: {},
    dofEnabled: false,
    viewfinderActive: false,
    undoStack: [],
    MAX_UNDO: 80,
    sliderRefs: {}
};

export function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
}

export function off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
}

export function emit(event, data) {
    if (!listeners[event]) return;
    listeners[event].forEach(fn => fn(data));
}
