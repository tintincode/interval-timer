// ============================================
// DEBUG FLAG — set to true to re-enable console output
// ============================================
const DEBUG = false;
const log  = (...a) => DEBUG && console.log(...a);
const warn = (...a) => DEBUG && console.warn(...a);
// Errors always surface (they indicate real failures)
const err  = (...a) => console.error(...a);
const STORAGE_KEYS = Object.freeze({
    routines: 'intervalTimerRoutines',
    settings: 'intervalTimerSettings'
});
const PRELOADED_ROUTINES = Object.freeze([
    {
        name: '5 Minutes Warm Up',
        exercises: [
            { name: 'Torso twists', duration: null },
            { name: 'Torso Rotations', duration: null },
            { name: 'Oblique Twists', duration: null },
            { name: 'Side step + reach', duration: null },
            { name: 'Butt kicks + arm pulls', duration: null },
            { name: 'Arm circles front & back', duration: null },
            { name: 'Run in place & shake it out', duration: null },
            { name: 'Quad stretches', duration: null },
            { name: 'Neck mobility', duration: null },
            { name: 'Sumo squat + pulse', duration: null }
        ],
        workTime: 30,
        restTime: 0,
        circuits: 1,
        prepTime: 10,
        coolDownTime: 0,
        voiceEnabled: true,
        audioType: 'voice'
    },
    {
        name: 'Full Body Home Workout',
        exercises: [
            { name: 'Jumping jacks', duration: null },
            { name: 'Push ups', duration: null },
            { name: 'Crunches', duration: null },
            { name: 'Walk outs', duration: null },
            { name: 'Squats', duration: null },
            { name: 'Mountain climbers', duration: null }
        ],
        workTime: 30,
        restTime: 15,
        circuits: 3,
        prepTime: 10,
        coolDownTime: 0,
        voiceEnabled: true,
        audioType: 'voice'
    }
]);

function readFromStorage(key) {
    return localStorage.getItem(key);
}

function writeToStorage(key, value) {
    localStorage.setItem(key, value);
}

// ============================================
// ICON CONSTANTS
// Centralised SVG strings to avoid duplication across togglePause,
// completeWorkout and resetTimer.
// ============================================
const PLAY_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 translate-x-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>`;

// ============================================
// WAKE LOCK MANAGER
// ============================================
class WakeLockManager {
    constructor() {
        this.wakeLock = null;
        this.isSupported = 'wakeLock' in navigator;
    }

    async enable() {
        if (!this.isSupported) {
            warn('Wake Lock API is not supported in this browser');
            return;
        }

        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            log('✓ Wake Lock enabled - screen will stay on');
            
            this.wakeLock.addEventListener('release', () => {
                log('Wake Lock was released');
            });
        } catch (e) {
            err('Failed to enable Wake Lock:', e);
        }
    }

    async disable() {
        if (this.wakeLock) {
            try {
                await this.wakeLock.release();
                this.wakeLock = null;
                log('✓ Wake Lock disabled');
            } catch (e) {
                err('Error releasing Wake Lock:', e);
            }
        }
    }

    async reEnable() {
        if (this.wakeLock !== null && this.isSupported) {
            await this.disable();
            await this.enable();
        }
    }
}

const wakeLockManager = new WakeLockManager();

// ============================================
// SPEECH SYNTHESIS MANAGER (iOS-Compatible)
// ============================================
class SpeechManager {
    constructor() {
        this.isInitialized = false;
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    }

    initialize() {
        if (this.isInitialized) return;
        
        if (this.isIOS && 'speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(' ');
            utterance.volume = 0;
            window.speechSynthesis.speak(utterance);
            this.isInitialized = true;
            log('✓ Speech synthesis initialized for iOS');
        } else {
            this.isInitialized = true;
        }
    }

    speak(text, voiceEnabled) {
        if (!voiceEnabled) return;
        
        if (!this.isInitialized) {
            this.initialize();
        }

        window.speechSynthesis.cancel();

        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.1;
            utterance.volume = 1.0;
            utterance.lang = 'en-US';
            
            if (this.isIOS) {
                utterance.rate = 1.0;
            }
            
            window.speechSynthesis.speak(utterance);
            log('🔊 Speaking:', text);
        }, this.isIOS ? 100 : 0);
    }

    cancel() {
        window.speechSynthesis.cancel();
    }
}

const speechManager = new SpeechManager();

// ============================================
// SOUND MANAGER (Beeps via Web Audio API)
// ============================================
class SoundManager {
    constructor() {
        this.ctx = null;
    }

    // Must be called inside a user gesture (button click) every time Start is pressed.
    // Creates the AudioContext on first call; resumes it on every subsequent call
    // so it is never silently suspended (browsers can suspend it after inactivity).
    async unlock() {
        try {
            if (!this.ctx) {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.ctx.state !== 'running') {
                await this.ctx.resume();
            }
            // iOS Safari requires a real buffer playback inside the gesture handler
            // to fully activate the audio hardware.
            const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.connect(this.ctx.destination);
            src.start(0);
            log('✓ Web Audio ready, state:', this.ctx.state);
        } catch (e) {
            err('Audio unlock failed:', e);
        }
    }

    // Internal: schedule a single tone at a precise AudioContext time.
    // `when` should always be ctx.currentTime + some lookahead (never just currentTime).
    _tone(freq, duration, vol, when) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        // Short attack, exponential decay envelope
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(vol, when + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
        osc.start(when);
        osc.stop(when + duration + 0.02);
    }

    // Public: play a sequence of tones.
    // `notes` is an array of { freq, duration, vol, delay }
    // All delays are relative to now + a fixed 80ms lookahead.
    // 80ms is enough to be reliable on both iOS and PC, but short enough to feel instant.
    _play(notes) {
        if (!this.ctx) {
            warn('AudioContext not ready.');
            return;
        }
        if (this.ctx.state === 'suspended') {
            // Shouldn't normally happen (unlock() is called on every Start press),
            // but handle gracefully just in case.
            this.ctx.resume().then(() => this._scheduleNotes(notes));
        } else {
            this._scheduleNotes(notes);
        }
    }

    _scheduleNotes(notes) {
        // Snapshot currentTime ONCE so all notes in a sequence are relative to
        // the same reference point, regardless of JS execution time between calls.
        const base = this.ctx.currentTime + 0.08;
        notes.forEach(({ freq, duration, vol, delay = 0 }) => {
            this._tone(freq, duration, vol, base + delay);
        });
    }

    playPrepare() {
        // Single rising two-tone: clearly signals "get ready"
        this._play([
            { freq: 500, duration: 0.12, vol: 0.3,  delay: 0    },
            { freq: 750, duration: 0.15, vol: 0.35, delay: 0.18 },
        ]);
    }

    playCountdown() {
        // Short high tick
        this._play([{ freq: 1200, duration: 0.1, vol: 0.3 }]);
    }

    playWorkStart() {
        // Double beep — "Go!"
        this._play([
            { freq: 880, duration: 0.15, vol: 0.4, delay: 0    },
            { freq: 880, duration: 0.15, vol: 0.4, delay: 0.22 },
        ]);
    }

    playRestStart() {
        // Single low tone — "Rest"
        this._play([{ freq: 400, duration: 0.25, vol: 0.3 }]);
    }

    playComplete() {
        // Rising victory sequence
        this._play([
            { freq: 700,  duration: 0.12, vol: 0.3,  delay: 0    },
            { freq: 900,  duration: 0.12, vol: 0.3,  delay: 0.17 },
            { freq: 1100, duration: 0.2,  vol: 0.35, delay: 0.34 },
        ]);
    }
}

const soundManager = new SoundManager();

// ============================================
// ANIMATION MANAGER (Web Animations API)
// ============================================
class AnimationManager {
    constructor() {
        this.animations = new Map(); // Stores active animations by element
    }

    stopAll() {
        this.animations.forEach(anim => anim.cancel());
        this.animations.clear();
    }

    pulseScale(element) {
        const anim = element.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.15)' },
            { transform: 'scale(1)' }
        ], {
            duration: 1000,
            iterations: Infinity,
            easing: 'ease-in-out'
        });
        this.animations.set(element, anim);
    }

    pulseStroke(element) {
        const anim = element.animate([
            { strokeWidth: '10px', opacity: 0.7 },
            { strokeWidth: '12px', opacity: 0.9 },
            { strokeWidth: '10px', opacity: 0.7 }
        ], {
            duration: 1000,
            iterations: Infinity,
            easing: 'ease-in-out'
        });
        this.animations.set(element, anim);
    }
    
    pulseGlow(element) {
        const anim = element.animate([
            { opacity: 0.2, transform: 'scale(1)' },
            { opacity: 0.4, transform: 'scale(1.1)' },
            { opacity: 0.2, transform: 'scale(1)' }
        ], {
            duration: 1000,
            iterations: Infinity,
            easing: 'ease-in-out'
        });
        this.animations.set(element, anim);
    }
}

const animationManager = new AnimationManager();

// ============================================
// DOM & CONSTANTS
// ============================================
const CIRCLE_RADIUS = 148;
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;
const TOTAL_PROGRESS_UPDATE_INTERVAL_MS = 80;

const DOM = {
    // Timer View
    timeLeftEl: document.getElementById('time-left'),
    circuitDisplayEl: document.getElementById('circuit-display'),
    totalTimeDisplayEl: document.getElementById('total-time-display'),
    exerciseTextEl: document.getElementById('current-exercise'),
    totalProgressBar: document.getElementById('total-progress-bar'),
    totalProgressBarContainer: document.getElementById('total-progress-bar-container'),
    progressCircle: document.getElementById('progress-circle'),
    btnMute: document.getElementById('btn-mute'),
    iconMuted: document.getElementById('icon-muted'),
    iconUnmuted: document.getElementById('icon-unmuted'),
    btnStart: document.getElementById('btn-start'),
    btnPause: document.getElementById('btn-pause'),
    nextUpContainer: document.getElementById('next-up-container'),
    nextExerciseNameEl: document.getElementById('next-exercise-name'),
    completionMedal: document.getElementById('completion-medal'),
    srAnnouncement: document.getElementById('sr-announcement'),
    
    // Settings View
    viewTimer: document.getElementById('view-timer'),
    viewSettings: document.getElementById('view-settings'),
    inputWork: document.getElementById('input-work'),
    inputRest: document.getElementById('input-rest'),
    inputRounds: document.getElementById('input-rounds'),
    inputPrepare: document.getElementById('input-prepare'),
    inputCooldown: document.getElementById('input-cooldown'),
    exercisesList: document.getElementById('exercises-list'),
    exercisesEmptyState: document.getElementById('exercises-empty-state'),
    
    // Routines
    routineDropdown: document.getElementById('custom-routine-dropdown'),
    routineDropdownSelect: document.getElementById('ac-ls-dropdown-select'),
    routineDropdownOptions: document.getElementById('ac-ls-dropdown-options'),
    routineDropdownTitle: document.getElementById('ac-ls-dropdown-title'),
    routineDropdownList: document.getElementById('ac-ls-dropdown-options-list'),
    btnUpdateRoutine: document.getElementById('btn-update-routine'),
    btnRenameRoutine: document.getElementById('btn-rename-routine'),
    
    // Audio
    audioVoiceCheck: document.getElementById('audio-voice-check'),
    audioBeepCheck: document.getElementById('audio-beep-check'),
    btnAudioVoice: document.getElementById('btn-audio-voice'),
    btnAudioBeep: document.getElementById('btn-audio-beep'),
    
    // Modal
    modal: document.getElementById('custom-modal'),
    modalContent: document.getElementById('modal-content'),
    modalTitle: document.getElementById('modal-title'),
    modalMessage: document.getElementById('modal-message'),
    modalInput: document.getElementById('modal-input'),
    modalConfirm: document.getElementById('modal-confirm'),
    modalCancel: document.getElementById('modal-cancel'),
    modalButtons: document.getElementById('modal-buttons'),
    
    // Misc
    messageBox: document.getElementById('message-box'),
    importFile: document.getElementById('import-file'),
};

// ============================================
// APP STATE (single source of truth for all mutable app-level data)
// ============================================
const appState = {
    // Exercise list — the canonical data model
    exercises: [
        { name: "Jumping jacks", duration: null },
        { name: "Push ups", duration: null },
        { name: "Crunches", duration: null },
        { name: "Walk outs", duration: null },
        { name: "Squats", duration: null },
        { name: "Mountain climbers", duration: null }
    ],
    // Audio
    voiceEnabled: true,
    audioType: 'voice',   // 'voice' | 'beep'
    // Saved routines
    savedRoutines: [],
    currentRoutineIndex: -1,
    // Timer runtime — previously a separate `state` / TimerState instance
    timer: {
        raf: null,           // requestAnimationFrame handle (was: state.timer)
        isPaused: false,
        currentPhase: 'prepare',
        globalIntervalIndex: 0,
        secondsRemaining: 0,
        totalPhaseSeconds: 0,
        totalTimeRemaining: 0,
        initialTotalTime: 0,
        exerciseObjects: [],
        phaseEndTime: 0,
        pausedTimeRemainingMs: 0,
        workoutEndTime: 0,
        pauseStartTime: 0,
        lastProgressBarUpdateAt: 0,
    },
};

// Convenience alias so existing code that references `state` keeps working
// without any other changes. This is a live reference — mutating `state.*`
// mutates `appState.timer.*` and vice-versa.
const state = appState.timer;

// ============================================
// ROUTINE MANAGER
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function loadRoutines() {
    try {
        const stored = readFromStorage(STORAGE_KEYS.routines);
        let shouldSeedDefaults = false;

        if (stored === null) {
            shouldSeedDefaults = true;
        } else {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    appState.savedRoutines = parsed;
                } else {
                    appState.savedRoutines = [];
                    shouldSeedDefaults = true;
                }
            } catch (e) {
                err('Error parsing routines', e);
                appState.savedRoutines = [];
                shouldSeedDefaults = true;
            }
        }

        // First run or corrupted payload fallback: seed with built-in routines.
        if (shouldSeedDefaults) {
            appState.savedRoutines = structuredClone(PRELOADED_ROUTINES);
            saveRoutines();
        }
    } catch (e) {
        warn('Could not load routines (storage unavailable):', e);
        appState.savedRoutines = [];
    }
    updateRoutineSelect();
}

function saveRoutines() {
    try {
        writeToStorage(STORAGE_KEYS.routines, JSON.stringify(appState.savedRoutines));
    } catch (e) {
        warn('Could not save routines (storage unavailable):', e);
    }
}

function updateRoutineSelect() {
    const list = DOM.routineDropdownList;
    if (!list) return;
    
    list.innerHTML = '';
    
    if (appState.savedRoutines.length === 0) {
         const li = document.createElement('li');
         li.className = 'touch-target px-3 py-2 text-sm text-white/50 italic flex items-center';
         li.textContent = 'No routines';
         list.appendChild(li);
         return;
    }

    appState.savedRoutines.forEach((routine, index) => {
        const li = document.createElement('li');
        li.className = 'ac-ls-dropdown-option touch-target px-3 py-2 text-sm font-medium text-white hover:bg-[#2c2c2e] cursor-pointer flex items-center gap-2';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', index === appState.currentRoutineIndex ? 'true' : 'false');
        li.onclick = () => {
            loadRoutine(index);
            toggleDropdown(false);
        };
        li.innerHTML = `<span class="w-3 h-3 flex items-center justify-center text-[#0071e3] ${index === appState.currentRoutineIndex ? '' : 'opacity-0'} check-icon"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6l3 3 5-5"/></svg></span><span>${escapeHtml(routine.name)}</span>`;
        list.appendChild(li);
    });
    updateRoutineButtonsState();
}

async function saveRoutine() {
    const name = await showModal({
        title: 'Save Routine',
        showInput: true,
        inputPlaceholder: 'Routine Name',
        confirmText: 'Save'
    });
    
    if (!name) return;

    const newRoutine = {
        name: name,
        exercises: structuredClone(appState.exercises),
        workTime: getSecondsFromTimeInput('input-work'),
        restTime: getSecondsFromTimeInput('input-rest'),
        circuits: DOM.inputRounds.value,
        prepTime: getSecondsFromTimeInput('input-prepare'),
        coolDownTime: getSecondsFromTimeInput('input-cooldown'),
        voiceEnabled: appState.voiceEnabled,
        audioType: appState.audioType
    };

    appState.savedRoutines.push(newRoutine);
    saveRoutines();
    updateRoutineSelect();
    
    // Select the new routine
    loadRoutine(appState.savedRoutines.length - 1);
}

async function updateRoutine() {
    if (appState.currentRoutineIndex === -1) return;
    
    const routine = appState.savedRoutines[appState.currentRoutineIndex];
    const confirmed = await showModal({
        title: 'Update Routine',
        message: `Update "${routine.name}" with current settings?`,
        confirmText: 'Update',
        confirmColor: 'bg-emerald-500'
    });
    
    if (!confirmed) return;

    const updatedRoutine = {
        name: routine.name,
        exercises: structuredClone(appState.exercises),
        workTime: getSecondsFromTimeInput('input-work'),
        restTime: getSecondsFromTimeInput('input-rest'),
        circuits: DOM.inputRounds.value,
        prepTime: getSecondsFromTimeInput('input-prepare'),
        coolDownTime: getSecondsFromTimeInput('input-cooldown'),
        voiceEnabled: appState.voiceEnabled,
        audioType: appState.audioType
    };

    appState.savedRoutines[appState.currentRoutineIndex] = updatedRoutine;
    saveRoutines();
    
    // Visual feedback
    const btn = DOM.btnUpdateRoutine;
    const originalText = btn.innerText;
    btn.innerText = "Saved!";
    setTimeout(() => btn.innerText = originalText, 1500);
}

async function deleteRoutine() {
    if (appState.currentRoutineIndex === -1) {
        await showModal({
            title: 'No Routine Selected',
            message: 'Please select a routine to delete.',
            confirmText: 'OK',
            cancelText: null,
            confirmColor: 'bg-white/10'
        });
        return;
    }
    
    const confirmed = await showModal({
        title: 'Delete Routine',
        message: `Delete "${appState.savedRoutines[appState.currentRoutineIndex].name}"?`,
        confirmText: 'Delete',
        confirmColor: 'bg-red-500'
    });
    
    if (!confirmed) return;

    appState.savedRoutines.splice(appState.currentRoutineIndex, 1);
    saveRoutines();
    appState.currentRoutineIndex = -1;
    DOM.routineDropdownTitle.textContent = "Select Routine";
    updateRoutineSelect();
    saveSettings();
}

async function renameRoutine() {
    if (appState.currentRoutineIndex === -1) {
        await showModal({
            title: 'No Routine Selected',
            message: 'Please select a routine to rename.',
            confirmText: 'OK',
            cancelText: null,
            confirmColor: 'bg-white/10'
        });
        return;
    }

    const routine = appState.savedRoutines[appState.currentRoutineIndex];
    const newName = await showModal({
        title: 'Rename Routine',
        showInput: true,
        inputValue: routine.name,
        inputPlaceholder: 'New Routine Name',
        confirmText: 'Rename'
    });

    if (!newName || newName.trim() === '' || newName.trim() === routine.name) return;

    appState.savedRoutines[appState.currentRoutineIndex].name = newName.trim();
    saveRoutines();
    DOM.routineDropdownTitle.textContent = newName.trim();
    updateRoutineSelect();
}

function exportRoutines() {
    if (appState.savedRoutines.length === 0) {
        showModal({
            title: 'No Routines',
            message: 'You have no routines to export.',
            confirmText: 'OK',
            cancelText: null
        });
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState.savedRoutines, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "interval_timer_routines.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function handleFileImport(input) {
    const file = input.files[0];
    if (!file) return;

    // Guard against oversized or binary files
    if (file.size > 1_000_000) {
        showModal({
            title: 'File Too Large',
            message: 'The selected file exceeds 1 MB. Please choose a valid routines backup file.',
            confirmText: 'OK',
            cancelText: null
        });
        input.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            let imported;
            try {
                imported = JSON.parse(e.target.result);
            } catch (parseErr) {
                throw new Error('Invalid JSON format');
            }

            if (!Array.isArray(imported)) {
                // Attempt to handle single object export
                if (imported && typeof imported === 'object' && imported.exercises) {
                    imported = [imported];
                } else {
                    throw new Error('File does not contain a list of routines');
                }
            }

            // Validate and sanitize structure
            const validRoutines = imported.filter(r => r && typeof r === 'object' && Array.isArray(r.exercises)).map(r => ({
                name: typeof r.name === 'string' ? r.name.substring(0, 60) : 'Imported Routine',
                exercises: r.exercises.map(ex => ({
                    name: typeof ex.name === 'string' ? ex.name.substring(0, 60) : 'Exercise',
                    duration: (ex.duration !== null && !isNaN(ex.duration)) ? Math.max(0, parseInt(ex.duration)) : null
                })),
                workTime: Math.max(0, parseInt(r.workTime) || 0),
                restTime: Math.max(0, parseInt(r.restTime) || 0),
                circuits: Math.max(1, parseInt(r.circuits) || 1),
                prepTime: Math.max(0, parseInt(r.prepTime) || 0),
                coolDownTime: Math.max(0, parseInt(r.coolDownTime) || 0),
                voiceEnabled: r.voiceEnabled !== false,
                audioType: r.audioType === 'beep' ? 'beep' : 'voice'
            }));

            if (validRoutines.length === 0) {
                throw new Error('No valid routines found in file');
            }

            const confirmed = await showModal({
                title: 'Import Routines',
                message: `Found ${validRoutines.length} valid routines. Import and append to your current list?`,
                confirmText: 'Import',
                confirmColor: 'bg-blue-500'
            });

            if (confirmed) {
                appState.savedRoutines = [...appState.savedRoutines, ...validRoutines];
                saveRoutines();
                updateRoutineSelect();
                await showModal({
                    title: 'Success',
                    message: 'Routines imported successfully!',
                    confirmText: 'OK',
                    cancelText: null
                });
            }
        } catch (e) {
            err(e);
            await showModal({
                title: 'Import Failed',
                message: e.message || 'An error occurred while processing the file.',
                confirmText: 'OK',
                cancelText: null
            });
        }
        input.value = ''; // Reset input
    };
    reader.readAsText(file);
}

function loadRoutine(index) {
    if (index === "" || index === -1) {
        return;
    }
    
    const routine = appState.savedRoutines[index];
    if (!routine) return;
    
    appState.currentRoutineIndex = parseInt(index);
    DOM.routineDropdownTitle.textContent = routine.name;
    updateRoutineSelect();
    
    // Apply settings
    appState.exercises = structuredClone(routine.exercises); // Deep copy
    setTimeInputSeconds('input-work', routine.workTime);
    setTimeInputSeconds('input-rest', routine.restTime);
    setTimeInputSeconds('input-prepare', routine.prepTime);
    setTimeInputSeconds('input-cooldown', routine.coolDownTime || 0);
    DOM.inputRounds.value = routine.circuits;
    
    if (routine.voiceEnabled !== undefined) {
        appState.voiceEnabled = routine.voiceEnabled;
        handleMuteToggle(appState.voiceEnabled);
    }
    
    if (routine.audioType) {
        setAudioType(routine.audioType);
    }
    
    renderExerciseList();
    saveSettings(); // Save as current active settings
    updateTotalTimeDisplay();
    updateCountsDisplay();
    updateAllIntervalRowDims();
}

function updateRoutineButtonsState() {
    const updateBtn = DOM.btnUpdateRoutine;
    const renameBtn = DOM.btnRenameRoutine;
    const shouldBeEnabled = appState.currentRoutineIndex !== -1;

    [updateBtn, renameBtn].forEach(btn => {
        if (!btn) return;
        btn.classList.toggle('opacity-40', !shouldBeEnabled);
        btn.classList.toggle('pointer-events-none', !shouldBeEnabled);
    });
}

function toggleDropdown(show) {
    const options = DOM.routineDropdownOptions;
    const button = DOM.routineDropdownSelect;
    const arrow = button.querySelector('svg');
    
    if (show === undefined) {
        show = options.classList.contains('hidden');
    }
    
    if (show) {
        options.classList.remove('hidden');
        button.setAttribute('aria-expanded', 'true');
        arrow.style.transform = 'rotate(180deg)';
    } else {
        options.classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
        arrow.style.transform = 'rotate(0deg)';
    }
}

async function restoreDefaultRoutines() {
    const routinesToAdd = PRELOADED_ROUTINES.filter(
        preloaded => !appState.savedRoutines.some(saved => saved.name === preloaded.name)
    );

    if (routinesToAdd.length === 0) {
        await showModal({
            title: 'No Action Needed',
            message: 'All default routines are already in your list.',
            confirmText: 'OK',
            cancelText: null
        });
        return;
    }

    const confirmed = await showModal({
        title: 'Restore Defaults',
        message: `This will add ${routinesToAdd.length} missing default routine(s) to your list. It will not affect your custom routines.`,
        confirmText: 'Restore',
        confirmColor: 'bg-blue-500'
    });

    if (!confirmed) return;

    appState.savedRoutines.push(...structuredClone(routinesToAdd));
    saveRoutines();
    updateRoutineSelect();
    
    await showModal({
        title: 'Success',
        message: 'Default routines have been restored.',
        confirmText: 'OK',
        cancelText: null
    });
}

// ============================================
// CUSTOM MODAL MANAGER
// ============================================
function showModal({ title, message, showInput = false, inputValue = '', inputPlaceholder = '', confirmText = 'OK', confirmColor = 'bg-blue-500', cancelText = 'Cancel' }) {
    return new Promise((resolve) => {
        const { modal, modalContent, modalTitle, modalMessage, modalInput, modalConfirm, modalCancel, modalButtons } = DOM;

        modalTitle.innerText = title;
        
        if (message) {
            modalMessage.innerText = message;
            modalMessage.classList.remove('hidden');
        } else {
            modalMessage.classList.add('hidden');
        }

        if (showInput) {
            modalInput.value = inputValue;
            modalInput.placeholder = inputPlaceholder;
            modalInput.classList.remove('hidden');
            setTimeout(() => modalInput.focus(), 50);
        } else {
            modalInput.classList.add('hidden');
        }

        modalConfirm.innerText = confirmText;
        modalConfirm.className = `ios-button ${confirmColor} hover:opacity-90 text-white rounded-xl py-3 text-sm font-semibold transition-all`;
        
        if (!cancelText) {
            modalCancel.classList.add('hidden');
            modalButtons.classList.remove('grid-cols-2');
            modalButtons.classList.add('grid-cols-1');
        } else {
            modalCancel.innerText = cancelText;
            modalCancel.classList.remove('hidden');
            modalButtons.classList.add('grid-cols-2');
            modalButtons.classList.remove('grid-cols-1');
        }

        modal.classList.remove('hidden');
        requestAnimationFrame(() => {
            modal.classList.remove('opacity-0');
            modalContent.classList.remove('scale-95');
            modalContent.classList.add('scale-100');
        });

        const close = (result) => {
            modal.classList.add('opacity-0');
            modalContent.classList.remove('scale-100');
            modalContent.classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
                resolve(result);
            }, 200);
            
            modalConfirm.onclick = null;
            modalCancel.onclick = null;
            modalInput.onkeydown = null;
        };

        modalConfirm.onclick = () => close(showInput ? modalInput.value : true);
        modalCancel.onclick = () => close(false);
        
        if (showInput) {
            modalInput.onkeydown = (e) => {
                if (e.key === 'Enter') close(modalInput.value);
            };
        }
    });
}

const SETTINGS_SAVE_DEBOUNCE_MS = 200;
let settingsSaveTimer = null;
let pendingSettingsSnapshot = null;

function createSettingsSnapshot() {
    return {
        exercises: appState.exercises,
        workTime: getSecondsFromTimeInput('input-work'),
        restTime: getSecondsFromTimeInput('input-rest'),
        circuits: DOM.inputRounds.value,
        prepTime: getSecondsFromTimeInput('input-prepare'),
        coolDownTime: getSecondsFromTimeInput('input-cooldown'),
        voiceEnabled: appState.voiceEnabled,
        audioType: appState.audioType,
        routineIndex: appState.currentRoutineIndex
    };
}

function persistSettingsSnapshot(settings) {
    try {
        writeToStorage(STORAGE_KEYS.settings, JSON.stringify(settings));
    } catch (e) {
        warn('Could not save settings (storage unavailable):', e);
    }
}

// Debounced by default to avoid synchronous localStorage writes on each keystroke.
function saveSettings(immediate = false) {
    pendingSettingsSnapshot = createSettingsSnapshot();

    if (immediate) {
        if (settingsSaveTimer) {
            clearTimeout(settingsSaveTimer);
            settingsSaveTimer = null;
        }
        persistSettingsSnapshot(pendingSettingsSnapshot);
        pendingSettingsSnapshot = null;
        return;
    }

    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(() => {
        settingsSaveTimer = null;
        if (!pendingSettingsSnapshot) return;
        persistSettingsSnapshot(pendingSettingsSnapshot);
        pendingSettingsSnapshot = null;
    }, SETTINGS_SAVE_DEBOUNCE_MS);
}

function flushSettingsSave() {
    saveSettings(true);
}

function loadSettings() {
    let saved = null;
    try {
        saved = readFromStorage(STORAGE_KEYS.settings);
    } catch (e) {
        warn('Could not load settings (storage unavailable):', e);
    }
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            
            // Handle legacy string format or new array format
            if (settings.exercises) {
                if (typeof settings.exercises === 'string') {
                    appState.exercises = settings.exercises.split(',').filter(i => i.trim() !== "").map(item => {
                        const parts = item.split(':');
                        return { name: parts[0].trim(), duration: (parts[1] && !isNaN(parseInt(parts[1].trim()))) ? parseInt(parts[1].trim()) : null };
                    });
                } else if (Array.isArray(settings.exercises)) {
                    appState.exercises = settings.exercises;
                }
            }
            
            // Load time values
            if (settings.workTime !== undefined) {
                setTimeInputSeconds('input-work', settings.workTime);
            }
            if (settings.restTime !== undefined) {
                setTimeInputSeconds('input-rest', settings.restTime);
            }
            if (settings.prepTime !== undefined) {
                setTimeInputSeconds('input-prepare', settings.prepTime);
            }
            if (settings.coolDownTime !== undefined) {
                setTimeInputSeconds('input-cooldown', settings.coolDownTime);
            }
            
            DOM.inputRounds.value = Math.max(1, parseInt(settings.circuits) || 1);
            appState.voiceEnabled = settings.voiceEnabled !== undefined ? settings.voiceEnabled : true;
            handleMuteToggle(appState.voiceEnabled);
            
            // Load audio type
            appState.audioType = settings.audioType || 'voice';
            
            // Load selected routine index
            if (settings.routineIndex !== undefined) {
                if (settings.routineIndex !== -1 && appState.savedRoutines[settings.routineIndex]) {
                    appState.currentRoutineIndex = settings.routineIndex;
                    DOM.routineDropdownTitle.textContent = appState.savedRoutines[appState.currentRoutineIndex].name;
                } else {
                    appState.currentRoutineIndex = -1;
                }
                updateRoutineButtonsState();
            }

            updateAudioTypeUI();
        } catch (e) {
            err('Error loading settings:', e);
        }
    }
}

function setAudioType(type) {
    appState.audioType = type;
    updateAudioTypeUI();
    saveSettings();
}

function updateAudioTypeUI() {
    const { audioVoiceCheck, audioBeepCheck, btnAudioVoice, btnAudioBeep } = DOM;
    if (!audioVoiceCheck || !audioBeepCheck) return;

    if (appState.audioType === 'voice') {
        audioVoiceCheck.classList.remove('hidden');
        audioBeepCheck.classList.add('hidden');
        btnAudioVoice.style.backgroundColor = 'rgba(255,255,255,0.06)';
        btnAudioBeep.style.backgroundColor = '';
    } else {
        audioBeepCheck.classList.remove('hidden');
        audioVoiceCheck.classList.add('hidden');
        btnAudioBeep.style.backgroundColor = 'rgba(255,255,255,0.06)';
        btnAudioVoice.style.backgroundColor = '';
    }
}

// Dim an interval row when its value is zero (phase is effectively disabled)
function updateIntervalRowDim(inputId) {
    const rowMap = {
        'input-prepare':  'row-prepare',
        'input-cooldown': 'row-cooldown',
        'input-rest':     'row-rest',
        'input-work':     'row-work',
    };
    const rowId = rowMap[inputId];
    if (!rowId) return;
    const row = document.getElementById(rowId);
    if (!row) return;
    const secs = parseFloat(document.getElementById(inputId)?.dataset?.seconds || 0);
    row.classList.toggle('is-zero', secs === 0);
}

// Run dim check on all interval rows on page load / routine load
function updateAllIntervalRowDims() {
    ['input-prepare', 'input-cooldown', 'input-rest', 'input-work'].forEach(updateIntervalRowDim);
}

function showSettingsSaved() {
    const box = DOM.messageBox;
    if (!box) return;
    box.textContent = 'Settings saved';
    box.style.opacity = '1';
    clearTimeout(box._hideTimer);
    box._hideTimer = setTimeout(() => { box.style.opacity = '0'; }, 1500);
}

function setupAutoSave() {
    [DOM.inputWork, DOM.inputRest, DOM.inputRounds, DOM.inputPrepare, DOM.inputCooldown].forEach(el => {
        el.addEventListener('input', () => {
            saveSettings();
            updateTotalTimeDisplay();
            updateCountsDisplay();
            updateIntervalRowDim(el.id);
        });
        
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
            }
        });
    });
}

// ============================================
// EXERCISE LIST UI HANDLERS
// ============================================
function renderExerciseList() {
    const container = DOM.exercisesList;
    if (!container) return;
    container.innerHTML = '';
    
    appState.exercises.forEach(item => {
        createExerciseRow(item.name, item.duration ?? '', { skipReindex: true });
    });
    
    // Show/hide empty state
    const emptyState = DOM.exercisesEmptyState;
    if (emptyState) emptyState.classList.toggle('hidden', appState.exercises.length > 0);

    if (appState.exercises.length === 0) createExerciseRow('', '', { skipReindex: true });
    reindexExerciseRows();
}

function reindexExerciseRows() {
    const container = DOM.exercisesList;
    if (!container) return;
    container.querySelectorAll('.exercise-row').forEach((row, index) => {
        row.dataset.exerciseIndex = String(index);
    });
}

function syncExerciseRowToState(row) {
    if (!row) return;
    const index = parseInt(row.dataset.exerciseIndex, 10);
    if (Number.isNaN(index)) return;

    const nameInput = row.querySelector('.exercise-name-input');
    const durInput = row.querySelector('.exercise-duration-input');
    if (!nameInput || !durInput) return;

    const name = nameInput.value.trim();
    const durationVal = durInput.value.trim();
    appState.exercises[index] = {
        name: name,
        duration: durationVal ? parseTimeInput(durationVal) : null
    };
}

function handleExerciseRowInput(row) {
    syncExerciseRowToState(row);
    saveSettings();
    updateTotalTimeDisplay();
    updateCountsDisplay();
}

function createExerciseRow(name = '', duration = '', { skipReindex = false } = {}) {
    const container = DOM.exercisesList;
    const div = document.createElement('div');
    
    // Format duration if it exists
    const formattedDuration = (duration !== '' && duration !== null) ? formatToMMSS(duration) : '';
    
    // Add transition classes for entry animation
    div.className = 'exercise-row relative overflow-hidden rounded-xl transition-all duration-300 ease-out opacity-0 translate-y-2 max-h-0 select-none';

    // ── Build DOM safely (no innerHTML with user data → no XSS) ──
    const rowContent = document.createElement('div');
    rowContent.className = 'row-content w-full flex items-center bg-white/5 py-3 px-4';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = name;                          // safe — DOM property, not HTML
    nameInput.placeholder = 'Exercise Name';
    nameInput.className = 'exercise-name-input touch-target flex-1 min-w-0 bg-transparent border-none p-0 text-sm font-medium focus:ring-0 outline-none placeholder:text-white/20 text-white';

    const durInput = document.createElement('input');
    durInput.type = 'text';
    durInput.value = formattedDuration;              // safe — DOM property
    durInput.placeholder = '--:--';
    durInput.className = 'exercise-duration-input touch-target w-16 bg-transparent border-none p-0 text-sm text-right focus:ring-0 outline-none placeholder:text-white/20 text-white tabular-nums font-bold mx-3';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn ios-button touch-target w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full bg-white/5 text-white/30 hover:bg-white/10 hover:text-white transition-all ml-1';
    // The delete icon is static markup — no user data, safe to use innerHTML here
    deleteBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';

    rowContent.appendChild(nameInput);
    rowContent.appendChild(durInput);
    rowContent.appendChild(deleteBtn);
    div.appendChild(rowContent);
    container.appendChild(div);
    if (!skipReindex) reindexExerciseRows();
    
    // Wire delete button
    div.querySelector('.delete-btn').addEventListener('click', () => removeExerciseRow(div));
    
    // Wire duration input click-to-select
    div.querySelector('.exercise-duration-input').addEventListener('click', function() { this.select(); });
    
    // Trigger animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            div.classList.remove('opacity-0', 'translate-y-2', 'max-h-0');
            div.classList.add('max-h-20');
        });
    });
    
    setupLongPressDrag(div);
    
    const inputs = div.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', () => handleExerciseRowInput(div));
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
            }
        });
        
        // Add blur handler for time formatting
        if (input.classList.contains('exercise-duration-input')) {
            input.addEventListener('blur', function() {
                const val = this.value.trim();
                if (val) {
                    const seconds = parseTimeInput(val);
                    this.value = seconds > 0 ? formatToMMSS(seconds) : '';
                }
                handleExerciseRowInput(div);
            });
        }
    });
}

function addNewExerciseRow() {
    createExerciseRow('', '');
    updateExercisesFromUI();
}

function removeExerciseRow(row) {
    
    // Set explicit height for transition
    row.style.maxHeight = row.scrollHeight + 'px';
    row.classList.add('overflow-hidden');
    void row.offsetWidth; // Force reflow

    // Exit animation
    row.style.maxHeight = '0px';
    row.classList.add('opacity-0', '-translate-y-2', '!mt-0', '!mb-0', 'pointer-events-none');
    
    setTimeout(() => {
        row.remove();
        updateExercisesFromUI();
        // Empty state is handled by updateExercisesFromUI
    }, 300);
}

// ============================================
// DRAG AND DROP REORDERING
// ============================================
let draggingRow = null;
let ghost = null;
let dragOffsetY = 0;
let dragFrameId = null;

function setupLongPressDrag(element) {
    let timer = null;
    let startX = 0;
    let startY = 0;

    const handleStart = (e) => {
        if (e.target.closest('.delete-btn')) return;
        
        const isInput = e.target.tagName === 'INPUT';
        const isTouch = e.type.startsWith('touch');
        
        // If mouse and not input, drag immediately
        if (!isTouch && !isInput) {
             const clientX = e.clientX;
             const clientY = e.clientY;
             startDrag(element, clientX, clientY, e);
             e.preventDefault(); 
             return;
        }
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        startX = clientX;
        startY = clientY;

        timer = setTimeout(() => {
            startDrag(element, startX, startY, e);
        }, 300);
    };

    const handleMove = (e) => {
        if (!timer) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        if (Math.abs(clientX - startX) > 10 || Math.abs(clientY - startY) > 10) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const handleEnd = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    element.addEventListener('touchstart', handleStart, {passive: true});
    element.addEventListener('touchmove', handleMove, {passive: true});
    element.addEventListener('touchend', handleEnd);
    
    element.addEventListener('mousedown', handleStart);
    element.addEventListener('mousemove', handleMove);
    element.addEventListener('mouseup', handleEnd);
    element.addEventListener('mouseleave', handleEnd);
}

function startDrag(row, clientX, clientY, originalEvent) {
    draggingRow = row;
    
    const rect = row.getBoundingClientRect();
    dragOffsetY = clientY - rect.top;
    
    // Create Ghost
    ghost = row.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.left = rect.left + 'px';
    
    // Disable inputs in ghost
    ghost.querySelectorAll('input').forEach(i => i.setAttribute('disabled', 'true'));
    
    document.body.appendChild(ghost);
    
    row.classList.add('placeholder');
    
    // Vibration
    if (navigator.vibrate) navigator.vibrate(50);
    
    document.body.style.overflow = 'hidden';
    
    if (originalEvent.type.startsWith('touch')) {
        document.addEventListener('touchmove', onDragMove, {passive: false});
        document.addEventListener('touchend', onDragEnd);
    } else {
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
    }
}

function onDragMove(e) {
    if (!draggingRow || !ghost) return;
    if (e.type === 'touchmove') e.preventDefault();
    
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    
    // Move Ghost
    // Move Ghost immediately for responsiveness
    ghost.style.top = (clientY - dragOffsetY) + 'px';
    
    // Throttle heavy layout calculations
    if (dragFrameId) return;
    
    dragFrameId = requestAnimationFrame(() => {
        handleDragReorder(clientX, clientY);
        dragFrameId = null;
    });
}

function handleDragReorder(clientX, clientY) {
    const elementBelow = document.elementFromPoint(clientX, clientY);
    if (!elementBelow) return;
    
    const rowBelow = elementBelow.closest('.exercise-row');
    
    if (rowBelow && rowBelow !== draggingRow) {
        const container = DOM.exercisesList;
        const rows = Array.from(container.children);
        
        const draggingIndex = rows.indexOf(draggingRow);
        const targetIndex = rows.indexOf(rowBelow);
        
        // Calculate threshold to prevent flickering
        const targetRect = rowBelow.getBoundingClientRect();
        const targetMiddleY = targetRect.top + targetRect.height / 2;
        const isMovingDown = draggingIndex < targetIndex;
        
        // Only swap if we have crossed the midline of the target element
        if (isMovingDown && clientY < targetMiddleY) return;
        if (!isMovingDown && clientY > targetMiddleY) return;

        // FLIP Animation: Capture old positions
        const positions = new Map();
        rows.forEach(r => positions.set(r, r.getBoundingClientRect().top));

        if (isMovingDown) {
            container.insertBefore(draggingRow, rowBelow.nextSibling);
        } else {
            container.insertBefore(draggingRow, rowBelow);
        }
        
        // FLIP Animation: Play
        rows.forEach(r => {
            if (r === draggingRow) return; // Don't animate placeholder
            const oldTop = positions.get(r);
            const newTop = r.getBoundingClientRect().top;
            
            if (oldTop && newTop && oldTop !== newTop) {
                const delta = oldTop - newTop;
                r.style.transition = 'none';
                r.style.transform = `translateY(${delta}px)`;
                
                requestAnimationFrame(() => {
                    r.style.transition = 'transform 0.3s ease';
                    r.style.transform = '';
                });
            }
        });
    }
}

function onDragEnd(e) {
    if (draggingRow && ghost) {
        // Animate ghost to final position
        const rect = draggingRow.getBoundingClientRect();
        ghost.style.transition = 'top 0.2s ease, left 0.2s ease';
        ghost.style.top = rect.top + 'px';
        ghost.style.left = rect.left + 'px';
        
        setTimeout(() => {
            if (ghost) ghost.remove();
            if (draggingRow) draggingRow.classList.remove('placeholder');
            ghost = null;
            draggingRow = null;
            updateExercisesFromUI();
        }, 200);
    } else {
        draggingRow = null;
    }
    
    document.body.style.overflow = '';
    
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    
    if (dragFrameId) {
        cancelAnimationFrame(dragFrameId);
        dragFrameId = null;
    }
}

function updateExercisesFromUI() {
    const container = DOM.exercisesList;
    const rows = container.querySelectorAll('.exercise-row');
    const newExercises = [];
    
    rows.forEach(row => {
        const nameInput = row.querySelector('.exercise-name-input');
        const durInput = row.querySelector('.exercise-duration-input');
        let name = nameInput.value.trim();
        let durationVal = durInput.value.trim();
        
        // Allow empty names so the row isn't lost in data model
        newExercises.push({ name: name, duration: durationVal ? parseTimeInput(durationVal) : null });
    });
    
    appState.exercises = newExercises;
    reindexExerciseRows();
    
    // Show/hide empty state
    const emptyState = DOM.exercisesEmptyState;
    if (emptyState) emptyState.classList.toggle('hidden', rows.length > 0);
    
    saveSettings();
    updateTotalTimeDisplay();
    updateCountsDisplay();
}

// ============================================
// TIME INPUT HELPERS (MM:SS format)
// ============================================
function parseTimeInput(value) {
    // Remove any spaces
    value = value.trim();
    
    // If contains colon, parse as MM:SS
    if (value.includes(':')) {
        const parts = value.split(':');
        const min = parseInt(parts[0]) || 0;
        const sec = parseInt(parts[1]) || 0;
        return min * 60 + sec;
    }
    
    // Otherwise treat as seconds
    return parseInt(value) || 0;
}

// Alias — formatTime is the canonical implementation (see below)
function formatToMMSS(seconds) { return formatTime(seconds); }

function handleTimeBlur(inputId) {
    const input = document.getElementById(inputId);
    const seconds = parseTimeInput(input.value);
    input.setAttribute('data-seconds', seconds);
    input.value = formatToMMSS(seconds);
    
    // Trigger save and update
    saveSettings();
    updateTotalTimeDisplay();
}

function getSecondsFromTimeInput(inputId) {
    const input = document.getElementById(inputId);
    return parseInt(input.getAttribute('data-seconds')) || 0;
}

function setTimeInputSeconds(inputId, seconds) {
    const input = document.getElementById(inputId);
    seconds = Math.max(0, seconds);
    input.setAttribute('data-seconds', seconds);
    input.value = formatToMMSS(seconds);
    
    // Trigger save and update
    input.dispatchEvent(new Event('input'));
}

// ============================================
// INCREMENT/DECREMENT WITH LONG-PRESS (for time inputs)
// ============================================
let adjustmentInterval = null;
let adjustmentTimeout = null;
let speedUpTimeout = null;
let isAdjusting = false; // Prevent double-fire on mobile

// New state variables for scroll vs. tap detection
let isScrolling = false;
let touchStartY = 0;

function incrementTimeValue(inputId) { // +5 seconds
    const seconds = getSecondsFromTimeInput(inputId);
    setTimeInputSeconds(inputId, seconds + 5);
    
    // Haptic feedback on mobile
    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
}

function decrementTimeValue(inputId) { // -5 seconds
    const seconds = getSecondsFromTimeInput(inputId);
    setTimeInputSeconds(inputId, seconds - 5);
    
    // Haptic feedback on mobile
    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
}

function startAdjustment(actionFn) {
    if (isAdjusting || isScrolling) return;
    isAdjusting = true;

    // Fire the first action immediately on press
    actionFn();

    // After 420ms hold, start repeating
    adjustmentTimeout = setTimeout(() => {
        adjustmentInterval = setInterval(actionFn, 150);

        // Speed up after 2 more seconds
        speedUpTimeout = setTimeout(() => {
            clearInterval(adjustmentInterval);
            adjustmentInterval = setInterval(actionFn, 75);
        }, 2000);
    }, 420);
}

function stopAdjustment() {
    clearTimeout(adjustmentTimeout);
    adjustmentTimeout = null;
    clearTimeout(speedUpTimeout);
    speedUpTimeout = null;
    clearInterval(adjustmentInterval);
    adjustmentInterval = null;
    isAdjusting = false;
}

function cancelAllAdjustments() {
    stopAdjustment();
}

// ============================================
// CIRCUITS INCREMENT/DECREMENT (still uses +/- 1)
// ============================================
function incrementValue(inputId) {
    const input = document.getElementById(inputId);
    const currentValue = parseInt(input.value) || 0;
    const min = parseInt(input.min) || 0;
    const max = parseInt(input.max) || 999;
    
    if (currentValue < max) {
        input.value = currentValue + 1;
        input.dispatchEvent(new Event('input'));
        
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    }
}

function decrementValue(inputId) {
    const input = document.getElementById(inputId);
    const currentValue = parseInt(input.value) || 0;
    const min = parseInt(input.min) || 0;
    
    if (currentValue > min) {
        input.value = currentValue - 1;
        input.dispatchEvent(new Event('input'));
        
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    }
}

function switchTab(tab) {
    const { viewTimer, viewSettings } = DOM;

    if (tab === 'timer') {
        viewSettings.classList.remove('active');
        viewTimer.classList.add('active');
        updateTotalTimeDisplay();
    } else {
        viewTimer.classList.remove('active');
        viewSettings.classList.add('active');
        if (state.raf && !state.isPaused) togglePause();
    }
}

function toggleMute() { 
    appState.voiceEnabled = !appState.voiceEnabled; 
    handleMuteToggle(appState.voiceEnabled);
    saveSettings();
}

function handleMuteToggle(isUnmuted) {
    const { btnMute, iconMuted, iconUnmuted } = DOM;
    if (isUnmuted) { 
        btnMute.classList.remove('is-muted');
        btnMute.setAttribute('aria-pressed', 'false');
        btnMute.setAttribute('aria-label', 'Mute audio');
        iconMuted.classList.add('hidden'); 
        iconUnmuted.classList.remove('hidden'); 
    } else { 
        btnMute.classList.add('is-muted');
        btnMute.setAttribute('aria-pressed', 'true');
        btnMute.setAttribute('aria-label', 'Unmute audio');
        iconMuted.classList.remove('hidden'); 
        iconUnmuted.classList.add('hidden'); 
        speechManager.cancel();
    }
}

// speak() is ONLY for voice TTS. Beep sounds are triggered directly
// via beep() at each phase transition and countdown tick.
function speak(text) {
    if (!appState.voiceEnabled) return;
    if (appState.audioType === 'beep') return;
    speechManager.speak(text, appState.voiceEnabled);
}

// beep() is ONLY for beep mode. Called directly at phase transitions and countdown.
function beep(type) {
    if (!appState.voiceEnabled) return;
    if (appState.audioType !== 'beep') return;
    switch (type) {
        case 'prepare':   soundManager.playPrepare();   break;
        case 'work':      soundManager.playWorkStart(); break;
        case 'rest':      soundManager.playRestStart(); break;
        case 'cooldown':  soundManager.playRestStart(); break;
        case 'countdown': soundManager.playCountdown(); break;
        case 'complete':  soundManager.playComplete();  break;
    }
}

function updateProgress(percent) { 
    // Direct update for smooth animation via requestAnimationFrame
    DOM.progressCircle.style.strokeDashoffset = CIRCUMFERENCE - (percent / 100 * CIRCUMFERENCE);
}

function refillProgress() {
    // Temporarily enable transition for smooth refill
    DOM.progressCircle.style.transition = 'stroke-dashoffset 0.05s ease-out, stroke 0.4s ease';
    
    // Set to full
    DOM.progressCircle.style.strokeDashoffset = '0';
    
    // Remove transition after animation
    setTimeout(() => {
        DOM.progressCircle.style.transition = 'stroke 0.4s ease';
    }, 50);
}

function formatTime(seconds) { seconds = Math.max(0, Math.floor(seconds)); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }
function parseExercises() { 
    const defaultWork = getSecondsFromTimeInput('input-work'); 
    return appState.exercises.map((item, index) => { 
        return { 
            name: item.name || `Exercise ${index + 1}`, 
            duration: item.duration ?? defaultWork 
        }; 
    }); 
}

function updateExerciseDisplay(text) {
    DOM.exerciseTextEl.innerText = text;
    const len = text.length;
    let fontSize;

    if (len <= 10) {
        fontSize = '10.0cqw';
    } else if (len <= 20) {
        fontSize = '8.5cqw';
    } else if (len <= 30) {
        fontSize = '7.0cqw';
    } else {
        fontSize = '5.5cqw';
    }
    DOM.exerciseTextEl.style.fontSize = fontSize;
}

function calculateTotalTime() {
    if (appState.exercises.length === 0) return 0;
    
    const circuits = parseInt(DOM.inputRounds.value);
    const restTime = getSecondsFromTimeInput('input-rest');
    const prepTime = getSecondsFromTimeInput('input-prepare');
    const coolDownTime = getSecondsFromTimeInput('input-cooldown');
    const defaultWork = getSecondsFromTimeInput('input-work');
    
    let totalWorkTime = 0;
    appState.exercises.forEach(ex => {
        totalWorkTime += (ex.duration !== null ? ex.duration : defaultWork);
    });
    
    const totalTime = prepTime + (totalWorkTime * circuits) + (restTime * (appState.exercises.length * circuits - 1)) + coolDownTime;
    
    return totalTime;
}

function updateProgressBar(time, isRunning) {
    if (!DOM.totalProgressBar) return;

    let progress;
    if (isRunning) {
        // Increment — grows from 0% to 100% as workout progresses
        progress = (state.initialTotalTime > 0) ? (1 - time / state.initialTotalTime) * 100 : 0;
    } else {
        // Set static state: 0% when not running
        progress = 0;
    }
    DOM.totalProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function updateTotalTimeDisplay(secondsOverride = null) {
    // If a specific time is provided (during workout), use it. 
    // Otherwise calculate from settings (during setup).
    const totalSeconds = secondsOverride !== null ? secondsOverride : calculateTotalTime();

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    DOM.totalTimeDisplayEl.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Show/hide when no time configured
    if (secondsOverride === null && totalSeconds === 0) {
        DOM.totalTimeDisplayEl.classList.add('opacity-0');
        if (DOM.totalProgressBarContainer) DOM.totalProgressBarContainer.classList.add('opacity-0');
    } else {
        DOM.totalTimeDisplayEl.classList.remove('opacity-0');
        if (DOM.totalProgressBarContainer) DOM.totalProgressBarContainer.classList.remove('opacity-0');
    }

    // Update Total Progress Bar only when timer is NOT running.
    // When timer is running, it's handled by updateProgressBarOnly on each frame.
    if (!state.raf && !state.isPaused) { updateProgressBar(totalSeconds, false); }
}

function updateCountsDisplay() {
    const totalCircuits = parseInt(DOM.inputRounds.value) || 1;
    const count = appState.exercises.length || 0;
    
    // Always show the counts based on current settings
    if (count > 0) {
        DOM.circuitDisplayEl.innerText = `Circuit 1 / ${totalCircuits} · Exercise 1 / ${count}`;
    } else {
        DOM.circuitDisplayEl.innerText = 'Add Exercises';
    }
    
    // Show first exercise as "Next" when stopped
    if (!state.raf && !state.isPaused) {
        if (count > 0) {
            DOM.nextExerciseNameEl.innerText = appState.exercises[0].name || "Exercise 1";
            DOM.nextUpContainer.classList.remove('opacity-0');
            DOM.nextUpContainer.classList.add('opacity-100');
        } else {
            DOM.nextUpContainer.classList.remove('opacity-100');
            DOM.nextUpContainer.classList.add('opacity-0');
        }
    }
}

function getIntervalData(index) { 
    const listSize = state.exerciseObjects.length; 
    if (listSize === 0) return null; 
    return { 
        exercise: state.exerciseObjects[index % listSize], 
        exerciseNum: (index % listSize) + 1, 
        circuitNum: Math.floor(index / listSize) + 1, 
        isLastOverall: (index === (listSize * parseInt(DOM.inputRounds.value)) - 1) 
    }; 
}

const phaseStyles = {
    prepare: { circle: 'text-blue-500', text: 'text-blue-400', bar: 'bg-blue-500', shadow: 'shadow-[0_0_10px_rgba(59,130,246,0.5)]' },
    work:    { circle: 'text-emerald-500', text: 'text-emerald-400', bar: 'bg-emerald-500', shadow: 'shadow-[0_0_10px_rgba(16,185,129,0.5)]' },
    rest:    { circle: 'text-orange-500', text: 'text-orange-400', bar: 'bg-orange-500', shadow: 'shadow-[0_0_10px_rgba(245,158,11,0.5)]' },
    cooldown:{ circle: 'text-teal-500', text: 'text-teal-400', bar: 'bg-teal-500', shadow: 'shadow-[0_0_10px_rgba(20,184,166,0.5)]' },
};
const allCircleClasses = Object.values(phaseStyles).map(s => s.circle);
const allTextClasses = Object.values(phaseStyles).map(s => s.text);
const allBarClasses = Object.values(phaseStyles).map(s => s.bar);
const allShadowClasses = Object.values(phaseStyles).map(s => s.shadow);

function setVisualState(phase, instant = false) {
    if (instant) { DOM.progressCircle.style.transition = 'none'; }

    const style = phaseStyles[phase];
    if (style) {
        DOM.progressCircle.classList.remove(...allCircleClasses, 'text-yellow-300', 'text-yellow-400');
        DOM.progressCircle.classList.add(style.circle);
        
        DOM.exerciseTextEl.classList.remove(...allTextClasses, 'text-yellow-300', 'text-yellow-400');
        DOM.exerciseTextEl.classList.add(style.text);

        DOM.totalProgressBar.classList.remove(...allBarClasses, ...allShadowClasses, 'bg-yellow-300', 'shadow-[0_0_10px_rgba(253,224,71,0.5)]');
        DOM.totalProgressBar.classList.add(style.bar, style.shadow);
    }

    const srAnnounce = (msg) => {
        const el = DOM.srAnnouncement;
        if (el) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }
    };

    if (phase === 'prepare') {
        updateExerciseDisplay("Get Ready");
        const info = getIntervalData(0);
        DOM.circuitDisplayEl.innerText = `Circuit ${info.circuitNum} / ${DOM.inputRounds.value} · Exercise ${info.exerciseNum} / ${state.exerciseObjects.length}`;
        DOM.nextExerciseNameEl.innerText = info.exercise.name;
        DOM.nextUpContainer.classList.replace('opacity-0', 'opacity-100');
        srAnnounce(`Get ready. First exercise: ${info.exercise.name}.`);
        beep('prepare');
        speak(`Get ready. First, ${info.exercise.name}.`);
    } else if (phase === 'rest') {
        updateExerciseDisplay("Rest");
        const info = getIntervalData(state.globalIntervalIndex + 1);
        DOM.nextExerciseNameEl.innerText = info.exercise.name;
        DOM.nextUpContainer.classList.replace('opacity-0', 'opacity-100');
        srAnnounce(`Rest. Next: ${info.exercise.name}.`);
        beep('rest');
        speak(`Rest. Next is ${info.exercise.name}.`);
    } else if (phase === 'cooldown') {
        updateExerciseDisplay("Cool Down");
        // circuit/exercise display intentionally left unchanged during cool down
        DOM.nextExerciseNameEl.innerText = "Complete";
        DOM.nextUpContainer.classList.replace('opacity-0', 'opacity-100');
        srAnnounce("Cool Down");
        beep('cooldown');
        speak("Cool Down");
    } else {
        const info = getIntervalData(state.globalIntervalIndex);
        updateExerciseDisplay(info.exercise.name);
        DOM.circuitDisplayEl.innerText = `Circuit ${info.circuitNum} / ${DOM.inputRounds.value} · Exercise ${info.exerciseNum} / ${state.exerciseObjects.length}`;
        
        if (!info.isLastOverall) {
            const restTime = getSecondsFromTimeInput('input-rest');
            if (restTime > 0) {
                DOM.nextExerciseNameEl.innerText = "Rest";
                DOM.nextUpContainer.classList.replace('opacity-0', 'opacity-100');
            } else {
                // No rest phase — show next exercise instead
                const nextInfo = getIntervalData(state.globalIntervalIndex + 1);
                DOM.nextExerciseNameEl.innerText = nextInfo ? nextInfo.exercise.name : '';
                DOM.nextUpContainer.classList.replace('opacity-0', 'opacity-100');
            }
        } else {
            DOM.nextUpContainer.classList.replace('opacity-100', 'opacity-0');
        }
        srAnnounce(`${info.exercise.name}. Exercise ${info.exerciseNum} of ${state.exerciseObjects.length}.`);
        beep('work');
        speak(info.exercise.name + ", Begin.");
    }

    if (instant) { DOM.progressCircle.style.transition = ''; }
}

function runTimerLoop() {
    if (state.isPaused) return;
    
    state.raf = requestAnimationFrame(runTimerLoop);
    
    const now = Date.now();
    const timeLeftMs = state.phaseEndTime - now;
    
    if (timeLeftMs <= 0) {
        cancelAnimationFrame(state.raf);
        nextPhase();
        return;
    }

    // Smooth progress update
    const percent = (timeLeftMs / (state.totalPhaseSeconds * 1000)) * 100;
    updateProgress(percent);

    // Integer second updates for text display
    const currentSeconds = Math.ceil(timeLeftMs / 1000);
    if (currentSeconds !== state.secondsRemaining) {
        state.secondsRemaining = currentSeconds;
        DOM.timeLeftEl.innerText = formatTime(state.secondsRemaining);
        
        // Derive total time remaining from precise workoutEndTime to prevent drift
        const preciseTotalTime = state.workoutEndTime > 0 ? Math.max(0, (state.workoutEndTime - now) / 1000) : 0;
        // Keep integer state in sync for skip calculations
        state.totalTimeRemaining = Math.ceil(preciseTotalTime);
        updateTotalTimeDisplay(Math.ceil(preciseTotalTime));
        
        if (state.secondsRemaining <= 3 && state.secondsRemaining > 0) {
            beep('countdown');
            speak(state.secondsRemaining.toString());
        }
    }
    if (
        state.workoutEndTime > 0 &&
        (state.lastProgressBarUpdateAt === 0 ||
         (now - state.lastProgressBarUpdateAt) >= TOTAL_PROGRESS_UPDATE_INTERVAL_MS ||
         timeLeftMs <= 250)
    ) {
        const preciseTotalTime = Math.max(0, (state.workoutEndTime - now) / 1000);
        updateProgressBar(preciseTotalTime, true);
        state.lastProgressBarUpdateAt = now;
    }
}

function nextPhase(isManualSkip = false) {
    if (!state.raf) return;
    // Cancel current loop frame to prevent double-fire
    cancelAnimationFrame(state.raf);
    
    // For natural transitions, the new phase starts exactly when the old one was scheduled to end.
    // This prevents drift. For manual skips, it starts now.
    const newPhaseBaseTime = isManualSkip ? Date.now() : state.phaseEndTime;

    // If skipping manually, deduct precise time left in current phase
    if (isManualSkip) {
        let timeToSkip = 0;
        if (state.isPaused) {
            timeToSkip = state.pausedTimeRemainingMs;
        } else {
            timeToSkip = Math.max(0, state.phaseEndTime - Date.now());
        }

        if (timeToSkip > 0) {
            state.workoutEndTime -= timeToSkip;
            
            // Update integer display
            const skippedSeconds = Math.ceil(timeToSkip / 1000);
            state.totalTimeRemaining = Math.max(0, state.totalTimeRemaining - skippedSeconds);
            updateTotalTimeDisplay(state.totalTimeRemaining);

            // Force update progress bar immediately
            const preciseTotalTime = Math.max(0, (state.workoutEndTime - Date.now()) / 1000);
            updateProgressBar(preciseTotalTime, true);
        }
    }
    if (state.currentPhase === 'prepare') { state.currentPhase = 'work'; state.globalIntervalIndex = 0; state.totalPhaseSeconds = getIntervalData(0).exercise.duration; }
    else if (state.currentPhase === 'work') { 
        if (getIntervalData(state.globalIntervalIndex).isLastOverall) { 
            const coolDown = getSecondsFromTimeInput('input-cooldown');
            if (coolDown > 0) {
                state.currentPhase = 'cooldown';
                state.totalPhaseSeconds = coolDown;
            } else {
                completeWorkout(); return; 
            }
        } else {
            const restSeconds = getSecondsFromTimeInput('input-rest');
            if (restSeconds > 0) {
                state.currentPhase = 'rest';
                state.totalPhaseSeconds = restSeconds;
            } else {
                state.globalIntervalIndex++;
                state.currentPhase = 'work';
                state.totalPhaseSeconds = getIntervalData(state.globalIntervalIndex).exercise.duration;
            }
        }
    }
    else if (state.currentPhase === 'cooldown') { completeWorkout(); return; }
    else { state.globalIntervalIndex++; state.currentPhase = 'work'; state.totalPhaseSeconds = getIntervalData(state.globalIntervalIndex).exercise.duration; } // Rest -> Work
    state.secondsRemaining = state.totalPhaseSeconds;
    
    setVisualState(state.currentPhase, isManualSkip);
    DOM.timeLeftEl.innerText = formatTime(state.secondsRemaining);

    // Force update total time display to ensure continuity (e.g. showing 5:00 between 5:01 and 4:59)
    const now = Date.now();
    const preciseTotalTime = state.workoutEndTime > 0 ? Math.max(0, (state.workoutEndTime - now) / 1000) : 0;
    state.totalTimeRemaining = Math.ceil(preciseTotalTime);
    updateTotalTimeDisplay(state.totalTimeRemaining);

    refillProgress();
    
    if (!state.isPaused) {
        state.phaseEndTime = newPhaseBaseTime + (state.totalPhaseSeconds * 1000);
        runTimerLoop();
    } else {
        // If paused, prepare the time for when we eventually resume
        state.pausedTimeRemainingMs = state.totalPhaseSeconds * 1000;
        // Also update phaseEndTime so it's correct when we unpause.
        state.phaseEndTime = newPhaseBaseTime + (state.totalPhaseSeconds * 1000);
    }
}

async function startWorkout() {
    state.exerciseObjects = parseExercises();
    if (state.exerciseObjects.length === 0) {
        // No exercises — guide the user to Settings to add some
        switchTab('settings');
        // Briefly highlight the exercises section via the toast
        const box = DOM.messageBox;
        if (box) {
            box.textContent = 'Add at least one exercise first';
            box.style.opacity = '1';
            clearTimeout(box._hideTimer);
            box._hideTimer = setTimeout(() => { box.style.opacity = '0'; }, 2500);
        }
        // Scroll the exercises list into view so the user sees exactly where to act
        setTimeout(() => {
            const exercisesList = DOM.exercisesList;
            if (exercisesList) exercisesList.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
        return;
    }
    
    // Clean up any completion animations from previous workout
    animationManager.stopAll();
    DOM.exerciseTextEl.classList.remove('text-yellow-300', 'text-yellow-400');
    DOM.progressCircle.classList.remove('text-yellow-300', 'text-yellow-400');
    
    // Remove completion glow if it exists
    const completionGlow = document.getElementById('completion-glow');
    if (completionGlow) completionGlow.remove();
    
    await wakeLockManager.enable();
    
    const startTime = Date.now();
    const prep = getSecondsFromTimeInput('input-prepare');
    state.isPaused = false;
    state.currentPhase = prep > 0 ? 'prepare' : 'work';
    state.totalPhaseSeconds = prep > 0 ? prep : getIntervalData(0).exercise.duration;
    state.secondsRemaining = state.totalPhaseSeconds;
    state.phaseEndTime = startTime + (state.totalPhaseSeconds * 1000);
    state.totalTimeRemaining = calculateTotalTime(); // Initialize total countdown
    state.initialTotalTime = state.totalTimeRemaining; // Store initial total for progress bar
    state.workoutEndTime = startTime + (state.initialTotalTime * 1000);
    state.lastProgressBarUpdateAt = 0;
    
    DOM.timeLeftEl.innerText = formatTime(state.secondsRemaining); 
    updateProgress(100); // Set initial progress to full
    
    setVisualState(state.currentPhase);
    DOM.btnStart.classList.add('hidden');
    DOM.btnPause.classList.remove('hidden');
    
    // Start timer AFTER displaying initial state
    if (state.raf) cancelAnimationFrame(state.raf);
    runTimerLoop();
    switchTab('timer');
}

async function togglePause() { 
    if (!state.raf && !state.isPaused) return; 
    state.isPaused = !state.isPaused; 
    
    if (state.isPaused) {
        cancelAnimationFrame(state.raf);
        // Calculate exact remaining time to preserve precision
        state.pausedTimeRemainingMs = state.phaseEndTime - Date.now();
        state.pauseStartTime = Date.now();
        
        await wakeLockManager.disable();
        speechManager.cancel();
        DOM.btnStart.innerHTML = PLAY_ICON_HTML;
    } else {
        // Resume using exact stored time
        state.phaseEndTime = Date.now() + state.pausedTimeRemainingMs;
        if (state.pauseStartTime > 0) {
            const pauseDuration = Date.now() - state.pauseStartTime;
            state.workoutEndTime += pauseDuration;
            state.pauseStartTime = 0;
        }
        await wakeLockManager.enable();
        runTimerLoop();
    }
    
    DOM.btnStart.classList.toggle('hidden', !state.isPaused); 
    DOM.btnPause.classList.toggle('hidden', state.isPaused); 
}

async function completeWorkout() { 
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null; 
    
    await wakeLockManager.disable();

    // Set final time to 00:00 on both the phase timer and total timer
    DOM.timeLeftEl.innerText = formatTime(0);
    state.totalTimeRemaining = 0;
    updateTotalTimeDisplay(state.totalTimeRemaining);
    
    // Visual celebration - synchronized pulsing
    // Change text to soft pastel yellow
    updateExerciseDisplay("Amazing!");
    DOM.exerciseTextEl.classList.remove(...allTextClasses);
    DOM.exerciseTextEl.classList.add('text-yellow-300');
    
    // WAAPI: Pulse Text
    animationManager.pulseScale(DOM.exerciseTextEl);
    
    // Make the circle full (100%) so entire circle glows
    refillProgress();
    
    // WAAPI: Pulse Circle Stroke
    animationManager.pulseStroke(DOM.progressCircle);
    
    // Add circular radial glow behind the circle - soft pastel yellow
    const progressContainer = document.querySelector('.progress-svg-container');
    const glowDiv = document.createElement('div');
    glowDiv.className = 'pulse-radial-glow';
    glowDiv.id = 'completion-glow';
    progressContainer.insertBefore(glowDiv, progressContainer.firstChild);
    
    // WAAPI: Pulse Radial Glow
    animationManager.pulseGlow(glowDiv);
    
    // Vibration feedback (if supported)
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
    }
    
    // Make progress circle soft yellow for completion
    DOM.progressCircle.classList.remove(...allCircleClasses, 'text-yellow-400');
    DOM.progressCircle.classList.add('text-yellow-300');

    // Hide progress bar, show medal
    DOM.totalProgressBarContainer.classList.add('opacity-0');
    const medalEl = DOM.completionMedal;
    if (medalEl) { medalEl.classList.remove('hidden'); animationManager.pulseScale(medalEl); }
    
    DOM.nextUpContainer.classList.replace('opacity-100', 'opacity-0');
    DOM.btnStart.innerHTML = PLAY_ICON_HTML;
    DOM.btnStart.classList.remove('hidden'); 
    DOM.btnPause.classList.add('hidden'); 
    beep('complete');
    speak("Workout complete! Great job!"); 
}

// ============================================
// SOFT RESET FUNCTION (No Page Reload)
// ============================================
async function resetTimer() {
    log('🔄 Soft reset initiated');
    
    // Stop and clear timer
    if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
    }
    
    // Cleanup resources
    await wakeLockManager.disable();
    animationManager.stopAll();
    speechManager.cancel();
    
    // Reset all state variables
    state.isPaused = false;
    state.currentPhase = 'prepare';
    state.globalIntervalIndex = 0;
    state.secondsRemaining = 0;
    state.totalPhaseSeconds = 0;
    state.initialTotalTime = 0;
    state.workoutEndTime = 0;
    state.pauseStartTime = 0;
    state.lastProgressBarUpdateAt = 0;
    state.exerciseObjects = [];
    
    // Reset UI - Status and Exercise
    updateExerciseDisplay('Get Ready');
    DOM.exerciseTextEl.classList.remove(...allTextClasses, 'text-yellow-300', 'text-yellow-400');
    DOM.exerciseTextEl.classList.add('text-blue-400');
    
    DOM.timeLeftEl.innerText = '00:00';
    updateCountsDisplay();
    
    // Reset total time display
    updateTotalTimeDisplay(); // Instant update for reset
    
    // Reset buttons
    DOM.btnStart.innerHTML = PLAY_ICON_HTML;
    DOM.btnStart.classList.remove('hidden');
    DOM.btnPause.classList.add('hidden');
    
    // Reset progress circle
    DOM.progressCircle.classList.remove(...allCircleClasses, 'text-yellow-400', 'text-yellow-300');
    DOM.progressCircle.classList.add('text-blue-500');
    updateProgress(100);

    // Reset total progress bar, hide medal
    DOM.totalProgressBar.classList.remove(...allBarClasses, ...allShadowClasses, 'bg-yellow-300', 'shadow-[0_0_10px_rgba(253,224,71,0.5)]');
    DOM.totalProgressBar.classList.add('bg-blue-500', 'shadow-[0_0_10px_rgba(59,130,246,0.5)]');
    DOM.totalProgressBar.style.width = '0%';
    DOM.totalProgressBarContainer.style.transition = 'none';
    DOM.totalProgressBarContainer.classList.remove('opacity-0');
    DOM.nextUpContainer.style.transition = 'none';
    requestAnimationFrame(() => {
        DOM.totalProgressBarContainer.style.transition = '';
        DOM.nextUpContainer.style.transition = '';
    });
    const medalEl = DOM.completionMedal;
    if (medalEl) medalEl.classList.add('hidden');
    
    // Remove celebration glow
    const completionGlow = document.getElementById('completion-glow');
    if (completionGlow) completionGlow.remove();
    
    // Switch to timer tab
    switchTab('timer');
    
    log('✓ Reset complete');
}

// ============================================
// CENTRALIZED EVENT LISTENER SETUP
// ============================================
function setupEventListeners() {

    // --- Header buttons ---
    document.getElementById('btn-settings').addEventListener('click', () => switchTab('settings'));
    DOM.btnMute.addEventListener('click', toggleMute);

    // --- Timer controls ---
    document.getElementById('btn-skip').addEventListener('click', () => nextPhase(true));
    document.getElementById('btn-reset').addEventListener('click', resetTimer);
    DOM.btnStart.addEventListener('click', async () => {
        speechManager.initialize();
        await soundManager.unlock();
        if (state.raf && state.isPaused) {
            togglePause();
        } else {
            startWorkout();
        }
    });
    DOM.btnPause.addEventListener('click', togglePause);

    // --- Settings done button ---
    document.getElementById('btn-settings-done').addEventListener('click', () => {
        switchTab('timer');
        showSettingsSaved();
    });

    // --- Audio type selection ---
    DOM.btnAudioVoice.addEventListener('click', () => setAudioType('voice'));
    DOM.btnAudioBeep.addEventListener('click', () => setAudioType('beep'));

    // --- Routine management ---
    DOM.routineDropdownSelect.addEventListener('click', () => toggleDropdown());
    DOM.btnUpdateRoutine.addEventListener('click', updateRoutine);
    document.getElementById('btn-save-routine').addEventListener('click', saveRoutine);
    DOM.btnRenameRoutine.addEventListener('click', renameRoutine);
    document.getElementById('btn-delete-routine').addEventListener('click', deleteRoutine);

    // --- Export / Import ---
    document.getElementById('btn-export').addEventListener('click', exportRoutines);
    document.getElementById('btn-import').addEventListener('click', () => DOM.importFile.click());
    DOM.importFile.addEventListener('change', function() { handleFileImport(this); });
    document.getElementById('btn-restore-defaults').addEventListener('click', restoreDefaultRoutines);

    // --- Add exercise ---
    document.getElementById('btn-add-exercise').addEventListener('click', addNewExerciseRow);

    // --- Time inputs: click-to-select and blur handling ---
    ['input-work', 'input-rest', 'input-prepare', 'input-cooldown'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('click', function() { this.select(); });
        input.addEventListener('blur', function() {
            handleTimeBlur(id);
            updateIntervalRowDim(id);
        });
    });

    // input-rounds: click-to-select and blur to clamp/validate
    const roundsInput = DOM.inputRounds;
    roundsInput.addEventListener('click', function() { this.select(); });
    roundsInput.addEventListener('blur', function() {
        const clamped = Math.max(1, Math.min(999, parseInt(this.value) || 1));
        if (parseInt(this.value) !== clamped) {
            this.value = clamped;
            this.dispatchEvent(new Event('input'));
        }
    });

    // --- Stepper buttons: unified pointerdown handler ---
    // Uses data-action and data-target attributes set on each button in HTML.
    // Stop listeners are on document (not the button) so they always fire,
    // and we avoid pointerleave which fires unreliably once pointer capture
    // is active (the press-feedback handler captures the pointer).
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('.stepper-btn');
        if (!btn) return;

        const action = btn.dataset.action;
        const target = btn.dataset.target;
        if (!action || !target) return;

        let actionFn;
        if (action === 'time-increment') actionFn = () => incrementTimeValue(target);
        else if (action === 'time-decrement') actionFn = () => decrementTimeValue(target);
        else if (action === 'increment') actionFn = () => incrementValue(target);
        else if (action === 'decrement') actionFn = () => decrementValue(target);
        else return;

        startAdjustment(actionFn);

        const stop = () => {
            stopAdjustment();
            document.removeEventListener('pointerup', stop);
            document.removeEventListener('pointercancel', stop);
        };
        document.addEventListener('pointerup', stop);
        document.addEventListener('pointercancel', stop);
    });

    // --- Dropdown close on outside click ---
    document.addEventListener('click', (e) => {
        const dropdown = DOM.routineDropdown;
        if (dropdown && !dropdown.contains(e.target)) {
            toggleDropdown(false);
        }
    });

    // --- Page visibility ---
    document.addEventListener('visibilitychange', () => {
        if (!state.raf || state.isPaused) return;
        if (document.hidden) {
            cancelAnimationFrame(state.raf);
            state.pausedTimeRemainingMs = Math.max(0, state.phaseEndTime - Date.now());
            state.pauseStartTime = Date.now();
        } else {
            if (state.pauseStartTime > 0) {
                const pauseDuration = Date.now() - state.pauseStartTime;
                state.workoutEndTime += pauseDuration;
                state.phaseEndTime = Date.now() + state.pausedTimeRemainingMs;
                state.pauseStartTime = 0;
                runTimerLoop();
            }
        }
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (state.raf || state.isPaused) {
                    togglePause();
                } else {
                    speechManager.initialize();
                    soundManager.unlock().then(() => startWorkout());
                }
                break;
            case 'KeyR': resetTimer(); break;
            case 'KeyM': toggleMute(); break;
            case 'ArrowRight': if (state.raf && !state.isPaused) nextPhase(true); break;
        }
    });

    // --- Button press visual feedback (generic) ---
    // Stepper buttons are excluded: they manage their own press state and
    // we must not capture their pointer here, as that would cause pointerleave
    // to fire immediately and break the hold-to-repeat logic.
    document.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('.ios-button');
        if (!btn) return;
        if (btn.classList.contains('stepper-btn')) return; // handled separately
        btn.classList.add('is-pressed');
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        const clear = (ev) => {
            btn.classList.remove('is-pressed');
            try { btn.releasePointerCapture(ev.pointerId); } catch (_) {}
            ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'].forEach(evt => btn.removeEventListener(evt, clear));
        };
        ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'].forEach(evt => btn.addEventListener(evt, clear));
    });

    // --- Scroll vs tap detection (for stepper cancel) ---
    window.addEventListener('touchstart', (e) => {
        isScrolling = false;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (Math.abs(e.touches[0].clientY - touchStartY) > 10) {
            if (!isScrolling) {
                isScrolling = true;
                cancelAllAdjustments();
            }
        }
    }, { passive: true });

    // --- beforeunload cleanup ---
    window.addEventListener('beforeunload', async () => {
        flushSettingsSave();
        await wakeLockManager.disable();
        speechManager.cancel();
    });
}

function init() {
    DOM.progressCircle.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
    loadRoutines();
    loadSettings();
    renderExerciseList();
    setupAutoSave();
    setupEventListeners();
    updateAllIntervalRowDims();
    DOM.timeLeftEl.innerText = formatTime(0);
    updateTotalTimeDisplay();
    updateCountsDisplay();
    updateExerciseDisplay('Get Ready');

    // Register service worker for PWA / offline support
    // and proactively check for updates on each app load.
    if ('serviceWorker' in navigator) {
        (async () => {
            try {
                const registration = await navigator.serviceWorker.register('./service-worker.js');

                // Force an update check. If nothing changed, this is a no-op.
                await registration.update();

                let hasRefreshed = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (hasRefreshed) return;
                    hasRefreshed = true;
                    window.location.reload();
                });
            } catch (e) {
                warn('Service worker registration/update failed:', e);
            }
        })();
    }
}

// The script has `defer`, so the DOM is fully parsed by the time this runs.
init();