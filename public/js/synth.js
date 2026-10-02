// Web Audio Context & State
let audioCtx;
const activeVoices = {}; 
let globalFX = {};
let activeVoiceCount = 0;
const MAX_VOICES = 16; 

// Modular Data Model
let moduleRegistry = [];
let nextModId = 1;

// FX Toggles
const fxToggles = { del: true, rev: true };

// Initial Presets
const PRESETS = [
    {
        name: "init Zebra2 Modular",
        modules: [
            { id: 1, type: 'osc', title: 'OSC 1', wave: 'sawtooth', semi: 0, detune: 0, vol: 0.8 },
            { id: 2, type: 'osc', title: 'OSC 2', wave: 'square', semi: -12, detune: 8, vol: 0.6 },
            { id: 3, type: 'filter', title: 'VCF 1', mode: 'lowpass', cutoff: 1800, res: 4, envMod: 2000 }
        ]
    },
    {
        name: "Analog Brass & Lead",
        modules: [
            { id: 1, type: 'osc', title: 'OSC 1', wave: 'sawtooth', semi: 0, detune: 0, vol: 0.9 },
            { id: 2, type: 'osc', title: 'OSC 2', wave: 'sawtooth', semi: 0, detune: 14, vol: 0.7 },
            { id: 3, type: 'filter', title: 'VCF 1', mode: 'lowpass', cutoff: 2400, res: 3, envMod: 3500 }
        ]
    },
    {
        name: "Dark Ambient Drone",
        modules: [
            { id: 1, type: 'osc', title: 'OSC 1', wave: 'triangle', semi: -24, detune: 0, vol: 0.9 },
            { id: 2, type: 'noise', title: 'NOISE 1', color: 'pink', vol: 0.4 },
            { id: 3, type: 'dist', title: 'DIST 1', drive: 40 },
            { id: 4, type: 'filter', title: 'VCF 1', mode: 'lowpass', cutoff: 900, res: 6, envMod: 800 }
        ]
    }
];
let currentPresetIndex = 0;

// Initialize Audio Context and Global FX Chain
function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    globalFX.input = audioCtx.createGain();
    
    // Stereo Delay
    globalFX.delay = audioCtx.createDelay(2.0);
    globalFX.delayFb = audioCtx.createGain();
    globalFX.delayMix = audioCtx.createGain();
    globalFX.dryMix = audioCtx.createGain();

    // Reverb
    globalFX.reverb = audioCtx.createConvolver();
    globalFX.reverb.buffer = generateReverbIR(audioCtx, 2.0);
    globalFX.revMix = audioCtx.createGain();

    // Master
    globalFX.master = audioCtx.createGain();
    globalFX.master.gain.value = parseFloat(document.getElementById('master-vol').value);

    // Routing
    globalFX.input.connect(globalFX.dryMix);
    globalFX.input.connect(globalFX.delay);
    globalFX.delay.connect(globalFX.delayFb).connect(globalFX.delay);
    globalFX.delay.connect(globalFX.delayMix);

    globalFX.dryMix.connect(globalFX.master);
    globalFX.delayMix.connect(globalFX.master);

    globalFX.dryMix.connect(globalFX.reverb);
    globalFX.delayMix.connect(globalFX.reverb);
    globalFX.reverb.connect(globalFX.revMix).connect(globalFX.master);

    globalFX.master.connect(audioCtx.destination);
    updateGlobalFX();
}

function generateReverbIR(ctx, duration) {
    const rate = ctx.sampleRate, length = rate * duration, impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0), right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
        const decay = Math.exp(-i / (rate * (duration / 3)));
        left[i] = (Math.random() * 2 - 1) * decay;
        right[i] = (Math.random() * 2 - 1) * decay;
    }
    return impulse;
}

function updateGlobalFX() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const delTime = parseFloat(document.getElementById('del-time').value);
    const delFb = parseFloat(document.getElementById('del-fb').value);
    const delMix = parseFloat(document.getElementById('del-mix').value);
    const revMix = parseFloat(document.getElementById('rev-mix').value);

    globalFX.delay.delayTime.setTargetAtTime(delTime, t, 0.05);
    globalFX.delayFb.gain.setTargetAtTime(delFb, t, 0.05);
    globalFX.delayMix.gain.setTargetAtTime(fxToggles.del ? delMix : 0, t, 0.05);
    globalFX.revMix.gain.setTargetAtTime(fxToggles.rev ? revMix : 0, t, 0.05);
}

// Global FX listeners
['del-time', 'del-fb', 'del-mix', 'rev-mix'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateGlobalFX);
});
document.getElementById('master-vol').addEventListener('input', e => {
    if (globalFX.master) globalFX.master.gain.setTargetAtTime(parseFloat(e.target.value), audioCtx.currentTime, 0.05);
});

// FX Power Buttons
['del', 'rev'].forEach(fx => {
    const btn = document.getElementById(`pwr-${fx}`);
    btn.addEventListener('click', () => {
        fxToggles[fx] = !fxToggles[fx];
        btn.classList.toggle('on', fxToggles[fx]);
        updateGlobalFX();
    });
});

// --- DYNAMIC MODULE SYSTEM (Add / Remove Modules) ---
function addModule(type, defaults = {}) {
    const id = nextModId++;
    let modObj = { id, type, ...defaults };

    if (type === 'osc') {
        modObj.title = modObj.title || `OSC ${id}`;
        modObj.wave = modObj.wave || 'sawtooth';
        modObj.semi = modObj.semi !== undefined ? modObj.semi : 0;
        modObj.detune = modObj.detune !== undefined ? modObj.detune : 0;
        modObj.vol = modObj.vol !== undefined ? modObj.vol : 0.8;
    } else if (type === 'filter') {
        modObj.title = modObj.title || `VCF ${id}`;
        modObj.mode = modObj.mode || 'lowpass';
        modObj.cutoff = modObj.cutoff || 2000;
        modObj.res = modObj.res || 3;
        modObj.envMod = modObj.envMod || 1500;
    } else if (type === 'noise') {
        modObj.title = modObj.title || `NOISE ${id}`;
        modObj.vol = modObj.vol || 0.4;
    } else if (type === 'dist') {
        modObj.title = modObj.title || `DIST ${id}`;
        modObj.drive = modObj.drive || 30;
    }

    moduleRegistry.push(modObj);
    renderModules();
    updateMatrix();
}

function removeModule(id) {
    moduleRegistry = moduleRegistry.filter(m => m.id !== id);
    renderModules();
    updateMatrix();
}

// Render dynamic modules in the Left Rack
function renderModules() {
    const rack = document.getElementById('module-rack');
    rack.innerHTML = '';

    moduleRegistry.forEach(mod => {
        const pod = document.createElement('div');
        pod.className = `z-pod ${mod.type}-pod`;
        
        let controlsHTML = '';
        if (mod.type === 'osc') {
            controlsHTML = `
                <div class="pod-controls-grid">
                    <div class="ctrl-cell">
                        <label>WAVE</label>
                        <select class="z-select" onchange="updateModProp(${mod.id}, 'wave', this.value)">
                            <option value="sawtooth" ${mod.wave==='sawtooth'?'selected':''}>SAW</option>
                            <option value="square" ${mod.wave==='square'?'selected':''}>SQR</option>
                            <option value="triangle" ${mod.wave==='triangle'?'selected':''}>TRI</option>
                            <option value="sine" ${mod.wave==='sine'?'selected':''}>SIN</option>
                        </select>
                    </div>
                    <div class="ctrl-cell">
                        <label>SEMI</label>
                        <div class="pitch-stepper">
                            <button class="step-btn" onclick="stepProp(${mod.id}, 'semi', -1)">-</button>
                            <input class="step-val" value="${mod.semi}" readonly>
                            <button class="step-btn" onclick="stepProp(${mod.id}, 'semi', 1)">+</button>
                        </div>
                    </div>
                    <div class="ctrl-cell">
                        <label>FINE</label>
                        <input type="range" class="z-slider" min="-50" max="50" value="${mod.detune}" oninput="updateModProp(${mod.id}, 'detune', parseFloat(this.value))">
                    </div>
                    <div class="ctrl-cell">
                        <label>VOL</label>
                        <input type="range" class="z-slider" min="0" max="1" step="0.05" value="${mod.vol}" oninput="updateModProp(${mod.id}, 'vol', parseFloat(this.value))">
                    </div>
                </div>`;
        } else if (mod.type === 'filter') {
            controlsHTML = `
                <div class="pod-controls-grid">
                    <div class="ctrl-cell">
                        <label>MODE</label>
                        <select class="z-select" onchange="updateModProp(${mod.id}, 'mode', this.value)">
                            <option value="lowpass" ${mod.mode==='lowpass'?'selected':''}>LP XCITE</option>
                            <option value="highpass" ${mod.mode==='highpass'?'selected':''}>HP VINT</option>
                            <option value="bandpass" ${mod.mode==='bandpass'?'selected':''}>BP ANALOG</option>
                        </select>
                    </div>
                    <div class="ctrl-cell">
                        <label>CUTOFF</label>
                        <input type="range" class="z-slider" min="50" max="10000" value="${mod.cutoff}" oninput="updateModProp(${mod.id}, 'cutoff', parseFloat(this.value))">
                    </div>
                    <div class="ctrl-cell">
                        <label>RES</label>
                        <input type="range" class="z-slider" min="0" max="20" step="0.5" value="${mod.res}" oninput="updateModProp(${mod.id}, 'res', parseFloat(this.value))">
                    </div>
                    <div class="ctrl-cell">
                        <label>ENV2</label>
                        <input type="range" class="z-slider" min="-5000" max="5000" step="100" value="${mod.envMod}" oninput="updateModProp(${mod.id}, 'envMod', parseFloat(this.value))">
                    </div>
                </div>`;
        } else if (mod.type === 'noise') {
            controlsHTML = `
                <div class="pod-controls-grid">
                    <div class="ctrl-cell">
                        <label>WHITE / PINK</label>
                        <select class="z-select"><option>WHITE</option><option>PINK</option></select>
                    </div>
                    <div class="ctrl-cell">
                        <label>VOL</label>
                        <input type="range" class="z-slider" min="0" max="1" step="0.05" value="${mod.vol}" oninput="updateModProp(${mod.id}, 'vol', parseFloat(this.value))">
                    </div>
                </div>`;
        } else if (mod.type === 'dist') {
            controlsHTML = `
                <div class="pod-controls-grid">
                    <div class="ctrl-cell">
                        <label>DRIVE</label>
                        <input type="range" class="z-slider" min="0" max="100" value="${mod.drive}" oninput="updateModProp(${mod.id}, 'drive', parseFloat(this.value))">
                    </div>
                </div>`;
        }

        pod.innerHTML = `
            <div class="pod-head">
                <span class="pod-title-tag">${mod.title}</span>
                <button class="pod-del-btn" onclick="removeModule(${mod.id})" title="Remove module">✕</button>
            </div>
            ${controlsHTML}
        `;
        rack.appendChild(pod);
    });
}

// Updaters
window.updateModProp = (id, prop, val) => {
    const mod = moduleRegistry.find(m => m.id === id);
    if (mod) mod[prop] = val;
};
window.stepProp = (id, prop, delta) => {
    const mod = moduleRegistry.find(m => m.id === id);
    if (mod) {
        mod[prop] = Math.max(-24, Math.min(24, mod[prop] + delta));
        renderModules();
    }
};

// Center Matrix: Map active modules into the vertical grid
function updateMatrix() {
    ['lane-1', 'lane-2', 'lane-3', 'lane-4'].forEach(id => document.getElementById(id).innerHTML = '');
    
    moduleRegistry.forEach((mod, idx) => {
        const laneIdx = (idx % 4) + 1;
        const laneEl = document.getElementById(`lane-${laneIdx}`);
        const tag = document.createElement('div');
        tag.className = `matrix-slot-tag ${mod.type}-tag`;
        tag.innerText = mod.title;
        laneEl.appendChild(tag);
    });
}

// Right Rack: Envelopes
const env1 = { a: 0.1, d: 0.4, s: 0.6, r: 1.5 }; // Amp Env
const env2 = { a: 0.05, d: 0.3, s: 0.2, r: 0.8 }; // Filter Env

function renderModRack() {
    const modRack = document.getElementById('mod-rack');
    modRack.innerHTML = `
        <div class="z-pod env-pod">
            <div class="pod-head"><span class="pod-title-tag">ENVELOPE 1 (AMP)</span></div>
            <div class="adsr-row">
                <div class="adsr-cell"><input type="range" min="0.01" max="3" step="0.01" value="${env1.a}" oninput="env1.a=parseFloat(this.value)"><label>A</label></div>
                <div class="adsr-cell"><input type="range" min="0.01" max="3" step="0.01" value="${env1.d}" oninput="env1.d=parseFloat(this.value)"><label>D</label></div>
                <div class="adsr-cell"><input type="range" min="0" max="1" step="0.01" value="${env1.s}" oninput="env1.s=parseFloat(this.value)"><label>S</label></div>
                <div class="adsr-cell"><input type="range" min="0.01" max="5" step="0.01" value="${env1.r}" oninput="env1.r=parseFloat(this.value)"><label>R</label></div>
            </div>
        </div>
        <div class="z-pod env-pod">
            <div class="pod-head"><span class="pod-title-tag">ENVELOPE 2 (MOD)</span></div>
            <div class="adsr-row">
                <div class="adsr-cell"><input type="range" min="0.01" max="3" step="0.01" value="${env2.a}" oninput="env2.a=parseFloat(this.value)"><label>A</label></div>
                <div class="adsr-cell"><input type="range" min="0.01" max="3" step="0.01" value="${env2.d}" oninput="env2.d=parseFloat(this.value)"><label>D</label></div>
                <div class="adsr-cell"><input type="range" min="0" max="1" step="0.01" value="${env2.s}" oninput="env2.s=parseFloat(this.value)"><label>S</label></div>
                <div class="adsr-cell"><input type="range" min="0.01" max="5" step="0.01" value="${env2.r}" oninput="env2.r=parseFloat(this.value)"><label>R</label></div>
            </div>
        </div>
        <div class="z-pod lfo-pod">
            <div class="pod-head"><span class="pod-title-tag">LFO 1 (VIBRATO)</span></div>
            <div class="pod-controls-grid">
                <div class="ctrl-cell"><label>RATE</label><input type="range" class="z-slider" min="0.1" max="15" value="4"></div>
                <div class="ctrl-cell"><label>DEPTH</label><input type="range" class="z-slider" min="0" max="1" step="0.05" value="0.2"></div>
            </div>
        </div>
    `;
}

// Preset Loader
function loadPreset(idx) {
    const p = PRESETS[idx];
    document.getElementById('preset-name').innerText = p.name;
    moduleRegistry = JSON.parse(JSON.stringify(p.modules));
    nextModId = Math.max(...moduleRegistry.map(m => m.id), 0) + 1;
    renderModules();
    updateMatrix();
}

document.getElementById('prev-preset').addEventListener('click', () => {
    currentPresetIndex = (currentPresetIndex - 1 + PRESETS.length) % PRESETS.length;
    loadPreset(currentPresetIndex);
});
document.getElementById('next-preset').addEventListener('click', () => {
    currentPresetIndex = (currentPresetIndex + 1) % PRESETS.length;
    loadPreset(currentPresetIndex);
});

// Dropdown Add Menu Logic
const addBtn = document.getElementById('btn-add-module');
const addMenu = document.getElementById('add-dropdown');
addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addMenu.classList.toggle('show');
});
window.addEventListener('click', () => addMenu.classList.remove('show'));
document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
        addModule(item.getAttribute('data-type'));
        addMenu.classList.remove('show');
    });
});

// --- AUDIO VOICE ENGINE (Modular Graph Assembly) ---
function playNote(baseFreq, noteId) {
    initAudio();
    if (activeVoices[noteId] || activeVoiceCount >= MAX_VOICES) return;

    const t = audioCtx.currentTime;
    const oscNodes = [];
    const filterNodes = [];
    
    // Master VCA for this voice driven by Env 1
    const voiceVCA = audioCtx.createGain();
    voiceVCA.gain.setValueAtTime(0, t);
    voiceVCA.gain.linearRampToValueAtTime(1, t + env1.a);
    voiceVCA.gain.setTargetAtTime(env1.s, t + env1.a, env1.d / 4);

    // Build Nodes dynamically based on registered modules!
    const generatorsMix = audioCtx.createGain();

    moduleRegistry.forEach(mod => {
        if (mod.type === 'osc') {
            const osc = audioCtx.createOscillator();
            const oscG = audioCtx.createGain();
            const semitones = mod.semi || 0;
            const freq = baseFreq * Math.pow(2, semitones / 12);

            osc.type = mod.wave;
            osc.frequency.setValueAtTime(freq, t);
            osc.detune.setValueAtTime(mod.detune || 0, t);
            oscG.gain.setValueAtTime(mod.vol || 0.8, t);

            osc.connect(oscG).connect(generatorsMix);
            osc.start(t);
            oscNodes.push(osc);
        } else if (mod.type === 'filter') {
            const filter = audioCtx.createBiquadFilter();
            filter.type = mod.mode;
            filter.Q.setValueAtTime(mod.res, t);

            // Envelope 2 mod automation
            const baseCutoff = Math.max(20, Math.min(10000, mod.cutoff));
            const peakCutoff = Math.max(20, Math.min(10000, baseCutoff + mod.envMod));
            const susCutoff = baseCutoff + ((peakCutoff - baseCutoff) * env2.s);

            filter.frequency.setValueAtTime(baseCutoff, t);
            filter.frequency.linearRampToValueAtTime(peakCutoff, t + env2.a);
            filter.frequency.setTargetAtTime(susCutoff, t + env2.a, env2.d / 4);

            filterNodes.push({ filter, baseCutoff });
        }
    });

    // Route: Generators -> Filters (in series) -> Voice VCA -> Global FX
    if (filterNodes.length > 0) {
        generatorsMix.connect(filterNodes[0].filter);
        for (let i = 0; i < filterNodes.length - 1; i++) {
            filterNodes[i].filter.connect(filterNodes[i+1].filter);
        }
        filterNodes[filterNodes.length - 1].filter.connect(voiceVCA);
    } else {
        generatorsMix.connect(voiceVCA);
    }

    voiceVCA.connect(globalFX.input);

    activeVoiceCount++;
    document.getElementById('voices-readout').innerText = `Poly: ${activeVoiceCount} / 16`;

    // Save voice bundle for noteOff
    activeVoices[noteId] = { oscNodes, filterNodes, voiceVCA };
}

function stopNote(noteId) {
    const voice = activeVoices[noteId];
    if (voice) {
        const t = audioCtx.currentTime;
        const { oscNodes, filterNodes, voiceVCA } = voice;

        // Release Amplitude Envelope
        voiceVCA.gain.cancelScheduledValues(t);
        voiceVCA.gain.setValueAtTime(voiceVCA.gain.value, t);
        voiceVCA.gain.setTargetAtTime(0, t, env1.r / 4);

        // Release Filter Envelope
        filterNodes.forEach(fObj => {
            fObj.filter.frequency.cancelScheduledValues(t);
            fObj.filter.frequency.setValueAtTime(fObj.filter.frequency.value, t);
            fObj.filter.frequency.setTargetAtTime(fObj.baseCutoff, t, env2.r / 4);
        });

        // Terminate oscillators safely
        oscNodes.forEach(osc => osc.stop(t + env1.r * 2));

        setTimeout(() => {
            voiceVCA.disconnect();
            activeVoiceCount = Math.max(0, activeVoiceCount - 1);
            document.getElementById('voices-readout').innerText = `Poly: ${activeVoiceCount} / 16`;
        }, (env1.r * 2) * 1000);

        delete activeVoices[noteId];
    }
}

// Panic Button
document.getElementById('panic-btn').addEventListener('click', () => {
    const t = audioCtx ? audioCtx.currentTime : 0;
    for (const noteId in activeVoices) {
        const { oscNodes, voiceVCA } = activeVoices[noteId];
        voiceVCA.gain.cancelScheduledValues(t);
        voiceVCA.gain.setValueAtTime(0, t);
        oscNodes.forEach(osc => osc.stop(t));
        delete activeVoices[noteId];
    }
    Object.values(uiKeys).forEach(el => el.classList.remove('active'));
    activeVoiceCount = 0;
    document.getElementById('voices-readout').innerText = `Poly: 0 / 16`;
});

// --- PIANO ROLL SETUP ---
const ALL_NOTES = [
    { id: 'C3', f: 130.81, bw: 'w', map: 'z' }, { id: 'C#3', f: 138.59, bw: 'b', map: 's' },
    { id: 'D3', f: 146.83, bw: 'w', map: 'x' }, { id: 'D#3', f: 155.56, bw: 'b', map: 'd' },
    { id: 'E3', f: 164.81, bw: 'w', map: 'c' }, { id: 'F3', f: 174.61, bw: 'w', map: 'v' },
    { id: 'F#3', f: 185.00, bw: 'b', map: 'g' }, { id: 'G3', f: 196.00, bw: 'w', map: 'b' },
    { id: 'G#3', f: 207.65, bw: 'b', map: 'h' }, { id: 'A3', f: 220.00, bw: 'w', map: 'n' },
    { id: 'A#3', f: 233.08, bw: 'b', map: 'j' }, { id: 'B3', f: 246.94, bw: 'w', map: 'm' },
    { id: 'C4', f: 261.63, bw: 'w', map: 'q' }, { id: 'C#4', f: 277.18, bw: 'b', map: '2' },
    { id: 'D4', f: 293.66, bw: 'w', map: 'w' }, { id: 'D#4', f: 311.13, bw: 'b', map: '3' },
    { id: 'E4', f: 329.63, bw: 'w', map: 'e' }, { id: 'F4', f: 349.23, bw: 'w', map: 'r' },
    { id: 'F#4', f: 369.99, bw: 'b', map: '5' }, { id: 'G4', f: 392.00, bw: 'w', map: 't' },
    { id: 'G#4', f: 415.30, bw: 'b', map: '6' }, { id: 'A4', f: 440.00, bw: 'w', map: 'y' },
    { id: 'A#4', f: 466.16, bw: 'b', map: '7' }, { id: 'B4', f: 493.88, bw: 'w', map: 'u' },
    { id: 'C5', f: 523.25, bw: 'w', map: 'i' }
];

const kbContainer = document.getElementById('piano-roll');
const uiKeys = {}; const keyMap = {};
let whiteKeyCount = 0;
const WHITE_KEY_WIDTH = 33; const BLACK_KEY_WIDTH = 22;

ALL_NOTES.forEach(note => {
    const el = document.createElement('div');
    if (note.bw === 'w') { el.className = 'key-white'; whiteKeyCount++; } 
    else { el.className = 'key-black'; el.style.left = `${(whiteKeyCount * WHITE_KEY_WIDTH) - (BLACK_KEY_WIDTH / 2)}px`; }
    
    const start = (e) => { e.preventDefault(); playNote(note.f, note.id); el.classList.add('active'); };
    const stop = (e) => { e.preventDefault(); stopNote(note.id); el.classList.remove('active'); };
    
    el.addEventListener('mousedown', start); el.addEventListener('mouseup', stop); el.addEventListener('mouseleave', stop);
    el.addEventListener('touchstart', start, {passive: false}); el.addEventListener('touchend', stop, {passive: false}); el.addEventListener('touchcancel', stop, {passive: false});
    kbContainer.appendChild(el); uiKeys[note.map] = el; keyMap[note.map] = note;
});

// PC Keyboard
window.addEventListener('keydown', e => { if (e.repeat) return; const k = e.key.toLowerCase(); if (keyMap[k]) { playNote(keyMap[k].f, keyMap[k].id); uiKeys[k].classList.add('active'); }});
window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (keyMap[k]) { stopNote(keyMap[k].id); uiKeys[k].classList.remove('active'); }});

// Boot Initial Configuration
loadPreset(0);
renderModRack();
