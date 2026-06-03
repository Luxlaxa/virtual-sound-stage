// IMAGE-BLASTER: still-220723 — Golden Gate Waterfront
// Recreates the original shot composition.
//
// SETUP:
//   1. In PlayCanvas editor, create an empty Entity named "SceneSetup"
//   2. Add a Script component → upload this file → add "sceneSetup" script
//   3. Assign the 4 asset slots in the Inspector
//   4. Press Play — entities are created and camera is positioned

var SceneSetup = pc.createScript('sceneSetup');

SceneSetup.attributes.add('splatAsset',   { type: 'asset', assetType: 'gsplat', title: 'World Splat (still-220723.compressed.ply)' });
SceneSetup.attributes.add('phopAsset',    { type: 'asset', assetType: 'container', title: 'Phop (phop.glb)' });
SceneSetup.attributes.add('davinciAsset', { type: 'asset', assetType: 'container', title: 'Davinci (davinci.glb)' });
SceneSetup.attributes.add('audioAsset',   { type: 'asset', assetType: 'audio', title: 'Ambient Loop (ambient-loop.mp3)' });

SceneSetup.prototype.initialize = function () {

    // ── World Splat ────────────────────────────────────────────────────────
    var world = new pc.Entity('World');
    world.addComponent('gsplat', { asset: this.splatAsset });
    world.setLocalPosition(0, 0, 0);
    this.app.root.addChild(world);

    // ── Phop — camera left, facing Davinci ────────────────────────────────
    // Original shot: woman on LEFT side of frame, body turned ~30° toward man,
    // right hand slightly raised toward him.
    var phop = new pc.Entity('Phop');
    phop.addComponent('render', {
        asset: this.phopAsset,
        type: 'asset'
    });
    phop.setLocalPosition(-0.42, 0, 0);
    // Hunyuan models face -Z by default. Rotate so she faces Davinci (+X dir).
    // If she looks wrong, try Y: 90 or Y: -90
    phop.setLocalEulerAngles(0, 90, 0);
    phop.setLocalScale(1, 1, 1);
    this.app.root.addChild(phop);

    // ── Davinci — camera right, facing Phop ───────────────────────────────
    // Original shot: man on RIGHT side of frame, body turned ~30° toward woman,
    // right hand gesturing open toward her, slight smile.
    var davinci = new pc.Entity('Davinci');
    davinci.addComponent('render', {
        asset: this.davinciAsset,
        type: 'asset'
    });
    davinci.setLocalPosition(0.42, 0, 0);
    // Rotate so he faces Phop (-X dir).
    // If he looks wrong, try Y: -90 or Y: 270
    davinci.setLocalEulerAngles(0, -90, 0);
    davinci.setLocalScale(1, 1, 1);
    this.app.root.addChild(davinci);

    // ── Ambient Audio ──────────────────────────────────────────────────────
    var audio = new pc.Entity('Ambient');
    audio.addComponent('sound');
    audio.sound.addSlot('loop', {
        asset: this.audioAsset,
        loop: true,
        autoPlay: true,
        volume: 0.5
    });
    this.app.root.addChild(audio);

    // ── Camera ─────────────────────────────────────────────────────────────
    // Original shot: camera at ~chin height, ~2m from subjects, slight downward
    // tilt, bridge centered in background. FOV ~45°, shallow DOF.
    var camera = this.app.root.findByName('Camera');
    if (!camera) {
        camera = new pc.Entity('Camera');
        camera.addComponent('camera', { clearColor: new pc.Color(0.1, 0.1, 0.15) });
        this.app.root.addChild(camera);
    }
    // Position: dead center between characters, ~2m back, chin height 1.42m
    camera.setLocalPosition(0, 1.42, 2.0);
    // Tilt down 6° to match slightly low angle looking up at subjects
    camera.setLocalEulerAngles(6, 0, 0);

    var cam = camera.camera;
    if (cam) {
        cam.fov      = 45;     // matches cinematic medium shot FOV
        cam.nearClip = 0.05;
        cam.farClip  = 2000;
    }

    // ── Camera bookmarks (log to console for SuperSplat export) ───────────
    // Bookmark 1: Wide — pull back, both characters + full bridge
    // Bookmark 2: OTS Phop — behind Phop's right shoulder, Davinci in frame
    // Bookmark 3: OTS Davinci — behind Davinci's left shoulder, Phop in frame
    // Bookmark 4: Match cut — exact original shot position (this camera setup)
    console.log('Scene ready. Camera bookmarks:');
    console.log('  Wide:         pos(0, 1.6, 5.0)  euler(3, 0, 0)');
    console.log('  OTS Phop:     pos(-0.9, 1.5, 0.6)  euler(0, 60, 0)');
    console.log('  OTS Davinci:  pos(0.9, 1.5, 0.6)  euler(0, -60, 0)');
    console.log('  Match cut:    pos(0, 1.42, 2.0)  euler(6, 0, 0)  [current]');
};
