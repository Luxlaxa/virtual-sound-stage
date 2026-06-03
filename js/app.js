// ═══════════════════════════════════════════════════════════════
// APP.JS — Virtual Sound Stage entry point
// ═══════════════════════════════════════════════════════════════

import { state, on, off, emit } from './state.js';
import { cameraBodies, getBody, fovForBody } from './camera-bodies.js';
import { lenses, getLens, getLensByType, nearestFocalLength } from './lens-database.js';

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONFIG & STATE (local working copies)
    // ═══════════════════════════════════════════════════════════════

    // Use real sensor math from camera-bodies
    var activeBody = getBody(state.bodyId);
    var activeLens = getLens(state.lensId);

    var defaultBindings = {
        bookmark1:     { key: 'Digit1', label: 'Wide Shot' },
        bookmark2:     { key: 'Digit2', label: 'OTS Phop' },
        bookmark3:     { key: 'Digit3', label: 'OTS Davinci' },
        bookmark4:     { key: 'Digit4', label: 'Match Cut' },
        povPhop:       { key: 'Digit5', label: 'Phop POV' },
        povDavinci:    { key: 'Digit6', label: 'Davinci POV' },
        toggleFly:     { key: 'KeyF',   label: 'Fly Mode' },
        toggleViewfinder: { key: 'KeyV', label: 'Viewfinder' },
        lockCamera:    { key: 'KeyK',   label: 'Lock Camera' },
        lockPhop:      { key: 'KeyJ',   label: 'Track Phop' },
        lockDavinci:   { key: 'KeyH',   label: 'Track Davinci' },
        settings:      { key: 'Escape', label: 'Settings' },
        moveForward:   { key: 'KeyW',   label: 'Forward' },
        moveBack:      { key: 'KeyS',   label: 'Back' },
        moveLeft:      { key: 'KeyA',   label: 'Left' },
        moveRight:     { key: 'KeyD',   label: 'Right' },
        moveUp:        { key: 'KeyE',   label: 'Up' },
        moveDown:      { key: 'KeyQ',   label: 'Down' },
        capture:       { key: 'Space',  label: 'Capture Snapshot' },
        cycleCamera:   { key: 'Tab',    label: 'Next Camera' }
    };

    var bindings = loadBindings();
    var cameraMode = state.cameraMode;
    var cameraLocked = state.cameraLocked;
    var trackTarget = state.trackTarget;
    var focalLength = state.focalLength;
    var aperture = state.aperture;
    var keysDown = state.keysDown;

    // ═══════════════════════════════════════════════════════════════
    // UNDO SYSTEM
    // ═══════════════════════════════════════════════════════════════

    var undoStack = state.undoStack;
    var MAX_UNDO = state.MAX_UNDO;
    var sliderRefs = state.sliderRefs;

    function captureState(entityList) {
        var s = {};
        entityList.forEach(function (item) {
            var p = item.entity.getLocalPosition();
            var r = item.entity.getLocalEulerAngles();
            var sc = item.entity.getLocalScale();
            s[item.name] = { pos: [p.x, p.y, p.z], rot: [r.x, r.y, r.z], scale: sc.x };
        });
        return s;
    }

    function pushUndo(entityList) {
        undoStack.push(captureState(entityList));
        if (undoStack.length > MAX_UNDO) undoStack.shift();
    }

    function popUndo(entityList) {
        if (!undoStack.length) return;
        var st = undoStack.pop();
        entityList.forEach(function (item) {
            var s = st[item.name];
            if (!s) return;
            item.entity.setLocalPosition(s.pos[0], s.pos[1], s.pos[2]);
            item.entity.setLocalEulerAngles(s.rot[0], s.rot[1], s.rot[2]);
            item.entity.setLocalScale(s.scale, s.scale, s.scale);
            syncSliders(item.name, s);
        });
    }

    function syncSliders(name, s) {
        ['pos_x','pos_y','pos_z','rot_x','rot_y','rot_z','scale'].forEach(function (k) {
            var ref = sliderRefs[name + '_' + k];
            if (!ref) return;
            var v;
            if (k === 'pos_x') v = s.pos[0];
            else if (k === 'pos_y') v = s.pos[1];
            else if (k === 'pos_z') v = s.pos[2];
            else if (k === 'rot_x') v = s.rot[0];
            else if (k === 'rot_y') v = s.rot[1];
            else if (k === 'rot_z') v = s.rot[2];
            else v = s.scale;
            ref.input.value = v;
            ref.val.textContent = formatVal(v, ref.step);
        });
    }

    function formatVal(v, step) { return Number(v).toFixed(step < 1 ? 2 : 1); }

    // ═══════════════════════════════════════════════════════════════
    // BINDINGS PERSISTENCE
    // ═══════════════════════════════════════════════════════════════

    function loadBindings() {
        try {
            var saved = localStorage.getItem('ib-bindings');
            if (saved) {
                var parsed = JSON.parse(saved);
                var merged = {};
                for (var k in defaultBindings) {
                    merged[k] = { key: (parsed[k] && parsed[k].key) || defaultBindings[k].key, label: defaultBindings[k].label };
                }
                return merged;
            }
        } catch (e) {}
        return JSON.parse(JSON.stringify(defaultBindings));
    }

    function saveBindings() {
        localStorage.setItem('ib-bindings', JSON.stringify(bindings));
    }

    function keyDisplayName(code) {
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code === 'Escape') return 'ESC';
        if (code === 'Space') return 'SPC';
        if (code === 'ArrowUp') return '\u2191';
        if (code === 'ArrowDown') return '\u2193';
        if (code === 'ArrowLeft') return '\u2190';
        if (code === 'ArrowRight') return '\u2192';
        return code.replace('Shift','\u21E7').replace('Control','\u2303').replace('Alt','\u2325');
    }

    function actionForKey(code) {
        for (var k in bindings) {
            if (bindings[k].key === code) return k;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // LENS MATH (now using real sensor data)
    // ═══════════════════════════════════════════════════════════════

    var NEUTRAL_FOV = 45; // default FOV for orbit/fly (no cinema body applied)
    var deliveryAspect = 0; // 0 = use sensor native, otherwise override (e.g., 2.39, 1.85)
    var vfElapsedTime = 0; // viewfinder timecode accumulator

    function focalToFov(f) {
        return fovForBody(activeBody, f);
    }

    // applyCameraFov is defined inside buildScene() where 'camera' is accessible

    var lensCharacter = {
        14: 'ultra-wide \u2014 extreme perspective, barrel distortion',
        18: 'super-wide \u2014 architectural, environmental',
        24: 'wide \u2014 establishing shots, environmental',
        35: 'standard \u2014 street, documentary feel',
        50: 'normal \u2014 human eye, natural perspective',
        85: 'portrait \u2014 flattering compression, shallow dof',
        100: 'medium tele \u2014 headshots, product',
        135: 'telephoto \u2014 background compression, isolation',
        200: 'super tele \u2014 extreme compression, sports'
    };

    function getLensInfo(f) {
        var best = '', bestDist = 999;
        for (var k in lensCharacter) {
            var d = Math.abs(f - parseInt(k));
            if (d < bestDist) { bestDist = d; best = lensCharacter[k]; }
        }
        return best;
    }

    var apertureStops = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];

    function getVignette(fstop) {
        return Math.max(0, 0.5 - (fstop - 1.4) * 0.025);
    }

    // ═══════════════════════════════════════════════════════════════
    // ENGINE SETUP
    // ═══════════════════════════════════════════════════════════════

    var canvas = document.getElementById('app');
    var app = new pc.Application(canvas, {
        mouse: new pc.Mouse(canvas),
        keyboard: new pc.Keyboard(window),
        graphicsDeviceOptions: {
            preserveDrawingBuffer: true  // required for canvas.toBlob() snapshot capture
        }
    });

    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', function () { app.resizeCanvas(); });
    app.start();

    // ═══════════════════════════════════════════════════════════════
    // ASSET LOADING
    // ═══════════════════════════════════════════════════════════════

    var assets = {
        splat:   new pc.Asset('world-splat', 'gsplat',    { url: 'still-220723.compressed.ply' }),
        davinci: new pc.Asset('davinci',     'container', { url: 'davinci.glb' }),
        phop:    new pc.Asset('phop',        'container', { url: 'phop.glb' }),
        ambient: new pc.Asset('ambient',     'audio',     { url: 'ambient-loop.mp3' })
    };

    var assetKeys = Object.keys(assets);
    var loadCount = 0;
    var barEl = document.getElementById('bar');
    var statusEl = document.getElementById('status');

    assetKeys.forEach(function (key) {
        var asset = assets[key];
        asset.on('load', function () {
            loadCount++;
            barEl.style.width = Math.round((loadCount / assetKeys.length) * 100) + '%';
            statusEl.textContent = key + ' loaded (' + loadCount + '/' + assetKeys.length + ')';
            if (loadCount === assetKeys.length) buildScene();
        });
        asset.on('error', function (err) {
            console.error('failed: ' + key, err);
            statusEl.textContent = 'error: ' + key;
            loadCount++;
            if (loadCount === assetKeys.length) buildScene();
        });
        app.assets.add(asset);
        app.assets.load(asset);
    });

    // ═══════════════════════════════════════════════════════════════
    // COLLAPSIBLE PANEL SECTIONS
    // ═══════════════════════════════════════════════════════════════

    function createSection(parent, title, defaultOpen) {
        var section = document.createElement('div');
        section.className = 'panel-section';

        var header = document.createElement('div');
        header.className = 'panel-section-header';

        var arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = defaultOpen ? '\u25BE' : '\u25B8';
        header.appendChild(arrow);

        var text = document.createTextNode(title);
        header.appendChild(text);

        var body = document.createElement('div');
        body.className = 'panel-section-body' + (defaultOpen ? '' : ' collapsed');

        header.addEventListener('click', function() {
            var isOpen = !body.classList.contains('collapsed');
            body.classList.toggle('collapsed');
            arrow.textContent = isOpen ? '\u25B8' : '\u25BE';
        });

        section.appendChild(header);
        section.appendChild(body);
        parent.appendChild(section);

        return body;
    }

    // ═══════════════════════════════════════════════════════════════
    // SCENE BUILD
    // ═══════════════════════════════════════════════════════════════

    function buildScene() {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('camera-panel').style.display = '';
        document.getElementById('transform-panel').style.display = '';

        // ── Focus Peaking SVG Filter ──
        var focusPeakingEnabled = false;
        var focusPeakingColor = 'red'; // 'red', 'green', 'blue'

        var fpSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        fpSvg.style.cssText = 'position:absolute;width:0;height:0;';
        fpSvg.innerHTML = '<defs>' +
            '<filter id="focus-peak-red">' +
                '<feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="edges"/>' +
                '<feColorMatrix type="matrix" in="edges" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 3 -0.5" result="red-edges"/>' +
                '<feBlend mode="screen" in="SourceGraphic" in2="red-edges"/>' +
            '</filter>' +
            '<filter id="focus-peak-green">' +
                '<feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="edges"/>' +
                '<feColorMatrix type="matrix" in="edges" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 3 -0.5" result="green-edges"/>' +
                '<feBlend mode="screen" in="SourceGraphic" in2="green-edges"/>' +
            '</filter>' +
            '<filter id="focus-peak-blue">' +
                '<feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="edges"/>' +
                '<feColorMatrix type="matrix" in="edges" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 3 -0.5" result="blue-edges"/>' +
                '<feBlend mode="screen" in="SourceGraphic" in2="blue-edges"/>' +
            '</filter>' +
        '</defs>';
        document.body.appendChild(fpSvg);

        // World splat
        var world = new pc.Entity('World');
        world.addComponent('gsplat', { asset: assets.splat });
        app.root.addChild(world);

        // Characters
        var phop = null, davinci = null;

        if (assets.phop.resource) {
            phop = assets.phop.resource.instantiateRenderEntity();
            phop.name = 'Phop';
            phop.setLocalPosition(-0.64, -0.50, 0.00);
            phop.setLocalEulerAngles(90, 90, 0);
            app.root.addChild(phop);
        }

        if (assets.davinci.resource) {
            davinci = assets.davinci.resource.instantiateRenderEntity();
            davinci.name = 'Davinci';
            davinci.setLocalPosition(0.11, -0.47, -0.01);
            davinci.setLocalEulerAngles(90, -90, 0);
            app.root.addChild(davinci);
        }

        // ── Fix PBR rendering: environment map + material boost ──
        // PBR materials need ambient/environment lighting to show textures properly.
        // Without this, they look flat/clay regardless of texture quality.
        function boostCharacterMaterials(entity) {
            if (!entity) return;
            var renders = entity.findComponents('render');
            renders.forEach(function(renderComp) {
                if (!renderComp.meshInstances) return;
                renderComp.meshInstances.forEach(function(mi) {
                    var mat = mi.material;
                    if (!mat) return;
                    // Boost ambient response so directional lights show the textures
                    mat.ambient = new pc.Color(1, 1, 1);
                    mat.ambientTint = true;
                    // Reduce metalness — most character materials are non-metallic (skin, fabric)
                    if (mat.metalness > 0.3) mat.metalness = 0.1;
                    // Ensure diffuse map shows through
                    if (mat.diffuse) {
                        mat.diffuse = new pc.Color(1, 1, 1);
                    }
                    // Boost the overall brightness
                    mat.emissiveIntensity = 0.15;
                    mat.update();
                });
            });
        }
        boostCharacterMaterials(phop);
        boostCharacterMaterials(davinci);

        // Increase ambient light for character visibility
        app.scene.ambientLight = new pc.Color(0.5, 0.5, 0.55);

        // Add a hemisphere-style fill: second softer directional from below
        var rimLight = new pc.Entity('Rim');
        rimLight.addComponent('light', {
            type: 'directional', color: new pc.Color(0.6, 0.65, 0.8),
            intensity: 0.6, castShadows: false
        });
        rimLight.setEulerAngles(-30, 0, 0); // from below/front
        app.root.addChild(rimLight);

        // Lights
        var sun = new pc.Entity('Sun');
        sun.addComponent('light', {
            type: 'directional', color: new pc.Color(1, 0.95, 0.88),
            intensity: 1.5, castShadows: true, shadowBias: 0.2,
            normalOffsetBias: 0.05, shadowResolution: 2048
        });
        sun.setEulerAngles(50, 140, 0);
        app.root.addChild(sun);

        var fill = new pc.Entity('Fill');
        fill.addComponent('light', {
            type: 'directional', color: new pc.Color(0.7, 0.8, 1.0),
            intensity: 0.4, castShadows: false
        });
        fill.setEulerAngles(30, -40, 0);
        app.root.addChild(fill);

        app.scene.ambientLight = new pc.Color(0.25, 0.28, 0.35);

        // Audio
        if (assets.ambient.resource) {
            var audio = new pc.Entity('Ambient');
            audio.addComponent('sound');
            audio.sound.addSlot('loop', { asset: assets.ambient, loop: true, autoPlay: true, volume: 0.4 });
            app.root.addChild(audio);
            canvas.addEventListener('mousedown', function () {
                var ctx = app.systems.sound && app.systems.sound.context;
                if (ctx && ctx.state === 'suspended') ctx.resume();
            }, { once: true });
        }

        // Camera — use real sensor math from activeBody at current focal length
        var camera = new pc.Entity('Camera');
        camera.addComponent('camera', {
            clearColor: new pc.Color(0.06, 0.06, 0.1),
            fov: NEUTRAL_FOV, nearClip: 0.05, farClip: 2000
        });
        // Start at eye level, slightly back, looking at the characters
        camera.setPosition(0, 1.65, 2.5);
        camera.setEulerAngles(-3, 0, 0); // slight downward tilt
        app.root.addChild(camera);

        // Entity list for panels
        var entities = [];
        if (phop) entities.push({ name: 'Phop', entity: phop });
        if (davinci) entities.push({ name: 'Davinci', entity: davinci });

        // Push initial undo state
        pushUndo(entities);

        // ───────────────────────────────────────────────────────────
        // ORBIT CONTROLLER
        // ───────────────────────────────────────────────────────────

        var orbit = {
            target: new pc.Vec3(0, 1.0, 0),
            distance: 2.04, yaw: 0, pitch: 12,
            dragging: false, panning: false,
            lastX: 0, lastY: 0
        };

        var smooth = {
            tx: 0, ty: 1.0, tz: 0,
            d: 2.04, y: 0, p: 12
        };

        // Fly mode state
        var flyYaw = 0, flyPitch = -3; // match initial camera tilt

        // Camera bookmarks
        var bookmarks = {
            bookmark1: { tx: 0,    ty: 1.0, tz: 0,    d: 5.0,  y: 0,   p: 7 },
            bookmark2: { tx: 0.1,  ty: 1.2, tz: 0,    d: 1.5,  y: 55,  p: 5 },
            bookmark3: { tx: -0.1, ty: 1.2, tz: 0,    d: 1.5,  y: -55, p: 5 },
            bookmark4: { tx: 0,    ty: 1.0, tz: 0,    d: 2.04, y: 0,   p: 12 }
        };

        // Character POV — hardcoded from user-dialed values
        function getCharPov(name) {
            if (name === 'Phop') {
                return { pos: new pc.Vec3(-0.580, 0.580, -0.002), yaw: -90.8, pitch: -2.0 };
            } else {
                return { pos: new pc.Vec3(0.050, 0.600, -0.008), yaw: 92.0, pitch: -9.0 };
            }
        }

        // ───────────────────────────────────────────────────────────
        // MOUSE CONTROLS
        // ───────────────────────────────────────────────────────────

        canvas.addEventListener('mousedown', function (e) {
            if (cameraLocked || cameraMode === 'path') return;
            if (cameraMode === 'orbit') {
                if (e.shiftKey) orbit.panning = true;
                else if (e.button === 0) orbit.dragging = true;
            } else if (cameraMode === 'fly') {
                orbit.dragging = true;
            }
            orbit.lastX = e.clientX;
            orbit.lastY = e.clientY;
        });

        window.addEventListener('mouseup', function () {
            orbit.dragging = false;
            orbit.panning = false;
        });

        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

        canvas.addEventListener('mousemove', function (e) {
            if (cameraLocked || cameraMode === 'path') return;
            var dx = e.clientX - orbit.lastX;
            var dy = e.clientY - orbit.lastY;
            orbit.lastX = e.clientX;
            orbit.lastY = e.clientY;

            if (cameraMode === 'orbit') {
                if (orbit.dragging) {
                    smooth.y -= dx * 0.3;
                    smooth.p = Math.max(-89, Math.min(89, smooth.p + dy * 0.3));
                } else if (orbit.panning) {
                    var right = new pc.Vec3();
                    var up = new pc.Vec3();
                    camera.getWorldTransform().getX(right);
                    camera.getWorldTransform().getY(up);
                    var ps = 0.002 * orbit.distance;
                    smooth.tx -= right.x * dx * ps + up.x * (-dy) * ps;
                    smooth.ty -= right.y * dx * ps + up.y * (-dy) * ps;
                    smooth.tz -= right.z * dx * ps + up.z * (-dy) * ps;
                }
            } else if (cameraMode === 'fly' && orbit.dragging) {
                flyYaw -= dx * 0.2;
                flyPitch = Math.max(-89, Math.min(89, flyPitch - dy * 0.2));
            }
        });

        canvas.addEventListener('wheel', function (e) {
            if (cameraLocked || cameraMode === 'path') return;
            if (cameraMode === 'orbit') {
                smooth.d = Math.max(0.3, Math.min(30, smooth.d * (1 + e.deltaY * 0.001)));
            } else if (cameraMode === 'fly') {
                camera.translateLocal(0, 0, e.deltaY * 0.005);
            }
            e.preventDefault();
        }, { passive: false });

        // ───────────────────────────────────────────────────────────
        // KEYBOARD
        // ───────────────────────────────────────────────────────────

        window.addEventListener('keydown', function (e) {
            keysDown[e.code] = true;

            // Don't process hotkeys when typing in an input or select
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            // Ctrl+Z undo
            if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
                e.preventDefault();
                popUndo(entities);
                return;
            }

            // Settings modal intercepts
            if (settingsListening) return;

            var action = actionForKey(e.code);
            if (!action) return;

            if (action === 'settings') {
                toggleSettings();
            } else if (action.startsWith('bookmark')) {
                var bm = bookmarks[action];
                if (bm) {
                    cameraMode = 'orbit';
                    trackTarget = null;
                    smooth.tx = bm.tx; smooth.ty = bm.ty; smooth.tz = bm.tz;
                    smooth.d = bm.d; smooth.y = bm.y; smooth.p = bm.p;
                    updateModeUI();
                    flashBadge(bindings[action].label);
                }
            } else if (action === 'povPhop' || action === 'povDavinci') {
                var charName = action === 'povPhop' ? 'Phop' : 'Davinci';
                var pov = getCharPov(charName);
                if (pov) {
                    cameraMode = 'fly';
                    trackTarget = null;
                    camera.setPosition(pov.pos);
                    flyYaw = pov.yaw;
                    flyPitch = pov.pitch;
                    // Reset POV adjust sliders
                    lastPovOffX = 0; lastPovOffY = 0; lastPovOffZ = 0;
                    povOffX.input.value = 0; povOffX.valEl.textContent = '0.00';
                    povOffY.input.value = 0; povOffY.valEl.textContent = '0.00';
                    povOffZ.input.value = 0; povOffZ.valEl.textContent = '0.00';
                    povYaw.input.value = flyYaw; povYaw.valEl.textContent = flyYaw.toFixed(1);
                    povPitch.input.value = flyPitch; povPitch.valEl.textContent = flyPitch.toFixed(1);
                    updateModeUI();
                    flashBadge(charName + ' POV');
                }
            } else if (action === 'toggleFly') {
                if (cameraMode === 'fly') {
                    cameraMode = 'orbit';
                    smooth.tx = orbit.target.x; smooth.ty = orbit.target.y; smooth.tz = orbit.target.z;
                } else {
                    cameraMode = 'fly';
                    var euler = camera.getEulerAngles();
                    flyYaw = euler.y; flyPitch = euler.x;
                }
                trackTarget = null;
                updateModeUI();
                flashBadge(cameraMode);
            } else if (action === 'toggleViewfinder') {
                var vf = document.getElementById('viewfinder');
                vf.classList.toggle('active');
                updateCameraLook();
                flashBadge(vf.classList.contains('active') ? 'viewfinder on' : 'viewfinder off');
            } else if (action === 'lockCamera') {
                cameraLocked = !cameraLocked;
                updateModeUI();
                flashBadge(cameraLocked ? 'camera locked' : 'camera unlocked');
            } else if (action === 'lockPhop' || action === 'lockDavinci') {
                var tn = action === 'lockPhop' ? 'Phop' : 'Davinci';
                if (trackTarget === tn) {
                    trackTarget = null;
                    cameraMode = 'orbit';
                } else {
                    trackTarget = tn;
                    cameraMode = 'track';
                }
                updateModeUI();
                flashBadge(trackTarget ? 'tracking ' + tn : 'tracking off');
            } else if (action === 'capture') {
                e.preventDefault();
                if (e.shiftKey) {
                    captureAllCameras();
                } else {
                    captureSnapshot();
                }
            } else if (action === 'cycleCamera') {
                e.preventDefault();
                if (cameras && cameras.length > 1) {
                    var idx = cameras.findIndex(function(c) { return c.id === activeCamId; });
                    var next = (idx + 1) % cameras.length;
                    switchCamera(cameras[next].id);
                    flashBadge(cameras[next].name);
                }
            }
        });

        window.addEventListener('keyup', function (e) {
            keysDown[e.code] = false;
        });

        // ───────────────────────────────────────────────────────────
        // CAMERA PATH ANIMATION
        // ───────────────────────────────────────────────────────────

        var cameraPath = {
            keyframes: [],
            duration: 5,
            playing: false,
            playTime: 0,
            loop: false
        };

        function addKeyframe() {
            var pos = camera.getPosition().clone();
            var rot = camera.getEulerAngles().clone();

            cameraPath.keyframes.push({
                time: 0,
                position: pos,
                rotation: rot,
                fov: camera.camera.fov
            });

            redistributeKeyframeTimes();
            renderKeyframeList();
            flashBadge('keyframe ' + cameraPath.keyframes.length + ' added');
        }

        function redistributeKeyframeTimes() {
            var n = cameraPath.keyframes.length;
            for (var i = 0; i < n; i++) {
                cameraPath.keyframes[i].time = n === 1 ? 0 : i / (n - 1);
            }
        }

        function removeKeyframe(index) {
            cameraPath.keyframes.splice(index, 1);
            redistributeKeyframeTimes();
            renderKeyframeList();
        }

        function goToKeyframe(index) {
            var kf = cameraPath.keyframes[index];
            camera.setPosition(kf.position);
            camera.setEulerAngles(kf.rotation.x, kf.rotation.y, kf.rotation.z);
            camera.camera.fov = kf.fov;
            flyYaw = kf.rotation.y;
            flyPitch = kf.rotation.x;
        }

        function interpolateKeyframes(keyframes, t) {
            var n = keyframes.length;
            if (t <= 0) return keyframes[0];
            if (t >= 1) return keyframes[n - 1];

            var i = 0;
            for (var k = 0; k < n - 1; k++) {
                if (t >= keyframes[k].time && t <= keyframes[k + 1].time) {
                    i = k;
                    break;
                }
            }

            var segStart = keyframes[i].time;
            var segEnd = keyframes[i + 1].time;
            var lt = (segEnd - segStart) > 0 ? (t - segStart) / (segEnd - segStart) : 0;

            // Smoothstep easing
            lt = lt * lt * (3 - 2 * lt);

            var pos = new pc.Vec3();
            pos.lerp(keyframes[i].position, keyframes[i + 1].position, lt);

            var rot = new pc.Vec3();
            rot.lerp(keyframes[i].rotation, keyframes[i + 1].rotation, lt);

            var fov = keyframes[i].fov + (keyframes[i + 1].fov - keyframes[i].fov) * lt;

            return { position: pos, rotation: rot, fov: fov };
        }

        function playPath() {
            if (cameraPath.keyframes.length < 2) {
                flashBadge('need at least 2 keyframes');
                return;
            }
            cameraPath.playing = true;
            cameraPath.playTime = 0;
            cameraMode = 'path';
            updateModeUI();
        }

        function stopPath() {
            cameraPath.playing = false;
            cameraMode = 'fly';
            var euler = camera.getEulerAngles();
            flyYaw = euler.y;
            flyPitch = euler.x;
            updateModeUI();
            if (typeof animPlayBtn !== 'undefined') {
                animPlayBtn.textContent = '\u25B6 play';
                animPlayBtn.classList.remove('active');
            }
        }

        // ───────────────────────────────────────────────────────────
        // UPDATE LOOP
        // ───────────────────────────────────────────────────────────

        var DEG2RAD = Math.PI / 180;

        app.on('update', function (dt) {
            // Camera path playback
            if (cameraPath.playing && cameraPath.keyframes.length >= 2) {
                cameraPath.playTime += dt / cameraPath.duration;

                if (cameraPath.playTime >= 1) {
                    if (cameraPath.loop) {
                        cameraPath.playTime = 0;
                    } else {
                        cameraPath.playTime = 1;
                        stopPath();
                    }
                }

                if (cameraPath.playing) {
                    var pathT = cameraPath.playTime;
                    var result = interpolateKeyframes(cameraPath.keyframes, pathT);
                    camera.setPosition(result.position);
                    camera.setEulerAngles(result.rotation.x, result.rotation.y, result.rotation.z);
                    camera.camera.fov = result.fov;
                }
            }

            // Fly mode movement (WASD / arrows)
            if (cameraMode === 'fly' && !cameraLocked) {
                var speed = 2 * dt;
                if (keysDown['ShiftLeft'] || keysDown['ShiftRight']) speed *= 3;

                if (keysDown[bindings.moveForward.key] || keysDown['ArrowUp'])    camera.translateLocal(0, 0, -speed);
                if (keysDown[bindings.moveBack.key]    || keysDown['ArrowDown'])   camera.translateLocal(0, 0, speed);
                if (keysDown[bindings.moveLeft.key]    || keysDown['ArrowLeft'])    camera.translateLocal(-speed, 0, 0);
                if (keysDown[bindings.moveRight.key]   || keysDown['ArrowRight'])   camera.translateLocal(speed, 0, 0);
                if (keysDown[bindings.moveUp.key])     camera.translateLocal(0, speed, 0);
                if (keysDown[bindings.moveDown.key])   camera.translateLocal(0, -speed, 0);

                camera.setEulerAngles(flyPitch, flyYaw, 0);
            }

            // Orbit mode
            if (cameraMode === 'orbit' && !cameraLocked) {
                var t = 1 - Math.exp(-8 * dt);
                orbit.target.x += (smooth.tx - orbit.target.x) * t;
                orbit.target.y += (smooth.ty - orbit.target.y) * t;
                orbit.target.z += (smooth.tz - orbit.target.z) * t;
                orbit.distance += (smooth.d - orbit.distance) * t;
                orbit.yaw += (smooth.y - orbit.yaw) * t;
                orbit.pitch += (smooth.p - orbit.pitch) * t;

                var yr = orbit.yaw * DEG2RAD;
                var pr = orbit.pitch * DEG2RAD;
                camera.setPosition(
                    orbit.target.x + orbit.distance * Math.sin(yr) * Math.cos(pr),
                    orbit.target.y + orbit.distance * Math.sin(pr),
                    orbit.target.z + orbit.distance * Math.cos(yr) * Math.cos(pr)
                );
                camera.lookAt(orbit.target);
            }

            // Track mode
            if (cameraMode === 'track' && trackTarget) {
                var trackEnt = trackTarget === 'Phop' ? phop : davinci;
                if (trackEnt) {
                    var tp = trackEnt.getPosition();
                    var headPos = new pc.Vec3(tp.x, tp.y + 1.2, tp.z);

                    var t2 = 1 - Math.exp(-4 * dt);
                    orbit.target.x += (headPos.x - orbit.target.x) * t2;
                    orbit.target.y += (headPos.y - orbit.target.y) * t2;
                    orbit.target.z += (headPos.z - orbit.target.z) * t2;

                    smooth.tx = headPos.x; smooth.ty = headPos.y; smooth.tz = headPos.z;

                    var yr2 = orbit.yaw * DEG2RAD;
                    var pr2 = orbit.pitch * DEG2RAD;
                    camera.setPosition(
                        orbit.target.x + orbit.distance * Math.sin(yr2) * Math.cos(pr2),
                        orbit.target.y + orbit.distance * Math.sin(pr2),
                        orbit.target.z + orbit.distance * Math.cos(yr2) * Math.cos(pr2)
                    );
                    camera.lookAt(orbit.target);
                }
            }

            // Update viewfinder info
            updateViewfinderInfo();

            // Update viewfinder timecode
            vfElapsedTime += dt;
            var vfTC = document.getElementById('vf-timecode');
            if (vfTC) {
                var h = Math.floor(vfElapsedTime / 3600) % 24;
                var m = Math.floor(vfElapsedTime / 60) % 60;
                var s = Math.floor(vfElapsedTime) % 60;
                var f = Math.floor((vfElapsedTime % 1) * 24); // 24fps
                vfTC.textContent = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + ':' + String(f).padStart(2,'0');
            }
        });

        // ───────────────────────────────────────────────────────────
        // CAMERA PANEL
        // ───────────────────────────────────────────────────────────

        var camBody = document.getElementById('cam-body');
        var camToggle = document.getElementById('cam-toggle');
        var camOpen = true;
        camToggle.addEventListener('click', function () {
            camOpen = !camOpen;
            camBody.style.display = camOpen ? '' : 'none';
            camToggle.textContent = 'camera ' + (camOpen ? '\u25BE' : '\u25B8');
        });

        // ── Create accordion sections ──
        var secCamera = createSection(camBody, 'Camera', true);
        var secControls = createSection(camBody, 'Controls', true);
        var secAnimation = createSection(camBody, 'Animation', false);
        var secViewfinder = createSection(camBody, 'Viewfinder', false);
        var secDOF = createSection(camBody, 'DOF', false);
        var secPOV = createSection(camBody, 'POV Adjust', false);
        var secLighting = createSection(camBody, 'Lighting', false);
        var secVariants = createSection(camBody, 'World Variants', false);
        var secShotList = createSection(camBody, 'Shot List', false);
        var secReset = createSection(camBody, 'Reset', false);

        // ── Camera Preset Selector ──
        var cameraPresets = [
            { label: '— Select Preset —', body: null, lens: null },
            // Drama / TV
            { label: 'Warm Drama (ARRI + Cooke S4)', body: 'arri-alexa-35', lens: 'cooke-s4i', focal: 50, aperture: 2.0, description: 'TV drama standard — warm filmic skin' },
            { label: 'Premium Drama (ARRI + Signature)', body: 'arri-alexa-35', lens: 'arri-signature-prime', focal: 40, aperture: 1.8, description: 'The Batman, Dune — organic large-format' },
            { label: 'Painterly (ARRI + Leica Summilux)', body: 'arri-alexa-35', lens: 'leica-summilux-c', focal: 35, aperture: 1.4, description: 'Stranger Things, Mank — creamy sharpness' },
            // Blockbuster
            { label: 'Modern Blockbuster (Venice + Cooke Ana)', body: 'sony-venice-2', lens: 'cooke-anamorphic-i', focal: 50, aperture: 2.3, description: 'Top Gun, A Star Is Born — premium anamorphic' },
            { label: 'Epic Anamorphic (ARRI LF + Ultra Vista)', body: 'arri-alexa-mini-lf', lens: 'panavision-ultra-vista', focal: 65, aperture: 2.0, description: 'Dune, Mandalorian — epic large-format anamorphic' },
            { label: 'Sci-Fi Clean (RED + Zeiss Master)', body: 'red-v-raptor', lens: 'zeiss-master-prime', focal: 35, aperture: 1.3, description: 'Blade Runner 2049, Sicario — clinical precision' },
            // Vintage
            { label: 'Vintage 70s (ARRI LF + Canon K-35)', body: 'arri-alexa-mini-lf', lens: 'canon-k35', focal: 35, aperture: 1.3, description: 'Barry Lyndon feel — warm faded halation' },
            { label: 'Classic Hollywood (ARRI + Speed Panchro)', body: 'arri-alexa-35', lens: 'cooke-speed-panchro', focal: 50, aperture: 2.0, description: 'Killers of the Flower Moon — vintage Cooke warmth' },
            { label: 'Soviet Dream (Any + Helios 44-2)', body: 'arri-alexa-35', lens: 'helios-44-2', focal: 58, aperture: 2.0, description: 'Swirly bokeh, dreamy Soviet character' },
            { label: 'Godfather (Any + Super Baltar)', body: 'arri-alexa-35', lens: 'bausch-lomb-super-baltar', focal: 50, aperture: 2.3, description: 'Ethereal, romantic, vintage Hollywood' },
            // Modern Indie
            { label: 'Indie Anamorphic (RED + Atlas Orion)', body: 'red-komodo-x', lens: 'atlas-orion', focal: 50, aperture: 2.0, description: 'Babylon, Dont Look Up — affordable anamorphic' },
            { label: 'Affordable Cinema (BM6K + Sigma)', body: 'blackmagic-pocket-6k-pro', lens: 'sigma-cine-ff-high-speed', focal: 35, aperture: 1.5, description: 'Clean modern indie — Nuts own kit' },
            { label: 'Vintage Indie (BM6K + Sigma Classic Art)', body: 'blackmagic-pocket-6k-pro', lens: 'sigma-cine-ff-classic-art', focal: 50, aperture: 2.5, description: 'Uncoated low contrast character' },
            // Large Format
            { label: 'IMAX (ARRI 65 + Primo 70)', body: 'arri-alexa-65', lens: 'panavision-primo-70', focal: 50, aperture: 2.0, description: 'Oppenheimer, Avengers — monumental scale' },
            { label: 'Warm Large Format (RED + Thalia)', body: 'red-v-raptor', lens: 'leitz-thalia', focal: 55, aperture: 2.6, description: 'Stranger Things S3 — Leica warmth on large format' },
            // Classic Anamorphic
            { label: 'Star Wars Original (Any + Panavision C)', body: 'arri-alexa-35', lens: 'panavision-c-series', focal: 50, aperture: 2.3, description: 'Star Wars 1977, Blade Runner — classic Hollywood anamorphic' },
            { label: 'John Wick (ARRI + Master Anamorphic)', body: 'arri-alexa-35', lens: 'arri-master-anamorphic', focal: 50, aperture: 1.9, description: 'John Wick Ch4 — clean modern anamorphic' }
        ];

        var presetLabel = document.createElement('div');
        presetLabel.className = 'section-label';
        presetLabel.textContent = 'preset';
        secCamera.appendChild(presetLabel);

        var presetRow = document.createElement('div');
        presetRow.className = 'select-row';
        var presetSelect = document.createElement('select');
        cameraPresets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.body ? JSON.stringify(p) : '';
            opt.textContent = p.label;
            presetSelect.appendChild(opt);
        });
        presetRow.appendChild(presetSelect);
        secCamera.appendChild(presetRow);

        var presetDesc = document.createElement('div');
        presetDesc.className = 'lens-info';
        presetDesc.textContent = '';
        secCamera.appendChild(presetDesc);

        // ── Camera Body Selector ──
        var bodySelectRow = document.createElement('div');
        bodySelectRow.className = 'select-row';
        var bodySelect = document.createElement('select');
        cameraBodies.forEach(function (b) {
            var opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.manufacturer + ' — ' + b.name;
            if (b.id === activeBody.id) opt.selected = true;
            bodySelect.appendChild(opt);
        });
        bodySelectRow.appendChild(bodySelect);
        secCamera.appendChild(bodySelectRow);

        var bodyDesc = document.createElement('div');
        bodyDesc.className = 'lens-info';
        bodyDesc.textContent = activeBody.description;
        secCamera.appendChild(bodyDesc);

        // ── Lens Family Selector ──
        var lensSelectRow = document.createElement('div');
        lensSelectRow.className = 'select-row';
        var lensSelect = document.createElement('select');

        function buildLensOptions() {
            lensSelect.innerHTML = '';
            var types = { spherical: 'Spherical', anamorphic: 'Anamorphic', vintage: 'Vintage' };
            for (var type in types) {
                var group = document.createElement('optgroup');
                group.label = types[type];
                lenses.filter(function (l) { return l.type === type; }).forEach(function (l) {
                    var opt = document.createElement('option');
                    opt.value = l.id;
                    opt.textContent = l.manufacturer + ' — ' + l.name;
                    if (l.id === activeLens.id) opt.selected = true;
                    group.appendChild(opt);
                });
                lensSelect.appendChild(group);
            }
        }
        buildLensOptions();
        lensSelectRow.appendChild(lensSelect);
        secCamera.appendChild(lensSelectRow);

        var lensDesc = document.createElement('div');
        lensDesc.className = 'lens-info';
        lensDesc.textContent = activeLens.characteristics;
        secCamera.appendChild(lensDesc);

        // ── Focal Length Dropdown ──
        var flSelectRow = document.createElement('div');
        flSelectRow.className = 'select-row';
        var flSelect = document.createElement('select');

        function buildFocalLengthOptions() {
            flSelect.innerHTML = '';
            activeLens.focalLengths.forEach(function (fl) {
                var opt = document.createElement('option');
                opt.value = fl;
                opt.textContent = fl + 'mm';
                if (fl === focalLength) opt.selected = true;
                flSelect.appendChild(opt);
            });
        }
        buildFocalLengthOptions();
        flSelectRow.appendChild(flSelect);
        secCamera.appendChild(flSelectRow);

        // Body change handler
        bodySelect.addEventListener('change', function () {
            activeBody = getBody(bodySelect.value);
            state.bodyId = activeBody.id;
            bodyDesc.textContent = activeBody.description;
            presetSelect.value = '';
            presetDesc.textContent = '';
            applyViewfinderStyle();
            updateCameraLook();
        });

        // Lens change handler
        lensSelect.addEventListener('change', function () {
            activeLens = getLens(lensSelect.value);
            state.lensId = activeLens.id;
            lensDesc.textContent = activeLens.characteristics;
            presetSelect.value = '';
            presetDesc.textContent = '';
            focalLength = nearestFocalLength(activeLens, focalLength);
            state.focalLength = focalLength;
            buildFocalLengthOptions();
            // Update aperture max
            var currentMax = activeLens.maxAperture;
            if (aperture < currentMax) {
                aperture = currentMax;
                state.aperture = aperture;
                apSlider.input.value = aperture;
                apSlider.valEl.textContent = formatVal(aperture, 0.1);
            }
            updateCameraLook();
        });

        // Focal length change handler
        flSelect.addEventListener('change', function () {
            focalLength = parseFloat(flSelect.value);
            state.focalLength = focalLength;
            updateCameraLook();
        });

        // ── Preset change handler ──
        presetSelect.addEventListener('change', function() {
            if (!presetSelect.value) {
                presetDesc.textContent = '';
                return;
            }
            var p = JSON.parse(presetSelect.value);

            // Update body
            activeBody = getBody(p.body);
            state.bodyId = activeBody.id;
            bodySelect.value = activeBody.id;
            bodyDesc.textContent = activeBody.description;

            // Update lens
            activeLens = getLens(p.lens);
            state.lensId = activeLens.id;
            buildLensOptions();
            lensSelect.value = activeLens.id;
            lensDesc.textContent = activeLens.characteristics;

            // Update focal length
            focalLength = p.focal;
            state.focalLength = focalLength;
            buildFocalLengthOptions();

            // Update aperture
            aperture = p.aperture;
            state.aperture = aperture;
            apSlider.input.value = aperture;
            apSlider.valEl.textContent = formatVal(aperture, 0.1);

            // Show preset description
            presetDesc.textContent = p.description;

            // Apply viewfinder style and camera look
            applyViewfinderStyle();
            updateCameraLook();

            flashBadge(p.label);
        });

        // ── Aspect Ratio / Delivery Format ─────────────────────────
        var arSelectRow = document.createElement('div');
        arSelectRow.className = 'select-row';
        var arSelect = document.createElement('select');
        var aspectOptions = [
            { value: 0,    label: 'Open Gate (sensor native)' },
            { value: 2.39, label: '2.39:1 — Cinemascope / Scope' },
            { value: 2.0,  label: '2.00:1 — Univisium' },
            { value: 1.85, label: '1.85:1 — Flat / Theatrical' },
            { value: 1.78, label: '1.78:1 — 16:9 / HD' },
            { value: 1.66, label: '1.66:1 — European Widescreen' },
            { value: 1.50, label: '1.50:1 — ARRI LF Open Gate' },
            { value: 1.43, label: '1.43:1 — IMAX' },
            { value: 1.33, label: '1.33:1 — 4:3 Classic' },
            { value: 1.0,  label: '1:1 — Square' }
        ];
        aspectOptions.forEach(function (a) {
            var opt = document.createElement('option');
            opt.value = a.value;
            opt.textContent = a.label;
            arSelect.appendChild(opt);
        });
        arSelectRow.appendChild(arSelect);
        secViewfinder.appendChild(arSelectRow);

        arSelect.addEventListener('change', function () {
            deliveryAspect = parseFloat(arSelect.value);
            updateCameraLook();
        });

        // Viewfinder style applicator
        function applyViewfinderStyle() {
            var vf = document.getElementById('viewfinder');
            vf.setAttribute('data-style', activeBody.viewfinderStyle);
        }
        applyViewfinderStyle();

        // Mode buttons
        var modeRow = document.createElement('div');
        modeRow.className = 'cam-mode-row';
        var modeBtns = {};
        ['orbit', 'fly', 'track'].forEach(function (m) {
            var btn = document.createElement('button');
            btn.className = 'cam-mode-btn' + (m === cameraMode ? ' active' : '');
            btn.textContent = m;
            btn.addEventListener('click', function () {
                // Stop path playback if switching modes manually
                if (cameraPath.playing) stopPath();
                if (m === 'fly') {
                    cameraMode = 'fly';
                    var euler = camera.getEulerAngles();
                    flyYaw = euler.y; flyPitch = euler.x;
                } else if (m === 'track') {
                    cameraMode = 'track';
                    if (!trackTarget) trackTarget = 'Phop';
                } else {
                    cameraMode = 'orbit';
                    trackTarget = null;
                }
                updateModeUI();
            });
            modeBtns[m] = btn;
            modeRow.appendChild(btn);
        });
        secControls.appendChild(modeRow);

        // Aperture
        var apSlider = makeSlider(secControls, 'f/', aperture, 1.4, 22, 0.1, function (v) {
            aperture = v;
            state.aperture = v;
            updateCameraLook();
            updateDOF();
        });

        // Lock buttons
        var lockRow = document.createElement('div');
        lockRow.className = 'lock-row';
        var lockCamBtn = document.createElement('button');
        lockCamBtn.className = 'lock-btn';
        lockCamBtn.textContent = 'camera';
        lockCamBtn.addEventListener('click', function () {
            cameraLocked = !cameraLocked;
            updateModeUI();
        });
        lockRow.appendChild(lockCamBtn);

        var lockPhopBtn = document.createElement('button');
        lockPhopBtn.className = 'lock-btn';
        lockPhopBtn.textContent = 'track phop';
        lockPhopBtn.addEventListener('click', function () {
            trackTarget = trackTarget === 'Phop' ? null : 'Phop';
            cameraMode = trackTarget ? 'track' : 'orbit';
            updateModeUI();
        });
        lockRow.appendChild(lockPhopBtn);

        var lockDavBtn = document.createElement('button');
        lockDavBtn.className = 'lock-btn';
        lockDavBtn.textContent = 'track davinci';
        lockDavBtn.addEventListener('click', function () {
            trackTarget = trackTarget === 'Davinci' ? null : 'Davinci';
            cameraMode = trackTarget ? 'track' : 'orbit';
            updateModeUI();
        });
        lockRow.appendChild(lockDavBtn);
        secControls.appendChild(lockRow);

        // ── ANIMATION SECTION UI ──

        // Add keyframe button
        var addKfBtn = document.createElement('button');
        addKfBtn.className = 'lock-btn';
        addKfBtn.style.width = '100%';
        addKfBtn.textContent = 'add keyframe at current position';
        addKfBtn.addEventListener('click', addKeyframe);
        secAnimation.appendChild(addKfBtn);

        // Keyframe list container
        var kfListEl = document.createElement('div');
        kfListEl.style.cssText = 'margin:6px 0;';
        secAnimation.appendChild(kfListEl);

        // Duration slider
        var durLabel = document.createElement('div');
        durLabel.className = 'section-label';
        durLabel.textContent = 'duration';
        secAnimation.appendChild(durLabel);
        var durSlider = makeSlider(secAnimation, 'sec', cameraPath.duration, 1, 30, 0.5, function(v) {
            cameraPath.duration = v;
        });

        // Play/Stop + Loop + Clear buttons
        var animPlayRow = document.createElement('div');
        animPlayRow.className = 'lock-row';

        var animPlayBtn = document.createElement('button');
        animPlayBtn.className = 'lock-btn';
        animPlayBtn.textContent = '\u25B6 play';
        animPlayBtn.addEventListener('click', function() {
            if (cameraPath.playing) {
                stopPath();
                animPlayBtn.textContent = '\u25B6 play';
                animPlayBtn.classList.remove('active');
            } else {
                playPath();
                if (cameraPath.playing) {
                    animPlayBtn.textContent = '\u25A0 stop';
                    animPlayBtn.classList.add('active');
                }
            }
        });
        animPlayRow.appendChild(animPlayBtn);

        var loopBtn = document.createElement('button');
        loopBtn.className = 'lock-btn';
        loopBtn.textContent = 'loop off';
        loopBtn.addEventListener('click', function() {
            cameraPath.loop = !cameraPath.loop;
            loopBtn.textContent = cameraPath.loop ? 'loop on' : 'loop off';
            loopBtn.classList.toggle('active');
        });
        animPlayRow.appendChild(loopBtn);

        var clearKfBtn = document.createElement('button');
        clearKfBtn.className = 'lock-btn';
        clearKfBtn.textContent = 'clear';
        clearKfBtn.addEventListener('click', function() {
            cameraPath.keyframes = [];
            renderKeyframeList();
            if (cameraPath.playing) stopPath();
            animPlayBtn.textContent = '\u25B6 play';
            animPlayBtn.classList.remove('active');
        });
        animPlayRow.appendChild(clearKfBtn);

        secAnimation.appendChild(animPlayRow);

        // ── QUICK CAMERA SETUP (Film Grammar) ──

        var filmSetups = [
            {
                label: 'Master Wide',
                description: 'Establishing wide shot showing both characters and environment',
                position: [0, 1.65, 4.0],
                rotation: [-5, 0, 0],
                focalLength: 24,
                shotType: 'establishing'
            },
            {
                label: 'Medium Two-Shot',
                description: 'Both characters in frame at medium distance',
                position: [-0.27, 1.1, 2.2],
                rotation: [-3, 0, 0],
                focalLength: 35,
                shotType: 'two-shot'
            },
            {
                label: 'OTS Phop \u2192 Davinci',
                description: 'Over Phops shoulder, Davinci in focus',
                position: [-0.45, 0.7, 0.6],
                rotation: [-5, -50, 0],
                focalLength: 50,
                shotType: 'ots'
            },
            {
                label: 'OTS Davinci \u2192 Phop',
                description: 'Over Davincis shoulder, Phop in focus',
                position: [0.0, 0.7, 0.6],
                rotation: [-5, 50, 0],
                focalLength: 50,
                shotType: 'ots'
            },
            {
                label: 'CU Phop',
                description: 'Close-up on Phop face',
                position: [-0.50, 0.65, 0.5],
                rotation: [-3, -25, 0],
                focalLength: 85,
                shotType: 'close-up'
            },
            {
                label: 'CU Davinci',
                description: 'Close-up on Davinci face',
                position: [0.0, 0.68, 0.5],
                rotation: [-3, 25, 0],
                focalLength: 85,
                shotType: 'close-up'
            },
            {
                label: 'Low Angle Wide',
                description: 'Low angle establishing shot, dramatic',
                position: [-0.27, 0.2, 3.0],
                rotation: [10, 0, 0],
                focalLength: 24,
                shotType: 'wide'
            },
            {
                label: 'High Angle',
                description: 'High angle looking down on both characters',
                position: [-0.27, 2.5, 2.0],
                rotation: [-25, 0, 0],
                focalLength: 35,
                shotType: 'wide'
            },
            {
                label: 'Phop POV',
                description: 'Point of view from Phops eyes',
                position: [-0.580, 0.580, -0.002],
                rotation: [-2, -90.8, 0],
                focalLength: 35,
                shotType: 'pov'
            },
            {
                label: 'Davinci POV',
                description: 'Point of view from Davincis eyes',
                position: [0.050, 0.600, -0.008],
                rotation: [-9, 92, 0],
                focalLength: 35,
                shotType: 'pov'
            }
        ];

        var qsLabel = document.createElement('div');
        qsLabel.className = 'section-label';
        qsLabel.textContent = 'quick camera setup';
        secAnimation.appendChild(qsLabel);

        var qsInfo = document.createElement('div');
        qsInfo.className = 'lens-info';
        qsInfo.textContent = 'auto-create cameras for dialogue scene';
        secAnimation.appendChild(qsInfo);

        var qsAllBtn = document.createElement('button');
        qsAllBtn.className = 'lock-btn';
        qsAllBtn.style.cssText = 'width:100%;margin-bottom:6px;';
        qsAllBtn.textContent = 'create all standard angles';
        qsAllBtn.addEventListener('click', function() {
            filmSetups.forEach(function(setup) {
                addCamera({
                    name: setup.label,
                    focalLength: setup.focalLength,
                    aperture: 2.8,
                    position: new pc.Vec3(setup.position[0], setup.position[1], setup.position[2]),
                    rotation: new pc.Vec3(setup.rotation[0], setup.rotation[1], setup.rotation[2]),
                    shotType: setup.shotType,
                    shotDescription: setup.description
                });
            });
            flashBadge('10 cameras created');
        });
        secAnimation.appendChild(qsAllBtn);

        var qsGrid = document.createElement('div');
        qsGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:3px;';

        filmSetups.forEach(function(setup) {
            var btn = document.createElement('button');
            btn.className = 'lock-btn';
            btn.style.fontSize = '8px';
            btn.textContent = setup.label;
            btn.title = setup.description;
            btn.addEventListener('click', function() {
                addCamera({
                    name: setup.label,
                    focalLength: setup.focalLength,
                    aperture: 2.8,
                    position: new pc.Vec3(setup.position[0], setup.position[1], setup.position[2]),
                    rotation: new pc.Vec3(setup.rotation[0], setup.rotation[1], setup.rotation[2]),
                    shotType: setup.shotType,
                    shotDescription: setup.description
                });
                switchCamera(cameras[cameras.length - 1].id);
                flashBadge(setup.label);
            });
            qsGrid.appendChild(btn);
        });
        secAnimation.appendChild(qsGrid);

        function renderKeyframeList() {
            kfListEl.innerHTML = '';
            cameraPath.keyframes.forEach(function(kf, i) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:3px;font-size:9px;color:#666;';

                var label = document.createElement('span');
                label.style.flex = '1';
                label.textContent = 'KF' + (i+1) + ' (' + (kf.time * 100).toFixed(0) + '%)';

                var goBtn = document.createElement('button');
                goBtn.className = 'lock-btn';
                goBtn.style.cssText = 'padding:2px 6px;font-size:8px;flex:none;';
                goBtn.textContent = 'go';
                (function(idx) {
                    goBtn.addEventListener('click', function() { goToKeyframe(idx); });
                })(i);

                var delBtn = document.createElement('button');
                delBtn.className = 'lock-btn';
                delBtn.style.cssText = 'padding:2px 6px;font-size:8px;flex:none;color:#c33;';
                delBtn.textContent = '\u00D7';
                (function(idx) {
                    delBtn.addEventListener('click', function() { removeKeyframe(idx); });
                })(i);

                row.appendChild(label);
                row.appendChild(goBtn);
                row.appendChild(delBtn);
                kfListEl.appendChild(row);
            });
        }

        // Viewfinder toggle button
        var vfRow = document.createElement('div');
        vfRow.className = 'lock-row';
        var vfBtn = document.createElement('button');
        vfBtn.className = 'lock-btn';
        vfBtn.textContent = 'toggle (V)';
        vfBtn.addEventListener('click', function () {
            document.getElementById('viewfinder').classList.toggle('active');
            updateCameraLook();
        });
        vfRow.appendChild(vfBtn);
        secViewfinder.insertBefore(vfRow, secViewfinder.firstChild);

        // Reset cameras
        var resetRow = document.createElement('div');
        resetRow.className = 'lock-row';
        var resetBtn = document.createElement('button');
        resetBtn.className = 'lock-btn';
        resetBtn.textContent = 'reset cameras';
        resetBtn.addEventListener('click', function() {
            if (confirm('Reset all cameras to default?')) {
                localStorage.removeItem('ib-cameras');
                cameras.length = 0;
                activeCamId = null;
                camSeqId = 0;
                window._snapshotSeq = 0;
                addCamera({ name: 'Wide Master' });
                switchCamera(cameras[0].id);
                flashBadge('cameras reset');
            }
        });
        resetRow.appendChild(resetBtn);
        secReset.appendChild(resetRow);

        // ── Shot List Panel ──

        // Shot type dropdown for active camera
        var stLabel = document.createElement('div');
        stLabel.className = 'section-label';
        stLabel.textContent = 'current shot';
        secShotList.appendChild(stLabel);

        var shotTypes = ['wide', 'medium', 'close-up', 'extreme-close-up', 'insert', 'pov', 'ots', 'establishing', 'two-shot'];
        var stRow = document.createElement('div');
        stRow.className = 'select-row';
        var stSelect = document.createElement('select');
        shotTypes.forEach(function(t) {
            var opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t.replace(/-/g, ' ').toUpperCase();
            stSelect.appendChild(opt);
        });
        stRow.appendChild(stSelect);
        secShotList.appendChild(stRow);

        // Shot description input
        var sdInput = document.createElement('input');
        sdInput.type = 'text';
        sdInput.placeholder = 'shot description...';
        sdInput.style.cssText = 'width:100%;padding:4px 6px;background:#1a1a22;border:1px solid #333;border-radius:3px;color:#aaa;font-family:inherit;font-size:9px;margin:4px 0;outline:none;box-sizing:border-box;';
        sdInput.addEventListener('keydown', function(e) { e.stopPropagation(); });
        secShotList.appendChild(sdInput);

        // Shot notes input
        var snInput = document.createElement('input');
        snInput.type = 'text';
        snInput.placeholder = 'notes...';
        snInput.style.cssText = 'width:100%;padding:4px 6px;background:#1a1a22;border:1px solid #333;border-radius:3px;color:#aaa;font-family:inherit;font-size:9px;margin:4px 0;outline:none;box-sizing:border-box;';
        snInput.addEventListener('keydown', function(e) { e.stopPropagation(); });
        secShotList.appendChild(snInput);

        // Save shot info when changed
        function saveShotInfo() {
            var cam = cameras.find(function(c) { return c.id === activeCamId; });
            if (cam) {
                cam.shotType = stSelect.value;
                cam.shotDescription = sdInput.value;
                cam.shotNotes = snInput.value;
                saveCameraState();
                renderShotList();
            }
        }
        stSelect.addEventListener('change', saveShotInfo);
        sdInput.addEventListener('change', saveShotInfo);
        snInput.addEventListener('change', saveShotInfo);

        // Load shot info when camera switches
        function loadShotInfo() {
            var cam = cameras.find(function(c) { return c.id === activeCamId; });
            if (cam) {
                stSelect.value = cam.shotType || 'medium';
                sdInput.value = cam.shotDescription || '';
                snInput.value = cam.shotNotes || '';
            }
        }

        // ── Shot List Display ──

        var slLabel = document.createElement('div');
        slLabel.className = 'section-label';
        slLabel.textContent = 'all shots';
        secShotList.appendChild(slLabel);

        var slListEl = document.createElement('div');
        slListEl.style.cssText = 'margin:4px 0;max-height:200px;overflow-y:auto;';
        secShotList.appendChild(slListEl);

        function renderShotList() {
            slListEl.innerHTML = '';
            cameras.forEach(function(cam, i) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:4px;align-items:center;padding:3px 0;font-size:9px;color:' + (cam.id === activeCamId ? '#e87400' : '#666') + ';cursor:pointer;border-bottom:1px solid #1a1a1a;';

                var num = document.createElement('span');
                num.style.cssText = 'width:16px;flex-shrink:0;color:#444;';
                num.textContent = (i + 1) + '.';

                var info = document.createElement('span');
                info.style.flex = '1';
                var typeTag = (cam.shotType || 'medium').toUpperCase().substring(0, 4);
                info.textContent = cam.name + ' [' + typeTag + ']' + (cam.shotDescription ? ' \u2014 ' + cam.shotDescription : '');

                row.appendChild(num);
                row.appendChild(info);

                row.addEventListener('click', function() { switchCamera(cam.id); });
                slListEl.appendChild(row);
            });
        }

        // ── Export Shot List ──

        var exportBtn = document.createElement('button');
        exportBtn.className = 'copy-btn';
        exportBtn.textContent = 'export shot list';
        exportBtn.addEventListener('click', function() {
            var shotList = {
                project: 'Virtual Sound Stage \u2014 still-220723',
                exportDate: new Date().toISOString(),
                scene: 'Golden Gate Waterfront',
                shots: cameras.map(function(cam, i) {
                    var body = getBody(cam.bodyId);
                    var lens = getLens(cam.lensId);
                    return {
                        number: i + 1,
                        name: cam.name,
                        shotType: cam.shotType || 'medium',
                        description: cam.shotDescription || '',
                        notes: cam.shotNotes || '',
                        camera: {
                            body: body.manufacturer + ' ' + body.name,
                            lens: lens.manufacturer + ' ' + lens.name,
                            focalLength: cam.focalLength,
                            aperture: cam.aperture
                        },
                        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
                        rotation: { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z }
                    };
                })
            };

            var blob = new Blob([JSON.stringify(shotList, null, 2)], { type: 'application/json' });
            downloadBlob(blob, 'shot-list-' + new Date().toISOString().split('T')[0] + '.json');
            flashBadge('shot list exported');
        });
        secShotList.appendChild(exportBtn);

        // DOF toggle
        var dofRow = document.createElement('div');
        dofRow.className = 'lock-row';

        var dofBtn = document.createElement('button');
        dofBtn.className = 'lock-btn';
        dofBtn.textContent = 'DOF off';
        dofBtn.addEventListener('click', function () {
            state.dofEnabled = !state.dofEnabled;
            dofBtn.className = 'lock-btn' + (state.dofEnabled ? ' active' : '');
            dofBtn.textContent = state.dofEnabled ? 'DOF on' : 'DOF off';
            updateDOF();
        });
        dofRow.appendChild(dofBtn);
        secDOF.appendChild(dofRow);

        // Focus distance slider
        var fdSlider = makeSlider(secDOF, 'm', state.focusDistance, 0.5, 30, 0.1, function (v) {
            state.focusDistance = v;
            updateDOF();
        });

        // Focus peaking toggle and color selector
        var fpLabel = document.createElement('div');
        fpLabel.className = 'section-label';
        fpLabel.textContent = 'focus peaking';
        secDOF.appendChild(fpLabel);

        var fpRow = document.createElement('div');
        fpRow.className = 'lock-row';

        var fpBtn = document.createElement('button');
        fpBtn.className = 'lock-btn';
        fpBtn.textContent = 'peaking off';
        fpBtn.addEventListener('click', function () {
            focusPeakingEnabled = !focusPeakingEnabled;
            fpBtn.className = 'lock-btn' + (focusPeakingEnabled ? ' active' : '');
            fpBtn.textContent = focusPeakingEnabled ? 'peaking on' : 'peaking off';
            updateColorScience();
        });
        fpRow.appendChild(fpBtn);

        var fpColorBtn = document.createElement('button');
        fpColorBtn.className = 'lock-btn';
        fpColorBtn.style.color = '#f44';
        fpColorBtn.textContent = 'red';
        fpColorBtn.addEventListener('click', function () {
            var colors = ['red', 'green', 'blue'];
            var colorCSS = ['#f44', '#4f4', '#44f'];
            var idx = (colors.indexOf(focusPeakingColor) + 1) % 3;
            focusPeakingColor = colors[idx];
            fpColorBtn.style.color = colorCSS[idx];
            fpColorBtn.textContent = focusPeakingColor;
            if (focusPeakingEnabled) updateColorScience();
        });
        fpRow.appendChild(fpColorBtn);

        secDOF.appendChild(fpRow);

        // ── POV ADJUST SECTION ──
        var povInfo = document.createElement('div');
        povInfo.className = 'lens-info';
        povInfo.textContent = 'press 5/6 for POV, then adjust';
        secPOV.appendChild(povInfo);

        var lastPovOffX = 0, lastPovOffY = 0, lastPovOffZ = 0;

        var povOffX = makeSlider(secPOV, 'X', 0, -2, 2, 0.01, function(v) {
            var pos = camera.getPosition();
            camera.setPosition(pos.x + (v - lastPovOffX), pos.y, pos.z);
            lastPovOffX = v;
        });
        var povOffY = makeSlider(secPOV, 'Y', 0, -2, 2, 0.01, function(v) {
            var pos = camera.getPosition();
            camera.setPosition(pos.x, pos.y + (v - lastPovOffY), pos.z);
            lastPovOffY = v;
        });
        var povOffZ = makeSlider(secPOV, 'Z', 0, -2, 2, 0.01, function(v) {
            var pos = camera.getPosition();
            camera.setPosition(pos.x, pos.y, pos.z + (v - lastPovOffZ));
            lastPovOffZ = v;
        });
        var povYaw = makeSlider(secPOV, 'Y\u00B0', 0, -180, 180, 1, function(v) {
            flyYaw = v;
            camera.setEulerAngles(flyPitch, flyYaw, 0);
        });
        var povPitch = makeSlider(secPOV, 'P\u00B0', 0, -90, 90, 1, function(v) {
            flyPitch = v;
            camera.setEulerAngles(flyPitch, flyYaw, 0);
        });

        var povCopyBtn = document.createElement('button');
        povCopyBtn.className = 'copy-btn';
        povCopyBtn.textContent = 'copy camera position';
        povCopyBtn.addEventListener('click', function() {
            var pos = camera.getPosition();
            var rot = camera.getEulerAngles();
            var out = 'Camera Position:\n';
            out += '  pos(' + pos.x.toFixed(3) + ', ' + pos.y.toFixed(3) + ', ' + pos.z.toFixed(3) + ')\n';
            out += '  rot(' + rot.x.toFixed(1) + ', ' + rot.y.toFixed(1) + ', ' + rot.z.toFixed(1) + ')\n';
            out += '  flyYaw: ' + flyYaw.toFixed(1) + ', flyPitch: ' + flyPitch.toFixed(1);
            navigator.clipboard.writeText(out);
            povCopyBtn.textContent = 'copied!';
            setTimeout(function() { povCopyBtn.textContent = 'copy camera position'; }, 1500);
        });
        secPOV.appendChild(povCopyBtn);

        // ── LIGHTING SECTION ──

        function kelvinToRGB(kelvin) {
            var temp = kelvin / 100;
            var r, g, b;
            if (temp <= 66) {
                r = 255;
                g = 99.4708025861 * Math.log(temp) - 161.1195681661;
                b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
            } else {
                r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
                g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
                b = 255;
            }
            return [
                Math.min(1, Math.max(0, r / 255)),
                Math.min(1, Math.max(0, g / 255)),
                Math.min(1, Math.max(0, b / 255))
            ];
        }

        // Current lighting state
        var currentSunElevation = 50;
        var currentSunDirection = 140;
        var currentSunIntensity = 1.5;
        var currentSunKelvin = 4500;
        var currentFillIntensity = 0.4;
        var currentAmbientIntensity = 0.3;
        var currentAmbientColor = [0.25, 0.28, 0.35];

        function applyLighting() {
            var rgb = kelvinToRGB(currentSunKelvin);
            sun.light.color = new pc.Color(rgb[0], rgb[1], rgb[2]);
            sun.light.intensity = currentSunIntensity;
            sun.setEulerAngles(currentSunElevation, currentSunDirection, 0);
            fill.light.intensity = currentFillIntensity;

            // ── 1. Dynamic Sky Color (clearColor based on time of day) ──
            var skyR, skyG, skyB;
            if (currentSunElevation < 0) {
                // Night sky
                skyR = 0.02; skyG = 0.02; skyB = 0.06;
            } else if (currentSunElevation < 10) {
                // Dawn/dusk — warm horizon
                var t = currentSunElevation / 10;
                skyR = 0.05 + t * 0.15; skyG = 0.03 + t * 0.08; skyB = 0.08 + t * 0.05;
            } else if (currentSunElevation < 30) {
                // Golden hour transition
                var t = (currentSunElevation - 10) / 20;
                skyR = 0.20 - t * 0.10; skyG = 0.11 + t * 0.15; skyB = 0.13 + t * 0.20;
            } else {
                // Daylight
                var t = Math.min(1, (currentSunElevation - 30) / 60);
                skyR = 0.10 + t * 0.05; skyG = 0.26 + t * 0.15; skyB = 0.33 + t * 0.25;
            }
            camera.camera.clearColor = new pc.Color(skyR, skyG, skyB);

            // ── 2. Directional light gradient overlay ──
            var gradAngle = (currentSunDirection + 180) % 360;
            var sunRGB = kelvinToRGB(currentSunKelvin);
            var sunColorCSS = 'rgba(' + Math.round(sunRGB[0] * 255) + ',' + Math.round(sunRGB[1] * 255) + ',' + Math.round(sunRGB[2] * 255) + ',';

            // Shadow-side color (complementary cool)
            var shadowR = Math.max(0, 0.3 - sunRGB[0] * 0.15);
            var shadowG = Math.max(0, 0.35 - sunRGB[1] * 0.1);
            var shadowB = Math.min(1, 0.5 + (1 - sunRGB[2]) * 0.2);

            var intensity = Math.min(1, currentSunIntensity * 0.5);

            lightOverlay.style.opacity = intensity.toFixed(2);
            lightOverlay.style.background = 'linear-gradient(' + gradAngle + 'deg, ' +
                sunColorCSS + '0.4) 0%, ' +
                'transparent 40%, ' +
                'transparent 60%, ' +
                'rgba(' + Math.round(shadowR * 255) + ',' + Math.round(shadowG * 255) + ',' + Math.round(shadowB * 255) + ',0.3) 100%)';

            // For night, use a dark blue radial overlay instead
            if (currentSunElevation < 0) {
                lightOverlay.style.opacity = '0.7';
                lightOverlay.style.background = 'radial-gradient(ellipse at 50% 30%, rgba(10,15,40,0.3) 0%, rgba(5,5,20,0.8) 100%)';
                lightOverlay.style.mixBlendMode = 'multiply';
            } else {
                lightOverlay.style.mixBlendMode = 'soft-light';
            }

            // ── 3. Elevation-based brightness gradient ──
            if (currentSunElevation > 20) {
                var elevIntensity = Math.min(0.3, (currentSunElevation - 20) / 200);
                elevOverlay.style.opacity = elevIntensity.toFixed(2);
                elevOverlay.style.background = 'linear-gradient(180deg, rgba(255,250,240,0.2) 0%, transparent 40%, rgba(0,0,0,0.15) 100%)';
            } else if (currentSunElevation < 0) {
                // Night — darker overall
                elevOverlay.style.opacity = '0.5';
                elevOverlay.style.background = 'linear-gradient(180deg, rgba(5,5,20,0.6) 0%, rgba(10,10,30,0.8) 100%)';
            } else {
                elevOverlay.style.opacity = '0';
            }

            // ── 4. Enhanced CSS filter (more dramatic values) ──
            var brightness = 0.3 + (currentSunIntensity * 0.4); // night=0.3, noon=1.0
            if (currentSunElevation < 0) brightness *= 0.35; // extra dark for night
            var contrast = 0.8 + (currentSunIntensity * 0.15);
            var saturate = 0.4 + (currentSunIntensity * 0.4);
            if (currentSunElevation < 0) saturate *= 0.4; // desaturate night heavily

            var warmth = Math.max(0, (5600 - currentSunKelvin) / 5600) * 15; // sepia for warm temps
            var coolShift = Math.max(0, (currentSunKelvin - 6500) / 3500) * 8; // blue for cool temps
            if (currentSunElevation < 0) coolShift += 12; // heavy blue hue-rotate at night

            var sceneFilter = 'brightness(' + brightness.toFixed(2) + ') ';
            sceneFilter += 'contrast(' + contrast.toFixed(2) + ') ';
            sceneFilter += 'saturate(' + saturate.toFixed(2) + ') ';
            if (warmth > 0.5) sceneFilter += 'sepia(' + warmth.toFixed(0) + '%) ';
            if (coolShift > 0.5) sceneFilter += 'hue-rotate(' + coolShift.toFixed(0) + 'deg) ';

            // ── 5. Scene exposure (PlayCanvas v2) ──
            if (typeof app.scene.exposure === 'number') {
                app.scene.exposure = brightness;
            }

            // Combine with viewfinder color science if active
            var vf = document.getElementById('viewfinder');
            if (vf && vf.classList.contains('active')) {
                // Viewfinder color science is handled by updateColorScience()
                // Store lighting filter for compositing
                canvas.dataset.lightingFilter = sceneFilter;
                updateColorScience(); // will merge both filters
            } else {
                canvas.style.filter = sceneFilter;
            }
            app.scene.ambientLight = new pc.Color(
                currentAmbientColor[0] * currentAmbientIntensity / 0.3,
                currentAmbientColor[1] * currentAmbientIntensity / 0.3,
                currentAmbientColor[2] * currentAmbientIntensity / 0.3
            );
        }

        // Time of day presets
        var timeRow = document.createElement('div');
        timeRow.className = 'cam-mode-row';
        var timePresets = [
            { label: 'dawn',   sunAngle: 5,  kelvin: 2500, intensity: 0.8, ambient: [0.15, 0.12, 0.2], ambientInt: 0.2, direction: 90, fillInt: 0.3 },
            { label: 'golden', sunAngle: 15, kelvin: 3200, intensity: 1.3, ambient: [0.25, 0.2, 0.15], ambientInt: 0.25, direction: 140, fillInt: 0.4 },
            { label: 'noon',   sunAngle: 75, kelvin: 5600, intensity: 1.8, ambient: [0.35, 0.35, 0.38], ambientInt: 0.4, direction: 180, fillInt: 0.3 },
            { label: 'sunset', sunAngle: 8,  kelvin: 2700, intensity: 1.0, ambient: [0.2, 0.15, 0.2], ambientInt: 0.2, direction: 270, fillInt: 0.3 },
            { label: 'night',  sunAngle: -10, kelvin: 8000, intensity: 0.15, ambient: [0.05, 0.05, 0.12], ambientInt: 0.08, direction: 180, fillInt: 0.1 }
        ];
        timePresets.forEach(function(preset) {
            var btn = document.createElement('button');
            btn.className = 'cam-mode-btn';
            btn.textContent = preset.label;
            btn.addEventListener('click', function() {
                currentSunElevation = preset.sunAngle;
                currentSunDirection = preset.direction;
                currentSunIntensity = preset.intensity;
                currentSunKelvin = preset.kelvin;
                currentFillIntensity = preset.fillInt;
                currentAmbientIntensity = preset.ambientInt;
                currentAmbientColor = preset.ambient.slice();
                applyLighting();
                // Update sliders to match
                sunElevSlider.input.value = preset.sunAngle;
                sunElevSlider.valEl.textContent = formatVal(preset.sunAngle, 1);
                sunDirSlider.input.value = preset.direction;
                sunDirSlider.valEl.textContent = formatVal(preset.direction, 1);
                sunIntSlider.input.value = preset.intensity;
                sunIntSlider.valEl.textContent = formatVal(preset.intensity, 0.01);
                sunKelvinSlider.input.value = preset.kelvin;
                sunKelvinSlider.valEl.textContent = preset.kelvin + 'K';
                fillIntSlider.input.value = preset.fillInt;
                fillIntSlider.valEl.textContent = formatVal(preset.fillInt, 0.01);
                ambIntSlider.input.value = preset.ambientInt;
                ambIntSlider.valEl.textContent = formatVal(preset.ambientInt, 0.01);
                flashBadge(preset.label);
            });
            timeRow.appendChild(btn);
        });
        secLighting.appendChild(timeRow);

        // Sun Elevation slider
        var sunElevSlider = makeSlider(secLighting, 'elev', currentSunElevation, -10, 90, 1, function(v) {
            currentSunElevation = v;
            applyLighting();
        });

        // Sun Direction slider
        var sunDirSlider = makeSlider(secLighting, 'dir', currentSunDirection, 0, 360, 1, function(v) {
            currentSunDirection = v;
            applyLighting();
        });

        // Sun Intensity slider
        var sunIntSlider = makeSlider(secLighting, 'int', currentSunIntensity, 0, 3, 0.01, function(v) {
            currentSunIntensity = v;
            applyLighting();
        });

        // Sun Color Temperature slider
        var sunKelvinSlider = makeSlider(secLighting, 'K', currentSunKelvin, 2000, 10000, 100, function(v) {
            currentSunKelvin = v;
            sunKelvinSlider.valEl.textContent = v + 'K';
            applyLighting();
        });
        sunKelvinSlider.valEl.textContent = currentSunKelvin + 'K';

        // Fill Intensity slider
        var fillLabel2 = document.createElement('div');
        fillLabel2.className = 'section-label';
        fillLabel2.textContent = 'fill light';
        secLighting.appendChild(fillLabel2);

        var fillIntSlider = makeSlider(secLighting, 'int', currentFillIntensity, 0, 2, 0.01, function(v) {
            currentFillIntensity = v;
            applyLighting();
        });

        // Ambient Intensity slider
        var ambLabel2 = document.createElement('div');
        ambLabel2.className = 'section-label';
        ambLabel2.textContent = 'ambient';
        secLighting.appendChild(ambLabel2);

        var ambIntSlider = makeSlider(secLighting, 'int', currentAmbientIntensity, 0, 1, 0.01, function(v) {
            currentAmbientIntensity = v;
            applyLighting();
        });

        // Weather / Mood presets
        var weatherRow = document.createElement('div');
        weatherRow.className = 'cam-mode-row';
        var weatherPresets = [
            { label: 'clear',    fillInt: 0.4, ambientMult: 1.0, sunInt: null },
            { label: 'cloudy',   fillInt: 0.8, ambientMult: 1.5, sunInt: 0.6 },
            { label: 'overcast', fillInt: 1.0, ambientMult: 2.0, sunInt: 0.3 },
            { label: 'rain',     fillInt: 0.9, ambientMult: 1.8, sunInt: 0.2 }
        ];
        weatherPresets.forEach(function(preset) {
            var btn = document.createElement('button');
            btn.className = 'cam-mode-btn';
            btn.textContent = preset.label;
            btn.addEventListener('click', function() {
                currentFillIntensity = preset.fillInt;
                currentAmbientIntensity = Math.min(1, currentAmbientIntensity * preset.ambientMult);
                if (preset.sunInt !== null) {
                    currentSunIntensity = preset.sunInt;
                    sunIntSlider.input.value = preset.sunInt;
                    sunIntSlider.valEl.textContent = formatVal(preset.sunInt, 0.01);
                }
                fillIntSlider.input.value = currentFillIntensity;
                fillIntSlider.valEl.textContent = formatVal(currentFillIntensity, 0.01);
                ambIntSlider.input.value = currentAmbientIntensity;
                ambIntSlider.valEl.textContent = formatVal(currentAmbientIntensity, 0.01);
                applyLighting();
                flashBadge(preset.label);
            });
            weatherRow.appendChild(btn);
        });
        secLighting.appendChild(weatherRow);

        // ── WORLD VARIANT HOT-SWAP ──
        var currentVariantFile = 'still-220723.compressed.ply'; // the base
        var worldEntity = world; // reference to the gsplat entity created earlier in buildScene
        var variantData = null;
        var variantLoading = false;

        // Fetch available variants
        fetch('variants.json')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                variantData = data;
                renderVariantButtons(data);
            })
            .catch(function() {
                // No variants.json — that's fine, just don't show variant buttons
            });

        function swapWorldVariant(filename, label) {
            if (filename === currentVariantFile || variantLoading) return;
            variantLoading = true;
            flashBadge('loading: ' + label + '...');

            // Create and load new gsplat asset
            var newAsset = new pc.Asset('world-variant', 'gsplat', { url: filename });
            newAsset.on('load', function() {
                // Remove old gsplat component and add new one
                worldEntity.removeComponent('gsplat');
                worldEntity.addComponent('gsplat', { asset: newAsset });
                currentVariantFile = filename;
                variantLoading = false;
                flashBadge(label);
                renderVariantButtons(variantData); // update active state
            });
            newAsset.on('error', function(err) {
                console.error('failed to load variant:', err);
                variantLoading = false;
                flashBadge('error loading variant');
            });
            app.assets.add(newAsset);
            app.assets.load(newAsset);
        }

        function renderVariantButtons(data) {
            // Remove old variant UI if exists
            var existing = document.getElementById('variant-buttons');
            if (existing) existing.remove();

            if (!data || (!data.variants.length && !data.base)) return;

            var container = document.createElement('div');
            container.id = 'variant-buttons';

            var row = document.createElement('div');
            row.className = 'cam-mode-row';
            row.style.flexWrap = 'wrap';
            row.style.gap = '4px';

            // Base variant button
            if (data.base) {
                var baseBtn = document.createElement('button');
                baseBtn.className = 'cam-mode-btn' + (currentVariantFile === data.base.file ? ' active' : '');
                baseBtn.textContent = data.base.label || 'Original';
                baseBtn.title = data.base.description || '';
                baseBtn.addEventListener('click', function() {
                    swapWorldVariant(data.base.file, data.base.label);
                });
                row.appendChild(baseBtn);
            }

            // Variant buttons
            data.variants.forEach(function(v) {
                var btn = document.createElement('button');
                btn.className = 'cam-mode-btn' + (currentVariantFile === v.file ? ' active' : '');
                btn.textContent = v.label;
                btn.title = v.description || '';
                btn.addEventListener('click', function() {
                    swapWorldVariant(v.file, v.label);
                });
                row.appendChild(btn);
            });

            container.appendChild(row);

            // If no variants generated yet, show a hint
            if (data.variants.length === 0) {
                var hint = document.createElement('div');
                hint.className = 'lens-info';
                hint.textContent = 'no variants yet — run "generate lighting variants" in Claude Code';
                container.appendChild(hint);
            }

            // Load custom PLY section
            var loadLabel = document.createElement('div');
            loadLabel.className = 'section-label';
            loadLabel.textContent = 'load custom world';
            container.appendChild(loadLabel);

            var loadRow = document.createElement('div');
            loadRow.className = 'lock-row';
            var loadBtn = document.createElement('button');
            loadBtn.className = 'lock-btn';
            loadBtn.textContent = 'load .ply file';
            loadBtn.addEventListener('click', function() {
                var input = document.createElement('input');
                input.type = 'file';
                input.accept = '.ply,.compressed.ply';
                input.addEventListener('change', function() {
                    if (!input.files.length) return;
                    var file = input.files[0];
                    var url = URL.createObjectURL(file);
                    swapWorldVariant(url, file.name);
                });
                input.click();
            });
            loadRow.appendChild(loadBtn);
            container.appendChild(loadRow);

            // Append to the World Variants accordion section
            secVariants.appendChild(container);
        }

        // Prevent panel from triggering orbit
        document.getElementById('camera-panel').addEventListener('mousedown', function (e) { e.stopPropagation(); });

        function updateModeUI() {
            for (var m in modeBtns) {
                modeBtns[m].className = 'cam-mode-btn' + (m === cameraMode ? ' active' : '');
            }
            lockCamBtn.className = 'lock-btn' + (cameraLocked ? ' active' : '');
            lockPhopBtn.className = 'lock-btn' + (trackTarget === 'Phop' ? ' active' : '');
            lockDavBtn.className = 'lock-btn' + (trackTarget === 'Davinci' ? ' active' : '');
            var modeText = cameraMode === 'path' ? 'path \u25B6' : cameraMode;
            document.getElementById('hud-mode').textContent = modeText + (cameraLocked ? ' [locked]' : '');
            document.getElementById('hud-extra').textContent = trackTarget ? 'tracking: ' + trackTarget : (cameraPath.playing ? 'playing path...' : '');
        }

        // ───────────────────────────────────────────────────────────
        // RELIGHTING OVERLAYS (z-index 11 — below DOF, vignette, letterbox)
        // ───────────────────────────────────────────────────────────

        var lightOverlay = document.createElement('div');
        lightOverlay.id = 'light-overlay';
        lightOverlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:11;mix-blend-mode:soft-light;opacity:0;';
        document.body.appendChild(lightOverlay);

        var elevOverlay = document.createElement('div');
        elevOverlay.id = 'elev-overlay';
        elevOverlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:11;mix-blend-mode:multiply;opacity:0;';
        document.body.appendChild(elevOverlay);

        // ───────────────────────────────────────────────────────────
        // LETTERBOX / COLOR SCIENCE / ANAMORPHIC OVERLAYS
        // ───────────────────────────────────────────────────────────

        // Create letterbox bar elements
        var lbTop = document.createElement('div');
        lbTop.className = 'letterbox-bar';
        lbTop.id = 'letterbox-top';
        document.body.appendChild(lbTop);

        var lbBottom = document.createElement('div');
        lbBottom.className = 'letterbox-bar';
        lbBottom.id = 'letterbox-bottom';
        document.body.appendChild(lbBottom);

        var lbLeft = document.createElement('div');
        lbLeft.className = 'letterbox-bar';
        lbLeft.id = 'letterbox-left';
        document.body.appendChild(lbLeft);

        var lbRight = document.createElement('div');
        lbRight.className = 'letterbox-bar';
        lbRight.id = 'letterbox-right';
        document.body.appendChild(lbRight);

        // Create anamorphic streak overlay
        var anamorphicStreak = document.createElement('div');
        anamorphicStreak.className = 'anamorphic-streak';
        document.body.appendChild(anamorphicStreak);

        // Create anamorphic edge softness overlay
        var anaEdgeSoft = document.createElement('div');
        anaEdgeSoft.className = 'anamorphic-edge-soft';
        document.body.appendChild(anaEdgeSoft);

        // Create chromatic aberration overlay
        var caOverlay = document.createElement('div');
        caOverlay.id = 'ca-overlay';
        document.body.appendChild(caOverlay);

        // Create lens haze overlay
        var hazeOverlay = document.createElement('div');
        hazeOverlay.id = 'haze-overlay';
        document.body.appendChild(hazeOverlay);

        // Create lens flare style overlay
        var flareOverlay = document.createElement('div');
        flareOverlay.className = 'lens-flare-overlay';
        document.body.appendChild(flareOverlay);

        function updateLetterbox() {
            var vf = document.getElementById('viewfinder');
            var isActive = vf.classList.contains('active');
            var bars = [lbTop, lbBottom, lbLeft, lbRight];
            var barStyle = 'position:fixed;background:rgba(0,0,0,0.92);z-index:14;pointer-events:none;';

            if (!isActive) {
                bars.forEach(function (b) { b.style.cssText = 'display:none'; });
                return;
            }

            // Determine display aspect ratio:
            // 1. If user selected a delivery format, use that
            // 2. If anamorphic lens, force 2.39:1
            // 3. Otherwise use sensor native
            var frameAspect;
            if (deliveryAspect > 0) {
                frameAspect = deliveryAspect;
            } else if (activeLens.type === 'anamorphic') {
                frameAspect = 2.39;
            } else {
                frameAspect = activeBody.sensorWidth / activeBody.sensorHeight;
            }

            var W = window.innerWidth;
            var H = window.innerHeight;
            var viewportAspect = W / H;

            // Reset all bars
            bars.forEach(function (b) { b.style.cssText = 'display:none'; });

            if (frameAspect > viewportAspect) {
                // Frame is wider than viewport — top/bottom letterbox bars
                var visH = W / frameAspect;
                var barH = Math.max(4, Math.round((H - visH) / 2));
                lbTop.style.cssText = barStyle + 'top:0;left:0;right:0;height:' + barH + 'px;';
                lbBottom.style.cssText = barStyle + 'bottom:0;left:0;right:0;height:' + barH + 'px;';
            } else {
                // Frame is narrower than viewport — left/right pillarbox bars
                var visW = H * frameAspect;
                var barW = Math.max(4, Math.round((W - visW) / 2));
                lbLeft.style.cssText = barStyle + 'top:0;left:0;bottom:0;width:' + barW + 'px;';
                lbRight.style.cssText = barStyle + 'top:0;right:0;bottom:0;width:' + barW + 'px;';
            }
        }

        function updateColorScience() {
            // Start with lighting filter (affects background + everything)
            var lightingFilter = canvas.dataset.lightingFilter || '';

            var vf = document.getElementById('viewfinder');
            if (!vf.classList.contains('active')) {
                // Outside viewfinder: only apply lighting color grade
                if (focusPeakingEnabled) {
                    canvas.style.filter = (lightingFilter || '') + ' url(#focus-peak-' + focusPeakingColor + ')';
                } else {
                    canvas.style.filter = lightingFilter || 'none';
                }
                return;
            }

            // In viewfinder: merge lighting + camera body color science + lens
            var bodyR = activeBody.colorTint[0];
            var bodyB = activeBody.colorTint[2];
            var bodyWarmth = (bodyR - bodyB) * 100;
            var lensWarmShift = (activeLens.warmth - 1.0) * 80;
            var lensContrast = activeLens.contrast;

            var sepia = Math.max(0, Math.min(25, (bodyWarmth + lensWarmShift) * 0.8));
            var contrast = 0.75 + (lensContrast * 0.35);
            var saturate = 0.80 + (lensContrast * 0.30);

            var hueRotate = 0;
            if (bodyB > bodyR) {
                hueRotate = (bodyB - bodyR) * 150;
                sepia = Math.max(0, sepia - 2);
            }

            // Combine: lighting filter first, then camera/lens on top
            var filter = lightingFilter;
            filter += 'contrast(' + contrast.toFixed(2) + ') ';
            filter += 'saturate(' + saturate.toFixed(2) + ') ';
            if (sepia > 0.5) filter += 'sepia(' + sepia.toFixed(0) + '%) ';
            if (Math.abs(hueRotate) > 0.5) filter += 'hue-rotate(' + hueRotate.toFixed(1) + 'deg) ';

            // Append focus peaking SVG filter if enabled
            if (focusPeakingEnabled) {
                filter += ' url(#focus-peak-' + focusPeakingColor + ')';
            }

            canvas.style.filter = filter;
        }

        // Lens vignette overlay — always visible, separate from viewfinder
        var lensVigEl = document.createElement('div');
        lensVigEl.id = 'lens-vignette';
        lensVigEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:13;' +
            'background:radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0) 100%);';
        document.body.appendChild(lensVigEl);

        // DOF (depth of field) blur overlay — sits between canvas and UI
        var dofOverlay = document.createElement('div');
        dofOverlay.id = 'dof-overlay';
        dofOverlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:12;display:none;';
        document.body.appendChild(dofOverlay);

        function updateVignette() {
            // Only show lens vignette in viewfinder mode
            var vf = document.getElementById('viewfinder');
            if (!vf.classList.contains('active')) {
                lensVigEl.style.background = 'none';
                return;
            }

            var lensVig = activeLens.vignetting || 0;
            var apertureVig = Math.max(0, 0.35 - (aperture - 1.4) * 0.018);
            var totalVig = Math.min(0.75, (lensVig * 1.5) + apertureVig);

            if (activeLens.type === 'anamorphic') {
                lensVigEl.style.background = 'radial-gradient(ellipse 130% 90% at center, ' +
                    'transparent 35%, rgba(0,0,0,' + totalVig.toFixed(2) + ') 100%)';
            } else {
                lensVigEl.style.background = 'radial-gradient(ellipse at center, ' +
                    'transparent 45%, rgba(0,0,0,' + totalVig.toFixed(2) + ') 100%)';
            }

            var vfVig = document.querySelector('.vf-vignette');
            if (vfVig) vfVig.style.setProperty('--vig', (totalVig * 0.5).toFixed(2));
        }

        function updateAnamorphic() {
            var vf = document.getElementById('viewfinder');
            var isAna = activeLens.type === 'anamorphic';
            var isVF = vf.classList.contains('active');

            if (isAna && isVF) {
                // Determine streak color from flareStyle
                var flare = activeLens.flareStyle || 'blue-streak';
                if (flare.includes('amber') || flare.includes('warm') || flare.includes('purple')) {
                    anamorphicStreak.className = 'anamorphic-streak active warm';
                } else {
                    anamorphicStreak.className = 'anamorphic-streak active cool';
                }

                // Edge softness overlay
                anaEdgeSoft.classList.add('active');

                // Slight horizontal stretch to simulate anamorphic desqueeze
                canvas.style.transform = 'scaleX(1.02)';
            } else {
                anamorphicStreak.className = 'anamorphic-streak';
                anaEdgeSoft.classList.remove('active');
                canvas.style.transform = '';
            }
        }

        function updateDOF() {
            var vf = document.getElementById('viewfinder');
            if (!state.dofEnabled || !vf.classList.contains('active')) {
                dofOverlay.style.display = 'none';
                return;
            }

            dofOverlay.style.display = 'block';

            // Calculate blur amount from aperture and focal length
            // Wider aperture (lower f-stop) = more blur
            // Longer focal length = more blur
            var apertureBlur = Math.max(0, (4.0 - aperture) * 2.5); // f/1.4 = 6.5px, f/2.8 = 3px, f/5.6 = 0
            var focalBlur = focalLength / 100; // 50mm = 0.5x, 135mm = 1.35x
            var blurAmount = Math.max(0, apertureBlur * focalBlur);

            if (blurAmount < 0.5) {
                dofOverlay.style.display = 'none';
                return;
            }

            // Focus ring: sharp center, blurred edges
            // focusDistance determines how large the sharp zone is
            var focusDist = state.focusDistance || 3.0;
            var sharpRadius = Math.max(15, Math.min(45, 30 / (focusDist * 0.5))); // % of screen

            // Apply blur via backdrop-filter
            dofOverlay.style.backdropFilter = 'blur(' + blurAmount.toFixed(1) + 'px)';
            dofOverlay.style.webkitBackdropFilter = 'blur(' + blurAmount.toFixed(1) + 'px)';

            // Mask: transparent in center (sharp), opaque at edges (blurred)
            // Where mask is opaque, backdrop-filter blur is applied
            // Where mask is transparent, no blur (sharp)
            var maskVal = 'radial-gradient(ellipse 50% 50% at 50% 50%, transparent 0%, transparent ' + (sharpRadius - 10) + '%, black ' + sharpRadius + '%)';
            dofOverlay.style.maskImage = maskVal;
            dofOverlay.style.webkitMaskImage = maskVal;
        }

        // ── Chromatic Aberration ──
        function updateCA() {
            var vf = document.getElementById('viewfinder');
            if (!vf.classList.contains('active')) {
                caOverlay.style.display = 'none';
                return;
            }

            // CA amount based on lens characteristics
            // Vintage/low-contrast lenses have more CA; high vignetting = more optical imperfection
            var contrastCA = Math.max(0, (1 - activeLens.contrast) * 0.4);
            var vigCA = (activeLens.vignetting || 0) * 0.3;
            var caAmount = Math.min(0.25, contrastCA + vigCA);

            if (caAmount < 0.02) {
                caOverlay.style.display = 'none';
                return;
            }

            caOverlay.style.display = 'block';
            var px = Math.round(caAmount * 3); // 0-2px offset
            var alpha = (caAmount * 0.3).toFixed(2);

            caOverlay.style.boxShadow =
                'inset ' + px + 'px 0 ' + (px * 2) + 'px rgba(255,0,0,' + alpha + '), ' +
                'inset -' + px + 'px 0 ' + (px * 2) + 'px rgba(0,200,255,' + alpha + '), ' +
                'inset 0 ' + px + 'px ' + (px * 2) + 'px rgba(255,0,0,' + (alpha * 0.5).toFixed(2) + '), ' +
                'inset 0 -' + px + 'px ' + (px * 2) + 'px rgba(0,200,255,' + (alpha * 0.5).toFixed(2) + ')';
        }

        // ── Lens Haze / Veiling Flare ──
        function updateLensHaze() {
            var vf = document.getElementById('viewfinder');
            if (!vf.classList.contains('active')) {
                hazeOverlay.style.display = 'none';
                return;
            }

            // Low contrast lenses have veiling haze
            var hazeAmount = Math.max(0, (0.8 - activeLens.contrast) * 0.15);

            if (hazeAmount < 0.01) {
                hazeOverlay.style.display = 'none';
                return;
            }

            hazeOverlay.style.display = 'block';
            hazeOverlay.style.background = 'rgba(255,250,240,' + hazeAmount.toFixed(3) + ')';
        }

        // ── Lens Flare Style ──
        function updateFlare() {
            var vf = document.getElementById('viewfinder');
            if (!vf.classList.contains('active')) {
                flareOverlay.style.display = 'none';
                return;
            }

            // Remove old style classes — reset to base
            flareOverlay.className = 'lens-flare-overlay';

            var style = activeLens.flareStyle || 'none';
            if (style === 'none' || style === 'clean-minimal') {
                flareOverlay.style.display = 'none';
                return;
            }

            // Map flareStyle to CSS class (strip non-alpha/hyphen)
            var cssClass = style.replace(/[^a-z-]/g, '');
            flareOverlay.classList.add(cssClass);
            flareOverlay.style.display = 'block';
        }

        // Master function — call after any body/lens/aperture/viewfinder change
        function updateCameraLook() {
            // FOV: sensor-specific only in viewfinder, neutral otherwise
            var vf = document.getElementById('viewfinder');
            if (vf && vf.classList.contains('active')) {
                camera.camera.fov = fovForBody(activeBody, focalLength);
            } else {
                camera.camera.fov = NEUTRAL_FOV;
            }
            updateLetterbox();
            updateColorScience();
            updateVignette();
            updateAnamorphic();
            updateDOF();
            updateCA();
            updateLensHaze();
            updateFlare();
            updateViewfinderInfo();
        }

        // Recalculate letterbox on window resize
        window.addEventListener('resize', function () { updateLetterbox(); });

        updateCameraLook();

        function updateViewfinderInfo() {
            var body = activeBody;
            var lens = activeLens;
            var style = body.viewfinderStyle;
            var vfLeft = document.getElementById('vf-info-left');
            var vfRight = document.getElementById('vf-info-right');
            var vfRec = document.querySelector('.vf-rec');

            var sensorFormat = body.sensorWidth > 50 ? '65mm' : body.sensorWidth > 33 ? 'LF' : body.sensorWidth > 25 ? 'S35' : 'S35';
            var sensorDims = body.sensorWidth.toFixed(1) + '\u00D7' + body.sensorHeight.toFixed(1);
            var sensorAR = (body.sensorWidth / body.sensorHeight).toFixed(2) + ':1';
            var displayAR = deliveryAspect > 0 ? deliveryAspect.toFixed(2) + ':1' : sensorAR;

            if (style === 'arri') {
                // ARRI style: clean, minimal, white on dark
                vfLeft.textContent = body.name + '  ' + lens.name + ' ' + Math.round(focalLength) + 'mm  T' + aperture.toFixed(1);
                vfRight.textContent = displayAR + '  ' + sensorFormat + '  24.000';
                vfRec.textContent = '\u25CF REC  ' + body.colorScience;

            } else if (style === 'red') {
                // RED style: modular blocks, technical info
                vfLeft.textContent = 'R3D  ' + body.resolution + '  ' + Math.round(focalLength) + 'mm  T' + aperture.toFixed(1);
                vfRight.textContent = body.name + '  ' + displayAR + '  ISO ' + (body.nativeISO || '800');
                vfRec.textContent = '\u25A0 REC  IPP2  ' + lens.manufacturer + ' ' + lens.name;

            } else if (style === 'sony') {
                // Sony style: clean info bars
                vfLeft.textContent = body.name + '  ' + lens.name + '  ' + Math.round(focalLength) + 'mm';
                vfRight.textContent = 'T' + aperture.toFixed(1) + '  ' + displayAR + '  S-Log3';
                vfRec.textContent = '\u25CFREC  X-OCN  ' + sensorFormat + ' ' + sensorDims;

            } else if (style === 'blackmagic') {
                // Blackmagic style: simple, clean
                vfLeft.textContent = body.name + '  BRAW  ' + Math.round(focalLength) + 'mm  T' + aperture.toFixed(1);
                vfRight.textContent = displayAR + '  Gen5  ISO ' + (body.nativeISO || '800');
                vfRec.textContent = '\u25CF REC  ' + lens.manufacturer + ' ' + lens.name;

            } else if (style === 'imax') {
                // IMAX style: minimal, grand
                vfLeft.textContent = 'IMAX  ' + lens.name + '  ' + Math.round(focalLength) + 'mm';
                vfRight.textContent = '1.43:1  15/70  ' + sensorDims;
                vfRec.textContent = 'IMAX  \u25CF';

            } else if (style === 'panavision') {
                // Panavision style: classic Hollywood
                vfLeft.textContent = 'PANAVISION  ' + body.name + '  ' + lens.name;
                vfRight.textContent = Math.round(focalLength) + 'mm  T' + aperture.toFixed(1) + '  ' + displayAR;
                vfRec.textContent = '\u25CF FILMING  LiColor2';

            } else if (style === 'canon') {
                // Canon style: broadcast/cinema hybrid
                vfLeft.textContent = body.name + '  ' + lens.name + '  ' + Math.round(focalLength) + 'mm';
                vfRight.textContent = 'T' + aperture.toFixed(1) + '  ' + displayAR + '  C-Log2';
                vfRec.textContent = '\u25CFREC  Canon Cinema  ' + sensorFormat;

            } else {
                // Default
                vfLeft.textContent = body.manufacturer + ' ' + body.name + ' | ' + lens.name + ' ' + Math.round(focalLength) + 'mm T' + aperture.toFixed(1);
                vfRight.textContent = sensorFormat + ' ' + sensorDims + ' | ' + displayAR + ' | 24fps';
            }

            // Update manufacturer badge
            var badge = document.querySelector('.vf-badge');
            if (badge) badge.textContent = body.manufacturer;
        }

        // ───────────────────────────────────────────────────────────
        // TRANSFORM PANEL
        // ───────────────────────────────────────────────────────────

        var xformBody = document.getElementById('xform-body');
        var xformToggle = document.getElementById('xform-toggle');
        var xformOpen = true;
        xformToggle.addEventListener('click', function () {
            xformOpen = !xformOpen;
            xformBody.style.display = xformOpen ? '' : 'none';
            xformToggle.textContent = 'transforms ' + (xformOpen ? '\u25BE' : '\u25B8');
        });

        entities.forEach(function (item) {
            var group = document.createElement('div');
            group.className = 'entity-group';
            group.innerHTML = '<h3>' + item.name + '</h3>';

            var pos = item.entity.getLocalPosition();
            var rot = item.entity.getLocalEulerAngles();
            var scl = item.entity.getLocalScale();

            var posLabel = document.createElement('div');
            posLabel.className = 'section-label';
            posLabel.textContent = 'position';
            group.appendChild(posLabel);

            makeEntitySlider(group, item, 'pos_x', 'X', pos.x, -5, 5, 0.01, function (v) {
                var p = item.entity.getLocalPosition(); item.entity.setLocalPosition(v, p.y, p.z);
            });
            makeEntitySlider(group, item, 'pos_y', 'Y', pos.y, -5, 5, 0.01, function (v) {
                var p = item.entity.getLocalPosition(); item.entity.setLocalPosition(p.x, v, p.z);
            });
            makeEntitySlider(group, item, 'pos_z', 'Z', pos.z, -5, 5, 0.01, function (v) {
                var p = item.entity.getLocalPosition(); item.entity.setLocalPosition(p.x, p.y, v);
            });

            var rotLabel = document.createElement('div');
            rotLabel.className = 'section-label';
            rotLabel.textContent = 'rotation';
            group.appendChild(rotLabel);

            makeEntitySlider(group, item, 'rot_x', 'X', rot.x, -180, 180, 1, function (v) {
                var r = item.entity.getLocalEulerAngles(); item.entity.setLocalEulerAngles(v, r.y, r.z);
            });
            makeEntitySlider(group, item, 'rot_y', 'Y', rot.y, -180, 180, 1, function (v) {
                var r = item.entity.getLocalEulerAngles(); item.entity.setLocalEulerAngles(r.x, v, r.z);
            });
            makeEntitySlider(group, item, 'rot_z', 'Z', rot.z, -180, 180, 1, function (v) {
                var r = item.entity.getLocalEulerAngles(); item.entity.setLocalEulerAngles(r.x, r.y, v);
            });

            var sclLabel = document.createElement('div');
            sclLabel.className = 'section-label';
            sclLabel.textContent = 'scale';
            group.appendChild(sclLabel);

            makeEntitySlider(group, item, 'scale', 'S', scl.x, 0.01, 5, 0.01, function (v) {
                item.entity.setLocalScale(v, v, v);
            });

            xformBody.appendChild(group);
        });

        // Copy button
        var copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'copy values to clipboard';
        copyBtn.addEventListener('click', function () {
            var out = '';
            entities.forEach(function (item) {
                var p = item.entity.getLocalPosition();
                var r = item.entity.getLocalEulerAngles();
                var s = item.entity.getLocalScale();
                out += item.name + ':\n';
                out += '  pos(' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ', ' + p.z.toFixed(2) + ')\n';
                out += '  rot(' + r.x.toFixed(1) + ', ' + r.y.toFixed(1) + ', ' + r.z.toFixed(1) + ')\n';
                out += '  scale(' + s.x.toFixed(2) + ')\n';
            });
            navigator.clipboard.writeText(out);
            copyBtn.textContent = 'copied!';
            setTimeout(function () { copyBtn.textContent = 'copy values to clipboard'; }, 1500);
        });
        xformBody.appendChild(copyBtn);

        // Prevent panel from triggering orbit
        document.getElementById('transform-panel').addEventListener('mousedown', function (e) { e.stopPropagation(); });

        // ───────────────────────────────────────────────────────────
        // SLIDER FACTORIES
        // ───────────────────────────────────────────────────────────

        function makeEntitySlider(parent, item, refKey, label, initial, min, max, step, onChange) {
            var result = makeSlider(parent, label, initial, min, max, step, function (v) {
                pushUndo(entities);
                onChange(v);
            });
            sliderRefs[item.name + '_' + refKey] = { input: result.input, val: result.valEl, step: step };
            return result;
        }

        function makeSlider(parent, label, initial, min, max, step, onChange) {
            var row = document.createElement('div');
            row.className = 'slider-row';

            var lbl = document.createElement('label');
            lbl.textContent = label;

            var input = document.createElement('input');
            input.type = 'range';
            input.min = min; input.max = max; input.step = step;
            input.value = initial;

            var val = document.createElement('span');
            val.className = 'val';
            val.textContent = formatVal(initial, step);
            val.title = 'double-click to type';

            input.addEventListener('input', function () {
                var v = parseFloat(input.value);
                val.textContent = formatVal(v, step);
                onChange(v);
            });

            // Double-click to type value
            val.addEventListener('dblclick', function () {
                var inp = document.createElement('input');
                inp.type = 'number';
                inp.className = 'val-input';
                inp.value = parseFloat(val.textContent);
                inp.min = min; inp.max = max; inp.step = step;
                val.style.display = 'none';
                row.appendChild(inp);
                inp.focus();
                inp.select();

                function commit() {
                    var v = parseFloat(inp.value);
                    if (isNaN(v)) v = initial;
                    v = Math.max(min, Math.min(max, v));
                    input.value = v;
                    val.textContent = formatVal(v, step);
                    val.style.display = '';
                    if (inp.parentNode) inp.parentNode.removeChild(inp);
                    onChange(v);
                }

                inp.addEventListener('blur', commit);
                inp.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); commit(); }
                    if (e.key === 'Escape') {
                        val.style.display = '';
                        if (inp.parentNode) inp.parentNode.removeChild(inp);
                    }
                    e.stopPropagation();
                });
            });

            row.appendChild(lbl);
            row.appendChild(input);
            row.appendChild(val);
            parent.appendChild(row);

            return { parentRow: row, input: input, valEl: val };
        }

        // ───────────────────────────────────────────────────────────
        // SETTINGS MODAL
        // ───────────────────────────────────────────────────────────

        var settingsModal = document.getElementById('settings-modal');
        var settingsListening = null;

        function toggleSettings() {
            settingsModal.classList.toggle('active');
            if (settingsModal.classList.contains('active')) {
                renderSettings();
            } else {
                settingsListening = null;
            }
        }

        function renderSettings() {
            var container = document.getElementById('settings-bindings');
            container.innerHTML = '';

            var sections = {
                'Camera Presets': ['bookmark1','bookmark2','bookmark3','bookmark4','povPhop','povDavinci'],
                'Controls': ['toggleFly','toggleViewfinder','lockCamera','lockPhop','lockDavinci','cycleCamera','settings'],
                'Movement (fly mode)': ['moveForward','moveBack','moveLeft','moveRight','moveUp','moveDown'],
                'Capture': ['capture']
            };

            for (var secName in sections) {
                var sec = document.createElement('div');
                sec.className = 'settings-section';
                sec.innerHTML = '<h3>' + secName + '</h3>';

                sections[secName].forEach(function (action) {
                    var row = document.createElement('div');
                    row.className = 'bind-row';
                    var span = document.createElement('span');
                    span.textContent = bindings[action].label;
                    var btn = document.createElement('button');
                    btn.className = 'bind-key';
                    btn.textContent = keyDisplayName(bindings[action].key);
                    btn.addEventListener('click', function () {
                        var prev = container.querySelector('.listening');
                        if (prev) prev.classList.remove('listening');

                        btn.classList.add('listening');
                        btn.textContent = '...';
                        settingsListening = action;

                        function onKey(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            bindings[action].key = e.code;
                            btn.textContent = keyDisplayName(e.code);
                            btn.classList.remove('listening');
                            settingsListening = null;
                            saveBindings();
                            window.removeEventListener('keydown', onKey, true);
                        }
                        window.addEventListener('keydown', onKey, true);
                    });
                    row.appendChild(span);
                    row.appendChild(btn);
                    sec.appendChild(row);
                });

                // Add Shift+Space info line under Capture section
                if (secName === 'Capture') {
                    var infoRow = document.createElement('div');
                    infoRow.className = 'bind-row';
                    infoRow.style.opacity = '0.6';
                    var infoSpan = document.createElement('span');
                    infoSpan.textContent = 'Capture All Cameras';
                    var infoKey = document.createElement('span');
                    infoKey.className = 'bind-key';
                    infoKey.style.pointerEvents = 'none';
                    infoKey.textContent = '\u21E7+SPC';
                    infoRow.appendChild(infoSpan);
                    infoRow.appendChild(infoKey);
                    sec.appendChild(infoRow);
                }

                container.appendChild(sec);
            }
        }

        document.getElementById('settings-close').addEventListener('click', function () {
            toggleSettings();
        });

        document.getElementById('settings-reset').addEventListener('click', function () {
            bindings = JSON.parse(JSON.stringify(defaultBindings));
            saveBindings();
            renderSettings();
        });

        // Close settings on click outside
        settingsModal.addEventListener('click', function (e) {
            if (e.target === settingsModal) toggleSettings();
        });

        // ───────────────────────────────────────────────────────────
        // MODE BADGE (flash)
        // ───────────────────────────────────────────────────────────

        var badgeEl = document.getElementById('mode-badge');
        var badgeTimer = null;

        function flashBadge(text) {
            badgeEl.textContent = text;
            badgeEl.style.opacity = '1';
            clearTimeout(badgeTimer);
            badgeTimer = setTimeout(function () { badgeEl.style.opacity = '0'; }, 1200);
        }

        // ───────────────────────────────────────────────────────────
        // SNAPSHOT PIPELINE
        // ───────────────────────────────────────────────────────────

        // ── Helpers ──
        function classifyShotType(fl) {
            if (fl <= 21) return 'Extreme wide'; if (fl <= 35) return 'Wide';
            if (fl <= 50) return 'Medium'; if (fl <= 85) return 'Medium close-up';
            if (fl <= 135) return 'Close-up'; return 'Extreme close-up';
        }
        function classifyCameraHeight(y) {
            if (y < 0.5) return 'Low-angle'; if (y < 1.3) return 'Below eye-level';
            if (y < 1.8) return 'Eye-level'; if (y < 2.5) return 'Above eye-level';
            return 'High-angle';
        }
        function generatePrompt(meta) {
            var st = classifyShotType(meta.lens.focalLength);
            var ht = classifyCameraHeight(meta.position[1]);
            var dof = meta.lens.aperture <= 2.8 ? 'Shallow depth of field' : 'Deep focus';
            return st + ' shot on ' + meta.camera.body + ' with ' + meta.lens.name + ' ' +
                meta.lens.focalLength + 'mm at T' + meta.lens.aperture.toFixed(1) + '. ' +
                ht + ' camera, ' + meta.aspectRatio + '. ' + dof + ', focus at ' +
                meta.focusDistance.toFixed(1) + 'm. ' + meta.camera.lookSignature + '. Lens: ' +
                meta.lens.lookSignature + '. Golden Gate waterfront, golden hour.';
        }

        // ── File System Access API (folder save) ──
        var projectDirHandle = null; // persisted across captures

        async function getProjectDir() {
            if (projectDirHandle) return projectDirHandle;
            // Ask user to pick a save folder (first capture only)
            if (window.showDirectoryPicker) {
                try {
                    projectDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    return projectDirHandle;
                } catch (e) {
                    // User cancelled — fall back to downloads
                    return null;
                }
            }
            return null;
        }

        async function getOrCreateDir(parent, name) {
            return await parent.getDirectoryHandle(name, { create: true });
        }

        async function writeFile(dirHandle, filename, blob) {
            var fileHandle = await dirHandle.getFileHandle(filename, { create: true });
            var writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        }

        function downloadBlob(blob, filename) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }

        // ── Main capture function ──
        async function captureSnapshot() {
            var flash = document.getElementById('snapshot-flash');
            flash.classList.add('flash');
            setTimeout(function () { flash.classList.remove('flash'); }, 200);

            // Get shot name from active camera
            var shotName = (activeCamId && cameras.length
                ? (cameras.find(function(c){return c.id===activeCamId})||{}).name
                : null) || 'Shot';
            var shotSlug = shotName.replace(/[^a-zA-Z0-9_-]/g, '-');
            var seq = (window._snapshotSeq = (window._snapshotSeq || 0) + 1);
            var baseName = shotSlug + '-' + String(seq).padStart(3, '0');

            // Build metadata
            var pos = camera.getPosition(), rot = camera.getEulerAngles();
            var meta = {
                shot: shotName, sequence: seq,
                camera: {
                    body: activeBody.manufacturer + ' ' + activeBody.name,
                    sensor: [activeBody.sensorWidth, activeBody.sensorHeight],
                    colorScience: activeBody.colorScience,
                    nativeISO: activeBody.nativeISO || '800',
                    lookSignature: activeBody.lookSignature || '',
                    feel: activeBody.feel || ''
                },
                lens: {
                    name: activeLens.manufacturer + ' ' + activeLens.name,
                    focalLength: focalLength, aperture: aperture,
                    type: activeLens.type, squeeze: activeLens.squeeze || 1,
                    coverage: activeLens.coverage || 'S35',
                    lookSignature: activeLens.lookSignature || '',
                    character: activeLens.character || ''
                },
                focusDistance: state.focusDistance || 3.0,
                fov: fovForBody(activeBody, focalLength),
                aspectRatio: deliveryAspect > 0 ? deliveryAspect.toFixed(2) + ':1' : (activeBody.sensorWidth / activeBody.sensorHeight).toFixed(2) + ':1',
                position: [+pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3)],
                rotation: [+rot.x.toFixed(1), +rot.y.toFixed(1), +rot.z.toFixed(1)],
                resolution: [canvas.width, canvas.height],
                timestamp: new Date().toISOString()
            };

            // Generate files
            var frameBlob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
            var metaBlob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
            var promptBlob = new Blob([generatePrompt(meta)], { type: 'text/plain' });

            // Camera card
            var cc = document.createElement('canvas');
            cc.width = canvas.width; cc.height = canvas.height;
            var ctx = cc.getContext('2d');
            ctx.drawImage(canvas, 0, 0);
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, cc.width, 36);
            ctx.fillRect(0, cc.height - 36, cc.width, 36);
            ctx.font = '14px monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillText(meta.camera.body + ' | ' + meta.lens.name + ' ' + focalLength + 'mm T' + aperture.toFixed(1), 12, 22);
            ctx.textAlign = 'right';
            ctx.fillText(meta.aspectRatio + ' | ' + activeBody.colorScience, cc.width - 12, 22);
            ctx.textAlign = 'left';
            ctx.fillText(baseName + ' | ' + meta.timestamp.split('T')[0], 12, cc.height - 14);
            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(255,80,80,0.8)';
            ctx.fillText('\u25CF CAPTURE', cc.width - 12, cc.height - 14);
            var cardBlob = await new Promise(function(resolve) { cc.toBlob(resolve, 'image/png'); });

            // Try saving to project folder structure
            var dirHandle = await getProjectDir();
            if (dirHandle) {
                try {
                    // Folder structure: <project>/<date>/<camera-angle>/files
                    var dateStr = new Date().toISOString().split('T')[0]; // 2026-06-02
                    var dateDir = await getOrCreateDir(dirHandle, dateStr);
                    var angleDir = await getOrCreateDir(dateDir, shotSlug);

                    await writeFile(angleDir, baseName + '.png', frameBlob);
                    await writeFile(angleDir, baseName + '-meta.json', metaBlob);
                    await writeFile(angleDir, baseName + '-prompt.txt', promptBlob);
                    await writeFile(angleDir, baseName + '-card.png', cardBlob);

                    flashBadge('saved: ' + dateStr + '/' + shotSlug + '/' + baseName);
                    return;
                } catch (e) {
                    console.error('folder save failed, falling back to downloads:', e);
                }
            }

            // Fallback: browser downloads
            downloadBlob(frameBlob, baseName + '.png');
            downloadBlob(metaBlob, baseName + '-meta.json');
            downloadBlob(promptBlob, baseName + '-prompt.txt');
            downloadBlob(cardBlob, baseName + '-card.png');
            flashBadge('captured: ' + baseName);
        }

        // ── Capture ALL cameras sequentially ──
        async function captureAllCameras() {
            if (!cameras.length) return;
            var originalId = activeCamId;
            flashBadge('capturing all ' + cameras.length + ' cameras...');

            // Ensure we have a project dir before the loop
            await getProjectDir();

            for (var i = 0; i < cameras.length; i++) {
                // Switch to this camera (updates position, body, lens)
                switchCamera(cameras[i].id);

                // Wait one frame for PlayCanvas to render the new view
                await new Promise(function(resolve) {
                    app.once('frameend', resolve);
                });

                // Capture this camera's view
                await captureSnapshot();

                // Small delay between saves
                await new Promise(function(resolve) { setTimeout(resolve, 200); });
            }

            // Restore original camera
            switchCamera(originalId);
            flashBadge('all ' + cameras.length + ' cameras captured');
        }

        // ───────────────────────────────────────────────────────────
        // MULTI-CAMERA SYSTEM
        // ───────────────────────────────────────────────────────────

        var cameras = [];
        var activeCamId = null;
        var camSeqId = 0;

        function createCameraData(opts) {
            camSeqId++;
            var letter = String.fromCharCode(64 + camSeqId); // A, B, C...
            return {
                id: 'cam-' + camSeqId,
                name: letter + ' - ' + (opts.name || 'Camera ' + letter),
                bodyId: opts.bodyId || activeBody.id,
                lensId: opts.lensId || activeLens.id,
                focalLength: opts.focalLength || focalLength,
                aperture: opts.aperture || aperture,
                position: opts.position || camera.getPosition().clone(),
                rotation: opts.rotation || camera.getEulerAngles().clone(),
                thumbnail: null,
                shotType: opts.shotType || 'medium',
                shotDescription: opts.shotDescription || '',
                shotNotes: opts.shotNotes || ''
            };
        }

        function addCamera(opts) {
            var camData = createCameraData(opts || {});
            cameras.push(camData);
            if (!activeCamId) activeCamId = camData.id;
            renderCameraStrip();
            saveCameraState();
            return camData;
        }

        function switchCamera(id) {
            // Save current camera state before switching
            var current = cameras.find(function(c) { return c.id === activeCamId; });
            if (current) {
                current.position = camera.getPosition().clone();
                current.rotation = camera.getEulerAngles().clone();
                current.bodyId = activeBody.id;
                current.lensId = activeLens.id;
                current.focalLength = focalLength;
                current.aperture = aperture;
                // Capture thumbnail of current view
                try { current.thumbnail = canvas.toDataURL('image/jpeg', 0.3); } catch(e) {}
            }

            // Load new camera
            var target = cameras.find(function(c) { return c.id === id; });
            if (!target) return;

            activeCamId = target.id;

            // Restore camera position
            camera.setPosition(target.position.x, target.position.y, target.position.z);
            camera.setEulerAngles(target.rotation.x, target.rotation.y, target.rotation.z);

            // Restore body/lens settings
            activeBody = getBody(target.bodyId);
            activeLens = getLens(target.lensId);
            focalLength = target.focalLength;
            aperture = target.aperture;
            state.bodyId = activeBody.id;
            state.lensId = activeLens.id;
            state.focalLength = focalLength;
            state.aperture = aperture;

            // Update UI dropdowns to reflect loaded camera
            if (typeof bodySelect !== 'undefined') bodySelect.value = activeBody.id;
            if (typeof lensSelect !== 'undefined') lensSelect.value = activeLens.id;
            if (typeof flSelect !== 'undefined') {
                buildFocalLengthOptions();
            }
            if (typeof apSlider !== 'undefined') {
                apSlider.input.value = aperture;
                apSlider.valEl.textContent = formatVal(aperture, 0.1);
            }
            if (typeof bodyDesc !== 'undefined') bodyDesc.textContent = activeBody.description;
            if (typeof lensDesc !== 'undefined') lensDesc.textContent = activeLens.lookSignature || activeLens.character;

            // Update viewfinder and camera look
            applyViewfinderStyle();
            updateCameraLook();
            renderCameraStrip();
            saveCameraState();

            // Update fly mode angles if in fly mode
            if (cameraMode === 'fly') {
                flyYaw = target.rotation.y;
                flyPitch = target.rotation.x;
            }

            // Update orbit if in orbit mode
            if (cameraMode === 'orbit') {
                smooth.tx = target.position.x;
                smooth.ty = target.position.y - 0.5;
                smooth.tz = target.position.z - 2;
            }

            // Update shot info panel if it exists
            if (typeof loadShotInfo === 'function') loadShotInfo();
        }

        function removeCamera(id) {
            if (cameras.length <= 1) return; // keep at least one
            cameras = cameras.filter(function(c) { return c.id !== id; });
            if (activeCamId === id) {
                switchCamera(cameras[0].id);
            }
            renderCameraStrip();
            saveCameraState();
        }

        function duplicateCamera(id) {
            var src = cameras.find(function(c) { return c.id === id; });
            if (!src) return;
            addCamera({
                name: src.name + ' copy',
                bodyId: src.bodyId,
                lensId: src.lensId,
                focalLength: src.focalLength,
                aperture: src.aperture,
                position: src.position.clone ? src.position.clone() : new pc.Vec3(src.position.x, src.position.y, src.position.z),
                rotation: src.rotation.clone ? src.rotation.clone() : new pc.Vec3(src.rotation.x, src.rotation.y, src.rotation.z),
                shotType: src.shotType,
                shotDescription: src.shotDescription,
                shotNotes: src.shotNotes
            });
        }

        // ── Camera Strip UI ──

        function renderCameraStrip() {
            var strip = document.getElementById('camera-strip');
            strip.style.display = '';
            strip.innerHTML = '';

            cameras.forEach(function(cam) {
                var thumb = document.createElement('div');
                thumb.className = 'cam-thumb' + (cam.id === activeCamId ? ' active' : '');

                // Show thumbnail if available
                if (cam.thumbnail) {
                    thumb.style.backgroundImage = 'url(' + cam.thumbnail + ')';
                    thumb.style.backgroundSize = 'cover';
                    thumb.style.backgroundPosition = 'center';
                }

                // Dark gradient overlay for text readability over thumbnails
                var gradOverlay = document.createElement('div');
                gradOverlay.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:24px;background:linear-gradient(transparent,rgba(0,0,0,0.75));border-radius:0 0 3px 3px;pointer-events:none;';
                thumb.appendChild(gradOverlay);

                // Top gradient for body label readability
                var topGrad = document.createElement('div');
                topGrad.style.cssText = 'position:absolute;top:0;left:0;right:0;height:16px;background:linear-gradient(rgba(0,0,0,0.6),transparent);border-radius:3px 3px 0 0;pointer-events:none;';
                thumb.appendChild(topGrad);

                var label = document.createElement('div');
                label.className = 'cam-thumb-label';
                label.textContent = cam.name;
                thumb.appendChild(label);

                var bodyLabel = document.createElement('div');
                bodyLabel.className = 'cam-thumb-body';
                var b = getBody(cam.bodyId);
                bodyLabel.textContent = b.manufacturer;
                thumb.appendChild(bodyLabel);

                // Click to switch
                thumb.addEventListener('click', function() {
                    switchCamera(cam.id);
                });

                // Right-click context menu for delete/duplicate
                thumb.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    if (confirm('Delete camera "' + cam.name + '"?')) {
                        removeCamera(cam.id);
                    }
                });

                strip.appendChild(thumb);
            });

            // Add button
            var addBtn = document.createElement('button');
            addBtn.className = 'cam-add';
            addBtn.textContent = '+';
            addBtn.title = 'Add new camera at current position';
            addBtn.addEventListener('click', function() {
                addCamera({});
            });
            strip.appendChild(addBtn);

            // Capture All button
            var captAllBtn = document.createElement('button');
            captAllBtn.className = 'cam-add';
            captAllBtn.textContent = '\u23FA';
            captAllBtn.title = 'Capture all cameras (Shift+Space)';
            captAllBtn.style.color = '#c33';
            captAllBtn.addEventListener('click', function() { captureAllCameras(); });
            strip.appendChild(captAllBtn);

            // Sync shot list display
            if (typeof renderShotList === 'function') renderShotList();
        }

        // ── Camera State Persistence (localStorage) ──

        function saveCameraState() {
            // Update current camera before saving
            var current = cameras.find(function(c) { return c.id === activeCamId; });
            if (current) {
                current.position = camera.getPosition().clone();
                current.rotation = camera.getEulerAngles().clone();
            }

            var data = cameras.map(function(c) {
                return {
                    id: c.id,
                    name: c.name,
                    bodyId: c.bodyId,
                    lensId: c.lensId,
                    focalLength: c.focalLength,
                    aperture: c.aperture,
                    position: { x: c.position.x, y: c.position.y, z: c.position.z },
                    rotation: { x: c.rotation.x, y: c.rotation.y, z: c.rotation.z },
                    shotType: c.shotType || 'medium',
                    shotDescription: c.shotDescription || '',
                    shotNotes: c.shotNotes || ''
                };
            });
            localStorage.setItem('ib-cameras', JSON.stringify({ cameras: data, activeId: activeCamId, seqId: camSeqId }));
        }

        function loadCameraState() {
            try {
                var saved = localStorage.getItem('ib-cameras');
                if (saved) {
                    var data = JSON.parse(saved);
                    camSeqId = data.seqId || 0;
                    data.cameras.forEach(function(c) {
                        cameras.push({
                            id: c.id,
                            name: c.name,
                            bodyId: c.bodyId,
                            lensId: c.lensId,
                            focalLength: c.focalLength,
                            aperture: c.aperture,
                            position: new pc.Vec3(c.position.x, c.position.y, c.position.z),
                            rotation: new pc.Vec3(c.rotation.x, c.rotation.y, c.rotation.z),
                            thumbnail: null,
                            shotType: c.shotType || 'medium',
                            shotDescription: c.shotDescription || '',
                            shotNotes: c.shotNotes || ''
                        });
                    });
                    activeCamId = data.activeId;
                    return true;
                }
            } catch(e) {}
            return false;
        }

        // ── Initialize multi-camera system ──
        if (!loadCameraState()) {
            addCamera({ name: 'Wide Master' });
        }
        // Apply the active camera
        if (activeCamId) {
            switchCamera(activeCamId);
        }
        renderCameraStrip();

        // Capture initial thumbnail after first frame renders
        app.once('frameend', function() {
            var current = cameras.find(function(c) { return c.id === activeCamId; });
            if (current) {
                try { current.thumbnail = canvas.toDataURL('image/jpeg', 0.3); } catch(e) {}
                renderCameraStrip();
            }
        });

        // Periodic thumbnail update for active camera (every 3 seconds)
        setInterval(function() {
            var current = cameras.find(function(c) { return c.id === activeCamId; });
            if (current) {
                try {
                    current.thumbnail = canvas.toDataURL('image/jpeg', 0.3);
                    // Update just the active thumbnail's background without full re-render
                    var activeThumb = document.querySelector('.cam-thumb.active');
                    if (activeThumb && current.thumbnail) {
                        activeThumb.style.backgroundImage = 'url(' + current.thumbnail + ')';
                        activeThumb.style.backgroundSize = 'cover';
                        activeThumb.style.backgroundPosition = 'center';
                    }
                } catch(e) {}
            }
        }, 3000);

        // Prevent camera strip from triggering orbit
        document.getElementById('camera-strip').addEventListener('mousedown', function (e) { e.stopPropagation(); });

        updateModeUI();
        updateCameraLook();
        console.log('image-blaster // still-220723 \u2014 Virtual Sound Stage ready');
    }
})();
